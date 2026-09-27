<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'
import { SlidersHorizontal, Settings } from '@lucide/vue'

import AccountProfilePop from '@/app/AccountProfilePop.vue'
import AccountPlatformBadge from '@/app/AccountPlatformBadge.vue'
import ExternalSettingsDialog from '@/app/ExternalSettingsDialog.vue'
import OutreachSettingsDialog from '@/app/OutreachSettingsDialog.vue'
import OutreachPip from '@/modules/outreach/components/OutreachPip.vue'
import OutreachLoginPanel from '@/modules/outreach/components/OutreachLoginPanel.vue'
import { useAssistantStore } from '@/modules/assistant/session'
import { useSuggestStore } from '@/modules/assistant/suggest'
import { useShellStore } from '@/stores/shell'
import type { AccountContext, AccountId } from '@/contracts'
import { applyTheme as applyShellTheme, cycleTheme as cycleShellTheme, onThemeChange, readThemeMode, watchSystemTheme, type ThemeMode } from '@/theme'
import { resolveShellViewState } from '@/app/shell-view-state'
import { startRuntimeStateStream, type RuntimeStateStream } from '@/app/runtime-state-stream'
import {
  accountAvatarClickAction,
  accountAvatarSrc,
  accountTitle,
  accountUnreadLabel,
  canCloseExitDialog,
  canOpenOutreachSettings,
  canOpenNapCatSettings,
  clampAccountMenuPosition,
  shouldCloseExitDialogForKey,
  shouldCloseImSettingsForKey,
  shouldShowAccountUnread,
  shouldShowBotBadge,
} from '@/app/account-ui'

const labels = { light: '浅色', dark: '深色', system: '跟随系统' }
const shell = useShellStore()
const assistant = useAssistantStore()
const suggest = useSuggestStore()
const route = useRoute()
const router = useRouter()
const settingsOpen = ref(false)
const externalSettings = ref<{ title: string; src: string } | null>(null)
const outreachSettings = ref<{ title: string } | null>(null)
const accountMenu = ref<{ account: AccountContext; x: number; y: number } | null>(null)
const accountProfile = ref<{ account: AccountContext; anchor: DOMRect } | null>(null)
const exitAccount = ref<AccountContext | null>(null)
const addLauncherOpen = ref(false)
const clientMenuOpen = ref(false)
const selectedClientId = ref('qq')
const themeMode = ref<ThemeMode>('dark')
const themeLabel = computed(() => labels[themeMode.value])
const runtimeBootstrapped = ref(false)
const shellView = computed(() => resolveShellViewState({
  routeName: route.name,
  routeSettings: route.query.settings,
  runtimeBootstrapped: runtimeBootstrapped.value,
  adding: shell.adding,
  pendingAdd: shell.pendingAdd,
  runtimePhase: shell.runtimePhase,
  runtimeMessage: shell.runtimeMessage,
  qrReady: shell.qrReady,
  cancelingLogin: shell.cancelingLogin,
  activeAccount: shell.activeAccount,
  loginClient: shell.loginClient,
}))
const showRuntimeBootLoading = computed(() => shellView.value.showRuntimeBootLoading)
const loginInProgress = computed(() => shellView.value.loginInProgress)
const loginNeedsRestart = computed(() => shellView.value.loginNeedsRestart)
// The empty state is now the Agent-led workbench; login remains available from the rail.
const showLoginPanel = computed(() => shellView.value.showLoginPanel && !shellView.value.showEmptyLauncher)
const loginMessage = computed(() => shellView.value.loginMessage)
const exitBusy = computed(() => Boolean(exitAccount.value && shell.removingAccountId === exitAccount.value.id))
const profileAccount = computed(() => {
  const pop = accountProfile.value
  if (!pop) return null
  return shell.accounts.find(item => item.id === pop.account.id) ?? pop.account
})
const profileAnchor = computed(() => accountProfile.value?.anchor ?? null)
const selectedClient = computed(() => shell.clients.find(client => client.id === selectedClientId.value)
  ?? shell.clients.find(client => client.enabled)
  ?? shell.clients[0])
const qrSrc = computed(() => `/api/runtime/qq/qr?v=${shell.qrVersion || Date.now()}`)
const loginKind = computed(() => shellView.value.loginKind)
function applyTheme(mode: ThemeMode) {
  themeMode.value = applyShellTheme(mode).mode
}
function cycleTheme() {
  themeMode.value = cycleShellTheme().mode
}
let suppressDocumentClose = false
function selectAccount(id: AccountId) {
  closeAccountMenu()
  shell.selectAccount(id)
  const current = router.currentRoute.value
  if (current.path !== '/im' || Object.keys(current.query).length > 0) void router.push('/im')
}
function onAccountAvatarClick(event: MouseEvent, account: AccountContext) {
  event.stopPropagation()
  settingsOpen.value = false
  closeAccountMenu()
  const action = accountAvatarClickAction(account.id, shell.activeAccountId, accountProfile.value?.account.id)
  if (action === 'select') {
    closeAccountProfile()
    selectAccount(account.id)
    return
  }
  suppressDocumentClose = true
  if (action === 'close-profile') accountProfile.value = null
  else {
    accountProfile.value = { account, anchor: (event.currentTarget as HTMLElement).getBoundingClientRect() }
  }
  queueMicrotask(() => { suppressDocumentClose = false })
}
function closeAccountProfile() { accountProfile.value = null }
function openAccountMenu(event: MouseEvent, account: AccountContext) {
  settingsOpen.value = false
  closeAccountProfile()
  accountMenu.value = {
    account,
    ...clampAccountMenuPosition(event.clientX, event.clientY, { width: window.innerWidth, height: window.innerHeight }),
  }
}
function closeAccountMenu() { accountMenu.value = null }
function closeAddLauncher() {
  addLauncherOpen.value = false
  clientMenuOpen.value = false
}
function relogin(account: AccountContext, refreshQr = false) {
  closeAccountMenu()
  void shell.reloginAccount(account.id, refreshQr)
}
async function loginDouyin(path = '') {
  try {
    await shell.loginOutreachAccount(path || shell.browserPath)
  } catch (cause) {
    shell.error = cause instanceof Error ? cause.message : '无法登录抖音'
  }
}
function askExit(account: AccountContext) {
  closeAccountMenu()
  closeAccountProfile()
  exitAccount.value = account
}
function closeExitDialog() {
  if (canCloseExitDialog(exitBusy.value)) exitAccount.value = null
}
async function confirmExit() {
  const account = exitAccount.value
  if (!account) return
  const removed = await shell.removeAccount(account.id)
  if (removed) exitAccount.value = null
}
function openImSettings() {
  settingsOpen.value = false
  void router.push(route.path === '/im' && route.query.settings === '1'
    ? { path: '/im' }
    : { path: '/im', query: { settings: '1' } })
}
function openExternalSettingsEvent(event: Event) {
  const detail = (event as CustomEvent<{ title?: unknown; src?: unknown }>).detail
  if (!detail || typeof detail.title !== 'string' || typeof detail.src !== 'string') return
  closeAccountProfile()
  closeAccountMenu()
  settingsOpen.value = false
  externalSettings.value = { title: detail.title, src: detail.src }
}
function openAccountNapCatSettings(account: AccountContext) {
  shell.selectAccount(account.id)
  closeAccountMenu()
  settingsOpen.value = false
  externalSettings.value = { title: `NapCat 设置 · ${account.label}`, src: '/webui' }
}
function openAccountOutreachSettings(account: AccountContext) {
  shell.selectAccount(account.id)
  closeAccountMenu()
  settingsOpen.value = false
  outreachSettings.value = { title: `全局设置 · ${account.label}` }
}
function closeMenus(event: MouseEvent) {
  if (suppressDocumentClose) return
  const target = event.target as Element
  if (!target.closest('.shell-settings')) settingsOpen.value = false
  if (!target.closest('.account-context-menu')) closeAccountMenu()
  if (!target.closest('.client-dropdown')) clientMenuOpen.value = false
  if (!target.closest('.rail-add-slot')) addLauncherOpen.value = false
  if (!target.closest('.account-profile-card') && !target.closest('.account-profile-mask') && !target.closest('.account-avatar')) {
    closeAccountProfile()
  }
}
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && outreachSettings.value) {
    outreachSettings.value = null
    return
  }
  if (event.key === 'Escape' && accountProfile.value) closeAccountProfile()
  if (shouldCloseExitDialogForKey(event.key, Boolean(exitAccount.value), exitBusy.value)) closeExitDialog()
  if (shouldCloseImSettingsForKey(event.key, route.name, route.query.settings)) {
    event.preventDefault()
    void router.push({ path: '/im' })
  }
}
function selectClient(id: string) {
  const client = shell.clients.find(item => item.id === id)
  if (!client?.enabled) return
  selectedClientId.value = id
  clientMenuOpen.value = false
}
async function startSelectedClient() {
  const client = selectedClient.value
  if (!client?.enabled || shell.adding) return
  closeAddLauncher()
  void router.push('/im')
  if (client.id === 'qq' && loginKind.value !== 'qq' && loginInProgress.value) await shell.cancelLogin()
  await shell.addAccount(client.id)
}
function openAddLauncher() {
  settingsOpen.value = false
  closeAccountMenu()
  closeAccountProfile()
  addLauncherOpen.value = !addLauncherOpen.value
  if (!addLauncherOpen.value) clientMenuOpen.value = false
}
function openAddLauncherEvent(event: Event) {
  const detail = (event as CustomEvent<{ client?: unknown }>).detail
  const preferredClient = detail && ['qq', 'douyin', 'xiaohongshu', 'bilibili'].includes(String(detail.client))
    ? String(detail.client)
    : null
  if (preferredClient) selectedClientId.value = preferredClient
  suppressDocumentClose = true
  settingsOpen.value = false
  closeAccountMenu()
  closeAccountProfile()
  addLauncherOpen.value = true
  clientMenuOpen.value = false
  queueMicrotask(() => { suppressDocumentClose = false })
}
async function bootstrapRuntime() {
  try {
    await shell.refreshAccounts()
  } finally {
    if (!mounted) return
    runtimeBootstrapped.value = true
    runtimeStream?.close()
    runtimeStream = startRuntimeStateStream(
      (state) => {
        shell.applyRuntimeState(state)
        suggest.applyRuntimeMarks(state)
      },
      () => shell.refreshAccounts(),
    )
  }
}

let runtimeStream: RuntimeStateStream | undefined
let stopTheme: (() => void) | undefined
let mounted = false
onMounted(() => {
  mounted = true
  applyTheme(readThemeMode())
  stopTheme = onThemeChange(mode => { themeMode.value = mode })
  watchSystemTheme()
  void bootstrapRuntime()
  void shell.refreshClients()
  document.addEventListener('click', closeMenus)
  document.addEventListener('keydown', onKeydown)
  window.addEventListener('chihiro-open-external-settings', openExternalSettingsEvent)
  window.addEventListener('chihiro-open-add-account', openAddLauncherEvent)
})
onUnmounted(() => {
  mounted = false
  shell.cancelRefresh()
  assistant.clear()
  document.removeEventListener('click', closeMenus)
  document.removeEventListener('keydown', onKeydown)
  window.removeEventListener('chihiro-open-external-settings', openExternalSettingsEvent)
  window.removeEventListener('chihiro-open-add-account', openAddLauncherEvent)
  stopTheme?.()
  runtimeStream?.close()
  runtimeStream = undefined
})
</script>

<template>
  <div class="app-shell">
    <nav class="account-rail" aria-label="账号">
      <div class="account-list">
        <button v-for="account in shell.accounts" :key="account.id" type="button" class="account-avatar"
          :class="{ active: account.id === shell.activeAccountId, offline: account.status !== 'online' }"
          :title="accountTitle(account, { active: account.id === shell.activeAccountId })"
          @click.stop="onAccountAvatarClick($event, account)" @contextmenu.prevent.stop="openAccountMenu($event, account)">
          <span class="account-avatar-face">
            <img v-if="accountAvatarSrc(account)" :src="accountAvatarSrc(account)" alt="" referrerpolicy="no-referrer" />
            <span v-else>{{ account.label.slice(0, 1) }}</span>
          </span>
          <span v-if="shouldShowAccountUnread(account)" class="account-unread-badge">{{ accountUnreadLabel(account) }}</span>
          <span v-if="shouldShowBotBadge(account)" class="account-bot-badge">BOT</span>
          <AccountPlatformBadge :platform="account.platform" />
        </button>
      </div>
      <div class="rail-add-slot">
        <button class="rail-button add-account" type="button" :disabled="shell.adding" title="添加账号" aria-label="添加账号"
          :aria-expanded="addLauncherOpen" aria-haspopup="dialog" @click.stop="openAddLauncher">
          <span v-if="shell.adding" class="rail-spinner" aria-hidden="true" />
          <span v-else aria-hidden="true">+</span>
        </button>
        <div v-if="addLauncherOpen" class="add-account-popover" role="dialog" aria-label="添加账号" @click.stop>
          <h2>添加账号</h2>
          <p v-if="selectedClient?.hint" class="add-account-hint">{{ selectedClient.hint }}</p>
          <div class="launch-row">
            <div class="client-dropdown">
              <button type="button" class="client-drop-button" aria-haspopup="listbox" :aria-expanded="clientMenuOpen" @click.stop="clientMenuOpen = !clientMenuOpen">
                <span class="client-badge">{{ selectedClient?.badge }}</span>
                <span>{{ selectedClient?.name }}</span>
                <svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M4.2 6.2a.75.75 0 0 1 1.06 0L8 8.94l2.74-2.74a.75.75 0 1 1 1.06 1.06l-3.27 3.27a.75.75 0 0 1-1.06 0L4.2 7.26a.75.75 0 0 1 0-1.06z"/></svg>
              </button>
              <div v-if="clientMenuOpen" class="client-menu" role="listbox">
                <button v-for="client in shell.clients" :key="client.id" type="button" role="option"
                  :aria-selected="client.id === selectedClient?.id" :disabled="!client.enabled"
                  :class="{ active: client.id === selectedClient?.id }" @click.stop="selectClient(client.id)">
                  <span class="client-badge">{{ client.badge }}</span>
                  <span>{{ client.name }}{{ client.enabled ? '' : '（即将支持）' }}</span>
                </button>
              </div>
            </div>
            <button type="button" class="launch-button" :disabled="shell.adding || !selectedClient?.enabled" @click="startSelectedClient">继续登录</button>
          </div>
        </div>
      </div>
      <div class="rail-space" />
      <button class="rail-button theme-button" type="button" :title="`主题：${themeLabel}`" :aria-label="`主题：${themeLabel}`" @click="cycleTheme">
        <svg v-if="themeMode === 'light'" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="currentColor"/><path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17m10-10 1.4-1.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        <svg v-else-if="themeMode === 'dark'" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21.6 15.1A9.5 9.5 0 0 1 8.9 2.4 9.5 9.5 0 1 0 21.6 15.1Z"/></svg>
        <svg v-else viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="11.5" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 19.5h8M12 16v3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
      </button>
      <div class="shell-settings">
        <button class="rail-button settings-button" :class="{ active: settingsOpen }" type="button" title="设置" aria-label="设置"
          aria-haspopup="menu" :aria-expanded="settingsOpen" @click.stop="settingsOpen = !settingsOpen">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        </button>
        <div v-if="settingsOpen" class="settings-menu" role="menu">
          <button type="button" role="menuitem" @click="openImSettings"><Settings :size="16" />{{ route.path === '/im' && route.query.settings === '1' ? '返回千寻 IM' : '设置' }}</button>
        </div>
      </div>
    </nav>

    <main v-show="!showLoginPanel" class="app-content">
      <div v-if="showRuntimeBootLoading" class="app-loading" role="status">
        <span class="app-loading-spinner" aria-hidden="true" />
        <p>加载中…</p>
      </div>
      <RouterView v-else />
    </main>
    <section v-if="showLoginPanel" class="login-panel" :class="{ 'login-panel-fill': loginKind !== 'qq' }" :aria-label="loginKind === 'xiaohongshu' ? '小红书登录' : loginKind === 'bilibili' ? '哔哩哔哩登录' : loginKind === 'douyin' ? '抖音登录' : 'QQ 登录'">
      <OutreachLoginPanel
        v-if="loginKind !== 'qq'"
        :product="loginKind === 'xiaohongshu' ? '小红书自动评论' : loginKind === 'bilibili' ? '哔哩哔哩评论获客' : '抖音自动营销与引流工具'"
        :busy="shell.runtimePhase === 'logging_in'"
        :canceling="shell.cancelingLogin"
        :message="loginMessage"
        :can-exit="Boolean(shell.activeAccount)"
        @login="loginDouyin"
        @cancel="shell.cancelLogin"
        @exit="shell.activeAccount && askExit(shell.activeAccount)"
      />
      <div v-else class="login-card">
        <h1>{{ shell.pendingAdd ? '登录新账号' : shell.activeAccount?.status === 'online' ? 'QQ 登录' : '账号未连接' }}</h1>
        <p class="login-brand">千寻IM - 千人千面, 千域千寻</p>
        <img v-if="shell.qrReady" class="login-qr" :src="qrSrc" alt="QQ 登录二维码" />
        <span v-else-if="loginInProgress" class="login-spinner" aria-hidden="true" />
        <p class="login-message">{{ loginMessage }}</p>
        <div class="login-actions">
          <button v-if="(!loginInProgress || loginNeedsRestart) && shell.activeAccount" type="button" class="primary" :disabled="shell.accountAction" @click="relogin(shell.activeAccount, loginNeedsRestart)">重新登录</button>
          <button v-if="shell.qrReady" type="button" :disabled="shell.accountAction" @click="shell.refreshLoginQr">刷新二维码</button>
          <button v-if="loginInProgress" type="button" :disabled="shell.cancelingLogin" @click="shell.cancelLogin"><span v-if="shell.cancelingLogin" class="button-spinner" aria-hidden="true" />{{ shell.cancelingLogin ? '取消中…' : '取消登录' }}</button>
          <button v-if="!loginInProgress && shell.activeAccount" type="button" class="danger" @click="askExit(shell.activeAccount)">退出账号</button>
        </div>
      </div>
    </section>
    <div v-if="accountMenu" class="account-context-menu" :style="{ left: `${accountMenu.x}px`, top: `${accountMenu.y}px` }" @click.stop>
      <button v-if="canOpenNapCatSettings(accountMenu.account)" type="button" @click="openAccountNapCatSettings(accountMenu.account)"><SlidersHorizontal :size="16" />NapCat 设置</button>
      <button v-if="canOpenOutreachSettings(accountMenu.account)" type="button" @click="openAccountOutreachSettings(accountMenu.account)"><Settings :size="16" />全局设置</button>
      <button type="button" @click="relogin(accountMenu.account)">{{ accountMenu.account.status === 'online' ? '重新登录' : '登录账号' }}</button>
      <button type="button" class="danger" @click="askExit(accountMenu.account)">退出账号</button>
    </div>
    <div v-if="exitAccount" class="shell-dialog" role="dialog" aria-modal="true" aria-labelledby="exit-account-title" @click.self="closeExitDialog">
      <div class="shell-dialog-card">
        <h2 id="exit-account-title">退出账号</h2>
        <p>确定退出“{{ exitAccount.label }}”吗？该账号的隔离运行数据会被删除，其他账号不受影响。</p>
        <div><button type="button" :disabled="exitBusy" @click="closeExitDialog">取消</button><button type="button" class="danger" :disabled="exitBusy" @click="confirmExit"><span v-if="exitBusy" class="button-spinner danger-spinner" aria-hidden="true" />{{ exitBusy ? '退出中…' : '退出账号' }}</button></div>
      </div>
    </div>
    <AccountProfilePop
      v-if="profileAccount && profileAnchor"
      :account="profileAccount"
      :anchor="profileAnchor"
      @close="closeAccountProfile"
    />
    <ExternalSettingsDialog
      :open="externalSettings !== null"
      :title="externalSettings?.title ?? ''"
      :src="externalSettings?.src ?? ''"
      @close="externalSettings = null"
    />
    <OutreachSettingsDialog
      :open="outreachSettings !== null"
      :title="outreachSettings?.title ?? ''"
      @close="outreachSettings = null"
    />
    <OutreachPip />
    <p v-if="shell.error" class="shell-error" role="alert">{{ shell.error }} <button type="button" @click="shell.refreshAccounts">重试</button></p>
  </div>
</template>
