import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const shell = readFileSync(new URL('./AppShell.vue', import.meta.url), 'utf8')
const pop = readFileSync(new URL('./AccountProfilePop.vue', import.meta.url), 'utf8')
const badge = readFileSync(new URL('./AccountPlatformBadge.vue', import.meta.url), 'utf8')
const accountUi = readFileSync(new URL('./account-ui.ts', import.meta.url), 'utf8')
const imPop = readFileSync(new URL('../modules/im/native/src/components/user/UserProfilePop.vue', import.meta.url), 'utf8')

describe('account rail profile pop', () => {
  it('opens the account card only when the already-selected avatar is clicked', () => {
    expect(shell).toContain("import AccountProfilePop from '@/app/AccountProfilePop.vue'")
    expect(shell).toContain('@click.stop="onAccountAvatarClick($event, account)"')
    expect(shell).toContain('@contextmenu.prevent.stop="openAccountMenu($event, account)"')
    expect(shell).toContain('<AccountProfilePop')
    expect(shell).toContain('accountAvatarClickAction')
    expect(shell).toContain("if (action === 'select')")
    expect(shell).toContain('selectAccount(account.id)')
  })

  it('shows the QQ number with a copy control on the rail card and IM profile pop', () => {
    expect(pop).toContain('QQ {{ uin || \'—\' }}')
    expect(pop).toContain('account-profile-copy')
    expect(pop).toContain('复制 QQ 号')
    expect(pop).toContain('navigator.clipboard.writeText(uin.value)')
    expect(pop).toContain("from '@lucide/vue'")
    expect(imPop).toContain('chihiro-profile-copy')
    expect(imPop).toContain('复制 QQ 号')
    expect(imPop).toContain("from '@lucide/vue'")
    expect(imPop).toContain('<Copy v-else :size="14" />')
    expect(imPop).not.toContain("['fas', copied ? 'check' : 'copy']")
    expect(imPop).toContain('copyToClipboard(String(props.userId))')
  })

  it('draws avatar platform badges from simple-icons library files', () => {
    expect(accountUi).toContain("from 'simple-icons/icons/qq.svg?raw'")
    expect(accountUi).toContain("from 'simple-icons/icons/tiktok.svg?raw'")
    expect(accountUi).not.toContain('@/assets/brands/')
    expect(badge).toContain('accountPlatformBrand')
    expect(badge).toContain('<path :d="brand.path" fill="currentColor" />')
    expect(badge).not.toContain('@/assets/brands/')
    expect(badge).not.toContain('<img')
  })

  it('opens QQ Zone in the shell iframe window instead of a new browser tab', () => {
    expect(pop).toContain('openExternalFrame')
    expect(pop).toContain('QQ空间 · ${props.account.label}')
    expect(pop).not.toContain("window.open(qzoneUrl.value")
    expect(imPop).toContain('chihiro-open-external-settings')
    expect(imPop).toContain("src: 'https://user.qzone.qq.com/' + props.userId")
    expect(imPop).not.toContain("openLink('https://user.qzone.qq.com/'")
  })
})
