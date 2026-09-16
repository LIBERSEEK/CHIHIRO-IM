export const CONTACT_MIN_INTERVAL_MS = 6000
export const CONTACT_JITTER_MS = 4000

function digits(value, kind) {
  const id = String(value || '').trim()
  if (!/^\d+$/.test(id) || /^0+$/.test(id)) throw new Error(kind === 'group' ? 'invalid_group' : 'invalid_user')
  return id
}

function unsupportedContact(error) {
  const message = error?.message || String(error || '')
  if (!/不支持的Api/i.test(message)) return error
  const next = new Error('当前 QQ 实例未加载加好友/入群能力，请重启该账号后再试')
  next.deliveryState = 'failed'
  return next
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function createContactApi({
  napcatAction,
  asList,
  requireAccount,
  now = Date.now,
  wait = sleep,
  random = Math.random,
  minIntervalMs = CONTACT_MIN_INTERVAL_MS,
  jitterMs = CONTACT_JITTER_MS
}) {
  const lastSubmitAt = new Map()
  const queues = new Map()

  function enqueue(accountId, work) {
    const previous = queues.get(accountId) || Promise.resolve()
    const next = previous.then(work, work)
    queues.set(accountId, next.catch(() => {}))
    return next
  }

  async function waitForSlot(accountId) {
    if (!lastSubmitAt.has(accountId)) return 0
    const interval = minIntervalMs + Math.floor(random() * (jitterMs + 1))
    const waitedMs = Math.max(0, lastSubmitAt.get(accountId) + interval - now())
    if (waitedMs > 0) await wait(waitedMs)
    return waitedMs
  }

  function markSubmitted(accountId) {
    lastSubmitAt.set(accountId, now())
  }

  async function observeRequests(accountId) {
    requireAccount(accountId)
    const group = await napcatAction(accountId, 'get_group_system_msg', {})
    let friend = []
    try {
      friend = asList(await napcatAction(accountId, 'get_doubt_friends_add_request', {}))
    } catch {
      friend = []
    }
    return {
      kind: 'requests',
      accountId,
      friend,
      groupInvites: asList(group?.invited_requests || group?.InvitedRequest),
      groupJoins: asList(group?.join_requests)
    }
  }

  async function submit(body) {
    const accountId = body.accountId
    const action = String(body.action || '')
    try {
      if (action === 'add_friend') {
        const userId = digits(body.userId || body.user_id, 'user')
        const friends = asList(await napcatAction(accountId, 'get_friend_list', {}))
        if (friends.some((row) => String(row.user_id ?? row.uin ?? '') === userId)) {
          return { ok: true, action, accountId, userId, already: true, waitedMs: 0 }
        }
        const params = {
          user_id: Number(userId),
          message: String(body.message || body.comment || '')
        }
        if (body.groupId || body.group_id) params.group_id = Number(digits(body.groupId || body.group_id, 'group'))
        const waitedMs = await waitForSlot(accountId)
        try {
          const result = await napcatAction(accountId, 'add_friend', params)
          return { ok: true, action, accountId, userId, already: false, waitedMs, result: result || {} }
        } finally {
          markSubmitted(accountId)
        }
      }
      if (action === 'join_group') {
        const groupId = digits(body.groupId || body.group_id, 'group')
        const groups = asList(await napcatAction(accountId, 'get_group_list', {}))
        if (groups.some((row) => String(row.group_id ?? '') === groupId)) {
          return { ok: true, action, accountId, groupId, already: true, waitedMs: 0 }
        }
        const waitedMs = await waitForSlot(accountId)
        try {
          const result = await napcatAction(accountId, 'join_group', {
            group_id: Number(groupId),
            comment: String(body.comment || body.message || '')
          })
          return { ok: true, action, accountId, groupId, already: false, waitedMs, result: result || {} }
        } finally {
          markSubmitted(accountId)
        }
      }
    } catch (error) {
      throw unsupportedContact(error)
    }
    throw new Error('unknown_contact_action')
  }

  async function contact(body = {}) {
    const accountId = body.accountId
    requireAccount(accountId)
    return enqueue(accountId, () => submit(body))
  }

  return { contact, observeRequests }
}
