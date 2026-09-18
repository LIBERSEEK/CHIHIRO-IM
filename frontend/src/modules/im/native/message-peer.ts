/** NapCat/QQ dummy peers used for merged-forward storage and failed temp-chat fallbacks. */
export const NAPCAT_DUMMY_PEERS = new Set([284840486, 1094950020])

export function isNapcatDummyPeer(id: unknown): boolean {
  const n = Number(id)
  return Number.isFinite(n) && NAPCAT_DUMMY_PEERS.has(n)
}

export function usablePeerId(id: unknown): number {
  const n = Number(id)
  if (!Number.isFinite(n) || n <= 0 || isNapcatDummyPeer(n)) return 0
  return n
}

/** NapCat has no `send_temp_msg`; temp C2C is `send_private_msg` plus the source group. */
export function resolvePrivateSendTarget(
  id: string | number,
  tempGroupId?: unknown,
): { userId: number, groupId: number, isTemp: boolean } {
  const raw = String(id)
  const slash = raw.indexOf('/')
  const userId = usablePeerId(slash > 0 ? raw.slice(0, slash) : raw)
  const groupId = usablePeerId(slash > 0 ? raw.slice(slash + 1) : tempGroupId)
  return { userId, groupId, isTemp: userId > 0 && groupId > 0 }
}

export function resolveMessageSession(data: {
  message_type?: string
  sub_type?: string
  post_type?: string
  group_id?: number | string
  user_id?: number | string
  target_id?: number | string
  sender?: { user_id?: number | string }
}, loginId: number | string): {
  sessionId: number
  isGroup: boolean
  isTemp: boolean
  senderId: number
  sourceGroupId: number
} {
  const senderId = usablePeerId(data.sender?.user_id)
  const isGroup = data.message_type === 'group'
  const isTemp = data.message_type === 'private' && data.sub_type === 'group'
  const sourceGroupId = usablePeerId(data.group_id)
  const login = Number(loginId)
  const selfSent = data.post_type === 'message_sent' || (senderId > 0 && senderId === login)

  if (isGroup) {
    return {
      sessionId: sourceGroupId || Number(data.group_id) || 0,
      isGroup: true,
      isTemp: false,
      senderId,
      sourceGroupId,
    }
  }

  const userId = usablePeerId(data.user_id)
  const targetId = usablePeerId(data.target_id)
  const candidates = selfSent
    ? [targetId, userId !== login ? userId : 0]
    : [userId, senderId, targetId]
  const sessionId = candidates.find((id) => id > 0) ?? 0
  return { sessionId, isGroup: false, isTemp, senderId, sourceGroupId }
}
