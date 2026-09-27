export function isQqAccountId(id) {
  return /^qq:\d+$/.test(String(id || ''))
}

export function isDouyinAccountId(id) {
  return /^douyin:[A-Za-z0-9._-]+$/.test(String(id || ''))
}

export function isXiaohongshuAccountId(id) {
  return /^xiaohongshu:[A-Za-z0-9._-]+$/.test(String(id || ''))
}

export function isBilibiliAccountId(id) {
  return /^bilibili:[A-Za-z0-9._-]+$/.test(String(id || ''))
}

export function isOutreachAccountId(id) {
  return isDouyinAccountId(id) || isXiaohongshuAccountId(id) || isBilibiliAccountId(id)
}

export function accountPlatform(account) {
  const id = String(account?.id || '')
  if (account?.platform === 'bilibili' || account?.client === 'bilibili' || isBilibiliAccountId(id)) return 'bilibili'
  if (account?.platform === 'xiaohongshu' || account?.client === 'xiaohongshu' || isXiaohongshuAccountId(id)) return 'xiaohongshu'
  if (account?.platform === 'douyin' || account?.client === 'douyin' || isDouyinAccountId(id)) return 'douyin'
  if (account?.platform === 'qq' || account?.client === 'qq' || isQqAccountId(id)) return 'qq'
  return null
}

export function outreachPlatformOf(id) {
  if (isBilibiliAccountId(id)) return 'bilibili'
  if (isXiaohongshuAccountId(id)) return 'xiaohongshu'
  if (isDouyinAccountId(id)) return 'douyin'
  return null
}

export function pickOutreachAccount(accounts, platform, preferredId, hasStorage = () => false) {
  const kind = platform === 'xiaohongshu' || platform === 'bilibili' ? platform : 'douyin'
  const list = (accounts || []).filter((account) => outreachPlatformOf(account?.id) === kind)
  return list.find((account) => account.id === preferredId && hasStorage(account.id))
    || list.find((account) => hasStorage(account.id))
    || list[0]
    || null
}

export function newDouyinAccountId() {
  const stamp = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 8)
  return `douyin:${stamp}${rand}`
}

export function newXiaohongshuAccountId() {
  const stamp = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 8)
  return `xiaohongshu:${stamp}${rand}`
}

export function newBilibiliAccountId() {
  const stamp = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 8)
  return `bilibili:${stamp}${rand}`
}
