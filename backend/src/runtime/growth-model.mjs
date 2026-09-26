import { buildChatRequestFlags, reduceChatStream } from './bot-suggest.mjs'

export function commentCompletionBody(prompt, { sessionId = 'chihiro-growth', provider = '', model = '' } = {}) {
  const body = {
    username: 'chihiro-growth',
    session_id: sessionId,
    message: [{ type: 'plain', text: String(prompt || '') }],
    flags: { ...buildChatRequestFlags(true), enable_default_system_prompt: false, enable_inline_genui: false },
  }
  if (provider) body.selected_provider = provider
  if (model) body.selected_model = model
  return body
}

export async function completeWithAstrbot(astrbot, prompt, { sessionId = 'chihiro-growth', provider = '', model = '' } = {}) {
  const text = String(prompt || '').trim()
  if (!text || !astrbot?.ensure || !astrbot?.mintDashboardToken) return ''
  try {
    await astrbot.ensure()
    const token = astrbot.mintDashboardToken()
    const base = String(astrbot.url || '').replace(/\/$/, '')
    if (!base || !token) return ''
    const response = await fetch(`${base}/api/v1/chat`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      body: JSON.stringify(commentCompletionBody(text, { sessionId, provider, model })),
      signal: AbortSignal.timeout(45000),
    })
    const body = await response.text()
    if (!response.ok) return ''
    return reduceChatStream(body).text || ''
  } catch {
    return ''
  }
}
