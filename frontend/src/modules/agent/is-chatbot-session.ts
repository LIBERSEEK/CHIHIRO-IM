export function isChatBotSession(session: { session_id?: string | null; creator?: string | null } | string | null | undefined): boolean {
  if (typeof session === 'string') {
    return session.startsWith('suggest:') || session.startsWith('chihiro-suggest:')
  }
  const id = String(session?.session_id || '')
  const creator = String(session?.creator || '')
  return id.startsWith('suggest:') || creator.startsWith('chihiro-suggest:')
}

export function withoutChatBotSessions<T extends { session_id?: string | null; creator?: string | null }>(sessions: T[] | null | undefined): T[] {
  if (!Array.isArray(sessions)) return []
  return sessions.filter((item) => !isChatBotSession(item))
}
