import assert from 'node:assert/strict'
import test from 'node:test'
import { createBotAuto } from '../src/runtime/bot-auto.mjs'

function harness(t, account = {
  id: 'qq:10001',
  uin: '10001',
  botSessions: { 'private:20002': { enabled: true, mode: 'auto', configId: null } },
}) {
  const sent = []
  const suggested = []
  const sockets = []
  const timers = new Map()
  let nextTimer = 1
  let clock = 1_000
  const auto = createBotAuto({
    store: { list: () => ({ accounts: [account] }) },
    qq: {
      subscribe: () => () => {},
      getInstanceForAccount: (id) => id === account.id
        ? { phase: 'ready', uin: account.uin, ports: { ws: 5801 }, tokens: { ws: 'tok' } }
        : null,
    },
    botSuggest: {
      suggest: async (body) => {
        suggested.push(body)
        return { replies: [{ id: '1', text: '我在', score: 0.9 }], summary: '我在的。' }
      },
    },
    sendToPeer: async (_id, body) => { sent.push(body) },
    fetchHistory: async () => ([
      { id: 'm1', user_id: '20002', text: '在吗', time: 20 },
    ]),
    openSocket: (url) => {
      const socket = { url, close() {}, on() {}, addEventListener() {} }
      sockets.push(socket)
      return socket
    },
    now: () => clock,
    setTimer: (fn, ms) => {
      const id = nextTimer++
      timers.set(id, { fn, ms })
      return id
    },
    clearTimer: (id) => { timers.delete(id) },
  })
  t.after(() => auto.shutdown())
  return {
    auto, sent, suggested, sockets, account,
    fireTimers() {
      const pending = [...timers.values()]
      timers.clear()
      for (const item of pending) item.fn()
    },
    advance(ms) { clock += ms },
  }
}

function themEvent(text = '在吗', extra = {}) {
  return {
    post_type: 'message',
    message_type: extra.type || 'private',
    user_id: extra.user_id || 20002,
    group_id: extra.group_id,
    self_id: 10001,
    message_id: extra.message_id || 11,
    raw_message: text,
    sender: { user_id: extra.user_id || 20002, nickname: 'Raven' },
  }
}

test('unfocused auto session sends after the quiet window', async (t) => {
  const h = harness(t)
  const noted = h.auto.handleEvent('qq:10001', themEvent())
  assert.equal(noted.scheduled, true)
  assert.equal(h.sent.length, 0)
  const flushed = h.auto.flushTurn('qq:10001', 'private', '20002')
  await flushed
  assert.equal(h.sent[0].text, '我在的。')
  assert.equal(h.suggested[0].trigger, 'auto')
  assert.equal(h.suggested[0].lastMessageId, 'm1')
})

test('focused conversation does not start a background auto send', (t) => {
  const h = harness(t)
  h.auto.notePresence({ accountId: 'qq:10001', type: 'private', peerId: '20002', focused: true })
  const noted = h.auto.handleEvent('qq:10001', themEvent())
  assert.equal(noted.skipped, 'focused')
  h.fireTimers()
  assert.equal(h.sent.length, 0)
})

test('claim is one-shot so the focused UI and Runtime cannot both send', async (t) => {
  const h = harness(t)
  assert.deepEqual(h.auto.claim({
    accountId: 'qq:10001', type: 'private', peerId: '20002', lastMessageId: 'm1',
  }), { claimed: true })
  assert.deepEqual(h.auto.claim({
    accountId: 'qq:10001', type: 'private', peerId: '20002', lastMessageId: 'm1',
  }), { claimed: false })
  await h.auto.flushTurn('qq:10001', 'private', '20002')
  assert.equal(h.sent.length, 0)
})

test('operator or self message cancels the pending quiet window', (t) => {
  const h = harness(t)
  h.auto.handleEvent('qq:10001', themEvent())
  const self = h.auto.handleEvent('qq:10001', {
    post_type: 'message_sent',
    message_type: 'private',
    user_id: 20002,
    self_id: 10001,
    message_id: 12,
    raw_message: '我自己回',
  })
  assert.equal(self.skipped, 'self')
  h.fireTimers()
  assert.equal(h.sent.length, 0)
})

test('nudge after leaving a chat schedules auto when the session is auto', (t) => {
  const h = harness(t)
  const result = h.auto.nudge({ accountId: 'qq:10001', type: 'private', peerId: '20002' })
  assert.equal(result.scheduled, true)
})

test('assist or disabled sessions never connect a reverse adapter and do not send', async (t) => {
  const h = harness(t, {
    id: 'qq:10001',
    uin: '10001',
    botSessions: { 'private:20002': { enabled: true, mode: 'assist', configId: null } },
  })
  const noted = h.auto.handleEvent('qq:10001', themEvent())
  assert.equal(noted.skipped, 'disabled')
  await h.auto.flushTurn('qq:10001', 'private', '20002')
  assert.equal(h.sent.length, 0)
})
