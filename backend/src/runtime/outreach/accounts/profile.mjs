const NICK_KEYS = /^(nickname|nick_name|nickName|user_name|userName|short_name|shortName|name)$/i
const AVATAR_KEYS = /^(avatar|avatar_url|avatarUrl|avatar_larger|avatarLarger|avatar_thumb|avatarThumb|avatar_medium|avatarMedium|avatar_168x168|url_list)$/i
const UID_KEYS = /^(uid|user_id|userId|sec_uid|secUid)$/i
const DOUYIN_ID_KEYS = /^(unique_id|uniqueId|display_id|displayId)$/i
const SHORT_ID_KEYS = /^(short_id|shortId)$/i
const BAD_NICK = /^(登录|登陆|抖音|douyin|tiktok|推荐|关注|朋友|消息|我|首页|user|null|undefined)$/i
const AVATAR_HOST = /(douyinpic|byteimg|tiktokcdn|douyinstatic|bytecdn|sns-avatar|p[1-9]\.douyin)/i

export function localStorageFromStorageState(storageState) {
  const storage = {}
  for (const origin of storageState?.origins || []) {
    for (const item of origin?.localStorage || []) {
      if (item?.name) storage[item.name] = String(item.value ?? '')
    }
  }
  return storage
}

export function extractDouyinProfile({
  localStorage = {},
  cookies = [],
  images = [],
  nickname = '',
  html = '',
} = {}) {
  const acc = { nicknames: [], avatars: [], uids: [], douyinIds: [], shortIds: [] }
  walk(localStorage, 0, acc)
  walk(decodeMaybe(html), 0, acc)
  const passed = splitDouyinIdentity(nickname)
  if (looksLikeNickname(passed.name)) acc.nicknames.unshift(passed.name)
  if (passed.douyinId) acc.douyinIds.unshift(passed.douyinId)
  for (const src of images) {
    if (looksLikeAvatar(src)) acc.avatars.push(normalizeAvatarUrl(src))
  }
  const uidCookie = (cookies || []).find((cookie) => /^(uid_tt|sid_tt|uid_tt_ss)$/.test(cookie?.name || '') && cookie?.value)
  if (uidCookie?.value) acc.uids.push(String(uidCookie.value))
  return {
    nickname: acc.nicknames.find(Boolean) || '',
    douyinId: acc.douyinIds.find(Boolean) || acc.shortIds.find(Boolean) || '',
    avatar: acc.avatars.find(Boolean) || '',
    uid: acc.uids.find((value) => looksLikeUid(value)) || '',
  }
}

/** Keep the display name and the public 抖音号; drop 关注 / 粉丝 / 获赞 counts. */
export function splitDouyinIdentity(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  const idMatch = text.match(/抖音号\s*[:：]\s*([A-Za-z0-9._-]{2,32})/)
  let name = idMatch ? text.slice(0, idMatch.index) : text
  name = name.replace(/关注\s*[\d.]+(?:\s*[万亿])?\s*粉丝\s*[\d.]+(?:\s*[万亿])?\s*获赞\s*[\d.]+(?:\s*[万亿])?\s*$/u, '')
  name = name.replace(/\s+/g, ' ').trim()
  return { name, douyinId: idMatch?.[1] || '' }
}

export function presentDouyinIdentity(account = {}) {
  const fromNick = splitDouyinIdentity(account.nickname || account.label || '')
  const fromLabel = splitDouyinIdentity(account.label || '')
  const name = [fromNick.name, fromLabel.name].find((value) => value && !hasDouyinStats(value)) || ''
  const douyinId = String(account.douyinId || '').trim() || fromNick.douyinId || fromLabel.douyinId || ''
  return { name, douyinId }
}

function walk(value, depth, acc) {
  if (depth > 8 || value == null) return acc
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return acc
    const decoded = decodeMaybe(trimmed)
    if (decoded !== trimmed) return walk(decoded, depth + 1, acc)
    if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && trimmed.length < 240000) {
      try {
        return walk(JSON.parse(trimmed), depth + 1, acc)
      } catch {
        return acc
      }
    }
    return acc
  }
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 80)) walk(item, depth + 1, acc)
    return acc
  }
  if (typeof value !== 'object') return acc
  for (const [key, nested] of Object.entries(value)) {
    if (typeof nested === 'string') {
      const trimmed = nested.trim()
      if (NICK_KEYS.test(key)) {
        const split = splitDouyinIdentity(trimmed)
        if (looksLikeNickname(split.name)) acc.nicknames.push(split.name)
        if (split.douyinId) acc.douyinIds.push(split.douyinId)
      }
      if (DOUYIN_ID_KEYS.test(key) && looksLikeDouyinId(trimmed)) acc.douyinIds.push(trimmed)
      if (SHORT_ID_KEYS.test(key) && looksLikeDouyinId(trimmed)) acc.shortIds.push(trimmed)
      if (AVATAR_KEYS.test(key) && looksLikeAvatar(trimmed)) acc.avatars.push(normalizeAvatarUrl(trimmed))
      if (UID_KEYS.test(key) && looksLikeUid(trimmed)) acc.uids.push(trimmed)
    } else if (Array.isArray(nested) && AVATAR_KEYS.test(key)) {
      const first = nested.find((item) => typeof item === 'string' && looksLikeAvatar(item))
      if (first) acc.avatars.push(normalizeAvatarUrl(first))
    }
    walk(nested, depth + 1, acc)
  }
  return acc
}

function decodeMaybe(value) {
  const text = String(value || '')
  if (!text) return text
  if (!/%[0-9A-Fa-f]{2}/.test(text)) return text
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

function looksLikeNickname(value) {
  const text = String(value || '').trim()
  return text.length >= 1 && text.length <= 40 && !BAD_NICK.test(text) && !/^https?:/i.test(text)
}

function hasDouyinStats(value) {
  return /关注\s*[\d.]/.test(value) || /抖音号\s*[:：]/.test(value)
}

function looksLikeDouyinId(value) {
  const text = String(value || '').trim()
  return /^[A-Za-z0-9._-]{2,32}$/.test(text) && !/^\d{16,}$/.test(text)
}

function looksLikeUid(value) {
  const text = String(value || '').trim()
  return /^[A-Za-z0-9._-]{4,64}$/.test(text)
}

function looksLikeAvatar(value) {
  const text = normalizeAvatarUrl(value)
  if (!/^https?:\/\//i.test(text)) return false
  if (/\.(svg)(\?|$)/i.test(text)) return false
  return AVATAR_HOST.test(text) || /avatar/i.test(text) || /\.(jpe?g|png|webp)(\?|$)/i.test(text)
}

function normalizeAvatarUrl(value) {
  const text = String(value || '').trim()
  if (text.startsWith('//')) return `https:${text}`
  return text
}
