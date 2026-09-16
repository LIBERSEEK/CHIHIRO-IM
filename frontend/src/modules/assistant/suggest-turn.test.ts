import { describe, expect, it } from 'vitest'
import {
  collectPendingTurn,
  decideJoin,
  isFillerText,
  isQuestionText,
  type SuggestTurnMessage,
} from './suggest-turn'

const them = (id: string, text: string, extra: Partial<SuggestTurnMessage> = {}): SuggestTurnMessage => ({
  id, role: 'them', text, senderId: extra.senderId || id, time: extra.time ?? 1_000, ...extra,
})
const me = (id: string, text: string, extra: Partial<SuggestTurnMessage> = {}): SuggestTurnMessage => ({
  id, role: 'me', text, senderId: 'self', time: extra.time ?? 1_000, ...extra,
})

describe('ChatBot turn coalescing and group join', () => {
  it('treats trailing them messages within 12s as one burst after the operator last spoke', () => {
    const messages = [
      me('m0', '我先去看一眼', { time: 1_000 }),
      them('t1', '那个地址', { senderId: 'a', time: 20_000 }),
      them('t2', '你知道吗', { senderId: 'a', time: 21_000 }),
      them('t3', 'GitHub 搜千寻 IM', { senderId: 'b', time: 22_000 }),
    ]
    expect(collectPendingTurn(messages).map(item => item.text)).toEqual([
      '那个地址', '你知道吗', 'GitHub 搜千寻 IM',
    ])
  })

  it('does not drag in an older them cluster separated by a long gap', () => {
    const messages = [
      them('old', '昨天的事', { senderId: 'a', time: 1_000 }),
      them('new', '在吗', { senderId: 'a', time: 30_000 }),
    ]
    expect(collectPendingTurn(messages).map(item => item.id)).toEqual(['new'])
  })

  it('always joins a private pending burst', () => {
    expect(decideJoin({
      type: 'private',
      messages: [them('1', '在吗'), them('2', '有空没')],
    }).reason).toBe('private')
  })

  it('joins a group burst that @ the operator, asks a question, or follows the operator', () => {
    expect(decideJoin({
      type: 'group',
      messages: [them('1', '帮看下这个', { senderId: 'a', atSelf: true })],
    }).reason).toBe('at')
    expect(decideJoin({
      type: 'group',
      messages: [them('1', '这个仓库地址你知道吗？', { senderId: 'a' })],
    }).reason).toBe('question')
    expect(decideJoin({
      type: 'group',
      messages: [me('m0', '我去查'), them('1', '好', { senderId: 'a' }), them('2', '谢了', { senderId: 'a' })],
    }).reason).toBe('follow-up')
  })

  it('joins a multi-person group discussion even when nobody asked a question', () => {
    const decision = decideJoin({
      type: 'group',
      messages: [
        them('1', '这个报错我这边也有', { senderId: 'a' }),
        them('2', '刚更新模型配置之后', { senderId: 'b' }),
        them('3', '好像和 token 有关', { senderId: 'c' }),
      ],
    })
    expect(decision).toEqual({ join: true, reason: 'open-discussion' })
  })

  it('joins a group request even when it is from one speaker', () => {
    expect(decideJoin({
      type: 'group',
      messages: [them('1', '把仓库地址发一下', { senderId: 'a' })],
    }).reason).toBe('request')
    expect(decideJoin({
      type: 'group',
      messages: [them('1', 'GitHub 上 CHIHIRO 仓库里有什么', { senderId: 'a' })],
    }).join).toBe(true)
  })

  it('skips group filler or a single-person dump that is not asking and not following the operator', () => {
    expect(decideJoin({
      type: 'group',
      messages: [them('1', '哈哈', { senderId: 'a' }), them('2', '嗯嗯', { senderId: 'b' })],
    }).join).toBe(false)
    expect(decideJoin({
      type: 'group',
      messages: [them('1', '今天天气不错', { senderId: 'a' })],
    }).join).toBe(false)
  })

  it('classifies questions and fillers', () => {
    expect(isQuestionText('那个地址你知道吗')).toBe(true)
    expect(isQuestionText('有没有人遇到过')).toBe(true)
    expect(isFillerText('哈哈')).toBe(true)
    expect(isFillerText('好的')).toBe(true)
    expect(isFillerText('GitHub 搜千寻 IM')).toBe(false)
  })
})
