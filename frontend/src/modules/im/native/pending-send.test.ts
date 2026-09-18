import { describe, expect, it } from 'vitest'
import { confirmPendingSend, failPendingSend, findLatestPendingSend, isPendingSend } from './pending-send'

describe('pending send confirmation', () => {
  it('finds the first message in a new chat', () => {
    const first = { fake_msg: true, revoke: true, message_id: 'uuid' }
    expect(findLatestPendingSend([first])).toBe(first)
    expect(findLatestPendingSend([{ fake_msg: false }, first])).toBe(first)
  })

  it('ignores already confirmed placeholders', () => {
    expect(findLatestPendingSend([
      { fake_msg: false, revoke: true },
      { fake_msg: undefined },
    ])).toBeNull()
    expect(isPendingSend({ fake_msg: false })).toBe(false)
  })

  it('clears the gray pre-send state', () => {
    const msg = { fake_msg: true, revoke: true, message_id: 'uuid' }
    confirmPendingSend(msg, 42)
    expect(msg).toMatchObject({ message_id: 42, fake_msg: undefined, revoke: false })
  })

  it('stops the spinner when send fails without inventing a message id', () => {
    const msg = { fake_msg: true, revoke: true, message_id: 'uuid' }
    failPendingSend(msg)
    expect(msg).toMatchObject({ message_id: 'uuid', fake_msg: undefined, revoke: false })
  })
})
