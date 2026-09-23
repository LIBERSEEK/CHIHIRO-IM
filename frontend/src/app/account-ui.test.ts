import { afterEach, describe, expect, it, vi } from 'vitest'
import { siQq, siTiktok } from 'simple-icons'
import { accountId, type AccountContext } from '@/contracts'
import {
  accountAvatarClickAction,
  accountAvatarSrc,
  accountPlatformBadge,
  accountPlatformBrand,
  accountQzoneUrl,
  accountDouyinId,
  accountTitle,
  accountUin,
  splitDouyinIdentity,
  accountUnreadLabel,
  canCloseExitDialog,
  canOpenGrowthSettings,
  canOpenNapCatSettings,
  clampAccountMenuPosition,
  openExternalFrame,
  shouldCloseExitDialogForKey,
  shouldCloseImSettingsForKey,
  shouldShowAccountUnread,
  shouldShowBotBadge,
} from './account-ui'

function account(overrides: Partial<AccountContext> = {}): AccountContext {
  return {
    id: accountId('qq:10001'),
    label: '千寻测试号',
    platform: 'qq',
    status: 'online',
    ...overrides,
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('account rail UI contract', () => {
  it('formats account title, unread badge and bot badge from account state', () => {
    const value = account({ unread: 128, botEnabled: true })

    expect(accountTitle(value)).toBe('千寻测试号 · QQ · 在线 · Bot · 右键管理')
    expect(accountTitle(value, { active: true })).toBe('千寻测试号 · QQ · 在线 · Bot · 再点查看资料 · 右键管理')
    expect(shouldShowAccountUnread(value)).toBe(true)
    expect(accountUnreadLabel(value)).toBe('99+')
    expect(accountUnreadLabel(account({ unread: 99 }))).toBe('99')
    expect(accountUnreadLabel(account({ unread: 100 }))).toBe('99+')
    expect(shouldShowBotBadge(value)).toBe(true)
  })

  it('exposes QQ number, avatar and Qzone from the account identity', () => {
    const value = account({ id: accountId('qq:3967167443'), avatar: 'https://example.test/a.png' })
    expect(accountUin(value)).toBe('3967167443')
    expect(accountAvatarSrc(value)).toBe('https://example.test/a.png')
    expect(accountQzoneUrl(value)).toBe('https://user.qzone.qq.com/3967167443')
    expect(accountAvatarSrc(account())).toBe('https://q1.qlogo.cn/g?b=qq&s=100&nk=10001')
    expect(accountUin(account({ id: accountId('other:1') }))).toBe('')
    expect(accountQzoneUrl(account({ id: accountId('other:1') }))).toBe('')
  })

  it('hides empty unread and bot badges', () => {
    const value = account({ unread: 0, botEnabled: false, status: 'offline' })

    expect(accountTitle(value)).toBe('千寻测试号 · QQ · 离线 · 右键管理')
    expect(shouldShowAccountUnread(value)).toBe(false)
    expect(accountUnreadLabel(value)).toBe('0')
    expect(shouldShowBotBadge(value)).toBe(false)
  })

  it('uses left-click to switch inactive accounts and open the selected account profile', () => {
    const a = 'qq:1'
    const b = 'qq:2'
    expect(accountAvatarClickAction(b, a, null)).toBe('select')
    expect(accountAvatarClickAction(a, a, null)).toBe('open-profile')
    expect(accountAvatarClickAction(a, a, a)).toBe('close-profile')
    expect(accountAvatarClickAction(b, a, a)).toBe('select')
    expect(accountAvatarClickAction(a, null, null)).toBe('select')
  })

  it('keeps NapCat settings scoped to QQ accounts', () => {
    expect(canOpenNapCatSettings(account({ platform: 'qq' }))).toBe(true)
    expect(canOpenNapCatSettings(account({ platform: 'telegram' as never }))).toBe(false)
    expect(canOpenNapCatSettings(account({ platform: 'wechat' as never }))).toBe(false)
    expect(canOpenNapCatSettings(account({ id: accountId('douyin:abc'), platform: 'douyin' }))).toBe(false)
  })

  it('keeps growth settings scoped to Douyin accounts', () => {
    expect(canOpenGrowthSettings(account({ id: accountId('douyin:abc'), platform: 'douyin' }))).toBe(true)
    expect(canOpenGrowthSettings(account({ platform: 'qq' }))).toBe(false)
    expect(canOpenGrowthSettings(account({ platform: 'telegram' as never }))).toBe(false)
  })

  it('splits a Douyin profile line into the name and the Douyin id', () => {
    expect(splitDouyinIdentity('自由探索LIBERSEEK关注30粉丝149获赞146抖音号：959855095')).toEqual({
      name: '自由探索LIBERSEEK',
      douyinId: '959855095',
    })
    expect(splitDouyinIdentity('创作者 关注 1.2万 粉丝 3 获赞 10 抖音号: liber.seek')).toEqual({
      name: '创作者',
      douyinId: 'liber.seek',
    })
    expect(splitDouyinIdentity('创作者')).toEqual({ name: '创作者', douyinId: '' })
    const value = account({
      id: accountId('douyin:abc'),
      label: '自由探索LIBERSEEK',
      platform: 'douyin',
      douyinId: '959855095',
    })
    expect(accountDouyinId(value)).toBe('959855095')
    expect(accountDouyinId(account())).toBe('')
  })

  it('labels Douyin accounts without QQ number, Qzone or Bot badge', () => {
    const value = account({ id: accountId('douyin:abc'), label: '创作者', platform: 'douyin', botEnabled: true, unread: 3 })
    expect(accountTitle(value)).toBe('创作者 · 抖音 · 在线 · 右键管理')
    expect(accountUin(value)).toBe('')
    expect(accountQzoneUrl(value)).toBe('')
    expect(accountAvatarSrc(value)).toBe('')
    expect(shouldShowBotBadge(value)).toBe(false)
    expect(accountPlatformBadge(value.platform)).toBe('douyin')
    expect(accountPlatformBadge('qq')).toBe('qq')
    expect(accountPlatformBrand('qq')).toEqual({
      platform: 'qq',
      slug: siQq.slug,
      title: siQq.title,
      hex: siQq.hex,
      path: siQq.path,
    })
    expect(accountPlatformBrand('douyin')).toEqual({
      platform: 'douyin',
      slug: siTiktok.slug,
      title: '抖音',
      hex: siTiktok.hex,
      path: siTiktok.path,
    })
    expect(accountPlatformBrand('telegram' as never)).toBeNull()
    expect(accountAvatarSrc(account({
      id: accountId('douyin:abc'),
      platform: 'douyin',
      avatar: '/api/runtime/growth/accounts/douyin%3Aabc/avatar?v=1',
    }))).toBe('/api/runtime/growth/accounts/douyin%3Aabc/avatar?v=1')
  })

  it('clamps context menu position inside the shell viewport', () => {
    expect(clampAccountMenuPosition(900, 700, { width: 1000, height: 760 })).toEqual({ x: 804, y: 644 })
    expect(clampAccountMenuPosition(120, 80, { width: 1000, height: 760 })).toEqual({ x: 120, y: 80 })
  })

  it('allows ESC and backdrop close only while account exit is idle', () => {
    expect(canCloseExitDialog(false)).toBe(true)
    expect(canCloseExitDialog(true)).toBe(false)
    expect(shouldCloseExitDialogForKey('Escape', true, false)).toBe(true)
    expect(shouldCloseExitDialogForKey('Escape', true, true)).toBe(false)
    expect(shouldCloseExitDialogForKey('Enter', true, false)).toBe(false)
    expect(shouldCloseExitDialogForKey('Escape', false, false)).toBe(false)
  })

  it('opens QQ Zone and other external pages through the shell iframe window', () => {
    const dispatch = vi.fn()
    vi.stubGlobal('CustomEvent', class FakeEvent {
      type: string
      detail: unknown
      constructor(type: string, init?: { detail?: unknown }) {
        this.type = type
        this.detail = init?.detail
      }
    })
    vi.stubGlobal('window', { dispatchEvent: dispatch })
    openExternalFrame('QQ空间 · Tower', 'https://user.qzone.qq.com/3967167443')
    expect(dispatch).toHaveBeenCalledTimes(1)
    const event = dispatch.mock.calls[0][0] as CustomEvent
    expect(event.type).toBe('chihiro-open-external-settings')
    expect(event.detail).toEqual({ title: 'QQ空间 · Tower', src: 'https://user.qzone.qq.com/3967167443' })
    openExternalFrame('  ', 'https://user.qzone.qq.com/1')
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it('allows ESC to close only the IM settings route', () => {
    expect(shouldCloseImSettingsForKey('Escape', 'im', '1')).toBe(true)
    expect(shouldCloseImSettingsForKey('Enter', 'im', '1')).toBe(false)
    expect(shouldCloseImSettingsForKey('Escape', 'im', undefined)).toBe(false)
    expect(shouldCloseImSettingsForKey('Escape', 'agent', '1')).toBe(false)
  })
})
