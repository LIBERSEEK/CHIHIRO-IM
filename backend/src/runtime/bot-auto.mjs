import { WebSocket } from 'ws'
import { log, logError } from './log.mjs'
import { normalizeBotSession, sessionPeerKey } from './bot.mjs'
import { pickAutoText } from './bot-suggest.mjs'
import {
  decideJoin,
  historyToSuggestMessages,
  parseInboundEvent,
  quietMsFor,
} from './bot-turn.mjs'

export const PRESENCE_TTL_MS = 15_000
export const CLAIM_TTL_MS = 30 * 60_000

function sessionKey(accountId, type, peerId) {
  return `${accountId}:${sessionPeerKey(type, peerId)}`
}

function turnKey(accountId, type, peerId, lastMessageId) {
  return `${sessionKey(accountId, type, peerId)}:${lastMessageId}`
}

export function createBotAuto({
  store,
  qq,
  botSuggest,
  sendToPeer,
  fetchHistory,
  openSocket,
  now = () => Date.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  const presence = new Map()
  const claimed = new Map()
  const quiet = new Map()
  const sockets = new Map()
  const retryAt = new Map()
  let closed = false
  let unsub = null
  const beat = setInterval(() => {
    if (!closed) sync()
  }, 5000)

  function accountOf(id) {
    return (store.list().accounts || []).find((item) => item.id === id) || null
  }

  function sessionOf(accountId, type, peerId) {
    const acc = accountOf(accountId)
    if (!acc) return normalizeBotSession(null)
    return normalizeBotSession((acc.botSessions || {})[sessionPeerKey(type, peerId)])
  }

  function isAuto(accountId, type, peerId) {
    const session = sessionOf(accountId, type, peerId)
    return session.enabled && session.mode === 'auto'
  }

  function prune(map, ttl) {
    const cutoff = now() - ttl
    for (const [key, at] of map) {
      const stamp = typeof at === 'number' ? at : at?.at
      if (!stamp || stamp < cutoff) map.delete(key)
    }
  }

  function notePresence(body) {
    const accountId = String(body?.accountId || '')
    const type = body?.type === 'group' ? 'group' : 'private'
    const peerId = String(body?.peerId ?? '')
    if (!accountId || !peerId) return { ok: false }
    const key = sessionKey(accountId, type, peerId)
    if (body?.focused === false) {
      presence.delete(key)
      return { ok: true, focused: false }
    }
    presence.set(key, {
      focused: true,
      busy: Boolean(body?.busy),
      at: now(),
    })
    return { ok: true, focused: true }
  }

  function readPresence(accountId, type, peerId) {
    prune(presence, PRESENCE_TTL_MS)
    return presence.get(sessionKey(accountId, type, peerId)) || null
  }

  function isFocused(accountId, type, peerId) {
    const hit = readPresence(accountId, type, peerId)
    return Boolean(hit?.focused)
  }

  function isBusy(accountId, type, peerId) {
    return Boolean(readPresence(accountId, type, peerId)?.busy)
  }

  function claim(body) {
    const accountId = String(body?.accountId || '')
    const type = body?.type === 'group' ? 'group' : 'private'
    const peerId = String(body?.peerId ?? '')
    const lastMessageId = String(body?.lastMessageId || '')
    if (!accountId || !peerId || !lastMessageId) return { claimed: false }
    prune(claimed, CLAIM_TTL_MS)
    const key = turnKey(accountId, type, peerId, lastMessageId)
    if (claimed.has(key)) return { claimed: false }
    claimed.set(key, now())
    return { claimed: true }
  }

  function cancelQuiet(key) {
    const timer = quiet.get(key)
    if (timer != null) {
      clearTimer(timer)
      quiet.delete(key)
    }
  }

  function autoAccounts() {
    const ids = new Set()
    for (const acc of store.list().accounts || []) {
      for (const raw of Object.values(acc.botSessions || {})) {
        const session = normalizeBotSession(raw)
        if (session.enabled && session.mode === 'auto') ids.add(acc.id)
      }
    }
    return ids
  }

  async function flushTurn(accountId, type, peerId) {
    const key = sessionKey(accountId, type, peerId)
    quiet.delete(key)
    if (!isAuto(accountId, type, peerId)) return { skipped: 'disabled' }
    if (isBusy(accountId, type, peerId)) return { skipped: 'busy' }
    const inst = qq.getInstanceForAccount?.(accountId)
    const selfUin = String(inst?.uin || accountOf(accountId)?.uin || '')
    let rows = []
    try {
      rows = await fetchHistory(accountId, type, peerId)
    } catch (error) {
      logError('bot-auto', 'history', error)
      return { skipped: 'history' }
    }
    const messages = historyToSuggestMessages(rows, selfUin)
    const decision = decideJoin({ type, messages })
    if (!decision.join) return { skipped: 'join' }
    const lastThem = [...messages].reverse().find((item) => item.role === 'them')
    const lastMessageId = lastThem?.id || ''
    if (!lastMessageId) return { skipped: 'empty' }
    if (!claim({ accountId, type, peerId, lastMessageId }).claimed) return { skipped: 'claimed' }
    let result
    try {
      result = await botSuggest.suggest({
        accountId,
        type,
        peerId,
        lastMessageId,
        trigger: 'auto',
        messages,
      })
    } catch (error) {
      logError('bot-auto', 'suggest', error)
      return { skipped: 'suggest' }
    }
    const text = pickAutoText(result)
    if (!text) return { skipped: 'empty-draft' }
    try {
      await sendToPeer(accountId, { type, peerId, text })
      log('bot-auto', `sent ${accountId} ${type}:${peerId}`)
      return { sent: text, lastMessageId }
    } catch (error) {
      logError('bot-auto', 'send', error)
      return { skipped: 'send' }
    }
  }

  function schedule(accountId, type, peerId) {
    if (!isAuto(accountId, type, peerId)) return
    if (isFocused(accountId, type, peerId)) return
    const key = sessionKey(accountId, type, peerId)
    cancelQuiet(key)
    const wait = quietMsFor(type)
    const timer = setTimer(() => {
      void flushTurn(accountId, type, peerId)
    }, wait)
    quiet.set(key, timer)
  }

  function handleEvent(accountId, event) {
    const inst = qq.getInstanceForAccount?.(accountId)
    const parsed = parseInboundEvent(event, inst?.uin)
    if (!parsed) return { skipped: 'event' }
    const key = sessionKey(accountId, parsed.type, parsed.peerId)
    if (parsed.isSelf) {
      cancelQuiet(key)
      return { skipped: 'self' }
    }
    if (!parsed.text) return { skipped: 'empty' }
    if (!isAuto(accountId, parsed.type, parsed.peerId)) return { skipped: 'disabled' }
    if (isFocused(accountId, parsed.type, parsed.peerId)) {
      cancelQuiet(key)
      return { skipped: 'focused' }
    }
    schedule(accountId, parsed.type, parsed.peerId)
    return { scheduled: true, wait: quietMsFor(parsed.type) }
  }

  function nudge(body) {
    const accountId = String(body?.accountId || '')
    const type = body?.type === 'group' ? 'group' : 'private'
    const peerId = String(body?.peerId ?? '')
    if (!accountId || !peerId) return { ok: false }
    if (!isAuto(accountId, type, peerId)) return { ok: true, scheduled: false }
    schedule(accountId, type, peerId)
    return { ok: true, scheduled: true }
  }

  function connectAccount(accountId) {
    if (closed || sockets.has(accountId)) return
    const inst = qq.getInstanceForAccount?.(accountId)
    if (!inst || inst.phase !== 'ready' || !inst.ports?.ws || !inst.tokens?.ws) return
    const last = retryAt.get(accountId) || 0
    if (now() - last < 1000) return
    retryAt.set(accountId, now())
    const url = `ws://127.0.0.1:${inst.ports.ws}/?access_token=${encodeURIComponent(inst.tokens.ws)}`
    const opener = openSocket || ((target) => new WebSocket(target, {
      headers: { Authorization: `Bearer ${inst.tokens.ws}` },
    }))
    let socket
    try {
      socket = opener(url, inst)
    } catch (error) {
      logError('bot-auto', `ws ${accountId}`, error)
      return
    }
    sockets.set(accountId, socket)
    socket.on?.('open', () => log('bot-auto', `ws ${accountId}`))
    const onMessage = (raw) => {
      const text = typeof raw === 'string' ? raw : raw?.toString?.() || (Buffer.isBuffer(raw) ? raw.toString() : '')
      let event
      try { event = JSON.parse(String(text)) } catch { return }
      handleEvent(accountId, event)
    }
    if (typeof socket.on === 'function') socket.on('message', onMessage)
    else socket.addEventListener?.('message', (ev) => onMessage(ev.data))
    const drop = () => {
      if (sockets.get(accountId) === socket) sockets.delete(accountId)
    }
    socket.on?.('close', drop)
    socket.on?.('error', (error) => {
      logError('bot-auto', `ws ${accountId}`, error)
      try { socket.close?.() } catch { /* ignore */ }
      drop()
    })
    socket.addEventListener?.('close', drop)
  }

  function disconnectAccount(accountId) {
    cancelQuietForAccount(accountId)
    const socket = sockets.get(accountId)
    sockets.delete(accountId)
    if (!socket) return
    try { socket.close?.() } catch { /* ignore */ }
  }

  function cancelQuietForAccount(accountId) {
    const prefix = `${accountId}:`
    for (const key of [...quiet.keys()]) {
      if (key.startsWith(prefix)) cancelQuiet(key)
    }
  }

  function sync() {
    if (closed) return
    const wanted = autoAccounts()
    for (const id of wanted) connectAccount(id)
    for (const id of [...sockets.keys()]) {
      if (!wanted.has(id)) disconnectAccount(id)
    }
    for (const key of [...quiet.keys()]) {
      const [accountId, type, peerId] = splitKey(key)
      if (!accountId || !isAuto(accountId, type, peerId)) cancelQuiet(key)
    }
  }

  function splitKey(key) {
    const match = String(key || '').match(/^(qq:\d+|[^:]+):(private|group):(.+)$/)
    if (!match) return [null, null, null]
    return [match[1], match[2], match[3]]
  }

  function shutdown() {
    closed = true
    clearInterval(beat)
    for (const key of [...quiet.keys()]) cancelQuiet(key)
    for (const id of [...sockets.keys()]) disconnectAccount(id)
    if (unsub) {
      try { unsub() } catch { /* ignore */ }
      unsub = null
    }
  }

  if (typeof qq?.subscribe === 'function') {
    unsub = qq.subscribe(() => {
      if (!closed) sync()
    })
  }
  queueMicrotask(() => {
    if (!closed) sync()
  })

  return {
    handleEvent,
    notePresence,
    claim,
    nudge,
    sync,
    shutdown,
    isFocused,
    isAuto,
    flushTurn,
  }
}
