import type { AccountContext } from '@/contracts'

export interface ShellViewStateInput {
  routeName?: string | symbol | null
  routeSettings?: unknown
  runtimeBootstrapped: boolean
  adding: boolean
  pendingAdd: boolean
  runtimePhase: string
  runtimeMessage: string
  qrReady: boolean
  cancelingLogin: boolean
  activeAccount: AccountContext | null
  loginClient?: string
}

export interface ShellViewState {
  accountRouteActive: boolean
  showRuntimeBootLoading: boolean
  loginInProgress: boolean
  loginNeedsRestart: boolean
  showLoginPanel: boolean
  showEmptyLauncher: boolean
  loginKind: 'qq' | 'douyin'
  loginMessage: string
}

const LOGIN_PHASES = new Set(['starting', 'logging_in', 'qr', 'qr_expired', 'cancelling', 'browser_setup'])
const RESTART_HINT = /(失效|过期|重新登录|请刷新|错误|超时)/

export function resolveShellViewState(input: ShellViewStateInput): ShellViewState {
  const accountRouteActive = (input.routeName === 'im' || input.routeName === 'agent') && input.routeSettings !== '1'
  const showRuntimeBootLoading = accountRouteActive && !input.runtimeBootstrapped
  const loginInProgress = input.adding || input.pendingAdd || LOGIN_PHASES.has(input.runtimePhase)
  const loginNeedsRestart = Boolean(input.activeAccount) && !input.qrReady && RESTART_HINT.test(input.runtimeMessage)
  const showLoginPanel = accountRouteActive && !showRuntimeBootLoading && (
    loginInProgress || !input.activeAccount || input.activeAccount.status !== 'online'
  )
  const showEmptyLauncher = !showRuntimeBootLoading && !loginInProgress && !input.activeAccount
  const kind = resolveLoginKind(input)
  const loginMessage = resolveLoginMessage(input, loginInProgress, kind)
  return {
    accountRouteActive,
    showRuntimeBootLoading,
    loginInProgress,
    loginNeedsRestart,
    showLoginPanel,
    showEmptyLauncher,
    loginKind: kind,
    loginMessage,
  }
}

/** A QQ login in progress stays a QQ card, even if the selected account is Douyin. */
export function resolveLoginKind(input: ShellViewStateInput): 'qq' | 'douyin' {
  const qqLogin = input.loginClient !== 'douyin' && (
    input.adding || input.pendingAdd || input.runtimePhase === 'starting' || input.runtimePhase === 'qr' || input.runtimePhase === 'qr_expired'
  )
  if (qqLogin) return 'qq'
  if (input.loginClient === 'douyin' || input.activeAccount?.platform === 'douyin' || input.runtimePhase === 'browser_setup') {
    return 'douyin'
  }
  return 'qq'
}

function resolveLoginMessage(input: ShellViewStateInput, loginInProgress: boolean, kind: 'qq' | 'douyin'): string {
  if (input.cancelingLogin) return '正在取消登录…'
  if (input.pendingAdd || (kind === 'douyin' && loginInProgress)) {
    if (kind === 'douyin') {
      if (input.runtimePhase === 'logging_in') return input.runtimeMessage || '请在弹出的 Chrome 中登录抖音'
      return input.runtimeMessage && !input.runtimeMessage.startsWith('已登录')
        ? input.runtimeMessage
        : '选择本机 Chrome，然后登录抖音账号'
    }
    if (input.qrReady) return input.runtimeMessage || '请使用 QQ 扫描二维码。约两分钟有效。'
    return input.runtimeMessage && !input.runtimeMessage.startsWith('已登录')
      ? input.runtimeMessage
      : '正在启动 QQ 登录'
  }
  return input.runtimeMessage || (loginInProgress
    ? '正在准备登录…'
    : input.activeAccount
      ? '重新登录后即可继续使用此账号'
      : '点击左侧 + 添加并登录账号')
}
