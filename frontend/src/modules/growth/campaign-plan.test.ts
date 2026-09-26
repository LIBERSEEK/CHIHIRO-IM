import { describe, expect, it } from 'vitest'
import { campaignSteer, isCampaignSteerText, readCampaignPlan, visibleCampaignText, type PlanState } from './campaign-plan'

const empty: PlanState = {
  audience: '',
  tags: [],
  excludes: [],
  excludesAsked: false,
  tone: '',
  interaction: 'comment',
  maxCount: 10,
  messages: [],
}

describe('campaign plan', () => {
  it('keeps the task card closed until the agent confirms the plan', () => {
    const asked = readCampaignPlan(
      empty,
      '帮我找到使用 Codex / Claude / Grok 的人群',
      '我先按使用 Codex、Claude、Grok 的人来理解。可以拿来匹配的标签是 Codex、Claude、Grok。评论想用什么语气？有没有要避开的词？',
    )
    expect(asked.ready).toBe(false)
    expect(asked.state.tags).toEqual([])
    expect(asked.prose).not.toContain('chihiro-task')
  })

  it('accepts a finished plan only from words the conversation actually contains', () => {
    const talking: PlanState = {
      ...empty,
      messages: [
        { role: 'user', text: '帮我找到使用 Codex / Claude / Grok 的人群' },
        { role: 'assistant', text: '有没有要避开的词？' },
      ],
    }
    const reply = [
      '那就按使用 Codex / Claude / Grok 的人群来，标签用 Codex、Claude、Grok，语气像路过的同行，排除词先空着。',
      '```chihiro-task',
      '{"ready":true,"audience":"使用 Codex / Claude / Grok 的人群","tags":["Codex","Claude","Grok","股票"],"excludes":[],"tone":"像路过的同行","interaction":"comment","maxCount":10}',
      '```',
    ].join('\n')
    const done = readCampaignPlan(
      { ...talking, tone: '像路过的同行' },
      '语气用像路过的同行，排除词没有',
      reply,
    )
    expect(done.ready).toBe(true)
    expect(done.state.audience).toBe('使用 Codex / Claude / Grok 的人群')
    expect(done.state.tags).toEqual(['Codex', 'Claude', 'Grok'])
    expect(done.state.excludesAsked).toBe(true)
    expect(done.prose).not.toContain('股票')
    expect(done.prose).not.toContain('chihiro-task')
  })

  it('opens the card after the agent closes the conversation, not on the first question', () => {
    const first = readCampaignPlan(
      empty,
      '帮我找到使用 Codex / Claude / Grok 的人群',
      '标签直接用 Codex、Claude、Grok。语气像路过的同行，排除词也没得。那咱们就这样准备？',
    )
    expect(first.ready).toBe(false)
    const second = readCampaignPlan(
      {
        ...empty,
        messages: [
          { role: 'user', text: '帮我找到使用 Codex / Claude / Grok 的人群' },
          { role: 'assistant', text: '那咱们就这样准备？' },
        ],
      },
      '语气用像路过的同行，排除词没有',
      '好的，语气就用像路过的同行，排除词也没有。那咱们就按这个来，标签 Codex、Claude、Grok。',
    )
    expect(second.ready).toBe(true)
    expect(second.state.tags).toEqual(['Codex', 'Claude', 'Grok'])
    expect(second.state.tone).toBe('像路过的同行')
    expect(second.state.excludesAsked).toBe(true)
  })

  it('hides the steering note from the visible transcript', () => {
    const steer = campaignSteer(empty, '找装修的人', 3)
    expect(isCampaignSteerText(steer)).toBe(true)
    expect(visibleCampaignText('先问一句。\n```chihiro-task\n{"ready":true}\n```')).toBe('先问一句。')
  })
})
