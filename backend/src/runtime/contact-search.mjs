function asObject(value) {
  return value && typeof value === 'object' ? value : {}
}

export function unwrapSearchGroup(found) {
  const row = asObject(found)
  return asObject(row.searchGroupInfo && typeof row.searchGroupInfo === 'object' ? row.searchGroupInfo : row)
}

export function mapSex(value) {
  const sex = String(value ?? '').trim().toLowerCase()
  if (sex === 'male' || sex === '1' || sex === '男') return 'male'
  if (sex === 'female' || sex === '2' || sex === '女') return 'female'
  return ''
}

export function mapSearchUser(info, already = false) {
  const row = asObject(info)
  const userId = String(row.uin || row.user_id || row.userId || '').trim()
  if (!/^\d+$/.test(userId) || /^0+$/.test(userId)) return null
  return {
    user_id: userId,
    nickname: String(row.nick || row.nickname || ''),
    remark: String(row.remark || ''),
    age: Number(row.age) > 0 ? Number(row.age) : 0,
    sex: mapSex(row.sex),
    birthday_month: Number(row.birthday_month ?? row.birthdayMonth) || 0,
    birthday_day: Number(row.birthday_day ?? row.birthdayDay) || 0,
    already: !!already,
  }
}

export function mapSearchGroup(info, already = false) {
  const row = unwrapSearchGroup(info)
  const groupId = String(row.groupCode || row.group_id || row.groupId || asObject(info).groupCode || '').trim()
  if (!/^\d+$/.test(groupId) || /^0+$/.test(groupId)) return null
  return {
    group_id: groupId,
    name: String(row.groupName || row.group_name || asObject(info).groupName || ''),
    member_num: Number(row.memberNum ?? row.member_count ?? row.member_num) || 0,
    max_member_num: Number(row.maxMemberNum ?? row.max_member_count ?? row.max_member_num) || 0,
    already: !!already,
    muted: Number(row.shutUpAllTimestamp || 0) > 0 || Number(row.shutUpMeTimestamp || 0) > 0,
    option: Number(row.addOption ?? row.groupOption ?? 0) || 0,
    question: String(row.groupQuestion || '').trim(),
    memo: String(row.fingerMemo || row.richFingerMemo || row.groupMemo || ''),
    joinGroupAuth: String(row.joinGroupAuth || ''),
  }
}

export function joinGroupCall(info, payload = {}) {
  const row = unwrapSearchGroup(info)
  const groupId = String(
    payload.group_id || payload.groupId || row.groupCode || row.group_id || '',
  ).trim()
  const comment = String(payload.comment || payload.message || payload.msg || '')
  const answer = String(payload.answer || payload.joinGroupAnswer || '')
  const option = Number(row.addOption ?? row.groupOption ?? 0) || 0
  return {
    groupCode: groupId,
    joinGroupAuth: String(row.joinGroupAuth || ''),
    msg: comment,
    joinGroupAnswer: answer || comment,
    option,
    question: String(row.groupQuestion || '').trim(),
  }
}
