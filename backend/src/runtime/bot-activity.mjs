export function sessionActivityKey(accountId, type, peerId) {
  return `${accountId}:${type === 'group' ? 'group' : 'private'}:${String(peerId)}`
}

export function createBotActivity({ touch } = {}) {
  const counts = new Map()

  function begin(accountId, type, peerId) {
    if (!accountId || peerId == null || peerId === '') return
    const key = sessionActivityKey(accountId, type, peerId)
    const next = (counts.get(key) || 0) + 1
    counts.set(key, next)
    if (next === 1) touch?.()
  }

  function end(accountId, type, peerId) {
    if (!accountId || peerId == null || peerId === '') return
    const key = sessionActivityKey(accountId, type, peerId)
    const current = counts.get(key) || 0
    if (current <= 1) {
      if (counts.has(key)) {
        counts.delete(key)
        touch?.()
      }
      return
    }
    counts.set(key, current - 1)
  }

  function snapshot() {
    const out = {}
    for (const key of counts.keys()) out[key] = 'working'
    return out
  }

  return { begin, end, snapshot }
}
