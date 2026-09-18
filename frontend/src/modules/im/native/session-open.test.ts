import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('./src/function/utils/msgUtil', async () => {
  const { useContactStore } = await import('./src/state/contact')
  return {
    getShowName: (base: string, remark: string) => {
      if (!remark || remark === '' || remark === base) return String(base || '')
      return `${remark}（${base}）`
    },
    updateBaseOnMsgList: () => {
      const contacts = useContactStore()
      contacts.onMsgList = [...contacts.baseOnMsgList.values()]
    },
  }
})

import { isSessionListItemActive, prepareGroupChat, preparePrivateChat } from './session-open'
import { useContactStore } from './src/state/contact'

beforeEach(() => setActivePinia(createPinia()))

describe('preparePrivateChat', () => {
  it('inserts a temp group-member session into the message list', () => {
    const contacts = useContactStore()
    const info = preparePrivateChat({
      userId: 10086,
      nickname: '自由探索',
      groupId: 732085886,
    })
    expect(info).toMatchObject({
      type: 'user',
      id: 10086,
      name: '自由探索',
      temp: 732085886,
    })
    expect(contacts.baseOnMsgList.get(10086)?.user_id).toBe(10086)
    expect(contacts.onMsgList.some((item) => Number(item.user_id) === 10086)).toBe(true)
  })

  it('reuses an existing friend session instead of creating a temp chat', () => {
    const contacts = useContactStore()
    contacts.userList = [{
      user_id: 42,
      nickname: 'Friend',
      remark: '备注',
      group_id: 1,
      group_name: '我的好友',
      time: 1_700_000_000_000,
    } as never]
    const info = preparePrivateChat({ userId: 42, nickname: 'ignored', groupId: 999 })
    expect(info.name).toContain('备注')
    expect(info.temp).toBeUndefined()
    expect(contacts.onMsgList.some((item) => Number(item.user_id) === 42)).toBe(true)
  })
})

describe('isSessionListItemActive', () => {
  const group = { group_id: 715825910, group_name: '55中转站2群', user_id: 0 }
  const temp = { user_id: 2654778181, nickname: 'ttg', group_id: 715825910, group_name: '' }
  const friend = { user_id: 42, group_id: 1, group_name: '我的好友' }

  it('does not highlight a temp session when the source group is open', () => {
    expect(isSessionListItemActive({ id: 715825910, type: 'group' }, group)).toBe(true)
    expect(isSessionListItemActive({ id: 715825910, type: 'group' }, temp)).toBe(false)
    expect(isSessionListItemActive({ id: 715825910, type: 'group' }, friend)).toBe(false)
  })

  it('highlights only the matching private session', () => {
    expect(isSessionListItemActive({ id: 2654778181, type: 'user' }, temp)).toBe(true)
    expect(isSessionListItemActive({ id: 2654778181, type: 'user' }, group)).toBe(false)
    expect(isSessionListItemActive({ id: 42, type: 'user' }, friend)).toBe(true)
  })
})

describe('prepareGroupChat', () => {
  it('inserts a joined group into the message list', () => {
    const contacts = useContactStore()
    const info = prepareGroupChat({
      groupId: 1103916100,
      name: '奥特曼Ai中转站下游公告2群',
    })
    expect(info).toMatchObject({
      type: 'group',
      id: 1103916100,
      name: '奥特曼Ai中转站下游公告2群',
    })
    expect(contacts.baseOnMsgList.get(1103916100)?.group_id).toBe(1103916100)
    expect(contacts.onMsgList.some((item) => Number(item.group_id) === 1103916100)).toBe(true)
  })
})
