import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const composer = readFileSync(new URL('./src/components/user/UserComposer.vue', import.meta.url), 'utf8')

describe('composer focus', () => {
  it('opts the contenteditable input into text selection under native IM user-select:none', () => {
    expect(composer).toContain('-webkit-user-select: text')
    expect(composer).toContain('user-select: text')
    expect(composer).toContain('tabindex="0"')
    expect(composer).toContain('placeCaretInInput')
  })
})
