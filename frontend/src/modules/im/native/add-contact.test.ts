import { describe, expect, it } from 'vitest'
import {
  applyLocalMembership,
  constellationFromDate,
  defaultFriendMessage,
  groupsFromContactList,
  groupMemberLabel,
  isFriendContact,
  isJoinedGroupContact,
  isUnsupportedContactAction,
  joinGroupForm,
  userFromStranger,
  userSearchTags,
} from './add-contact'

describe('joinGroupForm', () => {
  it('shows an empty apply body when anyone can join', () => {
    expect(joinGroupForm({ already: false, option: 1, question: '' })).toEqual({
      kind: 'none',
      question: '',
    })
  })

  it('asks for verification when the group needs admin approval', () => {
    expect(joinGroupForm({ already: false, option: 2, question: '' })).toEqual({
      kind: 'verify',
      question: '',
    })
  })

  it('shows the custom group question instead of the generic verification label', () => {
    expect(joinGroupForm({
      already: false,
      option: 5,
      question: '加群的目的是干嘛?',
    })).toEqual({
      kind: 'question',
      question: '加群的目的是干嘛?',
    })
  })

  it('prefers a custom question even when the option looks like verification', () => {
    expect(joinGroupForm({
      already: false,
      option: 2,
      question: '你是怎么找到本群的?',
    }).kind).toBe('question')
  })

  it('marks joined groups and groups that forbid joining', () => {
    expect(joinGroupForm({ already: true, option: 2, question: '' }).kind).toBe('already')
    expect(joinGroupForm({ already: false, option: 3, question: '' }).kind).toBe('forbid')
  })
})

describe('search tags', () => {
  it('builds age and constellation tags', () => {
    expect(constellationFromDate(11, 1)).toBe('天蝎座')
    expect(constellationFromDate(12, 28)).toBe('摩羯座')
    expect(userSearchTags({
      user_id: '1',
      nickname: '福运自来',
      age: 39,
      birthday_month: 11,
      birthday_day: 1,
    })).toEqual(['39岁', '天蝎座'])
  })

  it('shows member counts with or without a max', () => {
    expect(groupMemberLabel({ group_id: '1', name: 'a', member_num: 136 })).toBe('136')
    expect(groupMemberLabel({
      group_id: '1',
      name: 'BANK OF TOKEN',
      member_num: 106,
      max_member_num: 200,
    })).toBe('106/200')
    expect(groupMemberLabel({
      group_id: '1',
      name: 'chatGPT交流群',
      member_num: 2000,
      max_member_num: 2000,
    })).toBe('2000/2000')
  })

  it('prefills the friend verification with the local nickname', () => {
    expect(defaultFriendMessage('Raven')).toBe('我是Raven')
    expect(defaultFriendMessage('')).toBe('')
  })
})

describe('search fallback', () => {
  it('maps stranger info and joined groups when search_contact is missing', () => {
    expect(isUnsupportedContactAction(new Error('不支持的API search_contact'))).toBe(true)
    expect(userFromStranger({ user_id: 732085886, nickname: '老婆666', age: 36 }, false)).toMatchObject({
      user_id: '732085886',
      nickname: '老婆666',
      age: 36,
      already: false,
    })
    expect(groupsFromContactList([
      { group_id: 732085886, group_name: 'BANK OF TOKEN', member_count: 106 },
      { user_id: 1, group_id: 1, group_name: '我的好友' },
    ], '732085886')).toEqual([{
      group_id: '732085886',
      name: 'BANK OF TOKEN',
      already: true,
      member_num: 106,
    }])
  })

  it('treats get_group_info hits as not joined unless the group is in the contact list', () => {
    const list = [
      { group_id: 732085886, group_name: 'BANK OF TOKEN' },
      { user_id: 2250516944, group_id: 1, group_name: '我的好友' },
    ]
    expect(isJoinedGroupContact(list, 732085886)).toBe(true)
    expect(isJoinedGroupContact(list, 474141887)).toBe(false)
    expect(isFriendContact(list, 2250516944)).toBe(true)
    expect(isFriendContact(list, 3149159425)).toBe(false)
    const result = applyLocalMembership({
      user: { user_id: '3149159425', nickname: 'Raven', already: true },
      groups: [
        { group_id: '474141887', name: '公文接收（莲中党务群）', already: true, member_num: 4, max_member_num: 200 },
        { group_id: '732085886', name: 'BANK OF TOKEN', already: false },
      ],
    }, list)
    expect(result.user?.already).toBe(false)
    expect(result.groups[0].already).toBe(false)
    expect(result.groups[1].already).toBe(true)
  })
})
