const MAX_SESSIONS = 40
const MAX_MESSAGES = 200

export type SessionMessageShow = {
  type?: string
  id?: number | string
  temp?: number | string
}

const cache = new Map<string, any[]>()

export function sessionMessageCacheKey(
  show: SessionMessageShow | null | undefined,
): string {
  const type = String(show?.type || '')
  const id = Number(show?.id)
  if (!type || !Number.isFinite(id) || id === 0) return ''
  const temp = Number(show?.temp)
  const tempPart = Number.isFinite(temp) && temp > 0 ? String(temp) : ''
  return `${type}:${id}:${tempPart}`
}

function touch(key: string, messages: any[]) {
  cache.delete(key)
  cache.set(key, messages)
  while (cache.size > MAX_SESSIONS) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

export function rememberSessionMessages(
  show: SessionMessageShow | null | undefined,
  messages: unknown[] | null | undefined,
): void {
  const key = sessionMessageCacheKey(show)
  if (!key) return
  const list = Array.isArray(messages) ? messages : []
  // An empty pane is usually a wipe, not a real empty session. Keep the last stash.
  if (list.length === 0) return
  touch(key, list.slice(-MAX_MESSAGES))
}

export function peekSessionMessages(
  show: SessionMessageShow | null | undefined,
): any[] {
  const key = sessionMessageCacheKey(show)
  if (!key) return []
  const list = cache.get(key)
  return list?.length ? list.slice() : []
}

export function appendSessionMessages(
  show: SessionMessageShow | null | undefined,
  messages: unknown[] | null | undefined,
): void {
  const key = sessionMessageCacheKey(show)
  if (!key) return
  const incoming = Array.isArray(messages) ? messages.filter(Boolean) : []
  if (!incoming.length) return
  const current = cache.get(key) ?? []
  const ids = new Set(
    current.map((item) => String(item?.message_id ?? '')).filter(Boolean),
  )
  const next = current.slice()
  for (const msg of incoming) {
    const id = String((msg as { message_id?: unknown })?.message_id ?? '')
    if (id && ids.has(id)) continue
    if (id) ids.add(id)
    next.push(msg)
  }
  touch(key, next.slice(-MAX_MESSAGES))
}

export function switchSessionMessageList(
  prevShow: SessionMessageShow | null | undefined,
  nextShow: SessionMessageShow | null | undefined,
  currentList: unknown[] | null | undefined,
): any[] {
  rememberSessionMessages(prevShow, currentList)
  return peekSessionMessages(nextShow)
}

export function clearSessionMessageCache(): void {
  cache.clear()
}
