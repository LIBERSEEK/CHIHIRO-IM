import { describe, expect, it } from 'vitest'
import { isNapcatDummyPeer, resolveMessageSession, resolvePrivateSendTarget } from './message-peer'

describe('resolveMessageSession', () => {
  it('keeps group messages on the group session', () => {
    expect(resolveMessageSession({
      message_type: 'group',
      group_id: 715825910,
      user_id: 2654778181,
      sender: { user_id: 2654778181 },
    }, 3967167443)).toMatchObject({
      sessionId: 715825910,
      isGroup: true,
      isTemp: false,
    })
  })

  it('routes temp private messages to the peer instead of the source group', () => {
    expect(resolveMessageSession({
      message_type: 'private',
      sub_type: 'group',
      group_id: 715825910,
      user_id: 2654778181,
      sender: { user_id: 2654778181 },
    }, 3967167443)).toMatchObject({
      sessionId: 2654778181,
      isGroup: false,
      isTemp: true,
      sourceGroupId: 715825910,
    })
  })

  it('uses target_id for self-sent temp messages and ignores NapCat dummy group_id', () => {
    expect(isNapcatDummyPeer(284840486)).toBe(true)
    expect(resolveMessageSession({
      message_type: 'private',
      sub_type: 'group',
      post_type: 'message_sent',
      group_id: 284840486,
      user_id: 3967167443,
      target_id: 2654778181,
      sender: { user_id: 3967167443 },
    }, 3967167443)).toMatchObject({
      sessionId: 2654778181,
      isGroup: false,
      isTemp: true,
      sourceGroupId: 0,
      senderId: 3967167443,
    })
  })
})

describe('resolvePrivateSendTarget', () => {
  it('sends temp group-member chat as private C2C with the source group', () => {
    expect(resolvePrivateSendTarget('2654778181/715825910')).toEqual({
      userId: 2654778181,
      groupId: 715825910,
      isTemp: true,
    })
    expect(resolvePrivateSendTarget(2654778181, 715825910)).toEqual({
      userId: 2654778181,
      groupId: 715825910,
      isTemp: true,
    })
  })

  it('does not treat NapCat dummy peers as a send target or source group', () => {
    expect(resolvePrivateSendTarget(284840486, 715825910)).toEqual({
      userId: 0,
      groupId: 715825910,
      isTemp: false,
    })
    expect(resolvePrivateSendTarget('2654778181/284840486')).toEqual({
      userId: 2654778181,
      groupId: 0,
      isTemp: false,
    })
  })
})
