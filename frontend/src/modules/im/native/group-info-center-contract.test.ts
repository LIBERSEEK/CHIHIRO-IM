import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const info = readFileSync(new URL('./src/pages/user/UserInfo.vue', import.meta.url), 'utf8')
const chat = readFileSync(new URL('./src/pages/user/UserChat.vue', import.meta.url), 'utf8')

describe('group info overlay', () => {
  it('centers 群资料 inside UserChat instead of viewport-relative 50vh', () => {
    expect(info).toContain('align-items: center')
    expect(info).toContain('justify-content: center')
    expect(info).not.toContain('margin: 50vh 0 0 50%')
    expect(chat).toContain('.user-skin.chat-pan > .chat-info-pan')
    expect(chat).toContain('right: var(--chihiro-session-rail-width)')
  })
})
