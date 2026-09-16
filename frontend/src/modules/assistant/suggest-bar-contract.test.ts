import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const bar = readFileSync(new URL('./SuggestBar.vue', import.meta.url), 'utf8')

describe('ChatBot suggestion chip layout', () => {
  it('turns auto-send into a countdown ring with a close control beside send', () => {
    expect(bar).toContain('chihiro-suggest-ring')
    expect(bar).toContain('chihiro-suggest-close')
    expect(bar).toContain('isTicking(reply)')
    expect(bar).toContain('suggest.cancelCountdown()')
    expect(bar).not.toContain('chihiro-suggest-cancel')
    expect(bar).not.toContain('countdownSec')
  })

  it('keeps bubble and composer chips the same 32px height with matching 24px controls', () => {
    expect(bar).toContain('height: 32px')
    expect(bar).toContain('flex: 0 0 24px')
    expect(bar).toContain('width: 12px')
    expect(bar).toContain('chihiro-suggest-icon')
    expect(bar).not.toContain('width: 28px')
    expect(bar).not.toContain('box-shadow:')
  })

  it('keeps bubble options in a wrapping row instead of a 420px stack', () => {
    expect(bar).toContain('flex-flow: row wrap')
    expect(bar).toContain('width: max-content')
    expect(bar).not.toContain('max-width: min(420px, 100%)')
  })
})
