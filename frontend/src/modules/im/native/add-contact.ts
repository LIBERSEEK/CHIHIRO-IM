import { reactive } from 'vue'

export type JoinFormKind = 'none' | 'verify' | 'question' | 'forbid' | 'already'

export type SearchUser = {
  user_id: string
  nickname: string
  remark?: string
  age?: number
  sex?: string
  birthday_month?: number
  birthday_day?: number
  already?: boolean
}

export type SearchGroup = {
  group_id: string
  name: string
  member_num?: number
  max_member_num?: number
  already?: boolean
  muted?: boolean
  option?: number
  question?: string
  memo?: string
}

export type AddContactSeed =
  | { mode: 'search' }
  | { mode: 'friend'; user: SearchUser }

export const addContactUi = reactive({
  open: false,
  seed: { mode: 'search' } as AddContactSeed,
})

export function openAddContactSearch() {
  addContactUi.seed = { mode: 'search' }
  addContactUi.open = true
}

export function openAddFriendApply(input: { userId: number | string; nickname?: string }) {
  addContactUi.seed = {
    mode: 'friend',
    user: {
      user_id: String(input.userId),
      nickname: String(input.nickname || ''),
      already: false,
    },
  }
  addContactUi.open = true
}

export function closeAddContact() {
  addContactUi.open = false
}

export function constellationFromDate(month: number, day: number): string {
  if (month < 1 || month > 12 || day < 1 || day > 31) return ''
  const caps = [20, 19, 21, 20, 21, 22, 23, 23, 23, 23, 23, 22]
  const names = ['摩羯座', '水瓶座', '双鱼座', '白羊座', '金牛座', '双子座', '巨蟹座', '狮子座', '处女座', '天秤座', '天蝎座', '射手座']
  const index = month - 1
  return day < caps[index] ? names[index] : names[(index + 1) % 12]
}

export function userSearchTags(user: SearchUser): string[] {
  const tags: string[] = []
  const age = Number(user.age)
  if (age > 0) tags.push(`${age}岁`)
  const sign = constellationFromDate(Number(user.birthday_month), Number(user.birthday_day))
  if (sign) tags.push(sign)
  return tags
}

export function groupMemberLabel(group: SearchGroup): string {
  const current = Number(group.member_num) || 0
  const max = Number(group.max_member_num) || 0
  if (current > 0 && max > 0) return `${current}/${max}`
  if (current > 0) return String(current)
  if (max > 0) return `0/${max}`
  return ''
}

export function joinGroupForm(group: Pick<SearchGroup, 'already' | 'option' | 'question'>): {
  kind: JoinFormKind
  question: string
} {
  if (group.already) return { kind: 'already', question: '' }
  const question = String(group.question || '').trim()
  const option = Number(group.option) || 0
  if (option === 3) return { kind: 'forbid', question }
  if (option === 4 || option === 5 || question) {
    return { kind: 'question', question }
  }
  if (option === 2) return { kind: 'verify', question: '' }
  return { kind: 'none', question: '' }
}

export function defaultFriendMessage(nickname?: string): string {
  const name = String(nickname || '').trim()
  return name ? `我是${name}` : ''
}

export function userAvatar(userId: string | number): string {
  return `https://q1.qlogo.cn/g?b=qq&s=0&nk=${userId}`
}

export function groupAvatar(groupId: string | number): string {
  return `https://p.qlogo.cn/gh/${groupId}/${groupId}/0`
}

export function isUnsupportedContactAction(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error || '')
  return /不支持的Api/i.test(text)
}

export function userFromStranger(data: unknown, already = false): SearchUser | null {
  if (!data || typeof data !== 'object') return null
  const row = data as Record<string, unknown>
  const userId = String(row.user_id ?? row.uin ?? '').trim()
  if (!/^\d+$/.test(userId) || /^0+$/.test(userId)) return null
  return {
    user_id: userId,
    nickname: String(row.nickname || row.nick || ''),
    remark: String(row.remark || ''),
    age: Number(row.age) > 0 ? Number(row.age) : 0,
    sex: String(row.sex || ''),
    birthday_month: Number(row.birthday_month) || 0,
    birthday_day: Number(row.birthday_day) || 0,
    already,
  }
}

export type ContactLike = { user_id?: number; group_id?: number; group_name?: string; member_count?: number }

export function isFriendContact(list: ContactLike[], userId: string | number): boolean {
  const id = Number(userId)
  if (!Number.isFinite(id) || id <= 0) return false
  return list.some((item) => Number(item.user_id) === id)
}

export function isJoinedGroupContact(list: ContactLike[], groupId: string | number): boolean {
  const id = Number(groupId)
  if (!Number.isFinite(id) || id <= 0) return false
  return list.some((item) => Number(item.group_id) === id && !item.user_id)
}

export function groupsFromContactList(list: ContactLike[], keyword: string): SearchGroup[] {
  const q = String(keyword || '').trim().toLowerCase()
  if (!q) return []
  const groups: SearchGroup[] = []
  for (const item of list) {
    if (!item.group_id || item.user_id) continue
    const id = String(item.group_id)
    const name = String(item.group_name || '')
    if (id === q || name.toLowerCase().includes(q)) {
      groups.push({
        group_id: id,
        name,
        already: true,
        member_num: Number(item.member_count) || 0,
      })
    }
  }
  return groups
}

export function applyLocalMembership<T extends { user?: SearchUser | null; groups?: SearchGroup[] }>(
  result: T,
  list: ContactLike[],
): T {
  if (result.user) result.user.already = isFriendContact(list, result.user.user_id)
  if (Array.isArray(result.groups)) {
    for (const group of result.groups) {
      group.already = isJoinedGroupContact(list, group.group_id)
    }
  }
  return result
}
