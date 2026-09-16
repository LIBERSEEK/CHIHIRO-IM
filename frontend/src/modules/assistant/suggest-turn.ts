export const PRIVATE_QUIET_MS = 2800
export const GROUP_QUIET_MS = 3600
export const BURST_GAP_MS = 12_000
export const BURST_MAX = 8

export type SuggestTurnMessage = {
  id: string
  role: 'me' | 'them'
  text: string
  senderId?: string
  name?: string
  atSelf?: boolean
  time?: number
}

export type JoinDecision = {
  join: boolean
  reason: 'private' | 'at' | 'question' | 'request' | 'follow-up' | 'open-discussion' | 'skip'
}

const FILLER = /^(嗯+|哦+|噢+|啊+|哈+|哈哈+|呵呵+|嘿+|额+|好+|好的|收到|ok+|okay|1\+|plus one|\+1|谢谢|感谢)$/i
const QUESTION = /[?？]|吗[?？!！。.~…]*$|呢[?？!！。.~…]*$|(谁|有没有人|有人|大家|咱们|怎么|怎样|如何|为何|为什么|能不能|可不可以|可以吗|求问|请问|帮(我|看|查)|知道吗|懂吗|对吧|是不是|有什么|是什么)/
const REQUEST = /(帮(忙|看|查|我)|发(一?下|我|过来|群里)|谁(来|有|知道)|求(问|助)|看一下|给个|有空吗|在吗|仓库|github)/i

export function isFillerText(text: string): boolean {
  return FILLER.test(text.replace(/[\s\u200B。.!！~…]+/g, ''))
}

export function isQuestionText(text: string): boolean {
  return QUESTION.test(text.trim())
}

export function isRequestText(text: string): boolean {
  return REQUEST.test(text.trim())
}

export function lastMeIndex(messages: SuggestTurnMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]?.role === 'me') return index
  }
  return -1
}

export function collectPendingTurn(messages: SuggestTurnMessage[]): SuggestTurnMessage[] {
  const after = messages.slice(lastMeIndex(messages) + 1).filter(item => item.role === 'them' && item.text.trim())
  if (!after.length) return []
  const burst: SuggestTurnMessage[] = []
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

export function decideJoin(input: {
  type: 'private' | 'group'
  messages: SuggestTurnMessage[]
}): JoinDecision {
  const pending = collectPendingTurn(input.messages)
  if (!pending.length) return { join: false, reason: 'skip' }
  if (input.type === 'private') return { join: true, reason: 'private' }

  if (pending.some(item => item.atSelf)) return { join: true, reason: 'at' }

  const lastMe = lastMeIndex(input.messages)
  const meRecent = lastMe >= 0 && input.messages.length - 1 - lastMe <= 8
  const asked = pending.some(item => isQuestionText(item.text))
  const requested = pending.some(item => isRequestText(item.text))
  const speakers = new Set(pending.map(item => item.senderId || item.id))
  const substantial = pending.filter(item => !isFillerText(item.text))

  if (asked || requested) {
    if (speakers.size >= 2) return { join: true, reason: 'open-discussion' }
    return { join: true, reason: asked ? 'question' : 'request' }
  }
  if (meRecent) return { join: true, reason: 'follow-up' }
  // Several people talking, not the same sender dumping, and not just 哈哈/嗯嗯.
  if (speakers.size >= 2 && substantial.length >= 2) {
    return { join: true, reason: 'open-discussion' }
  }
  return { join: false, reason: 'skip' }
}

export function quietMsFor(type: 'private' | 'group'): number {
  return type === 'group' ? GROUP_QUIET_MS : PRIVATE_QUIET_MS
}
