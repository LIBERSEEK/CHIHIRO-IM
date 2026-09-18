import { describe, expect, it } from 'vitest'
import { chatHistoryRequestParams, isEmptyChatHistoryResponse } from './history-request'

describe('isEmptyChatHistoryResponse', () => {
  it('treats NapCat empty-history errors as empty, not failed', () => {
    expect(isEmptyChatHistoryResponse({
      status: 'failed',
      data: null,
      message: '消息undefined不存在',
      wording: '消息undefined不存在',
    })).toBe(true)
    expect(isEmptyChatHistoryResponse({
      status: 'failed',
      data: null,
      message: '消息0不存在',
    })).toBe(true)
  })

  it('treats an empty message list as empty history', () => {
    expect(isEmptyChatHistoryResponse({ status: 'ok', data: { messages: [] } })).toBe(true)
    expect(isEmptyChatHistoryResponse({ status: 'ok', data: [] })).toBe(true)
  })

  it('treats NapCat failed empty payloads as empty history', () => {
    expect(isEmptyChatHistoryResponse({
      status: 'failed',
      data: null,
      message: '记录10086不存在',
    })).toBe(true)
    expect(isEmptyChatHistoryResponse({
      status: 'failed',
      data: null,
      message: '无法获取用户信息',
    })).toBe(true)
    expect(isEmptyChatHistoryResponse({
      status: 'ok',
      data: { messages: [{ message_id: 1 }] },
    })).toBe(false)
  })
})

describe('chatHistoryRequestParams', () => {
  it('sends message_seq for NapCat private history', () => {
    expect(chatHistoryRequestParams({
      id: 10086,
      type: 'user',
      count: 20,
    })).toMatchObject({
      user_id: 10086,
      group_id: undefined,
      message_id: 0,
      message_seq: 0,
      count: 20,
    })
  })

  it('includes the source group for a temp session', () => {
    expect(chatHistoryRequestParams({
      id: 10086,
      type: 'user',
      count: 20,
      tempGroupId: 732085886,
    })).toMatchObject({
      user_id: 10086,
      group_id: 732085886,
    })
  })

  it('does not fetch history against a NapCat dummy group', () => {
    expect(chatHistoryRequestParams({
      id: 2654778181,
      type: 'user',
      count: 20,
      tempGroupId: 284840486,
    })).toMatchObject({
      user_id: 2654778181,
      group_id: undefined,
    })
  })

  it('keeps group history on group_id', () => {
    expect(chatHistoryRequestParams({
      id: 732085886,
      type: 'group',
      count: 20,
      messageId: 'abc',
      tempGroupId: 1,
    })).toMatchObject({
      group_id: 732085886,
      user_id: undefined,
      message_id: 'abc',
      message_seq: 'abc',
    })
  })
})
