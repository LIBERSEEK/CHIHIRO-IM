import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { buildOutreachDraft, callOutreachTool, outreachToolDefinitions, toCard } from '../src/mcp/outreach-card.mjs'

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

test('outreach tools do not include start', () => {
  const names = outreachToolDefinitions().map((tool) => tool.name)
  assert.deepEqual(names, ['outreach_schema', 'outreach_draft', 'outreach_get'])
  assert.equal(names.includes('outreach.start'), false)
})

test('draft refuses a card until required fields are present', () => {
  const judged = buildOutreachDraft({ audience: '使用 Codex 的人', tags: ['Codex'] })
  assert.equal(judged.ok, false)
  assert.deepEqual(judged.missing, ['产品 / 服务', '能提供的价值', '语气', '排除词'])
})

test('draft ignores an account supplied by the model', () => {
  const judged = buildOutreachDraft({ ...ready, accountId: 'douyin:from-model' })
  assert.equal(judged.ok, true)
  assert.equal(judged.brief.accountId, '')
  assert.equal(judged.card.kind, 'chihiro.card')
  assert.equal(judged.card.actions[0].id, 'start')
  assert.equal(judged.card.actions[0].path, '/api/runtime/outreach/brief/start')
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
  const saved = await callOutreachTool('outreach_draft', { ...ready, accountId: 'douyin:from-model' }, api)
  assert.equal(saved.kind, 'chihiro.card')
  assert.equal(saved.value.tone, '像路过的同行')
  assert.equal(saved.value.offer, ready.offer)
  assert.equal(saved.value.benefit, ready.benefit)
  assert.equal(saved.value.goal, ready.goal)
  assert.deepEqual(saved.value.tags, ['Codex', 'Claude', 'Grok'])
  assert.equal(store.get(saved.draftId).accountId, '')
  const again = await callOutreachTool('outreach_get', { draftId: saved.draftId }, api)
  assert.equal(again.draftId, saved.draftId)
  await assert.rejects(
    () => callOutreachTool('outreach_draft', { audience: '只说了人群' }, api),
    /还缺这些才能出任务卡/,
  )
})

test('the workbench skill body matches the skill file', () => {
  const source = readFileSync(new URL('../../frontend/src/modules/agent/session-skills.ts', import.meta.url), 'utf8')
  const skill = skillBody('social-comment-outreach')
  const sent = templateBody(source, 'const SKILL_BODY = `', '`\n\nconst STORAGE_KEY')
  assert.equal(sent, skill)
  assert.match(sent, /对含糊的人群用一句话确认/)
  assert.match(sent, /进入一场已经开始的讨论/)
  assert.match(sent, /platform 为 xiaohongshu/)
  assert.match(sent, /outreach_schema/)
  assert.doesNotMatch(sent, /outreach\.schema/)
  assert.doesNotMatch(sent, /小红书获客/)
})

function skillBody(name) {
  const skill = readFileSync(new URL(`../../skills/${name}/SKILL.md`, import.meta.url), 'utf8')
  return skill.split('---').slice(2).join('---').trim()
}

function templateBody(source, marker, next) {
  const start = source.indexOf(marker)
  const end = source.indexOf(next, start + marker.length)
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  return source.slice(start + marker.length, end).replaceAll('\\`', '`').trim()
}

test('xiaohongshu drafts keep the platform on the card', () => {
  const judged = buildOutreachDraft({ ...ready, platform: 'xiaohongshu' })
  assert.equal(judged.ok, true)
  assert.equal(judged.brief.platform, 'xiaohongshu')
  assert.equal(judged.card.value.platform, 'xiaohongshu')
  const kept = buildOutreachDraft({ ...ready, draftId: judged.brief.id }, judged.brief)
  assert.equal(kept.brief.platform, 'xiaohongshu')
  assert.equal(buildOutreachDraft(ready).brief.platform, 'douyin')
})

test('bilibili drafts keep the platform on the card', () => {
  const judged = buildOutreachDraft({ ...ready, platform: 'bilibili' })
  assert.equal(judged.ok, true)
  assert.equal(judged.brief.platform, 'bilibili')
  assert.equal(judged.card.value.platform, 'bilibili')
})

test('toCard drops the start action after the task has started', () => {
  const card = toCard({ id: 'b1', status: 'started', audience: '人群够长', tags: ['Codex'], excludes: [], tone: '像路过的同行' })
  assert.deepEqual(card.actions, [])
  assert.equal(card.status, 'started')
})
