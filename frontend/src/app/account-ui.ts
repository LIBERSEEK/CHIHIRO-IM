import type { AccountContext } from '@/contracts'
import qqSvg from 'simple-icons/icons/qq.svg?raw'
import tiktokSvg from 'simple-icons/icons/tiktok.svg?raw'
import xiaohongshuSvg from 'simple-icons/icons/xiaohongshu.svg?raw'
import bilibiliSvg from 'simple-icons/icons/bilibili.svg?raw'

export interface AccountMenuPosition {
  x: number
  y: number
}

export function accountPlatformLabel(platform: AccountContext['platform']): string {
  if (platform === 'bilibili') return '哔哩哔哩'
  if (platform === 'xiaohongshu') return '小红书'
  if (platform === 'douyin') return '抖音'
  if (platform === 'qq') return 'QQ'
  return platform
}

export function accountTitle(account: AccountContext, options?: { active?: boolean }): string {
  const viewHint = options?.active ? ' · 再点查看资料' : ''
  return `${account.label} · ${accountPlatformLabel(account.platform)}${account.status === 'online' ? ' · 在线' : ' · 离线'}${account.platform === 'qq' && account.botEnabled ? ' · Bot' : ''}${viewHint} · 右键管理`
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

/** Pull a display name and public 抖音号 out of a profile line that also contains 关注/粉丝/获赞. */
export function splitDouyinIdentity(value: string): { name: string; douyinId: string } {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  const idMatch = text.match(/抖音号\s*[:：]\s*([A-Za-z0-9._-]{2,32})/)
  let name = idMatch ? text.slice(0, idMatch.index) : text
  name = name.replace(/关注\s*[\d.]+(?:\s*[万亿])?\s*粉丝\s*[\d.]+(?:\s*[万亿])?\s*获赞\s*[\d.]+(?:\s*[万亿])?\s*$/u, '')
  name = name.replace(/\s+/g, ' ').trim()
  return { name, douyinId: idMatch?.[1] || '' }
}

export function accountDouyinId(account: AccountContext): string {
  if (account.platform !== 'douyin') return ''
  return account.douyinId?.trim() || splitDouyinIdentity(account.label).douyinId
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
  return account.platform === 'qq' && account.botEnabled === true
}

export type AccountPlatformBrand = {
  platform: 'qq' | 'douyin' | 'xiaohongshu' | 'bilibili'
  slug: string
  title: string
  hex: string
  path: string
}

function simpleIconPath(svg: string): string {
  const match = /\sd="([^"]+)"/.exec(svg)
  if (!match?.[1]) throw new Error('simple-icons svg is missing a path')
  return match[1]
}

const QQ_BRAND: AccountPlatformBrand = {
  platform: 'qq',
  slug: 'qq',
  title: 'QQ',
  hex: '1EBAFC',
  path: simpleIconPath(qqSvg),
}

const DOUYIN_BRAND: AccountPlatformBrand = {
  platform: 'douyin',
  slug: 'tiktok',
  title: '抖音',
  hex: '000000',
  path: simpleIconPath(tiktokSvg),
}

const XHS_BRAND: AccountPlatformBrand = {
  platform: 'xiaohongshu',
  slug: 'xiaohongshu',
  title: '小红书',
  hex: 'FF2442',
  path: simpleIconPath(xiaohongshuSvg),
}

const BILIBILI_BRAND: AccountPlatformBrand = {
  platform: 'bilibili',
  slug: 'bilibili',
  title: '哔哩哔哩',
  hex: '00AEEC',
  path: simpleIconPath(bilibiliSvg),
}

export function accountPlatformBrand(platform: AccountContext['platform']): AccountPlatformBrand | null {
  if (platform === 'qq') return QQ_BRAND
  if (platform === 'douyin') return DOUYIN_BRAND
  if (platform === 'xiaohongshu') return XHS_BRAND
  if (platform === 'bilibili') return BILIBILI_BRAND
  return null
}

export function accountPlatformBadge(platform: AccountContext['platform']): 'qq' | 'douyin' | 'xiaohongshu' | 'bilibili' | null {
  return accountPlatformBrand(platform)?.platform ?? null
}

export function canOpenNapCatSettings(account: AccountContext): boolean {
  return account.platform === 'qq'
}

export function canOpenOutreachSettings(account: AccountContext): boolean {
  return account.platform === 'douyin' || account.platform === 'xiaohongshu' || account.platform === 'bilibili'
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
