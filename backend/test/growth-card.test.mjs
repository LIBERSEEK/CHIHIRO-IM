import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { buildGrowthDraft, callGrowthTool, growthToolDefinitions, toCard } from '../src/mcp/growth-card.mjs'

const ready = {
  audience: '使用 Codex / Claude / Grok 的人群',
  offer: '面向 AI 用户的咨询服务',
  benefit: '帮助团队比较不同模型并选出合适工作流',
  goal: '和正在选模型的团队讨论他们的具体工作流',
  tags: ['Codex', 'Claude', 'Grok'],
  excludes: [],
  tone: '像路过的同行',
  interaction: 'comment',
  maxCount: 10,
  form: 'text',
}

test('growth tools do not include start', () => {
  const names = growthToolDefinitions().map((tool) => tool.name)
  assert.deepEqual(names, ['growth_schema', 'growth_draft', 'growth_get'])
  assert.equal(names.includes('growth.start'), false)
})

test('draft refuses a card until required fields are present', () => {
  const judged = buildGrowthDraft({ audience: '使用 Codex 的人', tags: ['Codex'] })
  assert.equal(judged.ok, false)
  assert.deepEqual(judged.missing, ['产品 / 服务', '能提供的价值', '语气', '排除词'])
})

test('draft ignores an account supplied by the model', () => {
  const judged = buildGrowthDraft({ ...ready, accountId: 'douyin:from-model' })
  assert.equal(judged.ok, true)
  assert.equal(judged.brief.accountId, '')
  assert.equal(judged.card.kind, 'chihiro.card')
  assert.equal(judged.card.actions[0].id, 'start')
  assert.equal(judged.card.actions[0].path, '/api/runtime/growth/brief/start')
})

test('draft tool saves through the brief api and get reads that id', async () => {
  const store = new Map()
  const api = async (method, path, body) => {
    const url = new URL(path, 'http://chihiro.local')
    if (method === 'POST') {
      store.set(body.brief.id, body.brief)
      return { brief: body.brief }
    }
    const brief = store.get(url.searchParams.get('id'))
    if (!brief) throw new Error('not_found')
    return { brief }
  }
  const saved = await callGrowthTool('growth_draft', { ...ready, accountId: 'douyin:from-model' }, api)
  assert.equal(saved.kind, 'chihiro.card')
  assert.equal(saved.value.tone, '像路过的同行')
  assert.equal(saved.value.offer, ready.offer)
  assert.equal(saved.value.benefit, ready.benefit)
  assert.equal(saved.value.goal, ready.goal)
  assert.deepEqual(saved.value.tags, ['Codex', 'Claude', 'Grok'])
  assert.equal(store.get(saved.draftId).accountId, '')
  const again = await callGrowthTool('growth_get', { draftId: saved.draftId }, api)
  const aliased = await callGrowthTool('growth.draft', { ...ready, draftId: saved.draftId }, api)
  assert.equal(aliased.draftId, saved.draftId)
  assert.equal(again.draftId, saved.draftId)
  await assert.rejects(
    () => callGrowthTool('growth_draft', { audience: '只说了人群' }, api),
    /还缺这些才能出任务卡/,
  )
})

test('the workbench skill body matches the skill file', () => {
  const skill = readFileSync(new URL('../../skills/douyin-comment-growth/SKILL.md', import.meta.url), 'utf8')
  const body = skill.split('---').slice(2).join('---').trim()
  const source = readFileSync(new URL('../../frontend/src/modules/agent/session-skills.ts', import.meta.url), 'utf8')
  const marker = 'const SKILL_BODY = `'
  const start = source.indexOf(marker)
  const end = source.indexOf('`\n\nconst STORAGE_KEY', start)
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  const sent = source.slice(start + marker.length, end).replaceAll('\\`', '`').trim()
  assert.equal(sent, body)
  assert.match(sent, /对含糊的人群用一句话确认/)
  assert.match(sent, /growth_schema/)
  assert.doesNotMatch(sent, /growth\.schema/)
})

test('toCard drops the start action after the task has started', () => {
  const card = toCard({ id: 'b1', status: 'started', audience: '人群够长', tags: ['Codex'], excludes: [], tone: '像路过的同行' })
  assert.deepEqual(card.actions, [])
  assert.equal(card.status, 'started')
})
