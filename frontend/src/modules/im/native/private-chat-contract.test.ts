import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const pop = readFileSync(new URL('./src/components/user/UserProfilePop.vue', import.meta.url), 'utf8')
const chat = readFileSync(new URL('./src/pages/user/UserChat.vue', import.meta.url), 'utf8')
const info = readFileSync(new URL('./src/pages/user/UserInfo.vue', import.meta.url), 'utf8')
const workspace = readFileSync(new URL('../../workspace/WorkspaceModule.vue', import.meta.url), 'utf8')
const handlers = readFileSync(new URL('./src/function/msg.ts', import.meta.url), 'utf8')
const sendUtil = readFileSync(new URL('./src/function/utils/msgUtil.ts', import.meta.url), 'utf8')
const messages = readFileSync(new URL('./src/pages/user/UserMessages.vue', import.meta.url), 'utf8')
const appUtil = readFileSync(new URL('./src/function/utils/appUtil.ts', import.meta.url), 'utf8')

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

  it('does not treat NapCat empty temp-session history as a load failure', () => {
    expect(handlers).toContain('isEmptyChatHistoryResponse')
    expect(handlers).toMatch(/getChatHistoryFist[\s\S]{0,400}isEmptyChatHistoryResponse\(msg\) \|\| msg\.data == null/)
    expect(handlers).toMatch(/getChatHistory:[\s\S]{0,400}isEmptyChatHistoryResponse\(msg\) \|\| msg\.data == null/)
  })

  it('does not highlight a temp session when its source group is selected', () => {
    expect(messages).toContain('isSessionListItemActive(chat.show, item)')
    expect(messages).not.toContain('chat.group_name != \'\'')
    expect(handlers).toContain('resolveMessageSession')
    expect(handlers).toContain('failPendingSend')
    expect(handlers).toContain('isNapcatDummyPeer')
  })

  it('sends the source group when messaging a temp session', () => {
    expect(sendUtil).toContain('resolvePrivateSendTarget')
    expect(sendUtil).toContain('send_private_msg')
    expect(sendUtil).not.toContain('send_temp_msg')
    expect(chat).toContain('chatHistoryRequestParams')
  })

  it('keeps live temp messages in RAM when switching sessions', () => {
    expect(workspace).toContain('switchSessionMessageList')
    expect(workspace).toMatch(/chat\.messageList = restored/)
    expect(appUtil).not.toMatch(/chatStore\.messageList = \[\]/)
    expect(handlers).toContain('appendSessionMessages')
    expect(handlers).toContain('rememberSessionMessages')
    expect(handlers).toMatch(/chatStore\.messageList\.length > 0/)
  })
})
