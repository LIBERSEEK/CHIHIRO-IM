import type { BaseChatInfoElem, UserFriendElem, UserGroupElem } from './src/function/elements/information'
import { getShowName, updateBaseOnMsgList } from './src/function/utils/msgUtil'
import { useContactStore } from './src/state/contact'

export type SessionContact = UserFriendElem & UserGroupElem

export function preparePrivateChat(input: {
  userId: number
  nickname?: string
  groupId?: number
}): BaseChatInfoElem {
  const contactStore = useContactStore()
  const userId = Number(input.userId)
  const existing = contactStore.baseOnMsgList.get(userId)
  const friend = contactStore.userList.find((item) => Number(item.user_id) === userId)
  const session: SessionContact = existing ?? friend ?? {
    user_id: userId,
    nickname: String(input.nickname || userId),
    remark: '',
    group_id: Number(input.groupId || 0),
    group_name: '',
  } as SessionContact
  if (!existing && !friend) {
    session.nickname = String(input.nickname || session.nickname || userId)
    if (input.groupId) session.group_id = Number(input.groupId)
    session.group_name = ''
  }
  if (!session.time) session.time = Date.now()
  contactStore.baseOnMsgList.set(userId, session)
  updateBaseOnMsgList()
  const temp = session.user_id && session.group_name === '' && session.group_id
    ? Number(session.group_id)
    : undefined
  return {
    type: 'user',
    id: userId,
    name: getShowName(session.nickname, session.remark),
    avatar: `https://q1.qlogo.cn/g?b=qq&s=0&nk=${userId}`,
    temp,
  }
}

export function prepareGroupChat(input: {
  groupId: number
  name?: string
}): BaseChatInfoElem {
  const contactStore = useContactStore()
  const groupId = Number(input.groupId)
  const existing = contactStore.baseOnMsgList.get(groupId)
  const known = contactStore.userList.find((item) =>
    Number(item.group_id) === groupId && !item.user_id,
  )
  const session: SessionContact = existing ?? known ?? {
    group_id: groupId,
    group_name: String(input.name || groupId),
    user_id: 0,
    nickname: '',
    remark: '',
  } as SessionContact
  if (!existing && !known) {
    session.group_name = String(input.name || session.group_name || groupId)
  }
  if (!session.time) session.time = Date.now()
  contactStore.baseOnMsgList.set(groupId, session)
  updateBaseOnMsgList()
  return {
    type: 'group',
    id: groupId,
    name: String(session.group_name || input.name || groupId),
    avatar: `https://p.qlogo.cn/gh/${groupId}/${groupId}/0`,
  }
}
