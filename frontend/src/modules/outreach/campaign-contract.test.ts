import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const chatInput = readFileSync(new URL('../agent/native/src/components/chat/ChatInput.vue', import.meta.url), 'utf8')
const userChat = readFileSync(new URL('../agent/native/src/components/user/UserChat.vue', import.meta.url), 'utf8')
const thread = readFileSync(new URL('./components/CampaignThread.vue', import.meta.url), 'utf8')

describe('outreach campaign composer', () => {
  it('keeps the workbench composer and adds the campaign menu, library, and task card', () => {
    expect(chatInput).toContain('营销获客')
    expect(chatInput).not.toContain('小红书获客')
    expect(chatInput).toContain('sessionSkills.toggle')
    expect(chatInput).toContain('从电脑添加')
    expect(chatInput).toContain('从资料库添加')
    expect(chatInput).toContain('<CampaignComposer part="panel"')
    expect(chatInput).not.toContain('<CampaignComposer part="tools" />')
    expect(userChat).toContain('sessionSkills.prompt(sessionId)')
    expect(userChat).not.toContain('CampaignThread')
    expect(userChat).not.toContain('campaign.finishTurn(')
    expect(userChat).not.toContain('campaign.steer(')
    expect(userChat).toContain('v-if="!loadingMessages && activeMessages.length"')
    expect(userChat).toContain('资料库')
    expect(userChat).toContain('添加到资料库')
    expect(thread).toContain('种子标签')
    expect(thread).toContain('启动')
  })
})
