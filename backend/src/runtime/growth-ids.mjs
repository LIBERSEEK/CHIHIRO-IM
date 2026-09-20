export function isQqAccountId(id) {
  return /^qq:\d+$/.test(String(id || ''))
}

export function isDouyinAccountId(id) {
  return /^douyin:[A-Za-z0-9._-]+$/.test(String(id || ''))
}

export function accountPlatform(account) {
  const id = String(account?.id || '')
  if (account?.platform === 'douyin' || account?.client === 'douyin' || isDouyinAccountId(id)) return 'douyin'
  if (account?.platform === 'qq' || account?.client === 'qq' || isQqAccountId(id)) return 'qq'
  return null
}

export function newDouyinAccountId() {
  const stamp = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 8)
  return `douyin:${stamp}${rand}`
}
