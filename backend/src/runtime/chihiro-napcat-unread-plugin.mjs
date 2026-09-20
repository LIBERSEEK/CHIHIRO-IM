// chihiro-recent-contact-unread
import original, { plugin_init as ssqqInit } from './index.ssqq.mjs'
import {
  joinGroupCall,
  joinGroupResultMessage,
  kernelJoinArgs,
  mapSearchGroup,
  mapSearchUser,
} from './contact-search.mjs'

const WRAP_MARK = 'chihiro-recent-contact-unread'
const UNREAD_KEYS = [
  'unreadCnt',
  'unreadCount',
  'unread_cnt',
  'unreadMsgCnt',
  'unread',
  'msgUnreadCnt',
]

function toCount(value) {
  if (value == null || value === '') return null
  if (typeof value === 'object') {
    for (const key of UNREAD_KEYS) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        const nested = toCount(value[key])
        if (nested != null) return nested
      }
    }
    return null
  }
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.floor(n)
}

function pickUnread(item) {
  if (!item || typeof item !== 'object') return null
  for (const key of UNREAD_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(item, key)) continue
    const n = toCount(item[key])
    if (n != null) return n
  }
  for (const [key, value] of Object.entries(item)) {
    if (!/unread/i.test(key) || /flag/i.test(key)) continue
    const n = toCount(value)
    if (n != null) return n
  }
  return null
}

function peerKey(item) {
  const uin = item?.peerUin ?? item?.peer_uin ?? item?.uin
  if (uin != null && String(uin) !== '') return String(uin)
  const uid = item?.peerUid ?? item?.peer_uid
  return uid != null && String(uid) !== '' ? String(uid) : ''
}

function attachUnread(results, changedList, logger) {
  if (!Array.isArray(results) || !Array.isArray(changedList) || changedList.length === 0) return
  const unreadByPeer = new Map()
  let sampleKeys = null
  for (const item of changedList) {
    if (!sampleKeys && item && typeof item === 'object') sampleKeys = Object.keys(item)
    const n = pickUnread(item)
    const key = peerKey(item)
    if (n == null || !key) continue
    unreadByPeer.set(key, n)
  }
  if (unreadByPeer.size === 0) {
    logger?.info?.(
      '[chihiro] recent contact snapshot has no unread field',
      sampleKeys || [],
    )
    return
  }
  for (const row of results) {
    const key = peerKey(row)
    if (!key || !unreadByPeer.has(key)) continue
    row.unread = unreadByPeer.get(key)
  }
}

function wrapFunction(target, name, wrapper) {
  const original = target[name]
  if (typeof original !== 'function' || original[WRAP_MARK]) return false
  const wrapped = wrapper(original.bind(target))
  wrapped[WRAP_MARK] = true
  target[name] = wrapped
  return true
}

function wrapRecentContactUnread(ctx) {
  const action = ctx.actions?.get?.('get_recent_contact')
  if (!action) {
    ctx.logger?.warn?.('[chihiro] get_recent_contact action is unavailable')
    return
  }
  const userApi = ctx.core?.apis?.UserApi
  const wrapWithCapture = (originalHandle) => {
    return async function chihiroRecentContactUnread(...args) {
      let captured
      let restore
      if (userApi && typeof userApi.getRecentContactListSnapShot === 'function') {
        const originalSnap = userApi.getRecentContactListSnapShot.bind(userApi)
        userApi.getRecentContactListSnapShot = async (count) => {
          const ret = await originalSnap(count)
          captured = ret
          return ret
        }
        restore = () => { userApi.getRecentContactListSnapShot = originalSnap }
      }
      try {
        const results = await originalHandle(...args)
        try {
          const list = Array.isArray(results) ? results : results?.data
          attachUnread(list, captured?.info?.changedList, ctx.logger)
        } catch (error) {
          ctx.logger?.warn?.('[chihiro] recent_contact unread wrap failed', error)
        }
        return results
      } finally {
        restore?.()
      }
    }
  }
  if (wrapFunction(action, '_handle', wrapWithCapture)) return
  if (wrapFunction(action, 'handle', wrapWithCapture)) return
  if (wrapFunction(action, 'websocketHandle', wrapWithCapture)) return
  ctx.logger?.warn?.('[chihiro] get_recent_contact handle is unavailable')
}

const CONTACT_MARK = 'chihiro-contact-actions'

function obOk(data, echo) {
  return { status: 'ok', retcode: 0, data: data ?? {}, message: '', wording: '', echo, stream: 'normal-action' }
}

function obErr(message, echo) {
  return { status: 'failed', retcode: 200, data: null, message, wording: message, echo, stream: 'normal-action' }
}

function makeAction(fn) {
  return {
    async handle(payload, _adapter, _config, _req, echo) {
      try {
        return obOk(await fn(payload || {}), echo)
      } catch (error) {
        return obErr(error?.message || String(error), echo)
      }
    },
    async websocketHandle(payload, echo, adapter, config, req) {
      return this.handle(payload, adapter, config, req, echo)
    }
  }
}

function idOf(payload, ...keys) {
  for (const key of keys) {
    const value = payload?.[key]
    if (value != null && String(value).trim() !== '') return String(value).trim()
  }
  return ''
}

function isMember(groups, groupId) {
  if (!Array.isArray(groups)) return false
  return groups.some((row) => String(row.groupCode ?? row.group_id ?? '') === String(groupId))
}

async function lookupUser(core, userId) {
  if (!/^\d+$/.test(userId) || /^0+$/.test(userId)) return null
  try {
    const uid = await core.apis.UserApi.getUidByUinV2(userId)
    if (!uid) return null
    let already = false
    try {
      already = !!(await core.apis.FriendApi.isBuddy(uid))
    } catch {
      already = false
    }
    let info = { uin: userId, user_id: userId }
    try {
      const detail = await core.apis.UserApi.getUserDetailInfo(uid, true)
      if (detail && typeof detail === 'object') Object.assign(info, detail)
    } catch {
      try {
        const byUin = await core.apis.UserApi.getUserDetailInfoByUin(userId)
        const detail = byUin?.detail
        if (detail?.simpleInfo) {
          Object.assign(info, detail.simpleInfo.baseInfo, detail.simpleInfo.coreInfo, detail.commonExt)
        }
      } catch {
        // Keep the QQ number even if the profile fetch fails.
      }
    }
    return mapSearchUser(info, already)
  } catch {
    return null
  }
}

async function searchGroupHits(core, keyword) {
  const key = String(keyword || '').trim()
  if (!key) return []
  const wrapper = core.eventWrapper
  if (typeof wrapper?.callNormalEventV2 === 'function') {
    try {
      const [, ret] = await wrapper.callNormalEventV2(
        'NodeIKernelSearchService/searchGroup',
        'NodeIKernelSearchListener/onSearchGroupResult',
        [{
          keyWords: key,
          groupNum: 25,
          exactSearch: /^\d+$/.test(key),
          penetrate: '',
        }],
        (r) => !r || r.result === 0 || r.result === undefined,
        (params) => Array.isArray(params?.groupInfos),
        1,
        5000,
      )
      if (Array.isArray(ret?.groupInfos) && ret.groupInfos.length) {
        const penetrate = String(ret.penetrate || '')
        if (penetrate) {
          for (const hit of ret.groupInfos) {
            if (hit && typeof hit === 'object' && !hit.penetrate) hit.penetrate = penetrate
          }
        }
        return ret.groupInfos
      }
    } catch {
      // Fall through to the exact group-number lookup.
    }
  }
  if (/^\d+$/.test(key) && typeof core.apis?.GroupApi?.searchGroup === 'function') {
    try {
      const found = await core.apis.GroupApi.searchGroup(key)
      return found ? [found] : []
    } catch {
      return []
    }
  }
  return []
}

async function searchContact(core, payload) {
  const keyword = String(payload.keyword || payload.key || payload.user_id || payload.group_id || '').trim()
  if (!keyword) throw new Error('invalid_keyword')
  const [user, hits, groups] = await Promise.all([
    /^\d+$/.test(keyword) ? lookupUser(core, keyword) : Promise.resolve(null),
    searchGroupHits(core, keyword),
    Promise.resolve(core.apis.GroupApi.getGroups(false)).catch(() => []),
  ])
  const seen = new Set()
  const mapped = []
  for (const hit of hits) {
    const group = mapSearchGroup(hit, false)
    if (!group || seen.has(group.group_id)) continue
    seen.add(group.group_id)
    group.already = isMember(groups, group.group_id)
    mapped.push(group)
  }
  return { keyword, user, groups: mapped }
}

async function addFriend(core, payload) {
  const userId = idOf(payload, 'user_id', 'userId')
  if (!/^\d+$/.test(userId) || /^0+$/.test(userId)) throw new Error('invalid_user')
  const uid = await core.apis.UserApi.getUidByUinV2(userId)
  if (!uid) throw new Error('用户不存在')
  if (await core.apis.FriendApi.isBuddy(uid)) {
    return { already: true, user_id: userId, uid }
  }
  const message = String(payload.message || payload.comment || '')
  const buddyService = core.context.session.getBuddyService()
  if (typeof buddyService?.reqToAddFriends !== 'function') throw new Error('当前内核没有加好友接口')
  const result = await Promise.resolve(buddyService.reqToAddFriends(uid, message))
  return { already: false, user_id: userId, uid, submitted: true, result: result ?? null }
}

async function joinGroup(core, payload, logger) {
  const groupId = idOf(payload, 'group_id', 'groupId')
  if (!/^\d+$/.test(groupId) || /^0+$/.test(groupId)) throw new Error('invalid_group')
  const groups = await core.apis.GroupApi.getGroups(false)
  if (isMember(groups, groupId)) {
    return { already: true, group_id: groupId }
  }
  let found = null
  try {
    const hits = await searchGroupHits(core, groupId)
    found = Array.isArray(hits) ? hits.find((hit) => mapSearchGroup(hit, false)?.group_id === groupId) || hits[0] : null
  } catch {
    found = null
  }
  if (!found && typeof core.apis?.GroupApi?.searchGroup === 'function') {
    try {
      found = await core.apis.GroupApi.searchGroup(groupId)
    } catch {
      found = null
    }
  }
  const call = joinGroupCall(found, { ...payload, group_id: groupId })
  if (!call.groupCode) throw new Error('群不存在')
  if (call.option === 3) throw new Error('该群不允许加入')
  const groupService = core.context.session.getGroupService()
  if (typeof groupService?.joinGroup !== 'function') throw new Error('当前内核没有入群接口')
  const args = kernelJoinArgs(call)
  let result
  try {
    result = await Promise.resolve(groupService.joinGroup(args))
  } catch (error) {
    logger?.warn?.('[chihiro] join_group object call failed', error?.message || error)
    result = await Promise.resolve(groupService.joinGroup(args.groupCode, args.option))
  }
  const fail = joinGroupResultMessage(result)
  if (fail) {
    logger?.warn?.(
      `[chihiro] join_group kernel ${groupId} option=${call.option} auth=${call.joinGroupAuth ? 'yes' : 'no'}`,
      result,
    )
    throw new Error(fail)
  }
  logger?.info?.(`[chihiro] join_group submitted ${groupId} option=${call.option} auth=${call.joinGroupAuth ? 'yes' : 'no'}`)
  return {
    already: false,
    group_id: groupId,
    submitted: true,
    name: mapSearchGroup(found, false)?.name || '',
    result: result ?? null,
  }
}

function wrapContactActions(ctx) {
  const core = ctx.core
  if (!core || typeof ctx.actions?.get !== 'function') {
    ctx.logger?.warn?.('[chihiro] contact actions unavailable')
    return
  }
  const extras = {
    search_contact: makeAction((payload) => searchContact(core, payload)),
    add_friend: makeAction((payload) => addFriend(core, payload)),
    join_group: makeAction((payload) => joinGroup(core, payload, ctx.logger)),
  }
  if (ctx.actions.get[CONTACT_MARK]) return
  const originalGet = ctx.actions.get.bind(ctx.actions)
  const wrapped = (name) => {
    const existing = originalGet(name)
    if (existing) return existing
    const key = String(name || '').replace(/_async$|_rate_limited$/, '')
    return extras[key]
  }
  wrapped[CONTACT_MARK] = true
  ctx.actions.get = wrapped
  ctx.logger?.info?.('[chihiro] contact actions registered: search_contact, add_friend, join_group')
}

export async function plugin_init(ctx) {
  const init = typeof ssqqInit === 'function' ? ssqqInit : original?.plugin_init
  if (typeof init === 'function') await init(ctx)
  wrapRecentContactUnread(ctx)
  wrapContactActions(ctx)
}

const index = { plugin_init }
export default index
