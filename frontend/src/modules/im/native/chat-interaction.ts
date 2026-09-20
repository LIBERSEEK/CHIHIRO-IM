import { usablePeerId } from './message-peer'

export interface ForwardContact {
  user_id?: number | string
  group_id?: number | string
  group_name?: string
  nickname?: string
  remark?: string
}

export function hasOutgoingContent({ text, attachmentCount, hasInlineFaces, hasInlineAts }: {
  text: string
  attachmentCount: number
  hasInlineFaces: boolean
  hasInlineAts: boolean
}): boolean {
  return text !== '' || attachmentCount > 0 || hasInlineFaces || hasInlineAts
}

export function forwardContactKey(contact: ForwardContact): string {
  const userId = usablePeerId(contact.user_id)
  if (userId > 0) return `user-${userId}`
  const groupId = usablePeerId(contact.group_id)
  return groupId > 0 ? `group-${groupId}` : ''
}

export function isTempForwardContact(contact: ForwardContact): boolean {
  return usablePeerId(contact.user_id) > 0
    && usablePeerId(contact.group_id) > 0
    && String(contact.group_name ?? '') === ''
}

export function forwardContactKind(contact: ForwardContact): 'temp' | 'user' | 'group' {
  if (usablePeerId(contact.user_id) > 0) {
    return isTempForwardContact(contact) ? 'temp' : 'user'
  }
  return 'group'
}

export function collectForwardContacts<T extends ForwardContact>(
  contacts: readonly T[],
  sessions: readonly T[],
): T[] {
  const list = [...contacts]
  const keys = new Set(list.map(forwardContactKey).filter(Boolean))
  for (const session of sessions) {
    if (!isTempForwardContact(session)) continue
    const key = forwardContactKey(session)
    if (!key || keys.has(key)) continue
    list.push(session)
    keys.add(key)
  }
  return list
}

export function resolveForwardTarget(contact: ForwardContact): {
  sendId: string
  peerId: string
  type: 'user' | 'group'
  isTemp: boolean
} {
  const userId = usablePeerId(contact.user_id)
  if (isTempForwardContact(contact)) {
    const groupId = usablePeerId(contact.group_id)
    return {
      sendId: `${userId}/${groupId}`,
      peerId: String(userId),
      type: 'user',
      isTemp: true,
    }
  }
  if (userId > 0) {
    return {
      sendId: String(userId),
      peerId: String(userId),
      type: 'user',
      isTemp: false,
    }
  }
  const groupId = usablePeerId(contact.group_id)
  return {
    sendId: String(groupId),
    peerId: String(groupId),
    type: 'group',
    isTemp: false,
  }
}

export function matchesForwardSearch(contact: ForwardContact, query: string): boolean {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return true
  const haystack = [
    contact.nickname,
    contact.remark,
    contact.group_name,
    contact.user_id,
    contact.group_id,
  ].filter((part) => part != null && part !== '').join(' ').toLowerCase()
  return haystack.includes(q)
}

export function prioritizeForwardContacts<T extends ForwardContact>(contacts: readonly T[], recentContacts: readonly T[]): T[] {
  const recentKeys = new Set(recentContacts.map(forwardContactKey).filter(Boolean))
  return [
    ...recentContacts.filter((contact) => contacts.some((item) => forwardContactKey(item) === forwardContactKey(contact))),
    ...contacts.filter((contact) => {
      const key = forwardContactKey(contact)
      return Boolean(key) && !recentKeys.has(key)
    }),
  ]
}
