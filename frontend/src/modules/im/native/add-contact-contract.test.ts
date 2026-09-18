import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const head = readFileSync(new URL('./src/components/user/UserListHead.vue', import.meta.url), 'utf8')
const pop = readFileSync(new URL('./src/components/user/UserProfilePop.vue', import.meta.url), 'utf8')
const pan = readFileSync(new URL('./src/components/user/UserAddContactPan.vue', import.meta.url), 'utf8')
const workspace = readFileSync(new URL('../../workspace/WorkspaceModule.vue', import.meta.url), 'utf8')
const chat = readFileSync(new URL('./src/pages/user/UserChat.vue', import.meta.url), 'utf8')
const plugin = readFileSync(new URL('../../../../../backend/src/runtime/chihiro-napcat-unread-plugin.mjs', import.meta.url), 'utf8')

describe('add friend/group', () => {
  it('opens the search pan from the plus menu instead of a stub toast', () => {
    expect(head).toContain('openAddContactSearch')
    expect(head).not.toContain('暂不支持加好友/群')
    expect(workspace).toContain('UserAddContactPan')
    expect(workspace).toContain('@start-chat="sendToContact"')
  })

  it('opens the friend apply dialog from a stranger profile', () => {
    expect(pop).toContain('openAddFriendApply')
    expect(pop).not.toContain('暂不支持加好友')
  })

  it('varies the join-group apply fields by group policy', () => {
    expect(pan).toContain('joinGroupForm')
    expect(pan).toContain('填写验证信息')
    expect(pan).toContain("form.kind === 'none'")
    expect(pan).toContain("form.kind === 'question'")
    expect(pan).toContain("form.kind === 'verify'")
    expect(pan).toContain("form.kind === 'forbid'")
    expect(pan).toContain("payload.answer = message.value")
  })

  it('uses the local contact list for 加入 vs 发消息 and 添加 vs 发消息', () => {
    expect(pan).toContain('applyLocalMembership')
    expect(pan).not.toContain('already = true')
    expect(pan).toContain("user.already ? $t('发消息') : $t('添加')")
    expect(pan).toContain("group.already ? $t('发消息') : $t('加入')")
  })

  it('marks a non-friend private chat as a temp session with an add-friend action', () => {
    expect(chat).toContain('isTempSession')
    expect(chat).toContain('临时会话')
    expect(chat).toContain('openTempAddFriend')
    expect(chat).toContain("['fas', 'user-plus']")
    expect(chat).toContain('chihiro-add-friend-btn')
    expect(chat).toContain('.chihiro-add-friend-btn svg')
    expect(chat).toContain('width: 20px !important')
    expect(pop).toContain('openAddFriendApply')
  })

  it('registers search_contact beside add_friend and join_group', () => {
    expect(plugin).toContain('search_contact:')
    expect(plugin).toContain('joinGroupCall')
    expect(plugin).toContain("call.option === 3")
  })
})
