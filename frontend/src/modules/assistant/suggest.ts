import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { useShellStore } from '@/stores/shell'
import {
  decideJoin,
  quietMsFor,
  type SuggestTurnMessage,
} from './suggest-turn'

export {
  PRIVATE_QUIET_MS,
  GROUP_QUIET_MS,
  collectPendingTurn,
  decideJoin,
  type SuggestTurnMessage,
} from './suggest-turn'

export type BotMode = 'assist' | 'auto'
export type BotSessionConfig = {
  enabled: boolean
  mode: BotMode
  configId: string | null
}
export type SuggestReply = { id: string; text: string; score: number }
export type SuggestContext = {
  accountId: string
  type: 'private' | 'group'
  peerId: string
}
export type AstrBotConfigOption = { id: string; name: string; isDefault?: boolean }

export const AUTO_SEND_MS = 5000
export const BOT_DEFAULT_KEY = 'chihiro-bot-new-default'

export function peerSessionKey(type: SuggestContext['type'], peerId: string): string {
  return `${type}:${peerId}`
}

export function botConversationKey(context: SuggestContext): string {
  return `${context.accountId}:${peerSessionKey(context.type, context.peerId)}`
}

export function normalizeBotSession(value: unknown): BotSessionConfig {
  if (value === true) return { enabled: true, mode: 'assist', configId: null }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    const configId = typeof record.configId === 'string' && record.configId.trim()
      ? record.configId.trim()
      : typeof record.config_id === 'string' && record.config_id.trim()
        ? record.config_id.trim()
        : null
    return {
      enabled: Boolean(record.enabled),
      mode: record.mode === 'auto' ? 'auto' : 'assist',
      configId,
    }
  }
  return { enabled: false, mode: 'assist', configId: null }
}

export function parseSuggestReplies(value: unknown): SuggestReply[] {
  const list = Array.isArray((value as { replies?: unknown })?.replies)
    ? (value as { replies: unknown[] }).replies
    : Array.isArray(value) ? value : []
  const replies: SuggestReply[] = []
  for (const item of list) {
    if (replies.length >= 3) break
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const text = typeof record.text === 'string' ? record.text.trim() : ''
    if (!text) continue
    const score = Number(record.score)
    replies.push({
      id: String(record.id || replies.length + 1),
      text,
      score: Number.isFinite(score) ? Math.min(1, Math.max(0, score)) : 0,
    })
  }
  return replies
}

export function parseSuggestSummary(value: unknown): string {
  const text = typeof (value as { summary?: unknown })?.summary === 'string'
    ? (value as { summary: string }).summary.trim()
    : ''
  return text
}

export function hasSubstantialText(text: string): boolean {
  return text.replace(/[\u200B\u00A0]/g, ' ').trim().length > 0
}

export function newSessionBotDefault(): boolean {
  try { return localStorage.getItem(BOT_DEFAULT_KEY) === '1' } catch { return false }
}

export function highestScoreReply(replies: SuggestReply[]): SuggestReply | null {
  if (!replies.length) return null
  return replies.reduce((best, item) => item.score > best.score ? item : best)
}

type SuggestActions = {
  fill: (text: string) => void
  send: (text: string, force?: boolean) => void
  inputText: () => string
  blocked?: () => boolean
  snapshot?: () => { lastMessageId: string; messages: SuggestTurnMessage[] } | null
}

export const useSuggestStore = defineStore('conversation-bot-suggest', () => {
  const shell = useShellStore()
  const context = ref<SuggestContext | null>(null)
  const sessions = ref<Record<string, BotSessionConfig>>({})
  const menuOpen = ref(false)
  const replies = ref<SuggestReply[]>([])
  const summary = ref('')
  const lastMessageId = ref('')
  const generating = ref(false)
  const countdownMs = ref(0)
  const countdownReplyId = ref('')
  const configs = ref<AstrBotConfigOption[]>([])
  const configsReady = ref(false)
  const setupMissing = ref(false)
  const autoRequested = ref<Set<string>>(new Set())
  const focused = ref(false)
  let generation = 0
  let controller: AbortController | undefined
  let countdownTimer: ReturnType<typeof setInterval> | undefined
  let quietTimer: ReturnType<typeof setTimeout> | undefined
  let presenceTimer: ReturnType<typeof setInterval> | undefined
  let actions: SuggestActions | undefined

  const key = computed(() => context.value ? botConversationKey(context.value) : '')
  const stored = computed(() => key.value ? sessions.value[key.value] : undefined)
  const config = computed<BotSessionConfig>(() => stored.value ?? {
    enabled: false,
    mode: 'assist',
    configId: null,
  })
  const enabled = computed(() => config.value.enabled)
  const mode = computed(() => config.value.mode)
  const configId = computed(() => config.value.configId)
  const selectedConfigLabel = computed(() => {
    if (!configId.value) return '未指定'
    return configs.value.find(item => item.id === configId.value)?.name || '未指定'
  })
  const composerReply = computed<SuggestReply | null>(() => {
    if (summary.value) return { id: 'summary', text: summary.value, score: 1 }
    return highestScoreReply(replies.value)
  })
  const highlightedId = computed(() => composerReply.value?.id || highestScoreReply(replies.value)?.id || '')
  const countingDown = computed(() => countdownMs.value > 0 && Boolean(countdownReplyId.value))
  const needsAstrBotSetup = computed(() => configsReady.value && (setupMissing.value || configs.value.length === 0))

  function bindActions(next: SuggestActions) {
    actions = next
  }

  function applySnapshot(value: unknown, accountId: string) {
    const accounts = (value as { accounts?: { accounts?: unknown[] } })?.accounts?.accounts
    if (!Array.isArray(accounts)) return
    const account = accounts.find(item => item && typeof item === 'object' && (item as { id?: unknown }).id === accountId) as
      | { botSessions?: Record<string, unknown> }
      | undefined
    const next: Record<string, BotSessionConfig> = {}
    for (const [id, raw] of Object.entries(account?.botSessions ?? {})) {
      next[`${accountId}:${id}`] = normalizeBotSession(raw)
    }
    sessions.value = next
  }

  async function request(path: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
    signal?.throwIfAborted()
    const response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      cache: 'no-store',
      signal,
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error((data as { message?: string }).message || `HTTP ${response.status}`)
    return data
  }

  function operatorBusy() {
    return Boolean(actions?.blocked?.() || hasSubstantialText(actions?.inputText() || ''))
  }

  function cancelQuiet() {
    if (quietTimer !== undefined) {
      clearTimeout(quietTimer)
      quietTimer = undefined
    }
  }

  function invalidateDraft() {
    generation += 1
    controller?.abort()
    controller = undefined
    generating.value = false
    clearChips()
  }

  function discardSurface() {
    cancelQuiet()
    generation += 1
    controller?.abort()
    controller = undefined
    generating.value = false
    replies.value = []
    summary.value = ''
    lastMessageId.value = ''
    cancelCountdown()
  }

  function cancelCountdown() {
    if (countdownTimer !== undefined) {
      clearInterval(countdownTimer)
      countdownTimer = undefined
    }
    countdownMs.value = 0
    countdownReplyId.value = ''
  }

  async function claimTurn(target: SuggestContext, messageId: string) {
    try {
      const result = await request('/api/runtime/bot/claim', {
        accountId: target.accountId,
        type: target.type,
        peerId: target.peerId,
        lastMessageId: messageId,
      }) as { claimed?: boolean }
      return result.claimed !== false
    } catch {
      return true
    }
  }

  async function finishAutoSend() {
    const target = context.value
    const messageId = lastMessageId.value
    const text = countdownReplyId.value === 'summary'
      ? summary.value
      : replies.value.find(item => item.id === countdownReplyId.value)?.text
    cancelCountdown()
    if (!target || !text?.trim() || hasSubstantialText(actions?.inputText() || '')) return
    if (!(await claimTurn(target, messageId))) {
      clearChips()
      return
    }
    actions?.send(text)
    replies.value = []
    summary.value = ''
    lastMessageId.value = ''
  }

  function maybeStartCountdown() {
    cancelCountdown()
    if (mode.value !== 'auto' || !enabled.value || !replies.value.length) return
    if (hasSubstantialText(actions?.inputText() || '')) return
    const best = composerReply.value || highestScoreReply(replies.value)
    if (!best) return
    countdownReplyId.value = best.id
    countdownMs.value = AUTO_SEND_MS
    const started = Date.now()
    countdownTimer = setInterval(() => {
      const left = AUTO_SEND_MS - (Date.now() - started)
      if (left <= 0) {
        void finishAutoSend()
        return
      }
      countdownMs.value = left
    }, 100)
  }

  function postPresence(target: SuggestContext, nextFocused: boolean) {
    void request('/api/runtime/bot/presence', {
      accountId: target.accountId,
      type: target.type,
      peerId: target.peerId,
      focused: nextFocused,
      busy: nextFocused && operatorBusy(),
    }).catch(() => {})
  }

  function postNudge(target: SuggestContext) {
    if (!enabled.value || mode.value !== 'auto') return
    void request('/api/runtime/bot/nudge', {
      accountId: target.accountId,
      type: target.type,
      peerId: target.peerId,
    }).catch(() => {})
  }

  function stopPresenceHeartbeat() {
    if (presenceTimer !== undefined) {
      clearInterval(presenceTimer)
      presenceTimer = undefined
    }
  }

  function startPresenceHeartbeat() {
    stopPresenceHeartbeat()
    presenceTimer = setInterval(() => {
      if (focused.value && context.value) postPresence(context.value, true)
    }, 8000)
  }

  function setFocused(next: boolean) {
    const target = context.value
    const was = focused.value
    focused.value = next
    if (!target) return
    if (next) {
      postPresence(target, true)
      startPresenceHeartbeat()
      return
    }
    stopPresenceHeartbeat()
    postPresence(target, false)
    cancelQuiet()
    cancelCountdown()
    if (was && enabled.value && mode.value === 'auto') postNudge(target)
  }

  function clearChips() {
    replies.value = []
    summary.value = ''
    lastMessageId.value = ''
    cancelCountdown()
  }

  async function persist(patch: Partial<BotSessionConfig>) {
    if (!context.value) return
    const target = { ...context.value }
    const version = generation
    const current = sessions.value[botConversationKey(target)] ?? { enabled: false, mode: 'assist' as BotMode, configId: null }
    const next: BotSessionConfig = {
      enabled: patch.enabled ?? current.enabled,
      mode: patch.mode ?? current.mode,
      configId: patch.configId === undefined ? current.configId : patch.configId,
    }
    sessions.value = { ...sessions.value, [botConversationKey(target)]: next }
    if (!next.enabled) {
      cancelQuiet()
      generation += 1
      controller?.abort()
      controller = undefined
      generating.value = false
      clearChips()
      autoRequested.value = new Set()
    }
    try {
      const result = await request('/api/runtime/bot/session', {
        id: target.accountId,
        type: target.type,
        peerId: target.peerId,
        enabled: next.enabled,
        mode: next.mode,
        configId: next.configId,
      })
      if (version !== generation) return
      applySnapshot(result, target.accountId)
    } catch {
      if (version === generation) sessions.value = { ...sessions.value, [botConversationKey(target)]: current }
    }
  }

  async function loadConfigs() {
    try {
      const result = await request('/api/runtime/bot/configs') as { configs?: AstrBotConfigOption[]; needsSetup?: boolean }
      configs.value = Array.isArray(result.configs) ? result.configs : []
      setupMissing.value = result.needsSetup === true || configs.value.length === 0
    } catch {
      configs.value = []
      setupMissing.value = true
    }
    configsReady.value = true
  }

  function select(next: SuggestContext) {
    if (next.accountId !== shell.activeAccountId || !/^\d+$/.test(next.peerId)) return
    const same = context.value && botConversationKey(context.value) === botConversationKey(next)
    if (!same) {
      const previous = context.value
      if (previous && focused.value) {
        postPresence(previous, false)
        if (enabled.value && mode.value === 'auto') postNudge(previous)
      }
      discardSurface()
      autoRequested.value = new Set()
      menuOpen.value = false
      context.value = { ...next }
      if (focused.value) postPresence(next, true)
      void hydrate(next.accountId)
    } else context.value = { ...next }
  }

  async function hydrate(accountId: string) {
    const version = generation
    try {
      const state = await request('/api/runtime/state')
      if (version !== generation) return
      applySnapshot(state, accountId)
      if (!context.value || context.value.accountId !== accountId) return
      const fullKey = botConversationKey(context.value)
      if (!sessions.value[fullKey] && newSessionBotDefault()) {
        await persist({ enabled: true, mode: 'assist', configId: null })
      }
    } catch { /* keep local */ }
  }

  function clear() {
    const previous = context.value
    if (previous && focused.value && enabled.value && mode.value === 'auto') postNudge(previous)
    if (previous) postPresence(previous, false)
    stopPresenceHeartbeat()
    focused.value = false
    discardSurface()
    autoRequested.value = new Set()
    context.value = null
    sessions.value = {}
    menuOpen.value = false
    configs.value = []
    configsReady.value = false
    setupMissing.value = false
  }

  function toggleMenu() {
    menuOpen.value = !menuOpen.value
    if (menuOpen.value) void loadConfigs()
  }

  function closeMenu() {
    menuOpen.value = false
  }

  async function setEnabled(value: boolean) {
    await persist({ enabled: value })
  }

  async function setMode(value: BotMode) {
    if (!enabled.value) return
    await persist({ mode: value })
    if (value === 'auto') maybeStartCountdown()
    else cancelCountdown()
  }

  async function setConfigId(value: string | null) {
    if (!enabled.value) return
    await persist({ configId: value })
  }

  function pick(reply: SuggestReply) {
    cancelCountdown()
    actions?.fill(reply.text)
  }

  function sendReply(reply: SuggestReply) {
    cancelCountdown()
    if (!reply.text.trim()) return
    const target = context.value
    const messageId = lastMessageId.value
    if (target && messageId) void claimTurn(target, messageId)
    actions?.send(reply.text, true)
  }

  function alreadyAutoRequested(messageId: string): boolean {
    return autoRequested.value.has(messageId)
  }

  function noteThemActivity() {
    if (!context.value || !enabled.value || operatorBusy()) return
    cancelCountdown()
    cancelQuiet()
    if (generating.value || replies.value.length || summary.value) invalidateDraft()
    const wait = quietMsFor(context.value.type)
    quietTimer = setTimeout(() => {
      quietTimer = undefined
      void flushQuietTurn()
    }, wait)
  }

  async function flushQuietTurn() {
    if (!context.value || !enabled.value || operatorBusy()) return
    const snap = actions?.snapshot?.()
    if (!snap?.lastMessageId) return
    const decision = decideJoin({ type: context.value.type, messages: snap.messages })
    if (!decision.join) return
    await requestSuggest({
      lastMessageId: snap.lastMessageId,
      trigger: 'auto',
      messages: snap.messages,
    })
  }

  async function requestSuggest(input: {
    lastMessageId: string
    messages: SuggestTurnMessage[] | { role: 'them' | 'me'; text: string }[]
    trigger: 'auto' | 'menu'
  }) {
    if (!context.value || !input.lastMessageId) return
    if (input.trigger === 'auto') {
      if (!enabled.value) return
      if (alreadyAutoRequested(input.lastMessageId)) return
      if (hasSubstantialText(actions?.inputText() || '')) return
      autoRequested.value = new Set(autoRequested.value).add(input.lastMessageId)
    }
    const target = { ...context.value }
    const version = ++generation
    controller?.abort()
    controller = new AbortController()
    const signal = controller.signal
    generating.value = true
    lastMessageId.value = input.lastMessageId
    replies.value = []
    summary.value = ''
    cancelCountdown()
    try {
      const result = await request('/api/runtime/bot/suggest', {
        accountId: target.accountId,
        type: target.type,
        peerId: target.peerId,
        lastMessageId: input.lastMessageId,
        trigger: input.trigger,
        messages: input.messages,
      }, signal)
      if (version !== generation || signal.aborted) return
      const next = parseSuggestReplies(result)
      const nextSummary = parseSuggestSummary(result)
      replies.value = next
      summary.value = nextSummary
      lastMessageId.value = input.lastMessageId
      generating.value = false
      if (!next.length && !nextSummary) {
        lastMessageId.value = ''
        return
      }
      maybeStartCountdown()
    } catch {
      if (version !== generation || signal.aborted) return
      generating.value = false
      replies.value = []
      summary.value = ''
      lastMessageId.value = ''
    }
  }

  function onOperatorInput() {
    cancelCountdown()
    cancelQuiet()
    if (focused.value && context.value) postPresence(context.value, true)
  }

  watch(() => `${shell.activeAccountId ?? ''}:${shell.activeAccount?.status ?? ''}`, clear, { flush: 'sync' })

  return {
    context, sessions, menuOpen, replies, summary, lastMessageId, generating, countdownMs, countdownReplyId,
    configs, configsReady, needsAstrBotSetup, enabled, mode, configId, selectedConfigLabel, highlightedId, countingDown, composerReply, config,
    bindActions, select, clear, applySnapshot, persist, toggleMenu, closeMenu,
    setEnabled, setMode, setConfigId, pick, sendReply, requestSuggest, alreadyAutoRequested,
    onOperatorInput, noteThemActivity, flushQuietTurn, cancelCountdown, clearChips, loadConfigs, discardSurface,
    setFocused,
  }
})
