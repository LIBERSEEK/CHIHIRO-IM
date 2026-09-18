import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const pop = readFileSync(new URL('./src/components/user/UserProfilePop.vue', import.meta.url), 'utf8')
const chat = readFileSync(new URL('./src/pages/user/UserChat.vue', import.meta.url), 'utf8')
const info = readFileSync(new URL('./src/pages/user/UserInfo.vue', import.meta.url), 'utf8')
const workspace = readFileSync(new URL('../../workspace/WorkspaceModule.vue', import.meta.url), 'utf8')

describe('group-member private chat', () => {
  it('opens the session through workspace instead of a list-item DOM click', () => {
    expect(pop).toContain('preparePrivateChat')
    expect(pop).toContain("emit('start-chat'")
    expect(pop).not.toContain("getElementById('user-'")
    expect(chat).toContain('@start-chat="onMemberStartChat"')
    expect(chat).toContain("emit('startChat', info)")
    expect(info).toContain('preparePrivateChat')
    expect(workspace).toContain('info?.id ? info : chat.chatInfo.show')
  })
})
