import assert from 'node:assert/strict'
import test from 'node:test'
import { createBotActivity, sessionActivityKey } from '../src/runtime/bot-activity.mjs'

test('bot activity refcounts working sessions and snapshots keys', () => {
  let touches = 0
  const activity = createBotActivity({ touch: () => { touches += 1 } })
  assert.deepEqual(activity.snapshot(), {})
  activity.begin('qq:1', 'private', '2')
  activity.begin('qq:1', 'private', '2')
  assert.equal(touches, 1)
  assert.deepEqual(activity.snapshot(), { [sessionActivityKey('qq:1', 'private', '2')]: 'working' })
  activity.end('qq:1', 'private', '2')
  assert.equal(touches, 1)
  assert.equal(activity.snapshot()[sessionActivityKey('qq:1', 'private', '2')], 'working')
  activity.end('qq:1', 'private', '2')
  assert.equal(touches, 2)
  assert.deepEqual(activity.snapshot(), {})
})
