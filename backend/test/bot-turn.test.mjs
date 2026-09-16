import assert from 'node:assert/strict'
import test from 'node:test'
import {
  collectPendingTurn,
  decideJoin,
  historyToSuggestMessages,
  isFillerText,
  parseInboundEvent,
} from '../src/runtime/bot-turn.mjs'

const them = (id, text, extra = {}) => ({
  id, role: 'them', text, senderId: extra.senderId || id, time: extra.time ?? 1_000, ...extra,
})
const me = (id, text, extra = {}) => ({
  id, role: 'me', text, senderId: 'self', time: extra.time ?? 1_000, ...extra,
})

test('group join matches ChatBot frontend heuristics', () => {
  assert.equal(decideJoin({
    type: 'group',
    messages: [them('1', 'GitHub 上 CHIHIRO 仓库里有什么', { senderId: 'a' })],
  }).join, true)
  assert.equal(decideJoin({
    type: 'group',
    messages: [them('1', '哈哈', { senderId: 'a' }), them('2', '嗯嗯', { senderId: 'b' })],
  }).join, false)
  assert.equal(decideJoin({
    type: 'private',
    messages: [them('1', '在吗')],
  }).reason, 'private')
  assert.deepEqual(collectPendingTurn([
    me('m0', '我先去看一眼', { time: 1_000 }),
    them('t1', '那个地址', { senderId: 'a', time: 20_000 }),
    them('t2', '你知道吗', { senderId: 'a', time: 21_000 }),
  ]).map((item) => item.text), ['那个地址', '你知道吗'])
  assert.equal(isFillerText('哈哈'), true)
})

test('history and inbound events map sender and @self', () => {
  const messages = historyToSuggestMessages([
    { id: '1', user_id: '10001', text: '我回了', time: 10 },
    { id: '2', user_id: '20002', text: '@10001 帮看下', nickname: 'Raven', time: 11 },
  ], '10001')
  assert.equal(messages[0].role, 'me')
  assert.equal(messages[1].role, 'them')
  assert.equal(messages[1].atSelf, true)

  const inbound = parseInboundEvent({
    post_type: 'message',
    message_type: 'group',
    group_id: 2159079773,
    user_id: 3966493674,
    self_id: 3967167443,
    message_id: 9,
    raw_message: '根目录有哪些文件？',
    sender: { nickname: '自由探索' },
  }, '3967167443')
  assert.equal(inbound.type, 'group')
  assert.equal(inbound.peerId, '2159079773')
  assert.equal(inbound.isSelf, false)
  assert.equal(inbound.text, '根目录有哪些文件？')

  const self = parseInboundEvent({
    post_type: 'message_sent',
    message_type: 'group',
    group_id: 1,
    user_id: 3967167443,
    self_id: 3967167443,
    message_id: 10,
    raw_message: '已发出',
  }, '3967167443')
  assert.equal(self.isSelf, true)
})
