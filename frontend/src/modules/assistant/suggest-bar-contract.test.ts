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

  it('keeps the sparkle mark larger than the chip text', () => {
    expect(bar).toMatch(/\.chihiro-suggest-mark \{[\s\S]*font-size: 18px/)
    expect(bar).toMatch(/\.chihiro-suggest-chip \{[\s\S]*font-size: 13px/)
  })

  it('keeps bubble options in a wrapping row instead of a 420px stack', () => {
    expect(bar).toContain('flex-flow: row wrap')
    expect(bar).toContain('width: max-content')
    expect(bar).not.toContain('max-width: min(420px, 100%)')
  })

  it('renders a typed read overlay on the bubble before reply chips', () => {
    expect(bar).toContain('chihiro-read-card')
    expect(bar).toContain('对方在问什么？')
    expect(bar).toContain('现在该不该开口？')
    expect(bar).toContain('建议动作')
    expect(bar).toContain('先别回，不要硬写客套。')
    expect(bar).toContain('chihiro-read-line')
  })

  it('keeps the previous pill skeleton while generating', () => {
    expect(bar).toContain('chihiro-suggest-skeleton')
    expect(bar).toContain('v-if="suggest.generating"')
    expect(bar).toContain('border-radius: 999px')
    expect(bar).toContain('height: 32px')
    expect(bar).not.toContain('chihiro-read-card is-loading')
    expect(bar).not.toContain('min-height: 72px')
  })
})
