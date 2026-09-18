import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const chat = readFileSync(new URL('./src/pages/user/UserChat.vue', import.meta.url), 'utf8')

describe('ChatBot unconfigured setup hops to workbench model config', () => {
  it('opens 模型配置 instead of an empty AstrBot config picker', () => {
    expect(chat).toContain('needsAstrBotSetup')
    expect(chat).toContain('去配置')
    expect(chat).toContain("selectList('workbench')")
    expect(chat).toContain('openProviderWorkspace')
    expect(chat).toContain('createHostedAgentNavigation')
    expect(chat).toContain('v-else-if="suggest.needsAstrBotSetup"')
    expect(chat).toContain('noteThemActivity')
    expect(chat).toContain('suggestSnapshot')
    expect(chat).toContain('atSelf')
    expect(chat).toContain('senderId')
  })

  it('opens the settings menu immediately while AstrBot starts', () => {
    expect(chat).toContain('正在启动 AstrBot')
    expect(chat).toContain('!suggest.configsReady')
    expect(chat).toContain('chihiro-bot-loading')
    expect(chat).not.toContain('await suggest.loadConfigs()')
  })
})
