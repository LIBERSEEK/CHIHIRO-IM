import { describe, expect, it } from 'vitest'
import { accountId } from '@/contracts'
import { resolveShellViewState, type ShellViewStateInput } from './shell-view-state'

const base: ShellViewStateInput = {
  routeName: 'im',
  routeSettings: undefined,
  runtimeBootstrapped: true,
  adding: false,
  pendingAdd: false,
  runtimePhase: 'idle',
  runtimeMessage: '',
  qrReady: false,
  cancelingLogin: false,
  activeAccount: null,
}

const onlineAccount = {
  id: accountId('qq:10001'),
  label: 'QQ 10001',
  platform: 'qq' as const,
  status: 'online' as const,
}

describe('shell view state', () => {
  it('shows boot loading instead of the empty launcher before runtime state is known', () => {
    const state = resolveShellViewState({ ...base, runtimeBootstrapped: false })

    expect(state.showRuntimeBootLoading).toBe(true)
    expect(state.showLoginPanel).toBe(false)
    expect(state.showEmptyLauncher).toBe(false)
  })

  it('shows the empty launcher only after runtime bootstraps with no account and no login work', () => {
    const state = resolveShellViewState(base)

    expect(state.showRuntimeBootLoading).toBe(false)
    expect(state.showLoginPanel).toBe(true)
    expect(state.showEmptyLauncher).toBe(true)
    expect(state.loginMessage).toBe('点击左侧 + 添加并登录账号')
  })

  it('keeps pending new-account login clean when runtime still reports the previous logged-in message', () => {
    const state = resolveShellViewState({
      ...base,
      adding: true,
      pendingAdd: true,
      runtimePhase: 'starting',
      runtimeMessage: '已登录 Raven',
      activeAccount: onlineAccount,
    })

    expect(state.loginInProgress).toBe(true)
    expect(state.showEmptyLauncher).toBe(false)
    expect(state.loginMessage).toBe('正在启动 QQ 登录')
  })

  it('surfaces cancel progress and restart hints', () => {
    expect(resolveShellViewState({
      ...base,
      activeAccount: { ...onlineAccount, status: 'offline' },
      runtimeMessage: '二维码过期，请刷新',
    }).loginNeedsRestart).toBe(true)

    const cancelling = resolveShellViewState({
      ...base,
      pendingAdd: true,
      runtimePhase: 'cancelling',
      cancelingLogin: true,
    })
    expect(cancelling.loginInProgress).toBe(true)
    expect(cancelling.loginMessage).toBe('正在取消登录…')
  })

  it('does not cover non-account routes or IM settings with the login panel', () => {
    expect(resolveShellViewState({ ...base, routeName: 'customers' }).showLoginPanel).toBe(false)
    expect(resolveShellViewState({ ...base, routeSettings: '1' }).showLoginPanel).toBe(false)
  })

  it('shows a QQ login card while a Douyin account stays selected', () => {
    const state = resolveShellViewState({
      ...base,
      pendingAdd: true,
      loginClient: 'qq',
      runtimePhase: 'qr',
      qrReady: true,
      activeAccount: { ...onlineAccount, id: accountId('douyin:preview'), platform: 'douyin', label: '抖音' },
    })
    expect(state.loginKind).toBe('qq')
    expect(state.showLoginPanel).toBe(true)
    expect(state.loginMessage).toBe('请使用 QQ 扫描二维码。约两分钟有效。')
  })

  it('shows the Douyin browser-setup panel instead of a QQ QR card', () => {
    const state = resolveShellViewState({
      ...base,
      adding: true,
      pendingAdd: true,
      loginClient: 'douyin',
      runtimePhase: 'browser_setup',
      runtimeMessage: '选择本机 Chrome，然后登录抖音账号',
    })
    expect(state.loginInProgress).toBe(true)
    expect(state.showLoginPanel).toBe(true)
    expect(state.showEmptyLauncher).toBe(false)
    expect(state.loginMessage).toBe('选择本机 Chrome，然后登录抖音账号')
  })
})
