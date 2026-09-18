import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createBotHistory } from '../src/runtime/bot-history.mjs'

test('bot history pins in-progress turns and records sent chips', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'chihiro-bot-history-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  let clock = 1_000
  const history = createBotHistory({
    filePath: path.join(root, 'bot-history.json'),
    now: () => clock++,
  })
  const id = history.startTurn({
    accountId: 'qq:1', type: 'group', peerId: '9', lastMessageId: 'm1', trigger: 'auto', joinReason: 'question',
  })
  assert.equal(history.list('qq:1', 'group', '9')[0].inProgress, true)
  history.completeTurn(id, {
    replies: [{ id: '1', text: '我在', score: 0.9 }],
    summary: '我在的。',
    lookupExcerpt: 'LIBERSEEK/CHIHIRO stars=1',
  })
  history.note({ accountId: 'qq:1', type: 'group', peerId: '9', lastMessageId: 'm1', sent: '我在的。' })
  const [row] = history.list('qq:1', 'group', '9')
  assert.equal(row.inProgress, false)
  assert.equal(row.trigger, 'auto')
  assert.equal(row.joinReason, 'question')
  assert.equal(row.replies[0].text, '我在')
  assert.equal(row.sent, '我在的。')
  assert.match(row.lookupExcerpt, /CHIHIRO/)
  const id2 = history.startTurn({
    accountId: 'qq:1', type: 'group', peerId: '9', lastMessageId: 'm2', trigger: 'auto',
    peerExcerpt: 'them(Raven): 仓库里有什么',
    steps: [{ kind: 'recv', title: '开始处理本轮', detail: 'them(Raven): 仓库里有什么' }],
  })
  history.addStep(id2, { kind: 'query', title: '检索事实' })
  history.addStep(id2, { kind: 'act', title: '正在生成建议' })
  history.completeTurn(id2, {
    replies: [{ id: '1', text: 'README', score: 0.8 }],
    steps: [{ kind: 'reply', title: '生成了 1 条建议', detail: 'README' }],
  })
  const process = history.list('qq:1', 'group', '9')[0]
  assert.equal(process.peerExcerpt.includes('仓库'), true)
  assert.ok(process.steps.some((step) => step.title === '正在生成建议'))
  assert.ok(process.steps.some((step) => step.title === '生成了 1 条建议'))
  const digestId = history.startTurn({
    accountId: 'qq:1', type: 'group', peerId: '9', lastMessageId: 'm9', trigger: 'digest', joinReason: 'unread',
  })
  history.completeTurn(digestId, {
    summary: '群里在问降智',
    points: [{ id: '1', text: '小默问 5.6 不降智了', messageId: 'm9' }],
  })
  const digest = history.list('qq:1', 'group', '9')[0]
  assert.equal(digest.trigger, 'digest')
  assert.equal(digest.points[0].messageId, 'm9')
  history.note({ accountId: 'qq:1', type: 'group', peerId: '9', skipped: 'join', joinReason: 'skip', trigger: 'auto' })
  const items = history.list('qq:1', 'group', '9')
  assert.equal(items[0].skipped, 'join')
  const saved = JSON.parse(await readFile(path.join(root, 'bot-history.json'), 'utf8'))
  assert.ok(saved.sessions['qq:1:group:9'].length >= 2)
})
