// Inspired by qq-live-digest's explainable rule pipeline; see docs/message-filter.md.
// No network or persistence: decisions belong to the analysis scope and policy.
export const FILTER_VERSION = 'group-filter-v1'
const FILLER = /^(?:嗯+|哦+|噢+|哈+|呵呵+|好+|好的|好滴|好嘞|收到|谢谢|感谢|辛苦了|笑死|早上好|早安|晚安|晚安啦|ok+|okay|\+1|打卡|签到)$/i
const QUESTION = /[?？]|(?:吗|嘛|么|呢)[。！!~～…]*$|请问|求问|怎么|如何|为什么|能不能|可不可以|有没有/
const BUSINESS = /预算|价格|报价|询价|采购|购买|套餐|交付|上线|私有化|部署|需求|希望|想要|反馈|准确率|故障|报错|太贵|太高|不支持|不满意|不用了|建议|经验|实测|刚测|决定|同意|不同意|拒绝|取消/
const DIRECTIVE = /请(?!问|教)|务必|必须|要求|截止|按时|通知|公告|@全体成员|全员/
const ACTION = /提交|填写|报名|缴费|领取|确认|核对|回复|接龙|上报|预约|下载|安装|完成|参加|办理|注册|部署|上线|开会/
const TIME = /今天|今日|今晚|明天|明日|后天|本周|下周|月底|\d{1,2}[:：]\d{2}|\d{1,2}月\d{1,2}日/
const MEDIA_ONLY = /^(?:\[(?:图片|文件|语音|视频|表情|合并转发|卡片消息|骰子|猜拳)\]\s*)+$/
const SYSTEM_ONLY = /^(?:撤回了一条消息|.+撤回了一条消息|.+加入了群聊|.+退出了群聊)$/
const CONTEXT_MS = 5 * 60 * 1000
const DEDUPE_MS = 24 * 60 * 60 * 1000
const SOCIAL_ONLY = /^(?:哈+|呵呵+|笑死|谢谢|感谢|辛苦了|早上好|早安|晚安|晚安啦|打卡|签到)$/

export function normalizeMessage(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message) || typeof message.text !== 'string') throw new Error('invalid_filter_message')
  return { ...message, text: message.text.normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\r\n?/g, '\n').trim() }
}

export function normalizeFilterOptions(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid_filter_options')
  const profile = raw.profile ?? 'analysis'
  if (!['analysis', 'notice'].includes(profile)) throw new Error('invalid_filter_profile')
  if (raw.dedupe != null && typeof raw.dedupe !== 'boolean') throw new Error('invalid_filter_dedupe')
  const normalizePolicy = (policy = {}) => {
    if (!policy || typeof policy !== 'object' || Array.isArray(policy)) throw new Error('invalid_filter_policy')
    const keywords = policy.keywords ?? []
    if (!Array.isArray(keywords) || keywords.length > 100 || keywords.some(word => typeof word !== 'string' || !word.trim() || word.length > 128)) throw new Error('invalid_filter_keywords')
    const senderRoles = policy.senderRoles ?? {}
    if (!senderRoles || typeof senderRoles !== 'object' || Array.isArray(senderRoles) || Object.values(senderRoles).some(role => !['admin', 'owner', 'member'].includes(role))) throw new Error('invalid_filter_sender_roles')
    const minScore = policy.minScore ?? 3
    if (!Number.isInteger(minScore) || minScore < 0 || minScore > 20) throw new Error('invalid_filter_min_score')
    return { keywords: [...new Set(keywords.map(word => word.trim().normalize('NFKC')))], senderRoles: { ...senderRoles }, minScore }
  }
  const groupPolicies = raw.groupPolicies ?? {}
  if (!groupPolicies || typeof groupPolicies !== 'object' || Array.isArray(groupPolicies) || Object.keys(groupPolicies).length > 200) throw new Error('invalid_filter_group_policies')
  return {
    profile, dedupe: raw.dedupe ?? true,
    groupPolicy: normalizePolicy(raw.groupPolicy),
    groupPolicies: Object.fromEntries(Object.entries(groupPolicies).map(([id, policy]) => [id, normalizePolicy(policy)])),
  }
}

export function extractFeatures(raw, policy = {}) {
  const { text, senderId } = normalizeMessage(raw)
  const compact = text.replace(/[\s。.!！~～…，,]+/g, '')
  return {
    isQuestion: QUESTION.test(text),
    isAcknowledgement: FILLER.test(compact),
    hasBusinessSignal: BUSINESS.test(text),
    hasLink: /https?:\/\/\S+/i.test(text),
    hasDirective: DIRECTIVE.test(text),
    hasAction: ACTION.test(text),
    hasTimeExpression: TIME.test(text),
    isMediaOnly: MEDIA_ONLY.test(text),
    isSystemOnly: SYSTEM_ONLY.test(text),
    isShort: [...compact].length <= 8,
    keywordHits: (policy.keywords || []).filter(word => text.toLowerCase().includes(word.toLowerCase())),
    isAuthority: Object.hasOwn(policy.senderRoles || {}, senderId) && ['admin', 'owner'].includes(policy.senderRoles[senderId]),
  }
}

function sameConversation(a, b) {
  return ['accountId', 'channel', 'groupId', 'conversationId'].every(key => a[key] === b[key])
}

function contextualReply(message, context) {
  return context.slice(-12).some(raw => {
    const previous = normalizeMessage(raw)
    const gap = message.messageAt - previous.messageAt
    return sameConversation(message, previous) && Number.isFinite(gap) && gap >= 0 && gap <= CONTEXT_MS
      && QUESTION.test(previous.text) && !MEDIA_ONLY.test(message.text)
  })
}

function classify(message, options, context) {
  const policy = Object.hasOwn(options.groupPolicies, message.groupId)
    ? options.groupPolicies[message.groupId] : options.groupPolicy
  const features = extractFeatures(message, policy)
  const reasons = []
  let score = 0
  const add = (condition, reason, weight) => { if (condition) { reasons.push(reason); score += weight } }
  add(features.keywordHits.length, 'group_keyword', 4)
  add(features.isQuestion, 'question', 2)
  add(features.hasBusinessSignal, 'business_signal', 3)
  add(features.hasLink, 'link', 1)
  add(features.hasDirective && features.hasAction, 'directive_action', 4)
  add(features.hasDirective && features.hasTimeExpression, 'notice_time', 2)
  add(features.hasDirective && features.isAuthority, 'authority_notice', 2)
  add(features.hasDirective && !features.isAcknowledgement, 'notice', 3)
  const reply = features.isShort && !SOCIAL_ONLY.test(message.text.replace(/[\s。.!！~～…，,]+/g, '')) && contextualReply(message, context)
  add(reply, 'contextual_reply', 2)
  let label = 'review'
  let confidence = 0.5
  if (!message.text || features.isMediaOnly || features.isSystemOnly) {
    label = 'noise'; confidence = 0.98; reasons.push(features.isMediaOnly ? 'media_placeholder' : features.isSystemOnly ? 'system_message' : 'empty_text')
  } else if (features.keywordHits.length || reply || (score > 0 && !features.isAcknowledgement)) {
    label = 'signal'; confidence = Math.min(0.9, 0.65 + score * 0.04)
  } else if (features.isAcknowledgement) {
    label = 'chatter'; confidence = 0.95; score = -6; reasons.push('acknowledgement')
  } else {
    reasons.push(features.isShort ? 'short_ambiguous' : 'unclassified_content')
  }
  const notice = features.keywordHits.length > 0 || (features.hasDirective && !features.isAcknowledgement && score >= policy.minScore)
  const included = options.profile === 'analysis' ? ['signal', 'review'].includes(label) : Boolean(notice && label === 'signal')
  if (options.profile === 'notice' && !included && !['noise', 'chatter'].includes(label)) reasons.push('notice_not_matched')
  return { label, confidence: Number(confidence.toFixed(2)), score, reasons, features, included, ruleVersion: FILTER_VERSION }
}

export function classifyMessage(raw, { context = [], ...options } = {}) {
  return classify(normalizeMessage(raw), normalizeFilterOptions(options), context)
}

export const classifyGroupMessage = classifyMessage

export function explainDecision(decision) {
  const labels = { signal: '有效信息', chatter: '闲聊', noise: '噪声', review: '待判断' }
  const reasons = {
    group_keyword: '命中群关键词', question: '问题或咨询', business_signal: '需求、反馈或业务线索',
    link: '包含链接', directive_action: '明确行动要求', notice_time: '通知时间线索', authority_notice: '配置的管理员通知',
    notice: '通知线索', contextual_reply: '同会话问题的短回复', media_placeholder: '只有媒体占位符，缺少可分析内容',
    system_message: '系统消息', empty_text: '空文本', acknowledgement: '确认或客套语',
    short_ambiguous: '短句含义不明，分析模式保留', unclassified_content: '未命中规则，分析模式保留', notice_not_matched: '未命中通知模式',
    duplicate_text: '重复文本合并到代表消息，原文保留',
  }
  return `${labels[decision.label]}：${decision.reasons.map(reason => reasons[reason] || reason).join('；')}`
}

// Conservative near-duplicate matching: preserve numbers, URLs and negation.
function matchText(text) { return text.toLowerCase().replace(/[\s。.!！~～…，,；;：:、]+/g, '') }
function anchors(text) {
  return JSON.stringify({
    numbers: text.match(/\d+(?:[.,]\d+)*|[零一二两三四五六七八九十百千万亿]+/g) || [],
    urls: text.match(/https?:\/\/\S+/gi) || [],
    negatives: text.match(/不|没|无|取消|拒绝/g) || [],
    relativeTimes: text.match(/今天|今日|今晚|明天|明日|明晚|大?后天|本周[一二三四五六日天]?|下周[一二三四五六日天]?|月底|周[一二三四五六日天]/g) || [],
  })
}
function grams(text) {
  const result = new Set()
  for (let i = 0; i < text.length - 2; i++) result.add(text.slice(i, i + 3))
  return result
}
function similar(left, right) {
  const a = matchText(left), b = matchText(right)
  // Identical short answers from different participants are independent evidence.
  if (Math.min(a.length, b.length) < 12) return false
  if (anchors(left) !== anchors(right)) return false
  if (a === b) return true
  if (Math.min(a.length, b.length) < 40 || Math.max(a.length, b.length) > 2000 || Math.min(a.length, b.length) / Math.max(a.length, b.length) < 0.95) return false
  const x = grams(a), y = grams(b)
  let shared = 0
  for (const value of x) if (y.has(value)) shared++
  return 2 * shared / (x.size + y.size) >= 0.96
}

export function dedupeMessages(rawMessages) {
  const messages = []
  const duplicates = []
  const pools = new Map()
  for (const raw of [...rawMessages].sort((a, b) => a.messageAt - b.messageAt)) {
    const message = normalizeMessage(raw)
    const key = JSON.stringify([message.accountId, message.channel])
    const pool = pools.get(key) || []
    const prior = pool.slice(-200).find(item => {
      const gap = message.messageAt - item.messageAt
      return Number.isFinite(gap) && gap >= 0 && gap <= DEDUPE_MS && similar(item.text, message.text)
    })
    if (prior) {
      prior.duplicateIds.push(message.id)
      duplicates.push({ sourceId: message.id, duplicateOf: prior.id, reason: 'duplicate_text' })
    } else {
      const item = { ...message, duplicateIds: [] }
      messages.push(item); pool.push(item); pools.set(key, pool)
    }
  }
  return { messages, duplicates }
}

export function classifyBatch(rawMessages, rawOptions = {}) {
  const options = normalizeFilterOptions(rawOptions)
  if (!Array.isArray(rawMessages)) throw new Error('invalid_filter_messages')
  const ids = new Set()
  for (const message of rawMessages) {
    if (!message || ['id', 'accountId', 'channel', 'groupId', 'conversationId'].some(key => typeof message[key] !== 'string' || !message[key].trim())
      || !Number.isSafeInteger(message.messageAt) || message.messageAt < 0 || ids.has(message.id)) throw new Error('invalid_filter_message')
    ids.add(message.id)
  }
  const ordered = rawMessages.map(normalizeMessage).sort((a, b) => a.messageAt - b.messageAt)
  const windows = new Map()
  const decisions = ordered.map(message => {
    const key = JSON.stringify([message.accountId, message.channel, message.groupId, message.conversationId])
    const context = windows.get(key) || []
    const decision = classify(message, options, context)
    context.push(message); windows.set(key, context.slice(-12))
    return { sourceId: message.id, ...decision, explanation: explainDecision(decision) }
  })
  const candidates = ordered.filter((_, index) => decisions[index].included)
  const result = options.dedupe ? dedupeMessages(candidates) : { messages: candidates.map(item => ({ ...item, duplicateIds: [] })), duplicates: [] }
  const byId = new Map(decisions.map(item => [item.sourceId, item]))
  for (const duplicate of result.duplicates) {
    const decision = byId.get(duplicate.sourceId)
    decision.duplicateOf = duplicate.duplicateOf
    decision.reasons.push(duplicate.reason)
    decision.explanation = explainDecision(decision)
  }
  return {
    options, decisions, messages: result.messages,
    stats: {
      sourceCount: ordered.length,
      signalCount: decisions.filter(item => item.label === 'signal').length,
      reviewCount: decisions.filter(item => item.label === 'review').length,
      chatterCount: decisions.filter(item => item.label === 'chatter').length,
      noiseCount: decisions.filter(item => item.label === 'noise').length,
      excludedCount: ordered.length - candidates.length,
      includedSourceCount: candidates.length,
      duplicateCount: result.duplicates.length,
      analysisCount: result.messages.length,
    },
    ruleVersion: FILTER_VERSION,
  }
}
