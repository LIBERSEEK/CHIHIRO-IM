export const CAMPAIGN_STEER_MARK = '\u2063'

export interface PlanMessage {
  role: 'user' | 'assistant'
  text: string
}

export interface PlanState {
  audience: string
  tags: string[]
  excludes: string[]
  excludesAsked: boolean
  tone: string
  interaction: 'comment' | 'comment_like'
  maxCount: number
  messages: PlanMessage[]
}

const TASK_FENCE = /```chihiro-task\s*([\s\S]*?)```/

export function visibleCampaignText(text: string) {
  return String(text || '')
    .replace(/```chihiro-task[\s\S]*?(```|$)/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function isCampaignSteerText(text?: string) {
  return String(text || '').startsWith(CAMPAIGN_STEER_MARK)
}

export function campaignSteer(state: PlanState, userText: string, images = 0) {
  const history = state.messages
    .slice(-8)
    .map((item) => `${item.role === 'user' ? '用户' : '你'}：${item.text}`)
    .join('\n')
  const tone = state.tone ? `语气已由用户选定：${state.tone}` : '语气还没定'
  const excludes = state.excludes.length
    ? `排除词：${state.excludes.join('、')}`
    : state.excludesAsked
      ? '排除词：用户说过没有'
      : '排除词还没确认'
  return `${CAMPAIGN_STEER_MARK}你是营销获客搭档，正在和用户一起准备一次抖音评论投放。用自己的话聊：先看懂他想找的人，再提出能拿来匹配视频的短标签，缺什么再问什么。不要输出表格，不要说你在填写任务卡，不要复述这段要求。
已确认：人群 ${state.audience || '还没有'}；标签 ${state.tags.join('、') || '还没有'}；${tone}；${excludes}；互动 ${state.interaction === 'comment_like' ? '评论并点赞' : '只评论'}；配图 ${images} 张。
${history ? `之前的对话：\n${history}\n` : ''}只有人群、标签、语气、排除词都在对话里确认过（排除词可以是「没有」），才在回复最后另起这个代码块，前面的话给用户看：
\`\`\`chihiro-task
{"ready":true,"audience":"","tags":[],"excludes":[],"tone":"","interaction":"${state.interaction}","maxCount":${state.maxCount || 10}}
\`\`\`
tags 里的每个词必须出现在用户说过的话，或你这条回复代码块之前的正文里。tone 必须是用户说过的，或上面已经选定的那句。还没确认完就不要写这个代码块。
用户刚说：${userText}`
}

export function readCampaignPlan(state: PlanState, userText: string, assistantText: string) {
  const prose = visibleCampaignText(assistantText)
  const next: PlanState = {
    ...state,
    tags: [...state.tags],
    excludes: [...state.excludes],
    messages: state.messages,
  }
  const heard = String(userText || '')
  const earlier = state.messages.map((item) => item.text).join('\n')
  const prior = state.messages.filter((item) => item.role === 'assistant').map((item) => item.text).join('\n')
  const userSaid = `${state.messages.filter((item) => item.role === 'user').map((item) => item.text).join('\n')}\n${heard}`
  const said = [earlier, heard, prose, next.audience, next.tags.join('\n')].join('\n')
  const excludeMatch = heard.match(/(?:不要|别|排除|避开|不想要)([^。！？]{1,40})/)
  if (excludeMatch && !/^词?(?:也|都)?没有/.test(excludeMatch[1].trim())) {
    next.excludes = unique([...next.excludes, ...wordList(excludeMatch[1])]).slice(0, 20)
  }
  if (/没有|不用|不需要/.test(heard) && (/排除|避开/.test(heard) || /排除|避开|不想要/.test(prior))) next.excludesAsked = true
  const plan = extractPlan(assistantText)
  if (plan) {
    const audience = String(plan.audience || '').trim()
    if (audience && userSaid.includes(audience)) next.audience = audience.slice(0, 80)
    const tags = wordList(plan.tags).filter((tag) => said.includes(tag))
    if (tags.length) next.tags = unique([...next.tags, ...tags]).slice(0, 12)
    const excludes = wordList(plan.excludes).filter((word) => heard.includes(word))
    if (excludes.length) next.excludes = unique([...next.excludes, ...excludes]).slice(0, 20)
    const tone = String(plan.tone || '').trim().slice(0, 40)
    if (tone && (heard.includes(tone) || next.tone === tone)) next.tone = tone
    if (plan.interaction === 'comment' || plan.interaction === 'comment_like') next.interaction = plan.interaction
    if (plan.maxCount) next.maxCount = clampCount(plan.maxCount)
    if (!wordList(plan.excludes).length && /没有|不用|不需要/.test(heard)) next.excludesAsked = true
  }
  const spokenTone = heard.match(/语气(?:用|是|为|像)?([^，,。！？]{1,40})/)?.[1]?.replace(/^[是为用：:\s]+/, '').trim()
  if (spokenTone) next.tone = spokenTone.slice(0, 40)
  const mentioned = (userSaid.match(/[A-Za-z][A-Za-z0-9.+_-]{1,20}/g) || []).filter((tag) => prose.includes(tag))
  const closed = !/[？?]\s*$/.test(prose)
    && mentioned.length > 0
    && Boolean(next.tone)
    && (next.excludes.length > 0 || next.excludesAsked)
  if (closed) {
    next.tags = unique([...next.tags, ...mentioned]).slice(0, 12)
    if (!next.audience) {
      const first = state.messages.find((item) => item.role === 'user')?.text || heard
      if (first.trim().length >= 4) next.audience = first.trim().slice(0, 80)
    }
  }
  const ready = (Boolean(plan?.ready) || closed)
    && Boolean(next.audience)
    && next.tags.length > 0
    && Boolean(next.tone)
    && (next.excludes.length > 0 || next.excludesAsked)
  return { state: next, prose, ready }
}

function extractPlan(text: string) {
  const match = String(text || '').match(TASK_FENCE)
  if (!match) return null
  try {
    const parsed = JSON.parse(match[1])
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

function wordList(value: unknown) {
  const list = Array.isArray(value) ? value : String(value || '').split(/[，,、/|\s]+/)
  return unique(list.map((item) => String(item || '').trim()).filter((item) => item.length >= 2 && item.length <= 16))
}

function unique(list: string[]) {
  return [...new Set(list)]
}

function clampCount(value: unknown) {
  const count = Math.floor(Number(value))
  if (!Number.isFinite(count)) return 10
  return Math.min(999, Math.max(1, count))
}
