import fs from 'node:fs'
import path from 'node:path'

export const BOT_HISTORY_MAX = 80

export function sessionHistoryKey(accountId, type, peerId) {
  return `${accountId}:${type === 'group' ? 'group' : 'private'}:${String(peerId)}`
}

function clip(value, max = 200) {
  const text = String(value || '').trim()
  if (!text) return ''
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function triggerOf(value) {
  if (value === 'menu' || value === 'digest') return value
  return 'auto'
}

function pointsOf(value) {
  if (!Array.isArray(value)) return []
  const out = []
  for (const item of value) {
    if (out.length >= 12) break
    const text = clip(typeof item === 'string' ? item : item?.text, 160)
    if (!text) continue
    const messageId = String(item?.messageId || item?.message_id || '').trim().slice(0, 64)
    out.push({
      id: String(item?.id || out.length + 1),
      text,
      messageId,
    })
  }
  return out
}

function repliesOf(value) {
  if (!Array.isArray(value)) return []
  const out = []
  for (const item of value) {
    if (out.length >= 3) break
    const text = clip(typeof item === 'string' ? item : item?.text, 200)
    if (!text) continue
    out.push({
      id: String(item?.id || out.length + 1),
      text,
      score: Number.isFinite(Number(item?.score)) ? Number(item.score) : 0,
    })
  }
  return out
}

function stepOf(step, at) {
  const title = clip(step?.title, 80)
  if (!title) return null
  const kind = clip(step?.kind, 20) || 'act'
  return {
    kind,
    title,
    detail: clip(step?.detail, 240),
    at: Number(step?.at) || at || 0,
  }
}

function appendSteps(item, steps, at) {
  if (!item || !Array.isArray(steps) || !steps.length) return
  if (!Array.isArray(item.steps)) item.steps = []
  for (const raw of steps) {
    const step = stepOf(raw, at)
    if (!step) continue
    const last = item.steps[item.steps.length - 1]
    if (last?.title === step.title && last?.detail === step.detail) continue
    item.steps.push(step)
  }
  if (item.steps.length > 40) item.steps = item.steps.slice(-40)
}

function publicSteps(value) {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const step = stepOf(item, Number(item?.at) || 0)
    return step ? [step] : []
  })
}

function publicEntry(entry) {
  if (!entry || typeof entry !== 'object') return null
  return {
    id: String(entry.id || ''),
    at: Number(entry.at) || 0,
    inProgress: entry.inProgress === true,
    trigger: triggerOf(entry.trigger),
    joinReason: clip(entry.joinReason, 40),
    lastMessageId: String(entry.lastMessageId || ''),
    peerExcerpt: clip(entry.peerExcerpt, 240),
    lookupExcerpt: clip(entry.lookupExcerpt, 160),
    replies: repliesOf(entry.replies),
    points: pointsOf(entry.points),
    summary: clip(entry.summary, 200),
    sent: clip(entry.sent, 200),
    skipped: clip(entry.skipped, 40),
    steps: publicSteps(entry.steps),
  }
}

export function createBotHistory({ filePath, now = () => Date.now() } = {}) {
  function load() {
    if (!filePath) return { sessions: {} }
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      return parsed && typeof parsed === 'object' ? parsed : { sessions: {} }
    } catch {
      return { sessions: {} }
    }
  }

  function save(data) {
    if (!filePath) return
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, `${JSON.stringify(data)}\n`)
  }

  function mutate(fn) {
    const data = load()
    data.sessions = data.sessions && typeof data.sessions === 'object' ? data.sessions : {}
    const out = fn(data) || data
    save(out)
    return out
  }

  function listFor(data, key) {
    if (!Array.isArray(data.sessions[key])) data.sessions[key] = []
    return data.sessions[key]
  }

  function trim(list) {
    if (list.length > BOT_HISTORY_MAX) list.splice(0, list.length - BOT_HISTORY_MAX)
  }

  function startTurn(fields) {
    const accountId = String(fields?.accountId || '')
    const type = fields?.type === 'group' ? 'group' : 'private'
    const peerId = String(fields?.peerId ?? '')
    if (!accountId || !peerId) return ''
    const id = `${now()}-${Math.random().toString(36).slice(2, 8)}`
    mutate((data) => {
      const list = listFor(data, sessionHistoryKey(accountId, type, peerId))
      const item = {
        id,
        at: now(),
        inProgress: true,
        trigger: triggerOf(fields.trigger),
        joinReason: clip(fields.joinReason, 40),
        lastMessageId: String(fields.lastMessageId || ''),
        peerExcerpt: clip(fields.peerExcerpt, 240),
        lookupExcerpt: '',
        replies: [],
        points: [],
        summary: '',
        sent: '',
        skipped: '',
        steps: [],
      }
      appendSteps(item, fields.steps, item.at)
      list.push(item)
      trim(list)
    })
    return id
  }

  function completeTurn(id, patch = {}) {
    const target = String(id || '')
    if (!target) return false
    let found = false
    mutate((data) => {
      for (const list of Object.values(data.sessions)) {
        if (!Array.isArray(list)) continue
        const item = list.find((entry) => entry?.id === target)
        if (!item) continue
        found = true
        if (patch.replies !== undefined) item.replies = repliesOf(patch.replies)
        if (patch.points !== undefined) item.points = pointsOf(patch.points)
        if (patch.summary !== undefined) item.summary = clip(patch.summary, 200)
        if (patch.lookupExcerpt !== undefined) item.lookupExcerpt = clip(patch.lookupExcerpt, 160)
        if (patch.peerExcerpt !== undefined) item.peerExcerpt = clip(patch.peerExcerpt, 240)
        if (patch.sent !== undefined) item.sent = clip(patch.sent, 200)
        if (patch.skipped !== undefined) item.skipped = clip(patch.skipped, 40)
        if (patch.joinReason !== undefined) item.joinReason = clip(patch.joinReason, 40)
        appendSteps(item, patch.steps, now())
        item.inProgress = false
      }
    })
    return found
  }

  function addStep(id, step) {
    const target = String(id || '')
    if (!target) return false
    let found = false
    mutate((data) => {
      for (const list of Object.values(data.sessions)) {
        if (!Array.isArray(list)) continue
        const item = list.find((entry) => entry?.id === target)
        if (!item) continue
        found = true
        appendSteps(item, [step], now())
      }
    })
    return found
  }

  function note(fields) {
    const accountId = String(fields?.accountId || '')
    const type = fields?.type === 'group' ? 'group' : 'private'
    const peerId = String(fields?.peerId ?? '')
    if (!accountId || !peerId) return
    const lastMessageId = String(fields.lastMessageId || '')
    mutate((data) => {
      const list = listFor(data, sessionHistoryKey(accountId, type, peerId))
      let item = null
      for (let index = list.length - 1; index >= 0; index--) {
        const entry = list[index]
        if (lastMessageId) {
          if (entry.lastMessageId === lastMessageId) {
            item = entry
            break
          }
          continue
        }
        if (entry.inProgress) {
          item = entry
          break
        }
        break
      }
      if (!item) {
        item = {
          id: `${now()}-${Math.random().toString(36).slice(2, 8)}`,
          at: now(),
          inProgress: false,
          trigger: triggerOf(fields.trigger),
          joinReason: '',
          lastMessageId,
          peerExcerpt: '',
          lookupExcerpt: '',
          replies: [],
          points: [],
          summary: '',
          sent: '',
          skipped: '',
          steps: [],
        }
        list.push(item)
        trim(list)
      }
      if (fields.trigger) item.trigger = triggerOf(fields.trigger)
      if (fields.joinReason !== undefined) item.joinReason = clip(fields.joinReason, 40)
      if (fields.lookupExcerpt !== undefined) item.lookupExcerpt = clip(fields.lookupExcerpt, 160)
      if (fields.peerExcerpt !== undefined) item.peerExcerpt = clip(fields.peerExcerpt, 240)
      if (fields.replies !== undefined) item.replies = repliesOf(fields.replies)
      if (fields.points !== undefined) item.points = pointsOf(fields.points)
      if (fields.summary !== undefined) item.summary = clip(fields.summary, 200)
      if (fields.sent !== undefined) item.sent = clip(fields.sent, 200)
      if (fields.skipped !== undefined) item.skipped = clip(fields.skipped, 40)
      if (fields.lastMessageId) item.lastMessageId = lastMessageId
      appendSteps(item, fields.steps, now())
      if (fields.inProgress === true) item.inProgress = true
      else item.inProgress = false
    })
  }

  function list(accountId, type, peerId) {
    const key = sessionHistoryKey(accountId, type, peerId)
    const rows = load().sessions?.[key] || []
    return [...rows].reverse().flatMap((entry) => {
      const item = publicEntry(entry)
      return item?.id ? [item] : []
    })
  }

  return { startTurn, completeTurn, addStep, note, list }
}
