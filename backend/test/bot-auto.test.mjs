import assert from 'node:assert/strict'
import test from 'node:test'
import { createBotAuto, PRESENCE_TTL_MS } from '../src/runtime/bot-auto.mjs'

function harness(t, account = {
  id: 'qq:10001',
  uin: '10001',
  botSessions: { 'private:20002': { enabled: true, mode: 'auto', configId: null } },
}, extras = {}) {
  const sent = []
  const suggested = []
  const notes = []
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
    botSuggest: extras.botSuggest || {
      suggest: async (body) => {
        suggested.push(body)
        return extras.suggestResult || { replies: [{ id: '1', text: '我在', score: 0.9 }], summary: '我在的。' }
      },
    },
    sendToPeer: async (_id, body) => { sent.push(body) },
    history: extras.history || { note(fields) { notes.push(fields) } },
    fetchHistory: extras.fetchHistory || (async () => ([
      { id: 'm1', user_id: '20002', text: '在吗', time: 20 },
    ])),
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
    auto, sent, suggested, notes, sockets, account,
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
  assert.equal(h.notes[0].sent, '我在的。')
})

test('auto session holds when the read gate says not to speak', async (t) => {
  const h = harness(t, undefined, {
    suggestResult: {
      replies: [{ id: '1', text: '哈哈', score: 0.9 }],
      summary: '哈哈哈哈',
      read: {
        intent: { id: 'smalltalk', options: [{ id: 'smalltalk', p: 1 }] },
        speakNow: { yes: 0.12, no: 0.88 },
        action: { id: 'hold', options: [{ id: 'hold', p: 1 }] },
        urgency: 1,
        note: '',
      },
    },
  })
  const result = await h.auto.flushTurn('qq:10001', 'private', '20002')
  assert.equal(result.skipped, 'hold')
  assert.equal(h.notes[0].skipped, 'hold')
  assert.equal(h.sent.length, 0)
})

test('group filler-only bursts are recorded as skipped join', async (t) => {
  const h = harness(t, {
    id: 'qq:10001',
    uin: '10001',
    botSessions: { 'group:9': { enabled: true, mode: 'auto', configId: null } },
  }, {
    fetchHistory: async () => ([{ id: 'm1', user_id: '20002', text: '哈哈', time: 20 }]),
  })
  const result = await h.auto.flushTurn('qq:10001', 'group', '9')
  assert.equal(result.skipped, 'join')
  assert.equal(h.notes[0].skipped, 'join')
  assert.equal(h.sent.length, 0)
})

test('focused conversation does not start a background auto send', (t) => {
  const h = harness(t)
  h.auto.notePresence({ accountId: 'qq:10001', type: 'private', peerId: '20002', focused: true })
  const noted = h.auto.handleEvent('qq:10001', themEvent())
  assert.equal(noted.skipped, 'focused')
  h.fireTimers()
  assert.equal(h.sent.length, 0)
})

test('presence lease survives a missed heartbeat then expires', (t) => {
  const h = harness(t)
  h.auto.notePresence({ accountId: 'qq:10001', type: 'private', peerId: '20002', focused: true })
  h.advance(20_000)
  assert.equal(h.auto.handleEvent('qq:10001', themEvent()).skipped, 'focused')
  h.advance(PRESENCE_TTL_MS)
  assert.equal(h.auto.handleEvent('qq:10001', themEvent()).scheduled, true)
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
