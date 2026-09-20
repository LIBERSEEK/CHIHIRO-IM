import { logError } from './log.mjs'
import { normalizeBotSession, sessionPeerKey } from './bot.mjs'
import { formatLookupDraft, isLookupFiller } from './bot-lookup.mjs'

const SUGGEST_TIMEOUT_MS = 40_000
const AGENT_TIMEOUT_MS = 120_000
const CACHE_TTL_MS = 30_000
export const SPEAK_NOW_MIN = 0.55
export const INTENT_IDS = ['inquire', 'request', 'complaint', 'confirm', 'smalltalk', 'other']
export const ACTION_IDS = ['brief', 'follow_up', 'lookup', 'escalate', 'hold']
const INTENT_LABEL = {
  inquire: '询价', request: '办事', complaint: '不满', confirm: '确认', smalltalk: '闲聊', other: '其他',
}
const ACTION_LABEL = {
  brief: '简答', follow_up: '补问', lookup: '查资料', escalate: '转人工', hold: '先别回',
}
export function buildChatRequestFlags(enableStreaming = true) {
  return {
    enable_inline_genui: true,
    enable_default_system_prompt: true,
    enable_streaming: enableStreaming,
  }
}

const PROMPT = `你在协助操作员回复即时消息。处理方式与工作台里新建对话后相同：该用工具就用工具，先把客户要办的事办完，再写可发给客户的回复。
工具全部结束后只输出 JSON，不要 Markdown，不要自称 AI。
格式：{"read":{"intent":{"id":"inquire","options":[{"id":"inquire","p":0.72},{"id":"request","p":0.1},{"id":"complaint","p":0.05},{"id":"confirm","p":0.05},{"id":"smalltalk","p":0.06},{"id":"other","p":0.02}]},"speakNow":{"yes":0.82,"no":0.18},"action":{"id":"follow_up","options":[{"id":"brief","p":0.2},{"id":"follow_up","p":0.55},{"id":"lookup","p":0.1},{"id":"escalate","p":0.1},{"id":"hold","p":0.05}]},"urgency":6,"note":"先问预算"},"replies":[{"id":"1","text":"选项","score":0.82}],"summary":"可直接发送的完整回复"}
read 是给操作员看的内部判断，不要写进发给客户的句子。
intent.id 只能是 inquire（询价/问需求）、request（请办事）、complaint（不满）、confirm（确认跟进）、smalltalk（闲聊）、other。
action.id 只能是 brief（简答）、follow_up（补问）、lookup（先查资料）、escalate（转人工）、hold（先别回）。
options 必须列出该组全部 id，p 为 0 到 1，同组合计约为 1。
speakNow：现在该不该开口；urgency 为 0 到 10 的整数。
note：一句内部提示，可空。
replies：1 到 3 条不同角度、像真人会发的下一句选项，score 为 0 到 1。
summary：一条总结性、语气完整、可直接发出的回复，不要与 replies 逐字相同。
先判断再写回复。speakNow.yes 低于 0.55 或 action 为 hold 时，replies 和 summary 必须为空。
把下面整段对话当成一次说话来回，不要对每一句分别回复。连续发言可能来自不同的人，按一场对话来接。前面是上下文，重点回末尾「本轮待回」。
客户让你去网上/GitHub 找项目并解释时：必须先调用工具查到再写 replies；intent 选 request；查到后 action 选 brief，replies 必须带仓库名和链接；没查到则 replies 和 summary 为空，action 选 escalate。
不要写「我去查一下」「我去找找」「请再描述一下」，不要向客户表演正在搜索。
群聊里：被 @、被提问、刚回过话、或多人正在讨论且值得插入时给出下一句；纯闲聊、应和、单人自说自话时 action 用 hold，输出空 replies 和空 summary。`

function emptySuggest(lastMessageId = '') {
  return { lastMessageId: String(lastMessageId || ''), replies: [], summary: '', read: null }
}

function clamp01(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}

function asRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value
}

function parseOptions(raw, allowed) {
  const allowedSet = new Set(allowed)
  const map = new Map()
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === 'string') {
        if (allowedSet.has(item)) map.set(item, map.get(item) ?? 0)
        continue
      }
      const record = asRecord(item)
      if (!record) continue
      const id = String(record.id ?? record.key ?? '')
      if (!allowedSet.has(id)) continue
      map.set(id, clamp01(record.p ?? record.prob ?? record.probability))
    }
  } else {
    const record = asRecord(raw)
    if (record) {
      for (const [id, value] of Object.entries(record)) {
        if (!allowedSet.has(id)) continue
        const nested = asRecord(value)
        map.set(id, clamp01(nested ? nested.p ?? nested.prob : value))
      }
    }
  }
  const options = allowed.map((id) => ({ id, p: map.get(id) ?? 0 }))
  const sum = options.reduce((total, item) => total + item.p, 0)
  if (sum <= 0) return options
  return options.map((item) => ({ id: item.id, p: Math.round((item.p / sum) * 1000) / 1000 }))
}

function parseChoice(raw, allowed) {
  let preferred = ''
  if (typeof raw === 'string') preferred = raw
  else {
    const record = asRecord(raw)
    if (record && typeof record.id === 'string') preferred = record.id
  }
  const source = asRecord(raw)
  const options = parseOptions(source?.options ?? source?.probabilities ?? raw, allowed)
  const known = allowed.includes(preferred)
  if (known && options.every((item) => item.p === 0)) {
    return { id: preferred, options: allowed.map((id) => ({ id, p: id === preferred ? 1 : 0 })) }
  }
  const winner = options.reduce((best, item) => item.p > best.p ? item : best, options[0])
  return { id: known ? preferred : winner.id, options }
}

function parseSpeakNow(raw) {
  if (typeof raw === 'number' || typeof raw === 'string') {
    const yes = clamp01(raw)
    return { yes, no: Math.round((1 - yes) * 1000) / 1000 }
  }
  const record = asRecord(raw)
  if (!record) return { yes: 0, no: 1 }
  let yes = clamp01(record.yes ?? record.noul ?? record.p)
  let no = clamp01(record.no)
  if (yes === 0 && no === 0 && record.true != null) yes = clamp01(record.true)
  const sum = yes + no
  if (sum <= 0) return { yes: 0, no: 1 }
  yes = Math.round((yes / sum) * 1000) / 1000
  return { yes, no: Math.round((1 - yes) * 1000) / 1000 }
}

function parseUrgency(raw) {
  if (typeof raw === 'string') {
    const match = raw.match(/(\d+(?:\.\d+)?)/)
    raw = match ? match[1] : raw
  }
  const n = Number(raw)
  if (!Number.isFinite(n)) return 0
  if (n > 0 && n <= 1) return Math.round(n * 10)
  return Math.min(10, Math.max(0, Math.round(n)))
}

export function parseSuggestRead(value) {
  const root = asRecord(value)
  const raw = asRecord(root?.read) || asRecord(root?.judgment) || asRecord(root?.eval)
  if (!raw) return null
  const intent = parseChoice(raw.intent, INTENT_IDS)
  const action = parseChoice(raw.action, ACTION_IDS)
  const speakNow = parseSpeakNow(raw.speakNow ?? raw.speak)
  const note = typeof raw.note === 'string' ? raw.note.trim().slice(0, 80) : ''
  const urgency = parseUrgency(raw.urgency)
  const peaked = intent.options.some((item) => item.p > 0)
    || action.options.some((item) => item.p > 0)
    || speakNow.yes > 0
    || urgency > 0
    || Boolean(note)
  if (!peaked && !raw.intent && !raw.action) return null
  return { intent, speakNow, action, urgency, note }
}

export function shouldHoldRead(read) {
  if (!read) return false
  if (read.action?.id === 'hold' || read.action?.id === 'escalate') return true
  return Number(read.speakNow?.yes) < SPEAK_NOW_MIN
}

function forceTop(choice, allowed, id, minWeight = 0.72) {
  const parsed = choice?.options ? choice : parseChoice(id, allowed)
  const currentP = (parsed.options || []).find((item) => item.id === id)?.p || 0
  const weight = Math.round(Math.max(minWeight, currentP) * 1000) / 1000
  const rest = allowed.filter((key) => key !== id)
  const leftover = Math.max(0, 1 - weight)
  const otherP = rest.length ? Math.round((leftover / rest.length) * 1000) / 1000 : 0
  return { id, options: allowed.map((key) => ({ id: key, p: key === id ? weight : otherP })) }
}

function forceSpeakNow(yes) {
  const value = clamp01(yes)
  return { yes: value, no: Math.round((1 - value) * 1000) / 1000 }
}

function citesLookup(text, lookup) {
  const value = String(text || '').toLowerCase()
  if (!value) return false
  if (/https?:\/\//i.test(value)) return true
  return (lookup?.hits || []).some((hit) => {
    const name = String(hit?.name || '').toLowerCase()
    if (name && value.includes(name)) return true
    const short = name.split('/').pop()
    return Boolean(short && short.length >= 3 && value.includes(short))
  })
}

function emptyLookupRead() {
  return {
    intent: parseChoice('request', INTENT_IDS),
    speakNow: { yes: 0.5, no: 0.5 },
    action: parseChoice('lookup', ACTION_IDS),
    urgency: 5,
    note: '',
  }
}

export function applyLookupToSuggest(parsed, lookup, lastMessageId = '') {
  if (!lookup?.needed) return parsed
  const base = parsed && typeof parsed === 'object' ? parsed : emptySuggest(lastMessageId)
  const read = {
    ...(base.read || emptyLookupRead()),
    intent: forceTop(base.read?.intent, INTENT_IDS, 'request'),
  }
  const id = String(base.lastMessageId || lastMessageId || '')
  if (!String(lookup.facts || '').trim()) {
    const note = lookup.queries?.length ? `没查到：${lookup.queries.join('、')}` : '没查到'
    return {
      lastMessageId: id,
      replies: [],
      summary: '',
      skipped: 'no-facts',
      read: {
        ...read,
        action: forceTop(read.action, ACTION_IDS, 'escalate'),
        speakNow: forceSpeakNow(0.08),
        note,
      },
    }
  }
  let replies = (Array.isArray(base.replies) ? base.replies : []).filter((item) => !isLookupFiller(item?.text))
  let summary = isLookupFiller(base.summary) ? '' : String(base.summary || '').trim()
  const cited = replies.some((item) => citesLookup(item.text, lookup)) || citesLookup(summary, lookup)
  const hasUrl = [...replies.map((item) => item.text), summary].some((text) => /https?:\/\//i.test(String(text || '')))
  if (!replies.length || !cited || !hasUrl) {
    const draft = formatLookupDraft(lookup)
    if (draft) replies = [{ id: '1', text: draft, score: 0.85 }, ...replies].slice(0, 3)
  }
  if (!summary || !citesLookup(summary, lookup) || !/https?:\/\//i.test(summary)) {
    summary = replies[0]?.text || ''
  }
  const hitName = lookup.hits?.[0]?.name || lookup.queries?.[0] || ''
  const note = read.note && !isLookupFiller(read.note) ? read.note : `已查到 ${hitName}`.trim()
  return {
    lastMessageId: id,
    replies,
    summary,
    skipped: '',
    read: {
      ...read,
      action: forceTop(read.action, ACTION_IDS, 'brief'),
      speakNow: forceSpeakNow(Math.max(Number(read.speakNow?.yes) || 0, 0.72)),
      note,
    },
  }
}

function readStep(read) {
  if (!read) return null
  const intent = INTENT_LABEL[read.intent.id] || read.intent.id
  const action = ACTION_LABEL[read.action.id] || read.action.id
  return {
    kind: 'act',
    title: `判断：${intent} · ${action} · 紧急 ${read.urgency}`,
    detail: read.note || '',
  }
}

export function pickAutoText(result) {
  if (shouldHoldRead(result?.read)) return ''
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
    return {
      lastMessageId: String(parsed?.lastMessageId || lastMessageId || ''),
      replies,
      summary,
      read: parseSuggestRead(parsed),
    }
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

function payloadText(data) {
  if (data == null) return ''
  if (typeof data === 'string') return data
  const record = asRecord(data)
  if (record && typeof record.text === 'string') return record.text
  return ''
}

function parseJsonSafe(data) {
  if (data && typeof data === 'object') return data
  try { return JSON.parse(String(data || '')) } catch { return null }
}

function clipToolDetail(value) {
  if (value == null) return ''
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.replace(/\s+/g, ' ').trim().slice(0, 240)
}

function parseSseEvents(body) {
  const text = String(body || '')
  if (!text.includes('data:')) return []
  const events = []
  for (const block of text.split(/\n\n+/)) {
    const payload = block.split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')
    if (!payload || payload === '[DONE]') continue
    try { events.push(JSON.parse(payload)) } catch { events.push({ type: 'plain', data: payload }) }
  }
  return events
}

export function reduceChatStream(body) {
  const events = parseSseEvents(body)
  if (!events.length) {
    const text = String(body || '').trim()
    return { text, steps: [], tools: [] }
  }
  let plain = ''
  const steps = []
  const tools = []
  const toolNames = new Map()
  for (const event of events) {
    const msgType = event?.type || event?.t
    const chainType = event?.chain_type
    const data = event?.data
    if (msgType === 'plain') {
      if (chainType === 'reasoning') continue
      if (chainType === 'tool_call') {
        const call = parseJsonSafe(data)
        const name = String(call?.name || call?.tool || 'tool')
        const id = call?.id
        if (id != null) toolNames.set(String(id), name)
        tools.push({ id, name, args: call?.arguments })
        steps.push({ kind: 'query', title: `调用 ${name}`, detail: clipToolDetail(call?.arguments) })
        continue
      }
      if (chainType === 'tool_call_result') {
        const result = parseJsonSafe(data)
        const name = toolNames.get(String(result?.id ?? '')) || 'tool'
        steps.push({ kind: 'query', title: `完成 ${name}`, detail: clipToolDetail(result?.result) })
        continue
      }
      plain += payloadText(data)
      continue
    }
    if (msgType === 'complete') {
      const finalText = payloadText(data)
      if (finalText && (!plain || finalText.startsWith(plain))) plain = finalText
    }
  }
  return { text: plain.trim(), steps, tools }
}

function looksLikeBareJson(text) {
  const trimmed = String(text || '').trim()
  return trimmed.startsWith('{') && trimmed.endsWith('}')
}

function synthesizeRead({ usedTools, hasDraft }) {
  if (!hasDraft) {
    return {
      intent: parseChoice(usedTools ? 'request' : 'other', INTENT_IDS),
      speakNow: forceSpeakNow(0.08),
      action: parseChoice(usedTools ? 'escalate' : 'hold', ACTION_IDS),
      urgency: usedTools ? 5 : 1,
      note: usedTools ? '没查到' : '',
    }
  }
  return {
    intent: parseChoice(usedTools ? 'request' : 'other', INTENT_IDS),
    speakNow: forceSpeakNow(0.78),
    action: parseChoice('brief', ACTION_IDS),
    urgency: usedTools ? 5 : 3,
    note: usedTools ? '已查到' : '',
  }
}

export function draftsFromAgentRun(stream, lastMessageId = '') {
  const parsed = parseSuggestReplies(stream?.text, lastMessageId)
  let replies = (parsed.replies || []).filter((item) => !isLookupFiller(item?.text))
  let summary = isLookupFiller(parsed.summary) ? '' : String(parsed.summary || '').trim()
  const prose = String(stream?.text || '').trim()
  if (!replies.length && !summary && prose && !isLookupFiller(prose) && !looksLikeBareJson(prose)) {
    const text = prose.slice(0, 500)
    replies = [{ id: '1', text, score: 0.8 }]
    summary = text
  }
  const usedTools = Array.isArray(stream?.tools) && stream.tools.length > 0
  let read = parsed.read
  if (!read) read = synthesizeRead({ usedTools, hasDraft: Boolean(replies.length || summary) })
  if (usedTools && (replies.length || summary)) {
    read = {
      ...read,
      intent: forceTop(read.intent, INTENT_IDS, 'request'),
      action: forceTop(read.action, ACTION_IDS, 'brief'),
      speakNow: forceSpeakNow(Math.max(Number(read.speakNow?.yes) || 0, 0.72)),
    }
  }
  if (!replies.length && !summary && usedTools) {
    return applyLookupToSuggest(emptySuggest(lastMessageId), {
      needed: true,
      queries: stream.tools.map((item) => item.name).filter(Boolean),
      hits: [],
      facts: '',
    }, lastMessageId)
  }
  return {
    lastMessageId: parsed.lastMessageId || lastMessageId,
    replies,
    summary,
    read,
    skipped: replies.length || summary ? '' : (shouldHoldRead(read) ? '' : 'empty-draft'),
  }
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
    return `${turnBlock(pending, facts)}\n\n这是同一场对话的下一轮。沿用已知上下文，不要重复已经说过的话。仍输出含 read 的 JSON。`
  }
  const lines = clipped.map(formatLine)
  const scene = type === 'group'
    ? '场景：群聊。连续消息可能来自不同的人，先判断要不要接话，再给出一句能插进去的回复。'
    : '场景：私聊，对方可能连发多句。'
  return `${PROMPT}\n\n${scene}\n对话：\n${lines.join('\n') || '(空)'}\n${turnBlock(pending, facts)}\n\n请给出回复建议。`
}

export function buildChatMessageParts(messages, type, continued = false) {
  return [{ type: 'plain', text: buildPrompt(messages, type, '', continued) }]
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
        return { lastMessageId, replies: hit.replies, summary: hit.summary || '', read: hit.read || null }
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
        return { lastMessageId, replies: hit.replies, summary: hit.summary || '', read: hit.read || null }
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
      history?.addStep?.(turnId, { kind: 'act', title: '正在生成建议' })
      const payload = {
        username: `chihiro-suggest:${accountId}`,
        session_id: sessionId,
        message: buildChatMessageParts(messages, type, continued),
        flags: buildChatRequestFlags(true),
      }
      if (configId) payload.config_id = configId
      const result = await astrbotJson('/api/v1/chat', { method: 'POST', body: payload, timeout: AGENT_TIMEOUT_MS })
      const stream = result.ok ? reduceChatStream(result.text) : { text: '', steps: [], tools: [] }
      for (const step of stream.steps) history?.addStep?.(turnId, step)
      const parsed = result.ok ? draftsFromAgentRun(stream, lastMessageId) : emptySuggest(lastMessageId)
      if (result.ok) opened.add(sessionId)
      if (lastMessageId) {
        cache.set(cacheKey(accountId, type, peerId, lastMessageId), {
          at: Date.now(),
          replies: parsed.replies,
          summary: parsed.summary,
          read: parsed.read,
        })
      }
      const hasDraft = parsed.replies.length || parsed.summary
      const judged = readStep(parsed.read)
      const hold = shouldHoldRead(parsed.read)
      const skipped = parsed.skipped || (hold ? 'hold' : hasDraft ? '' : 'empty-draft')
      const steps = []
      if (judged) steps.push(judged)
      if (hasDraft && !hold) {
        steps.push({
          kind: 'reply',
          title: parsed.replies.length ? `生成了 ${parsed.replies.length} 条建议` : '生成了总结回复',
          detail: parsed.summary || parsed.replies[0]?.text || '',
        })
      } else if (skipped === 'no-facts') {
        steps.push({ kind: 'skip', title: '没查到' })
      } else if (hold) {
        steps.push({ kind: 'skip', title: '先别回' })
      } else {
        steps.push({ kind: 'skip', title: '没有可发内容' })
      }
      history?.completeTurn?.(turnId, {
        replies: parsed.replies,
        summary: parsed.summary,
        lookupExcerpt: stream.tools.map((item) => item.name).filter(Boolean).join('、'),
        skipped,
        steps,
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
