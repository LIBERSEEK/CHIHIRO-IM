import { describe, expect, it } from 'vitest'
import { messageBlocks } from './native/src/composables/useMessages'
import { commentModelOptions, parseChihiroCard, shouldAdoptChatImages } from './schema-card'

const card = {
  kind: 'chihiro.card',
  draftId: 'b1',
  title: '任务卡',
  schema: { fields: [{ key: 'audience', label: '人群', type: 'text' }] },
  value: { audience: '使用 Codex 的人' },
  actions: [{ id: 'start', label: '启动', method: 'POST', path: '/api/runtime/outreach/brief/start' }],
}

describe('parseChihiroCard', () => {
  it('reads a card from a tool result string', () => {
    expect(parseChihiroCard(JSON.stringify(card))?.draftId).toBe('b1')
  })

  it('unwraps an MCP content envelope', () => {
    const wrapped = { content: [{ type: 'text', text: JSON.stringify(card) }] }
    expect(parseChihiroCard(wrapped)?.title).toBe('任务卡')
  })

  it('adopts chat pictures onto an image card that does not have any yet', () => {
    expect(shouldAdoptChatImages({ form: 'image', ids: [], locked: false, remembered: false, sourceCount: 3 })).toBe(true)
    expect(shouldAdoptChatImages({ form: 'image', ids: ['abc123abc123'], locked: false, remembered: false, sourceCount: 3 })).toBe(false)
    expect(shouldAdoptChatImages({ form: 'text', ids: [], locked: false, remembered: false, sourceCount: 3 })).toBe(false)
    expect(shouldAdoptChatImages({ form: 'image', ids: [], locked: true, remembered: false, sourceCount: 3 })).toBe(false)
    expect(shouldAdoptChatImages({ form: 'image', ids: [], locked: false, remembered: true, sourceCount: 3 })).toBe(false)
  })

  it('reads enabled chat models for the task card', () => {
    expect(commentModelOptions({
      data: {
        providers: [
          { id: 'openai/grok-4.3', model: 'grok-4.3', enable: true },
          { id: 'BOFT Gemini/gemini-3.8-flash', model: 'gemini-3.8-flash', enable: true },
          { id: 'bad\nid', model: 'x' },
          { model: 'missing' },
          { id: 'BOFT/gpt-5.5', model: 'gpt-5.5', enable: false },
        ],
      },
    })).toEqual([
      { provider: 'openai/grok-4.3', model: 'grok-4.3', label: 'grok-4.3' },
      { provider: 'BOFT Gemini/gemini-3.8-flash', model: 'gemini-3.8-flash', label: 'gemini-3.8-flash' },
    ])
  })

  it('ignores ordinary tool output', () => {
    expect(parseChihiroCard('{"ok":true}')).toBeNull()
  })

  it('lifts a saved task card out of the collapsed tool trace', () => {
    const blocks = messageBlocks({
      type: 'bot',
      message: [
        { type: 'think', think: '准备出卡' },
        {
          type: 'tool_call',
          tool_calls: [
            { id: 'schema', name: 'outreach_schema', result: JSON.stringify({ kind: 'chihiro.card', schema: card.schema }) },
            { id: 'draft', name: 'outreach_draft', result: JSON.stringify(card) },
          ],
        },
        { type: 'plain', text: '卡片已就绪' },
      ],
    })
    const thinking = blocks.filter((block) => block.kind === 'thinking')
    const content = blocks.filter((block) => block.kind === 'content')
    const hiddenTools = thinking.flatMap((block) => block.parts.flatMap((part) => part.tool_calls || []))
    const shownTools = content.flatMap((block) => block.parts.flatMap((part) => part.tool_calls || []))
    expect(hiddenTools.map((tool) => tool.name)).toEqual(['outreach_schema'])
    expect(shownTools.map((tool) => tool.name)).toEqual(['outreach_draft'])
    expect(content.some((block) => block.parts.some((part) => part.type === 'plain'))).toBe(true)
  })
})
