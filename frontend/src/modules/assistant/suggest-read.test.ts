import { expect, it } from 'vitest'
import {
  formatReadLine,
  parseSuggestRead,
  shouldHoldRead,
  visibleOptions,
} from './suggest-read'

it('parses choice/score/noul read blocks and fills missing options', () => {
  const read = parseSuggestRead({
    read: {
      intent: { id: 'inquire', options: [{ id: 'inquire', p: 0.72 }, { id: 'smalltalk', p: 0.18 }] },
      speakNow: { yes: 0.82, no: 0.18 },
      action: { id: 'follow_up', options: [{ id: 'follow_up', p: 0.61 }, { id: 'brief', p: 0.24 }, { id: 'escalate', p: 0.15 }] },
      urgency: 6,
      note: '先问预算',
    },
  })
  expect(read?.intent.id).toBe('inquire')
  expect(read?.intent.options).toHaveLength(6)
  expect(read?.action.id).toBe('follow_up')
  expect(read?.speakNow.yes).toBe(0.82)
  expect(read?.urgency).toBe(6)
  expect(formatReadLine(read!)).toBe('询价 80% · 建议补问 · 紧急 6/10')
  expect(visibleOptions(read!.intent).map((item) => item.id)).toEqual(['inquire', 'smalltalk'])
  expect(shouldHoldRead(read)).toBe(false)
})

it('treats hold, escalate, and low speakNow as a stop gate', () => {
  expect(shouldHoldRead(parseSuggestRead({ read: { intent: 'smalltalk', speakNow: 0.2, action: 'brief', urgency: 1 } }))).toBe(true)
  expect(shouldHoldRead(parseSuggestRead({ read: { intent: 'complaint', speakNow: { yes: 0.9, no: 0.1 }, action: 'escalate', urgency: 8 } }))).toBe(true)
  expect(shouldHoldRead(parseSuggestRead({ read: { intent: 'confirm', speakNow: 0.9, action: 'hold', urgency: 2 } }))).toBe(true)
  expect(formatReadLine(parseSuggestRead({ read: { intent: 'smalltalk', speakNow: 0.1, action: 'hold', urgency: 1 } })!)).toBe('先别回 · 闲聊 100%')
})

it('ignores empty or unknown payloads', () => {
  expect(parseSuggestRead({ replies: [] })).toBeNull()
  expect(parseSuggestRead({ read: {} })).toBeNull()
})
