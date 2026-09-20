import { afterEach, describe, expect, it } from 'vitest'
import {
  appendSessionMessages,
  clearSessionMessageCache,
  peekSessionMessages,
  rememberSessionMessages,
  sessionMessageCacheKey,
  switchSessionMessageList,
} from './session-message-cache'

const tempA = { type: 'user', id: 2917246341, temp: 732085886 }
const tempB = { type: 'user', id: 2917246341, temp: 1103916100 }
const group = { type: 'group', id: 732085886 }

afterEach(() => {
  clearSessionMessageCache()
})

describe('sessionMessageCacheKey', () => {
  it('keeps temp sessions distinct from friends and other source groups', () => {
    expect(sessionMessageCacheKey(tempA)).toBe('user:2917246341:732085886')
    expect(sessionMessageCacheKey(tempB)).toBe('user:2917246341:1103916100')
    expect(sessionMessageCacheKey({ type: 'user', id: 2917246341 })).toBe('user:2917246341:')
    expect(sessionMessageCacheKey(group)).toBe('group:732085886:')
    expect(sessionMessageCacheKey({ type: 'user', id: 0 })).toBe('')
  })
})

describe('session message cache', () => {
  it('restores live temp messages after switching away and back', () => {
    const sent = [{ message_id: 'm1', raw_message: '谁家好人拿grok4.3蒸啊' }]
    const restored = switchSessionMessageList(tempA, group, sent)
    expect(restored).toEqual([])
    expect(switchSessionMessageList(group, tempA, [])).toEqual(sent)
  })

  it('does not let an empty wipe erase a populated stash', () => {
    rememberSessionMessages(tempA, [{ message_id: 'm1' }])
    rememberSessionMessages(tempA, [])
    expect(peekSessionMessages(tempA)).toEqual([{ message_id: 'm1' }])
  })

  it('appends messages that arrive while the session is not open', () => {
    rememberSessionMessages(tempA, [{ message_id: 'm1' }])
    appendSessionMessages(tempA, [
      { message_id: 'm1' },
      { message_id: 'm2', raw_message: '是不是请求次数太多影响账号了' },
    ])
    expect(peekSessionMessages(tempA).map((item) => item.message_id)).toEqual(['m1', 'm2'])
  })
})
