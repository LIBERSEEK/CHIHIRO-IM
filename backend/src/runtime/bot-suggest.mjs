import { logError } from './log.mjs'
import { normalizeBotSession, sessionPeerKey } from './bot.mjs'
import { lookupFacts, needsLookup } from './bot-lookup.mjs'

const SUGGEST_TIMEOUT_MS = 40_000
const CACHE_TTL_MS = 30_000
const PROMPT = `你在协助操作员回复即时消息。只输出 JSON，不要 Markdown，不要自称 AI。
格式：{"replies":[{"id":"1","text":"选项","score":0.82}],"summary":"可直接发送的完整回复"}
replies：1 到 3 条不同角度、像真人会发的下一句选项，score 为 0 到 1。
summary：一条总结性、语气完整、可直接发出的回复，不要与 replies 逐字相同。
把下面整段对话当成一次说话来回，不要对每一句分别回复。连续发言可能来自不同的人，按一场对话来接。前面是上下文，重点回末尾「本轮待回」。
需要事实时只根据「检索依据」写下一句，不要编造，不要提工具、检索或 AI。没有依据时用自然追问或「我去查一下」。
群聊里：被 @、被提问、刚回过话、或多人正在讨论且值得插入时给出下一句；纯闲聊、应和、单人自说自话时输出空 replies 和空 summary。`

function emptySuggest(lastMessageId = '') {
  return { lastMessageId: String(lastMessageId || ''), replies: [], summary: '' }
}

export function pickAutoText(result) {
  const summary = typeof result?.summary === 'string' ? result.summary.trim() : ''
  if (summary) return summary
  const replies = Array.isArray(result?.replies) ? result.replies : []
  let best = null
  for (const item of replies) {
    const text = typeof item?.text === 'string' ? item.text.trim() : ''
    if (!text) continue
    const score = Number(item?.score)
    const next = { text, score: Number.isFinite(score) ? score : 0 }
    if (!best || next.score > best.score) best = next
  }
  return best?.text || ''
}

export function parseSuggestReplies(text, lastMessageId = '') {
  const trimmed = String(text || '').trim()
  if (!trimmed) return emptySuggest(lastMessageId)
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const raw = fence ? fence[1].trim() : trimmed
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return emptySuggest(lastMessageId)
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1))
    const list = Array.isArray(parsed?.replies) ? parsed.replies : Array.isArray(parsed) ? parsed : []
    const replies = []
    for (const item of list) {
      if (replies.length >= 3) break
      const textValue = typeof item?.text === 'string' ? item.text.trim() : ''
      if (!textValue) continue
      const score = Number(item?.score)
      replies.push({
        id: String(item?.id || replies.length + 1),
        text: textValue,
        score: Number.isFinite(score) ? Math.min(1, Math.max(0, score)) : 0,
      })
    }
    const summary = typeof parsed?.summary === 'string' ? parsed.summary.trim() : ''
    return { lastMessageId: String(parsed?.lastMessageId || lastMessageId || ''), replies, summary }
  } catch {
    return emptySuggest(lastMessageId)
  }
}

export function collectSsePlain(body) {
  const text = String(body || '')
  if (!text.includes('data:')) {
    try {
      const parsed = JSON.parse(text)
      if (typeof parsed?.data === 'string') return parsed.data
      if (typeof parsed?.message === 'string') return parsed.message
    } catch { /* not json */ }
    return text
  }
  const chunks = []
  for (const block of text.split(/\n\n+/)) {
    const line = block.split('\n').find((item) => item.startsWith('data:'))
    if (!line) continue
    const payload = line.slice(5).trim()
    if (!payload || payload === '[DONE]') continue
    try {
      const event = JSON.parse(payload)
      if (event?.type === 'plain' && event.data != null) chunks.push(String(event.data))
      else if (event?.type === 'end' || event?.type === 'complete') continue
      else if (typeof event?.data === 'string' && event.type !== 'session_id' && event.type !== 'user_message_saved') {
        chunks.push(event.data)
      }
    } catch {
      chunks.push(payload)
    }
  }
  return chunks.join('')
}

function clipMessages(messages) {
  if (!Array.isArray(messages)) return []
  const out = []
  for (const item of messages.slice(-24)) {
    const role = item?.role === 'me' ? 'me' : item?.role === 'them' ? 'them' : ''
    const text = typeof item?.text === 'string' ? item.text.trim() : ''
    if (!role || !text) continue
    const name = typeof item.name === 'string' ? item.name.trim().slice(0, 24) : ''
    out.push({ role, name, text: text.slice(0, 500) })
  }
  return out
}

function formatLine(item) {
  const who = item.role === 'me' ? 'me' : (item.name ? `them(${item.name})` : 'them')
  return `${who}: ${item.text}`
}

function splitTurn(messages) {
  const clipped = clipMessages(messages)
  let lastMe = -1
  for (let index = clipped.length - 1; index >= 0; index--) {
    if (clipped[index].role === 'me') {
      lastMe = index
      break
    }
  }
  return {
    clipped,
    pending: clipped.slice(lastMe + 1).filter((item) => item.role === 'them'),
  }
}

function turnBlock(pending, facts = '') {
  const turn = pending.length
    ? `本轮待回：\n${pending.map(formatLine).join('\n')}`
    : '本轮待回：（无新消息）'
  const evidence = facts ? `\n检索依据（内部，勿发给客户）：\n${facts}` : ''
  return `${turn}${evidence}`
}

export function buildPrompt(messages, type, facts = '', continued = false) {
  const { clipped, pending } = splitTurn(messages)
  if (continued) {
    return `${turnBlock(pending, facts)}\n\n这是同一场对话的下一轮。沿用已知上下文，不要重复已经说过的话。只输出 JSON。`
  }
  const lines = clipped.map(formatLine)
  const scene = type === 'group'
    ? '场景：群聊。连续消息可能来自不同的人，先判断要不要接话，再给出一句能插进去的回复。'
    : '场景：私聊，对方可能连发多句。'
  return `${PROMPT}\n\n${scene}\n对话：\n${lines.join('\n') || '(空)'}\n${turnBlock(pending, facts)}\n\n请给出回复建议。`
}

export function suggestSessionId(accountId, type, peerId) {
  return `suggest:${accountId}:${type}:${peerId}`
}

export function digestSessionId(accountId, type, peerId) {
  return `${suggestSessionId(accountId, type, peerId)}:digest`
}

export const DIGEST_MAX_MESSAGES = 200
export const DIGEST_MAX_POINTS = 12

const DIGEST_PROMPT = `你在协助操作员快速看未读即时消息。只输出 JSON，不要 Markdown，不要自称 AI。
格式：{"points":[{"text":"要点","messageId":"消息id"}],"summary":"一两句总览"}
points：3 到 12 条按时间顺序的事件要点，覆盖整段未读的关键进展，每条对应一条关键原消息。
messageId 必须从下面消息的 id 原样复制，不要编造。
不要写回复建议，不要提工具、检索或 AI。
把闲聊、表情、应和合并或省略，突出提问、结论、请求、争议和决定。`

function emptyDigest(lastMessageId = '') {
  return { lastMessageId: String(lastMessageId || ''), replies: [], summary: '', points: [] }
}

function digestCap(max) {
  const n = Math.floor(Number(max))
  if (!Number.isFinite(n) || n <= 0) return DIGEST_MAX_MESSAGES
  return Math.min(DIGEST_MAX_MESSAGES, Math.max(1, n))
}

export function clipDigestMessages(messages, max = DIGEST_MAX_MESSAGES) {
  if (!Array.isArray(messages)) return []
  const cap = digestCap(max)
  const source = messages.slice(-cap)
  const textMax = source.length > 40 ? 160 : 240
  const out = []
  for (const item of source) {
    const id = String(item?.id || '').trim()
    const text = typeof item?.text === 'string' ? item.text.trim() : ''
    if (!text) continue
    const role = item?.role === 'me' ? 'me' : 'them'
    const name = typeof item.name === 'string' ? item.name.trim().slice(0, 24) : ''
    out.push({ id, role, name, text: text.slice(0, textMax) })
  }
  return out
}

function formatDigestLine(item) {
  const who = item.role === 'me' ? 'me' : (item.name ? `them(${item.name})` : 'them')
  const id = item.id ? `[id=${item.id}] ` : ''
  return `${id}${who}: ${item.text}`
}

export function buildDigestPrompt(messages, max = DIGEST_MAX_MESSAGES) {
  const total = Array.isArray(messages) ? messages.length : 0
  const clipped = clipDigestMessages(messages, max)
  const lines = clipped.map(formatDigestLine)
  const omitted = total > clipped.length
    ? `（未读共 ${total} 条，以下为最近 ${clipped.length} 条）\n`
    : ''
  return `${DIGEST_PROMPT}\n\n未读消息：\n${omitted}${lines.join('\n') || '(空)'}\n\n请给出事件要点。`
}

function knownMessageIds(messages, max = DIGEST_MAX_MESSAGES) {
  const ids = new Set()
  for (const item of clipDigestMessages(messages, max)) {
    if (item.id) ids.add(item.id)
  }
  return ids
}

export function parseDigestPoints(text, messages = []) {
  const empty = emptyDigest()
  const trimmed = String(text || '').trim()
  if (!trimmed) return empty
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const raw = fence ? fence[1].trim() : trimmed
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return empty
  let parsed
  try {
    parsed = JSON.parse(raw.slice(start, end + 1))
  } catch {
    return empty
  }
  const ids = knownMessageIds(messages)
  const clipped = clipDigestMessages(messages)
  const list = Array.isArray(parsed?.points) ? parsed.points : []
  const points = []
  for (const item of list) {
    if (points.length >= DIGEST_MAX_POINTS) break
    const pointText = typeof item === 'string' ? item.trim() : String(item?.text || '').trim()
    if (!pointText) continue
    let messageId = String(item?.messageId || item?.message_id || '').trim()
    if (messageId && !ids.has(messageId)) messageId = ''
    if (!messageId && pointText) {
      const hit = clipped.find((row) => row.id && (row.text.includes(pointText.slice(0, 16)) || pointText.includes(row.text.slice(0, 16))))
      if (hit) messageId = hit.id
    }
    points.push({
      id: String(item?.id || points.length + 1),
      text: pointText.slice(0, 160),
      messageId,
    })
  }
  const summary = typeof parsed?.summary === 'string' ? parsed.summary.trim() : ''
  return { lastMessageId: '', replies: [], summary, points }
}

export function createBotSuggest({ store, qq, astrbot, activity, history } = {}) {
  const cache = new Map()
  const opened = new Set()
  const locks = new Map()

  function withSessionLock(sessionId, fn) {
    const prev = locks.get(sessionId) || Promise.resolve()
    const next = prev.then(fn, fn)
    locks.set(sessionId, next)
    return next.finally(() => {
      if (locks.get(sessionId) === next) locks.delete(sessionId)
    })
  }

  function accountOf(id) {
    return (store.list().accounts || []).find((item) => item.id === id) || null
  }

  function sessionOf(accountId, type, peerId) {
    const acc = accountOf(accountId)
    if (!acc) return null
    return normalizeBotSession((acc.botSessions || {})[sessionPeerKey(type, peerId)])
  }

  function cacheKey(accountId, type, peerId, lastMessageId) {
    return `${accountId}:${type}:${peerId}:${lastMessageId}`
  }

  async function astrbotJson(path, { method = 'GET', body, timeout = SUGGEST_TIMEOUT_MS } = {}) {
    await astrbot.ensure()
    const token = astrbot.mintDashboardToken()
    const base = String(astrbot.url || '').replace(/\/$/, '')
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json, text/event-stream',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    })
    const text = await response.text()
    return { ok: response.ok, status: response.status, text }
  }

  function parseAstrbotList(result, keys) {
    if (!result?.ok) return []
    try {
      const parsed = JSON.parse(result.text)
      const data = parsed?.data && typeof parsed.data === 'object' ? parsed.data : parsed
      for (const key of keys) {
        if (Array.isArray(data?.[key])) return data[key]
        if (Array.isArray(parsed?.[key])) return parsed[key]
      }
    } catch { /* ignore malformed payloads */ }
    return []
  }

  async function listConfigs() {
    try {
      const [configResult, sourceResult] = await Promise.all([
        astrbotJson('/api/v1/configs'),
        astrbotJson('/api/v1/provider-sources'),
      ])
      const configs = parseAstrbotList(configResult, ['configs']).flatMap((item) => {
        if (!item || typeof item.id !== 'string' || !item.id) return []
        return [{
          id: item.id,
          name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : item.id,
          isDefault: item.is_default === true || item.isDefault === true,
        }]
      })
      const sources = parseAstrbotList(sourceResult, ['provider_sources', 'providerSources'])
      return { configs, needsSetup: configs.length === 0 || sources.length === 0 }
    } catch (error) {
      logError('bot-suggest', 'configs', error)
      return { configs: [], needsSetup: true }
    }
  }

  async function suggest(body) {
    const accountId = String(body?.accountId || '')
    const type = body?.type === 'group' ? 'group' : 'private'
    const peerId = String(body?.peerId ?? '')
    const lastMessageId = String(body?.lastMessageId || '')
    const trigger = body?.trigger === 'menu' ? 'menu' : body?.trigger === 'digest' ? 'digest' : 'auto'
    const empty = trigger === 'digest' ? emptyDigest(lastMessageId) : emptySuggest(lastMessageId)
    if (!accountId || !peerId) return empty
    const acc = accountOf(accountId)
    if (!acc) return empty
    const inst = qq.getInstanceForAccount?.(accountId)
    if (!inst || inst.phase !== 'ready') return empty
    const session = sessionOf(accountId, type, peerId)
    if (trigger === 'auto' && !session.enabled) return empty
    if (trigger === 'digest') {
      const sessionId = digestSessionId(accountId, type, peerId)
      return withSessionLock(sessionId, () => runDigest({
        accountId, type, peerId, lastMessageId, session, sessionId, messages: body?.messages, max: body?.max, empty,
      }))
    }
    if (lastMessageId) {
      const hit = cache.get(cacheKey(accountId, type, peerId, lastMessageId))
      if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
        return { lastMessageId, replies: hit.replies, summary: hit.summary || '' }
      }
    }
    const sessionId = suggestSessionId(accountId, type, peerId)
    return withSessionLock(sessionId, () => runSuggest({
      accountId, type, peerId, lastMessageId, trigger, session, sessionId, messages: body?.messages, empty,
    }))
  }

  async function runSuggest({ accountId, type, peerId, lastMessageId, trigger, session, sessionId, messages, empty }) {
    if (lastMessageId) {
      const hit = cache.get(cacheKey(accountId, type, peerId, lastMessageId))
      if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
        return { lastMessageId, replies: hit.replies, summary: hit.summary || '' }
      }
    }
    const pending = splitTurn(messages).pending
    const peerExcerpt = pending.map(formatLine).join('\n')
    const continued = opened.has(sessionId)
    const turnId = history?.startTurn?.({
      accountId,
      type,
      peerId,
      lastMessageId,
      trigger,
      peerExcerpt,
      steps: [{
        kind: 'recv',
        title: trigger === 'menu' ? '手动生成建议' : '开始处理本轮',
        detail: peerExcerpt,
      }],
    })
    activity?.begin?.(accountId, type, peerId)
    try {
      const configId = session.configId
      const turn = pending.map((item) => item.text).join('\n')
      let facts = ''
      if (needsLookup(turn)) {
        history?.addStep?.(turnId, { kind: 'query', title: '检索事实' })
        try { facts = await lookupFacts(turn) } catch (error) { logError('bot-suggest', 'lookup', error) }
        history?.addStep?.(turnId, {
          kind: 'query',
          title: facts ? '检索完成' : '检索无结果',
          detail: facts,
        })
      }
      history?.addStep?.(turnId, { kind: 'act', title: '正在生成建议' })
      const payload = {
        username: `chihiro-suggest:${accountId}`,
        session_id: sessionId,
        message: buildPrompt(messages, type, facts, continued),
        enable_streaming: false,
        flags: { enable_streaming: false, enable_inline_genui: false },
      }
      if (configId) payload.config_id = configId
      const result = await astrbotJson('/api/v1/chat', { method: 'POST', body: payload })
      const parsed = parseSuggestReplies(collectSsePlain(result.text), lastMessageId)
      if (result.ok) opened.add(sessionId)
      if (lastMessageId) {
        cache.set(cacheKey(accountId, type, peerId, lastMessageId), {
          at: Date.now(),
          replies: parsed.replies,
          summary: parsed.summary,
        })
      }
      const hasDraft = parsed.replies.length || parsed.summary
      history?.completeTurn?.(turnId, {
        replies: parsed.replies,
        summary: parsed.summary,
        lookupExcerpt: facts,
        skipped: hasDraft ? '' : 'empty-draft',
        steps: hasDraft
          ? [{
              kind: 'reply',
              title: parsed.replies.length ? `生成了 ${parsed.replies.length} 条建议` : '生成了总结回复',
              detail: parsed.summary || parsed.replies[0]?.text || '',
            }]
          : [{ kind: 'skip', title: '没有可发内容' }],
      })
      return parsed
    } catch (error) {
      logError('bot-suggest', 'suggest', error)
      history?.completeTurn?.(turnId, {
        skipped: 'error',
        steps: [{ kind: 'skip', title: '生成失败' }],
      })
      return empty
    } finally {
      activity?.end?.(accountId, type, peerId)
    }
  }

  async function runDigest({ accountId, type, peerId, lastMessageId, session, sessionId, messages, max, empty }) {
    const cap = digestCap(max)
    const digestKey = `digest:${cacheKey(accountId, type, peerId, lastMessageId)}:${cap}`
    if (lastMessageId) {
      const hit = cache.get(digestKey)
      if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
        return {
          lastMessageId,
          replies: [],
          summary: hit.summary || '',
          points: hit.points || [],
        }
      }
    }
    const clipped = clipDigestMessages(messages, cap)
    const peerExcerpt = clipped.map(formatDigestLine).join('\n')
    const turnId = history?.startTurn?.({
      accountId,
      type,
      peerId,
      lastMessageId,
      trigger: 'digest',
      joinReason: 'unread',
      peerExcerpt,
      steps: [{
        kind: 'recv',
        title: '开始整理未读',
        detail: peerExcerpt,
      }],
    })
    activity?.begin?.(accountId, type, peerId)
    try {
      const configId = session?.configId
      history?.addStep?.(turnId, { kind: 'act', title: '正在生成事件总结' })
      const payload = {
        username: `chihiro-suggest:${accountId}`,
        session_id: sessionId,
        message: buildDigestPrompt(messages, cap),
        enable_streaming: false,
        flags: { enable_streaming: false, enable_inline_genui: false },
      }
      if (configId) payload.config_id = configId
      const result = await astrbotJson('/api/v1/chat', { method: 'POST', body: payload })
      const parsed = parseDigestPoints(collectSsePlain(result.text), clipped)
      parsed.lastMessageId = lastMessageId
      if (lastMessageId) {
        cache.set(digestKey, {
          at: Date.now(),
          summary: parsed.summary,
          points: parsed.points,
        })
      }
      const hasPoints = parsed.points.length || parsed.summary
      history?.completeTurn?.(turnId, {
        summary: parsed.summary,
        points: parsed.points,
        skipped: hasPoints ? '' : 'empty-digest',
        steps: hasPoints
          ? [{
              kind: 'reply',
              title: parsed.points.length ? `整理了 ${parsed.points.length} 个要点` : '生成了事件总览',
              detail: parsed.summary || parsed.points[0]?.text || '',
            }]
          : [{ kind: 'skip', title: '没有可总结的内容' }],
      })
      return parsed
    } catch (error) {
      logError('bot-suggest', 'digest', error)
      history?.completeTurn?.(turnId, {
        skipped: 'error',
        steps: [{ kind: 'skip', title: '总结失败' }],
      })
      return empty
    } finally {
      activity?.end?.(accountId, type, peerId)
    }
  }

  return { suggest, listConfigs, parseSuggestReplies, sessionOf }
}
