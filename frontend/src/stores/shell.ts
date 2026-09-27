import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { AccountContext, AccountId, AccountPlatform } from '../contracts'
import { accountId, accountPlatformFromId, isBilibiliAccountId, isDouyinAccountId, isXiaohongshuAccountId } from '../contracts'
import { splitDouyinIdentity } from '@/app/account-ui'
import {
  filterUnreadPeers,
  readAccountSessionNotice,
  type NativeUnreadPeer,
} from '@/modules/workspace/nativeUnread'

type RuntimeAccountRow = AccountContext & { unreadPeers?: NativeUnreadPeer[] }

function parseUnreadPeers(value: unknown): NativeUnreadPeer[] | undefined {
  if (!Array.isArray(value)) return undefined
  const peers = value.flatMap((item): NativeUnreadPeer[] => {
    if (!record(item)) return []
    const peer = String(item.peer ?? item.peerUin ?? item.peer_uin ?? item.user_id ?? item.group_id ?? '')
    const unread = Math.max(0, Math.floor(Number(item.unread) || 0))
    if (!peer || peer === '0' || unread <= 0) return []
    return [{ peer, unread }]
  })
  return peers
}

function runtimeAccountUnread(account: RuntimeAccountRow): number | undefined {
  if (account.unreadPeers) {
    const filtered = filterUnreadPeers(account.unreadPeers, readAccountSessionNotice(account.id))
    return filtered > 0 ? filtered : undefined
  }
  return account.unread
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Read only the public account fields; runtime tokens never enter this store. */
export function parseRuntimeAccounts(value: unknown): { accounts: RuntimeAccountRow[]; activeId: AccountId | null } {
  if (!record(value) || !record(value.accounts) || !Array.isArray(value.accounts.accounts)) {
    throw new Error('账号状态响应格式无效')
  }
  const ids = new Set<string>()
  const accounts: RuntimeAccountRow[] = value.accounts.accounts.map((item: unknown) => {
    if (!record(item) || typeof item.id !== 'string' || ids.has(item.id)) {
      throw new Error('账号状态包含无效或重复账号')
    }
    const platform = parseAccountPlatform(item)
    if (!platform) throw new Error('账号状态包含无效或重复账号')
    ids.add(item.id)
    const avatar = typeof item.avatar === 'string' && isAllowedAvatar(item.avatar) ? item.avatar : undefined
    const instanceId = typeof item.instanceId === 'string' && item.instanceId.trim() ? item.instanceId : undefined
    const unread = typeof item.unread === 'number' && Number.isFinite(item.unread) ? Math.max(0, Math.floor(item.unread)) : undefined
    const unreadPeers = platform === 'qq' ? parseUnreadPeers(item.unreadPeers) : undefined
    const rawLabel = [item.label, item.nickname, item.id].find((label): label is string => typeof label === 'string' && Boolean(label.trim()))!
    const identity = platform === 'douyin' ? splitDouyinIdentity(rawLabel) : null
    const explicitDouyinId = typeof item.douyinId === 'string' ? item.douyinId.trim() : ''
    const douyinId = identity ? (explicitDouyinId || identity.douyinId) : ''
    return {
      id: accountId(item.id),
      label: identity ? (identity.name || '抖音账号') : rawLabel,
      ...(douyinId ? { douyinId } : {}),
      ...(avatar ? { avatar } : {}),
      ...(instanceId && platform === 'qq' ? { instanceId } : {}),
      platform,
      status: item.online === true ? 'online' : 'offline',
      ...(platform === 'qq' && item.botEnabled === true ? { botEnabled: true } : {}),
      ...(platform === 'qq' && item.botWired === true ? { botWired: true } : {}),
      ...(platform === 'qq' && unread !== undefined ? { unread } : {}),
      ...(unreadPeers ? { unreadPeers } : {}),
    }
  })
  const selected = value.accounts.activeId
  return { accounts, activeId: typeof selected === 'string' && ids.has(selected) ? accountId(selected) : null }
}

function isAllowedAvatar(src: string): boolean {
  if (/^https?:\/\//.test(src)) return true
  return src.startsWith('/api/runtime/outreach/accounts/') && src.includes('/avatar')
}

function parseAccountPlatform(item: Record<string, unknown>): AccountPlatform | null {
  if (item.platform === 'bilibili' || item.client === 'bilibili') return 'bilibili'
  if (item.platform === 'xiaohongshu' || item.client === 'xiaohongshu') return 'xiaohongshu'
  if (item.platform === 'douyin' || item.client === 'douyin') return 'douyin'
  if (item.platform === 'qq' || item.client === 'qq') return 'qq'
  return typeof item.id === 'string' ? accountPlatformFromId(item.id) : null
}

function outreachClientName(client: string) {
  return client === 'xiaohongshu' ? '小红书' : client === 'bilibili' ? '哔哩哔哩' : '抖音'
}

function messageFrom(value: unknown, fallback: string): string {
  return record(value) && typeof value.message === 'string' && value.message.trim() ? value.message : fallback
}

export interface OutreachTaskState {
  running: boolean
  accountId: string
  status: string
  logs: Array<{ level?: string; text?: string; at?: string }>
  commented: number
  scanned: number
  id: string
  startedAt: string
  previewMode: 'pip' | 'window'
  previewAvailable: boolean
  previewMuted: boolean
  paused: boolean
}

export function parseOutreachTask(value: unknown): OutreachTaskState {
  if (!record(value)) {
    return { running: false, accountId: '', status: 'idle', logs: [], commented: 0, scanned: 0, id: '', startedAt: '', previewMode: 'window', previewAvailable: false, previewMuted: true, paused: false }
  }
  return {
    running: value.running === true,
    accountId: typeof value.accountId === 'string' ? value.accountId : '',
    status: typeof value.status === 'string' && value.status ? value.status : 'idle',
    logs: Array.isArray(value.logs) ? value.logs.filter(record) : [],
    commented: Math.max(0, Math.floor(Number(value.commented) || 0)),
    scanned: Math.max(0, Math.floor(Number(value.scanned) || 0)),
    id: typeof value.id === 'string' ? value.id : '',
    startedAt: typeof value.startedAt === 'string' ? value.startedAt : '',
    previewMode: value.previewMode === 'pip' ? 'pip' : 'window',
    previewAvailable: value.previewAvailable === true,
    previewMuted: value.previewMuted !== false,
    paused: value.paused === true || value.status === 'paused',
  }
}

export interface RuntimeClient {
  id: string
  name: string
  badge: string
  enabled: boolean
  hint?: string
}

export function parseRuntimeClients(value: unknown): RuntimeClient[] {
  if (!record(value) || !Array.isArray(value.clients)) throw new Error('客户端列表响应格式无效')
  return value.clients.flatMap((item): RuntimeClient[] => {
    if (!record(item) || typeof item.id !== 'string' || typeof item.name !== 'string') return []
    return [{
      id: item.id,
      name: item.name,
      badge: typeof item.badge === 'string' && item.badge ? item.badge : item.name.slice(0, 2),
      enabled: item.enabled === true,
      ...(typeof item.hint === 'string' && item.hint ? { hint: item.hint } : {}),
    }]
  })
}

export const useShellStore = defineStore('shell', () => {
  const activeAccountId = ref<AccountId | null>(null)
  const accounts = ref<AccountContext[]>([])
  const loading = ref(false)
  const adding = ref(false)
  const accountAction = ref(false)
  const cancelingLogin = ref(false)
  const removingAccountId = ref<AccountId | null>(null)
  const error = ref('')
  const runtimePhase = ref('idle')
  const runtimeMessage = ref('')
  const pendingAdd = ref(false)
  const qrReady = ref(false)
  const qrVersion = ref(0)
  const clients = ref<RuntimeClient[]>([{ id: 'qq', name: 'QQ', badge: 'QQ', enabled: true }])
  const loginClient = ref('qq')
  const browserPath = ref('')
  const browserDetected = ref(false)
  const outreachTask = ref<OutreachTaskState>(parseOutreachTask(null))
  const outreachPipOpen = ref(false)
  const activeAccount = computed(() => accounts.value.find(account => account.id === activeAccountId.value) ?? null)
  let requestVersion = 0
  let selectionVersion = 0
  let loginVersion = 0
  let controller: AbortController | undefined
  const liveUnread = new Map<AccountId, number>()

  function dropLiveUnread(id: AccountId | null | undefined) {
    if (id) liveUnread.delete(id)
  }

  function applyLiveUnread(account: AccountContext): AccountContext {
    if (!liveUnread.has(account.id)) return account
    const unread = liveUnread.get(account.id) || 0
    if (unread > 0) return account.unread === unread ? account : { ...account, unread }
    if (account.unread === undefined) return account
    const next = { ...account }
    delete next.unread
    return next
  }

  function toAccountContext(account: RuntimeAccountRow): AccountContext {
    const unread = runtimeAccountUnread(account)
    const next: AccountContext = {
      id: account.id,
      label: account.label,
      platform: account.platform,
      status: account.status,
      ...(account.avatar ? { avatar: account.avatar } : {}),
      ...(account.instanceId ? { instanceId: account.instanceId } : {}),
      ...(account.douyinId ? { douyinId: account.douyinId } : {}),
      ...(account.botEnabled ? { botEnabled: true } : {}),
      ...(account.botWired ? { botWired: true } : {}),
      ...(unread ? { unread } : {}),
    }
    return next
  }

  function sameAccount(a: AccountContext, b: AccountContext) {
    return a.id === b.id &&
      a.label === b.label &&
      a.avatar === b.avatar &&
      a.instanceId === b.instanceId &&
      a.platform === b.platform &&
      a.douyinId === b.douyinId &&
      a.status === b.status &&
      a.botEnabled === b.botEnabled &&
      a.botWired === b.botWired &&
      a.unread === b.unread
  }

  function mergeAccounts(nextAccounts: RuntimeAccountRow[]) {
    const currentById = new Map(accounts.value.map(account => [account.id, account]))
    const next = nextAccounts.map(account => {
      const current = currentById.get(account.id)
      const fromRuntime = toAccountContext(account)
      const withRuntimeUnread = fromRuntime.unread === undefined && !account.unreadPeers && current?.unread
        ? { ...fromRuntime, unread: current.unread }
        : fromRuntime
      const withLocalUnread = applyLiveUnread(withRuntimeUnread)
      return current && sameAccount(current, withLocalUnread) ? current : withLocalUnread
    })
    const nextIds = new Set(next.map(account => account.id))
    for (const id of [...liveUnread.keys()]) {
      if (!nextIds.has(id)) liveUnread.delete(id)
    }
    const unchanged = next.length === accounts.value.length &&
      next.every((account, index) => account === accounts.value[index])
    if (!unchanged) accounts.value = next
  }

  function applyOutreachState(value: unknown) {
    if (!record(value) || !record(value.outreach)) return
    const outreach = value.outreach
    loginClient.value = outreach.loginClient === 'xiaohongshu' || outreach.loginClient === 'bilibili' || outreach.loginClient === 'douyin' ? outreach.loginClient : 'qq'
    if (typeof outreach.browserPath === 'string') browserPath.value = outreach.browserPath
    browserDetected.value = outreach.browserDetected === true
    const wasRunning = outreachTask.value.running
    const nextTask = parseOutreachTask(outreach.task)
    if (record(outreach.preview)) {
      nextTask.previewMode = outreach.preview.mode === 'pip' ? 'pip' : 'window'
      nextTask.previewAvailable = outreach.preview.available === true
      nextTask.previewMuted = outreach.preview.muted !== false
    }
    outreachTask.value = nextTask
    if (outreachTask.value.running && !wasRunning) outreachPipOpen.value = true
    if (!outreachTask.value.running && !outreachTask.value.accountId) {
      /* keep pip if the operator opened it by hand */
    }
  }

  function applyRuntimeState(value: unknown, preserveSelection = true, options: { preserveLoginState?: boolean } = {}) {
    const state = parseRuntimeAccounts(value)
    const pendingBefore = pendingAdd.value
    if (record(value) && !options.preserveLoginState) {
      runtimePhase.value = typeof value.phase === 'string' ? value.phase : 'idle'
      runtimeMessage.value = typeof value.message === 'string' ? value.message : ''
      pendingAdd.value = value.pendingAdd === true
      if (record(value.qr)) {
        qrReady.value = value.qr.exists === true
        qrVersion.value = typeof value.qr.mtime === 'number' ? value.qr.mtime : 0
      } else {
        qrReady.value = false
        qrVersion.value = 0
      }
    }
    applyOutreachState(value)
    mergeAccounts(state.accounts)
    const selectedStillExists = state.accounts.some(account => account.id === activeAccountId.value)
    const adoptNewLogin = pendingBefore && !pendingAdd.value && Boolean(state.activeId)
    if (!preserveSelection || !selectedStillExists || adoptNewLogin) {
      dropLiveUnread(activeAccountId.value)
      activeAccountId.value = state.activeId ?? state.accounts[0]?.id ?? null
    }
    return state
  }

  // Selection is local to this browser; API calls carry their explicit account.
  function selectAccount(id: AccountId | null) {
    if (id !== null && !accounts.value.some(account => account.id === id)) return
    ++selectionVersion
    activeAccountId.value = id
  }

  async function refreshAccounts() {
    const version = ++requestVersion
    const selectionAtStart = selectionVersion
    controller?.abort()
    controller = new AbortController()
    loading.value = true
    error.value = ''
    try {
      const response = await fetch('/api/runtime/state', { signal: controller.signal, cache: 'no-store' })
      if (!response.ok) throw new Error(`无法加载账号（HTTP ${response.status}）`)
      const body: unknown = await response.json()
      if (version !== requestVersion) return
      const selectionBeforeApply = activeAccountId.value
      const staleNewLoginState = adding.value && pendingAdd.value && record(body) && body.pendingAdd !== true
      const state = applyRuntimeState(body, true, { preserveLoginState: staleNewLoginState || cancelingLogin.value })
      const selectedStillExists = state.accounts.some(account => account.id === selectionBeforeApply)
      if (!selectedStillExists) {
        activeAccountId.value = selectionAtStart !== selectionVersion && activeAccountId.value === null
          ? null : state.activeId ?? state.accounts[0]?.id ?? null
      }
    } catch (cause) {
      if (version === requestVersion) error.value = cause instanceof Error ? cause.message : '无法加载账号'
    } finally {
      if (version === requestVersion) { loading.value = false; controller = undefined }
    }
  }

  function setAccountUnread(id: AccountId, count: number) {
    const unread = Math.max(0, Math.floor(Number.isFinite(count) ? count : 0))
    const index = accounts.value.findIndex(account => account.id === id)
    if (index < 0) return
    liveUnread.set(id, unread)
    if ((accounts.value[index].unread ?? 0) === unread) return
    const next = accounts.value.slice()
    next[index] = { ...next[index], ...(unread > 0 ? { unread } : { unread: undefined }) }
    accounts.value = next
  }

  async function refreshClients() {
    try {
      const response = await fetch('/api/runtime/clients', { cache: 'no-store' })
      if (!response.ok) throw new Error(`无法加载客户端（HTTP ${response.status}）`)
      const list = parseRuntimeClients(await response.json())
      if (list.length) clients.value = list
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '无法加载客户端'
    }
  }

  async function addAccount(client = 'qq') {
    if (adding.value || accountAction.value) return
    const version = ++loginVersion
    const browserOutreach = client === 'douyin' || client === 'xiaohongshu' || client === 'bilibili'
    adding.value = true
    pendingAdd.value = true
    loginClient.value = browserOutreach ? client : 'qq'
    runtimePhase.value = browserOutreach ? 'browser_setup' : 'starting'
    runtimeMessage.value = browserOutreach ? `选择本机 Chrome，然后登录${outreachClientName(client)}账号` : '正在启动 QQ 登录'
    qrReady.value = false
    qrVersion.value = 0
    error.value = ''
    try {
      const response = await fetch('/api/runtime/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client, mode: 'new' }),
      })
      const body: unknown = await response.json().catch(() => ({}))
      if (version !== loginVersion) return
      if (!response.ok) throw new Error(record(body) && typeof body.message === 'string' ? body.message : `无法添加账号（HTTP ${response.status}）`)
      const state = applyRuntimeState(body, !browserOutreach)
      if (!browserOutreach) activeAccountId.value = state.activeId ?? state.accounts.at(-1)?.id ?? null
    } catch (cause) {
      if (version === loginVersion) {
        error.value = cause instanceof Error ? cause.message : '无法添加账号'
        pendingAdd.value = false
        runtimePhase.value = 'idle'
        runtimeMessage.value = ''
        loginClient.value = 'qq'
      }
    } finally {
      if (version === loginVersion) adding.value = false
    }
  }

  async function reloginAccount(id: AccountId, refreshQr = false) {
    if (adding.value || accountAction.value) return
    const version = ++loginVersion
    accountAction.value = true
    error.value = ''
    selectAccount(id)
    const outreachClient = isBilibiliAccountId(id) ? 'bilibili' : isXiaohongshuAccountId(id) ? 'xiaohongshu' : (isDouyinAccountId(id) ? 'douyin' : '')
    if (outreachClient) {
      loginClient.value = outreachClient
      runtimePhase.value = 'browser_setup'
      runtimeMessage.value = `选择本机 Chrome，然后登录${outreachClientName(outreachClient)}账号`
    }
    try {
      const response = await fetch('/api/runtime/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(outreachClient
          ? { client: outreachClient, id }
          : { client: 'qq', uin: String(id).replace(/^qq:/, ''), ...(refreshQr ? { refreshQr: true } : {}) }),
      })
      const body: unknown = await response.json().catch(() => ({}))
      if (version !== loginVersion) return
      if (!response.ok) throw new Error(messageFrom(body, `无法登录账号（HTTP ${response.status}）`))
      applyRuntimeState(body)
    } catch (cause) {
      if (version === loginVersion) error.value = cause instanceof Error ? cause.message : '无法登录账号'
    } finally {
      if (version === loginVersion) accountAction.value = false
    }
  }

  async function saveBrowserPath(nextPath: string) {
    const response = await fetch('/api/runtime/outreach/browser', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: nextPath }),
    })
    const body: unknown = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(messageFrom(body, `无法保存浏览器路径（HTTP ${response.status}）`))
    applyRuntimeState(body)
    return body
  }

  async function loginOutreachAccount(nextPath = browserPath.value, id: AccountId | '' = '') {
    if (accountAction.value || runtimePhase.value === 'logging_in') return
    const version = ++loginVersion
    const target = id || (pendingAdd.value ? '' : activeAccountId.value || '')
    const client = isBilibiliAccountId(target) || loginClient.value === 'bilibili'
      ? 'bilibili'
      : isXiaohongshuAccountId(target) || loginClient.value === 'xiaohongshu' ? 'xiaohongshu' : 'douyin'
    const name = outreachClientName(client)
    accountAction.value = true
    loginClient.value = client
    runtimePhase.value = 'logging_in'
    runtimeMessage.value = `请在弹出的 Chrome 中登录${name}`
    error.value = ''
    try {
      const response = await fetch('/api/runtime/outreach/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: target,
          client,
          browserPath: nextPath || browserPath.value,
        }),
      })
      const body: unknown = await response.json().catch(() => ({}))
      if (version !== loginVersion) return
      if (!response.ok) throw new Error(messageFrom(body, `无法登录${name}（HTTP ${response.status}）`))
      applyRuntimeState(body)
    } catch (cause) {
      if (version === loginVersion) {
        error.value = cause instanceof Error ? cause.message : `无法登录${name}`
        if (runtimePhase.value === 'logging_in') {
          runtimePhase.value = 'browser_setup'
          runtimeMessage.value = error.value
        }
      }
    } finally {
      if (version === loginVersion) accountAction.value = false
    }
  }

  function setOutreachPipOpen(open: boolean) {
    outreachPipOpen.value = open
  }

  async function refreshLoginQr() {
    if (accountAction.value) return
    const version = ++loginVersion
    accountAction.value = true
    error.value = ''
    try {
      const response = await fetch('/api/runtime/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client: 'qq', refreshQr: true }),
      })
      const body: unknown = await response.json().catch(() => ({}))
      if (version !== loginVersion) return
      if (!response.ok) throw new Error(messageFrom(body, `无法刷新二维码（HTTP ${response.status}）`))
      applyRuntimeState(body)
    } catch (cause) {
      if (version === loginVersion) error.value = cause instanceof Error ? cause.message : '无法刷新二维码'
    } finally {
      if (version === loginVersion) accountAction.value = false
    }
  }

  async function removeAccount(id: AccountId) {
    if (accountAction.value) return false
    accountAction.value = true
    removingAccountId.value = id
    error.value = ''
    try {
      const response = await fetch('/api/runtime/accounts/remove', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }),
      })
      const body: unknown = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(messageFrom(body, `无法退出账号（HTTP ${response.status}）`))
      applyRuntimeState(body, false)
      return true
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '无法退出账号'
      return false
    } finally {
      accountAction.value = false
      removingAccountId.value = null
    }
  }

  async function cancelLogin() {
    if (runtimePhase.value === 'cancelling') return
    ++loginVersion
    adding.value = false
    accountAction.value = true
    cancelingLogin.value = true
    runtimePhase.value = 'cancelling'
    runtimeMessage.value = '正在取消登录…'
    qrReady.value = false
    error.value = ''
    try {
      const response = await fetch('/api/runtime/login/cancel', { method: 'POST' })
      const body: unknown = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(messageFrom(body, `无法取消登录（HTTP ${response.status}）`))
      applyRuntimeState(body)
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '无法取消登录'
    } finally {
      adding.value = false
      accountAction.value = false
      cancelingLogin.value = false
    }
  }

  function cancelRefresh() {
    ++requestVersion
    controller?.abort()
    controller = undefined
    loading.value = false
  }

  return {
    activeAccountId, activeAccount, accounts, loading, adding, accountAction, cancelingLogin, removingAccountId, error,
    runtimePhase, runtimeMessage, pendingAdd, qrReady, qrVersion, clients,
    loginClient, browserPath, browserDetected, outreachTask, outreachPipOpen,
    selectAccount, setAccountUnread, applyRuntimeState, refreshAccounts, refreshClients, addAccount, reloginAccount, refreshLoginQr, removeAccount, cancelLogin, cancelRefresh,
    saveBrowserPath, loginOutreachAccount, setOutreachPipOpen,
  }
})
