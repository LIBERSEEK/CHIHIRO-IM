export const PRIVATE_QUIET_MS = 2800
export const GROUP_QUIET_MS = 3600
export const BURST_GAP_MS = 12_000
export const BURST_MAX = 8

const FILLER = /^(嗯+|哦+|噢+|啊+|哈+|哈哈+|呵呵+|嘿+|额+|好+|好的|收到|ok+|okay|1\+|plus one|\+1|谢谢|感谢)$/i
const QUESTION = /[?？]|吗[?？!！。.~…]*$|呢[?？!！。.~…]*$|(谁|有没有人|有人|大家|咱们|怎么|怎样|如何|为何|为什么|能不能|可不可以|可以吗|求问|请问|帮(我|看|查)|知道吗|懂吗|对吧|是不是|有什么|是什么)/
const REQUEST = /(帮(忙|看|查|我)|发(一?下|我|过来|群里)|谁(来|有|知道)|求(问|助)|看一下|给个|有空吗|在吗|仓库|github)/i

export function messageText(message) {
  if (message == null) return ''
  if (typeof message === 'string') return message
  if (!Array.isArray(message)) return String(message)
  return message.map((seg) => {
    if (typeof seg === 'string') return seg
    const t = seg?.type
    const data = seg?.data || seg
    if (t === 'text') return data.text || ''
    if (t === 'image') return '[图片]'
    if (t === 'video') return '[视频]'
    if (t === 'record') return '[语音]'
    if (t === 'file') {
      const name = data.name || data.file || ''
      return name ? `[文件:${name}]` : '[文件]'
    }
    if (t === 'reply') return `[回复${data.id || ''}]`
    if (t === 'forward' || t === 'node') return '[合并转发]'
    if (t === 'json' || t === 'xml') return '[卡片]'
    if (t === 'at') return `@${data.qq || data.user_id || ''}`
    if (t === 'face') return `[表情${data.id || ''}]`
    if (t) return `[${t}]`
    return ''
  }).join('')
}

export function isFillerText(text) {
  return FILLER.test(String(text || '').replace(/[\s\u200B。.!！~…]+/g, ''))
}

export function isQuestionText(text) {
  return QUESTION.test(String(text || '').trim())
}

export function isRequestText(text) {
  return REQUEST.test(String(text || '').trim())
}

export function lastMeIndex(messages) {
  for (let index = (messages || []).length - 1; index >= 0; index--) {
    if (messages[index]?.role === 'me') return index
  }
  return -1
}

export function collectPendingTurn(messages) {
  const after = (messages || []).slice(lastMeIndex(messages) + 1).filter((item) => item.role === 'them' && String(item.text || '').trim())
  if (!after.length) return []
  const burst = []
  for (let index = after.length - 1; index >= 0; index--) {
    const item = after[index]
    if (burst.length >= BURST_MAX) break
    if (burst.length) {
      const newer = burst[0]
      const gap = Math.max(0, (newer.time || 0) - (item.time || 0))
      if (gap > BURST_GAP_MS) break
    }
    burst.unshift(item)
  }
  return burst
}

export function decideJoin(input) {
  const pending = collectPendingTurn(input?.messages)
  if (!pending.length) return { join: false, reason: 'skip' }
  if (input.type === 'private') return { join: true, reason: 'private' }

  if (pending.some((item) => item.atSelf)) return { join: true, reason: 'at' }

  const lastMe = lastMeIndex(input.messages)
  const meRecent = lastMe >= 0 && input.messages.length - 1 - lastMe <= 8
  const asked = pending.some((item) => isQuestionText(item.text))
  const requested = pending.some((item) => isRequestText(item.text))
  const speakers = new Set(pending.map((item) => item.senderId || item.id))
  const substantial = pending.filter((item) => !isFillerText(item.text))

  if (asked || requested) {
    if (speakers.size >= 2) return { join: true, reason: 'open-discussion' }
    return { join: true, reason: asked ? 'question' : 'request' }
  }
  if (meRecent) return { join: true, reason: 'follow-up' }
  if (speakers.size >= 2 && substantial.length >= 2) {
    return { join: true, reason: 'open-discussion' }
  }
  return { join: false, reason: 'skip' }
}

export function quietMsFor(type) {
  return type === 'group' ? GROUP_QUIET_MS : PRIVATE_QUIET_MS
}

export function mentionsSelf(text, selfUin) {
  const raw = String(text || '')
  const self = String(selfUin || '')
  if (self && (raw.includes(`@${self}`) || new RegExp(`\\[CQ:at,qq=${self}\\b`).test(raw))) return true
  return /@全体成员|@everyone|\[CQ:at,qq=all\b/i.test(raw)
}

export function historyToSuggestMessages(rows, selfUin) {
  const self = String(selfUin || '')
  const out = []
  for (const row of Array.isArray(rows) ? rows.slice(-24) : []) {
    const text = String(row?.text || messageText(row?.message) || row?.raw_message || '').trim()
    if (!text) continue
    const senderId = String(row?.user_id ?? row?.sender?.user_id ?? '')
    const timeRaw = Number(row?.time || 0)
    out.push({
      id: String(row?.id || row?.message_id || ''),
      role: senderId && self && senderId === self ? 'me' : 'them',
      text,
      senderId,
      name: String(row?.card || row?.nickname || row?.sender?.card || row?.sender?.nickname || senderId),
      atSelf: Boolean(row?.atme) || mentionsSelf(text, self),
      time: timeRaw > 0 && timeRaw < 1e12 ? timeRaw * 1000 : timeRaw,
    })
  }
  return out
}

export function parseInboundEvent(event, selfUin) {
  if (!event || (event.post_type !== 'message' && event.post_type !== 'message_sent')) return null
  const type = event.message_type === 'group' || event.group_id != null ? 'group' : 'private'
  const peerId = type === 'group'
    ? String(event.group_id ?? '')
    : String(event.user_id ?? event.sender?.user_id ?? '')
  if (!peerId) return null
  const senderId = String(event.user_id ?? event.sender?.user_id ?? '')
  const self = String(event.self_id ?? selfUin ?? '')
  const text = String(messageText(event.message) || event.raw_message || '').trim()
  const isSelf = event.post_type === 'message_sent' || (self && senderId === self)
  return {
    type,
    peerId,
    senderId,
    selfId: self,
    isSelf,
    text,
    id: String(event.message_id || ''),
    name: String(event.sender?.card || event.sender?.nickname || senderId),
    atSelf: Boolean(event.atme) || mentionsSelf(text, self) || (Array.isArray(event.message) && event.message.some((seg) => {
      if (seg?.type !== 'at') return false
      const qq = String(seg.qq ?? seg.data?.qq ?? '')
      return qq === self || qq === 'all' || qq === '0'
    })),
    time: Number(event.time || 0),
  }
}
