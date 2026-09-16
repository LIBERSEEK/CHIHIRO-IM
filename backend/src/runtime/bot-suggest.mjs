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

function buildPrompt(messages, type, facts = '') {
  const { clipped, pending } = splitTurn(messages)
  const lines = clipped.map(formatLine)
  const scene = type === 'group'
    ? '场景：群聊。连续消息可能来自不同的人，先判断要不要接话，再给出一句能插进去的回复。'
    : '场景：私聊，对方可能连发多句。'
  const turn = pending.length ? `\n本轮待回：\n${pending.map(formatLine).join('\n')}` : ''
  const evidence = facts ? `\n检索依据（内部，勿发给客户）：\n${facts}` : ''
  return `${PROMPT}\n\n${scene}\n对话：\n${lines.join('\n') || '(空)'}${turn}${evidence}\n\n请给出回复建议。`
}

function suggestSessionId(accountId, type, peerId, lastMessageId) {
  const turn = String(lastMessageId || 'open').replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 80)
  return `suggest:${accountId}:${type}:${peerId}:${turn}`
}

export function createBotSuggest({ store, qq, astrbot }) {
  const cache = new Map()

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
    const trigger = body?.trigger === 'menu' ? 'menu' : 'auto'
    const empty = emptySuggest(lastMessageId)
    if (!accountId || !peerId) return empty
    const acc = accountOf(accountId)
    if (!acc) return empty
    const inst = qq.getInstanceForAccount?.(accountId)
    if (!inst || inst.phase !== 'ready') return empty
    const session = sessionOf(accountId, type, peerId)
    if (trigger === 'auto' && !session.enabled) return empty
    if (lastMessageId) {
      const hit = cache.get(cacheKey(accountId, type, peerId, lastMessageId))
      if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
        return { lastMessageId, replies: hit.replies, summary: hit.summary || '' }
      }
    }
    try {
      const configId = session.configId
      const turn = splitTurn(body?.messages).pending.map((item) => item.text).join('\n')
      let facts = ''
      if (needsLookup(turn)) {
        try { facts = await lookupFacts(turn) } catch (error) { logError('bot-suggest', 'lookup', error) }
      }
      const payload = {
        username: `chihiro-suggest:${accountId}`,
        session_id: suggestSessionId(accountId, type, peerId, lastMessageId),
        message: buildPrompt(body?.messages, type, facts),
        enable_streaming: false,
        flags: { enable_streaming: false, enable_inline_genui: false },
      }
      if (configId) payload.config_id = configId
      const result = await astrbotJson('/api/v1/chat', { method: 'POST', body: payload })
      const parsed = parseSuggestReplies(collectSsePlain(result.text), lastMessageId)
      if (lastMessageId) {
        cache.set(cacheKey(accountId, type, peerId, lastMessageId), {
          at: Date.now(),
          replies: parsed.replies,
          summary: parsed.summary,
        })
      }
      return parsed
    } catch (error) {
      logError('bot-suggest', 'suggest', error)
      return empty
    }
  }

  return { suggest, listConfigs, parseSuggestReplies, sessionOf }
}
