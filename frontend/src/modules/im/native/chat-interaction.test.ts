import { describe, expect, it } from 'vitest'
import {
  collectForwardContacts,
  forwardContactKey,
  forwardContactKind,
  hasOutgoingContent,
  matchesForwardSearch,
  prioritizeForwardContacts,
  resolveForwardTarget,
} from './chat-interaction'

describe('native IM chat interactions', () => {
  it('does not send an empty composer', () => {
    expect(hasOutgoingContent({ text: '', attachmentCount: 0, hasInlineFaces: false, hasInlineAts: false })).toBe(false)
    expect(hasOutgoingContent({ text: '', attachmentCount: 0, hasInlineFaces: true, hasInlineAts: false })).toBe(true)
    expect(hasOutgoingContent({ text: '', attachmentCount: 1, hasInlineFaces: false, hasInlineAts: false })).toBe(true)
  })

  it('prioritizes recent forward targets without mutating contact order', () => {
    const contacts = [{ user_id: 1 }, { group_id: 2 }, { user_id: 3 }]
    const ordered = prioritizeForwardContacts(contacts, [{ user_id: 3 }, { group_id: 2 }, { user_id: 9 }])
    expect(ordered.map(forwardContactKey)).toEqual(['user-3', 'group-2', 'user-1'])
    expect(contacts.map(forwardContactKey)).toEqual(['user-1', 'group-2', 'user-3'])
  })

  it('adds temp sessions that are missing from the friend/group book', () => {
    const contacts = [
      { user_id: 1, nickname: 'Raven', group_id: 1, group_name: '我的好友' },
      { group_id: 715825910, group_name: '中转站' },
    ]
    const sessions = [
      { user_id: 2917246341, nickname: 'THREE', group_id: 732085886, group_name: '' },
      { user_id: 1, nickname: 'Raven', group_id: 1, group_name: '我的好友' },
      { group_id: 715825910, group_name: '中转站' },
    ]
    const list = collectForwardContacts(contacts, sessions)
    expect(list.map(forwardContactKey)).toEqual(['user-1', 'group-715825910', 'user-2917246341'])
    expect(forwardContactKind(sessions[0])).toBe('temp')
    expect(matchesForwardSearch(sessions[0], 'three')).toBe(true)
    expect(matchesForwardSearch(sessions[0], '2917246341')).toBe(true)
  })

  it('forwards a temp session as private with the source group', () => {
    expect(resolveForwardTarget({
      user_id: 2917246341,
      group_id: 732085886,
      group_name: '',
    })).toEqual({
      sendId: '2917246341/732085886',
      peerId: '2917246341',
      type: 'user',
      isTemp: true,
    })
    expect(resolveForwardTarget({ group_id: 715825910, group_name: '中转站' })).toMatchObject({
      sendId: '715825910',
      peerId: '715825910',
      type: 'group',
      isTemp: false,
    })
    expect(resolveForwardTarget({
      user_id: 1,
      group_id: 1,
      group_name: '我的好友',
    })).toMatchObject({
      sendId: '1',
      type: 'user',
      isTemp: false,
    })
  })
})
