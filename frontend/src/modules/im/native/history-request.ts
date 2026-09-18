import { usablePeerId } from './message-peer'

/** NapCat throws instead of returning `messages: []` when a chat has no history. */
const EMPTY_HISTORY_MESSAGE = /消息.*不存在|记录.*不存在/

export function isEmptyChatHistoryResponse(msg: {
  data?: unknown
  message?: string
  wording?: string
  status?: string
} | null | undefined): boolean {
  if (!msg) return false
  if (hasNoHistoryMessages(msg.data)) return true
  if (msg.data != null) return false
  const text = `${msg.wording || ''} ${msg.message || ''}`
  if (!text.trim()) return true
  return EMPTY_HISTORY_MESSAGE.test(text) || msg.status === 'failed'
}

function hasNoHistoryMessages(data: unknown): boolean {
  if (Array.isArray(data)) return data.length === 0
  if (!data || typeof data !== 'object') return false
  const messages = (data as { messages?: unknown }).messages
  return Array.isArray(messages) && messages.length === 0
}

export function chatHistoryRequestParams(input: {
  id: number | string
  type: string
  count: number
  messageId?: string | number
  tempGroupId?: number
}): Record<string, unknown> {
  const isGroup = input.type === 'group'
  const messageId = input.messageId ?? 0
  const tempGroupId = usablePeerId(input.tempGroupId)
  return {
    group_id: isGroup
      ? input.id
      : (tempGroupId > 0 ? tempGroupId : undefined),
    user_id: isGroup ? undefined : input.id,
    message_id: messageId,
    message_seq: messageId,
    count: input.count,
  }
}
