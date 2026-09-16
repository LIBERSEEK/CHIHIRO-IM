import type { AccountContext } from '@/contracts'

export interface AccountMenuPosition {
  x: number
  y: number
}

export function accountTitle(account: AccountContext, options?: { active?: boolean }): string {
  const viewHint = options?.active ? ' · 再点查看资料' : ''
  return `${account.label} · ${account.platform.toUpperCase()}${account.status === 'online' ? ' · 在线' : ' · 离线'}${account.botEnabled ? ' · Bot' : ''}${viewHint} · 右键管理`
}

export type AccountAvatarClickAction = 'select' | 'open-profile' | 'close-profile'

export function accountAvatarClickAction(
  clickedId: string,
  activeId: string | null | undefined,
  profileOpenId: string | null | undefined,
): AccountAvatarClickAction {
  if (clickedId !== activeId) return 'select'
  if (profileOpenId === clickedId) return 'close-profile'
  return 'open-profile'
}

export function accountUin(account: AccountContext): string {
  const match = /^qq:(\d+)$/.exec(account.id)
  return match?.[1] ?? ''
}

export function accountAvatarSrc(account: AccountContext): string {
  if (account.avatar) return account.avatar
  const uin = accountUin(account)
  return uin ? `https://q1.qlogo.cn/g?b=qq&s=100&nk=${uin}` : ''
}

export function accountQzoneUrl(account: AccountContext): string {
  const uin = accountUin(account)
  return uin ? `https://user.qzone.qq.com/${uin}` : ''
}

export function openExternalFrame(title: string, src: string) {
  if (typeof window === 'undefined') return
  const nextTitle = title.trim()
  const nextSrc = src.trim()
  if (!nextTitle || !nextSrc) return
  window.dispatchEvent(new CustomEvent('chihiro-open-external-settings', {
    detail: { title: nextTitle, src: nextSrc },
  }))
}

export function shouldShowAccountUnread(account: AccountContext): boolean {
  return (account.unread ?? 0) > 0
}

export function accountUnreadLabel(account: AccountContext): string {
  const unread = Math.max(0, Math.floor(account.unread ?? 0))
  return unread > 99 ? '99+' : String(unread)
}

export function shouldShowBotBadge(account: AccountContext): boolean {
  return account.botEnabled === true
}

export function canOpenNapCatSettings(account: AccountContext): boolean {
  return account.platform === 'qq'
}

export function clampAccountMenuPosition(clientX: number, clientY: number, viewport: { width: number; height: number }): AccountMenuPosition {
  return {
    x: Math.min(clientX, viewport.width - 196),
    y: Math.min(clientY, viewport.height - 116),
  }
}

export function canCloseExitDialog(exitBusy: boolean): boolean {
  return !exitBusy
}

export function shouldCloseExitDialogForKey(key: string, exitOpen: boolean, exitBusy: boolean): boolean {
  return key === 'Escape' && exitOpen && canCloseExitDialog(exitBusy)
}

export function shouldCloseImSettingsForKey(key: string, routeName: unknown, routeSettings: unknown): boolean {
  return key === 'Escape' && routeName === 'im' && routeSettings === '1'
}
