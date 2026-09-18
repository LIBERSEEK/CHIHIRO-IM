import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const rail = readFileSync(new URL('./src/components/user/UserSessionRail.vue', import.meta.url), 'utf8')
const bulletin = readFileSync(new URL('./src/components/user/UserBulletinBody.vue', import.meta.url), 'utf8')
const info = readFileSync(new URL('./src/pages/user/UserInfo.vue', import.meta.url), 'utf8')
const chat = readFileSync(new URL('./src/pages/user/UserChat.vue', import.meta.url), 'utf8')

describe('group notice UX', () => {
  it('decodes HTML entities in the session-rail preview', () => {
    expect(rail).toContain('noticePreviewText')
    expect(rail).toContain('@chihiro/im-native/notice-text')
  })

  it('opens 群资料 on the 公告 tab when 群公告 is clicked', () => {
    expect(chat).toContain("chatInfoTab.value = 'notice'")
    expect(chat).toContain('openGroupInfoFromRail')
    expect(chat).toContain(':initial-tab="chatInfoTab"')
    expect(info).toContain("selectTab('notice')")
    expect(info).toContain('tabSelect(1)')
  })

  it('lets expanded bulletin text be mouse-selected', () => {
    expect(bulletin).toContain('user-select: text')
    expect(bulletin).toContain('-webkit-user-select: text')
    expect(bulletin).toContain('@click.stop="onBodyClick"')
    expect(bulletin).not.toContain('@click="showAll = !showAll"')
  })
})
