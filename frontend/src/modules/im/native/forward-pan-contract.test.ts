import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const chat = readFileSync(new URL('./src/pages/user/UserChat.vue', import.meta.url), 'utf8')
const css = readFileSync(new URL('./src/assets/css/chat.css', import.meta.url), 'utf8')

describe('forward message overlay', () => {
  it('centers 转发消息 inside UserChat like 群资料 and closes on ESC', () => {
    expect(css).toContain('.forward-pan {')
    expect(css).toContain('align-items: center')
    expect(css).toContain('justify-content: center')
    expect(css).not.toMatch(/\.forward-pan[\s\S]{0,400}margin:\s*50vh/)
    expect(chat).toContain('v-esc="cancelForward"')
    expect(chat).toContain('tags.value.showForwardPan')
    expect(chat).toContain('cancelForward()')
    expect(chat).toContain('.user-skin.chat-pan > .forward-pan')
    expect(chat).toContain('right: var(--chihiro-session-rail-width)')
  })

  it('lists temp sessions and insets the search field', () => {
    expect(chat).toContain('collectForwardContacts')
    expect(chat).toContain('resolveForwardTarget')
    expect(chat).toContain("$t('临时会话')")
    expect(chat).toMatch(/\.user-skin\.chat-pan > \.forward-pan > div\.card > input[\s\S]{0,120}margin:\s*0 12px/)
    expect(chat).toMatch(/\.user-skin\.chat-pan > \.forward-pan > div\.card > div[\s\S]{0,80}padding:\s*0 12px 12px/)
    expect(css).toMatch(/\.forward-pan > div\.card > input[\s\S]{0,160}margin:\s*0 10px/)
    expect(css).toMatch(/\.forward-pan > div\.card > div[\s\S]{0,160}padding:\s*0 10px 10px/)
  })
})
