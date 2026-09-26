export const DEFAULT_GROWTH_SETTINGS = {
  maxCount: 10,
  minWatchMs: 5000,
  maxWatchMs: 15000,
  watchTimeRangeSeconds: [5, 15],
  simulateWatchBeforeComment: true,
  onlyCommentActiveVideo: false,
  comments: ['学到了', '说得很清楚'],
  blockKeywords: [],
  authorBlockKeywords: [],
  ruleGroups: [
    { id: 'default', name: '默认规则组', type: 'manual', comments: ['学到了', '说得很清楚'], children: [], relation: 'or', rules: [], aiPrompt: '', commentImagePath: '', commentImageType: 'folder', commentImageName: '' },
  ],
  presets: [],
}

export function normalizeGrowthSettings(value = {}) {
  const maxCount = clampInt(value.maxCount, 1, 999, DEFAULT_GROWTH_SETTINGS.maxCount)
  const range = normalizeWatchRange(value)
  const simulateWatchBeforeComment = value.simulateWatchBeforeComment !== false
  const onlyCommentActiveVideo = value.onlyCommentActiveVideo === true
  const blockKeywords = toStringList(value.blockKeywords, [])
  const authorBlockKeywords = toStringList(value.authorBlockKeywords, [])
  const campaign = normalizeCampaign(value.campaign)
  const ruleGroups = applyLearnedCampaignRules(normalizeRuleGroups(value), campaign)
  const comments = flattenComments(ruleGroups, value.comments)
  return {
    maxCount,
    minWatchMs: range.minWatchMs,
    maxWatchMs: range.maxWatchMs,
    watchTimeRangeSeconds: range.watchTimeRangeSeconds,
    simulateWatchBeforeComment,
    onlyCommentActiveVideo,
    comments,
    blockKeywords,
    authorBlockKeywords,
    ruleGroups,
    presets: normalizePresets(value.presets),
    campaign,
  }
}

function applyLearnedCampaignRules(groups, campaign) {
  if (!campaign?.enabled || !campaign.learnedTags.length) return groups
  const learned = new Set(campaign.learnedTags)
  return groups.map((group) => {
    const children = Array.isArray(group.children)
      ? applyLearnedCampaignRules(group.children, campaign)
      : []
    if (group.id !== 'campaign') return { ...group, children }
    const rules = (group.rules || []).filter((rule) => !(rule.field === 'videoTag' && learned.has(rule.keyword)))
    const existing = new Set(rules.filter((rule) => rule.field === 'videoDesc').map((rule) => rule.keyword))
    for (const keyword of learned) {
      if (!existing.has(keyword)) rules.push({ field: 'videoDesc', keyword })
    }
    return {
      ...group,
      children,
      rules,
    }
  })
}

export function flattenComments(ruleGroups, fallbackComments) {
  const fromGroups = []
  walkLeaves(Array.isArray(ruleGroups) ? ruleGroups : [], (group) => {
    fromGroups.push(...toStringList(group?.comments ?? group?.commentTexts, []))
  })
  if (fromGroups.length) return fromGroups.slice(0, 80)
  return toStringList(fallbackComments, DEFAULT_GROWTH_SETTINGS.comments)
}

function normalizeWatchRange(value) {
  const raw = Array.isArray(value?.watchTimeRangeSeconds) ? value.watchTimeRangeSeconds : null
  if (raw && raw.length >= 2) {
    const minS = clampInt(raw[0], 0, 60, 5)
    const maxS = Math.max(minS, clampInt(raw[1], 0, 60, 15))
    return {
      minWatchMs: minS * 1000 || 0,
      maxWatchMs: Math.max(1000, maxS * 1000),
      watchTimeRangeSeconds: [minS, maxS],
    }
  }
  const minWatchMs = clampInt(value?.minWatchMs, 0, 60000, DEFAULT_GROWTH_SETTINGS.minWatchMs)
  const maxWatchMs = Math.max(Math.max(1000, minWatchMs), clampInt(value?.maxWatchMs, 1000, 120000, DEFAULT_GROWTH_SETTINGS.maxWatchMs))
  return {
    minWatchMs,
    maxWatchMs,
    watchTimeRangeSeconds: [Math.round(minWatchMs / 1000), Math.round(maxWatchMs / 1000)],
  }
}

function normalizeRuleGroups(value) {
  const groups = Array.isArray(value?.ruleGroups) ? value.ruleGroups : []
  const next = groups.map((group, index) => normalizeRuleGroup(group, index, 0)).filter(Boolean).slice(0, 40)
  if (next.length) return next
  return [{
    id: 'default',
    name: '默认规则组',
    type: 'manual',
    comments: toStringList(value?.comments, DEFAULT_GROWTH_SETTINGS.comments),
    children: [],
    relation: 'or',
    rules: [],
    aiPrompt: '',
  }]
}

function normalizeRuleGroup(group, index, depth) {
  if (!group || typeof group !== 'object' || depth > 4) return null
  const name = String(group.name || `规则组 ${index + 1}`).trim().slice(0, 40) || `规则组 ${index + 1}`
  const id = String(group.id || `g${index + 1}`).trim().slice(0, 64) || `g${index + 1}`
  const type = group.type === 'ai' ? 'ai' : 'manual'
  const childrenSrc = Array.isArray(group.children) ? group.children : []
  const children = childrenSrc.map((child, childIndex) => normalizeRuleGroup(child, childIndex, depth + 1)).filter(Boolean).slice(0, 20)
  const comments = children.length ? [] : toStringList(group.comments ?? group.commentTexts, [])
  const rules = Array.isArray(group.rules)
    ? group.rules.flatMap((rule) => {
      if (!rule || typeof rule !== 'object') return []
      const field = ['nickName', 'videoDesc', 'videoTag'].includes(rule.field) ? rule.field : 'nickName'
      const keyword = String(rule.keyword || '').trim().slice(0, 80)
      return [{ field, keyword }]
      }).slice(0, 40)
    : []
  return {
    id,
    name,
    type,
    comments,
    children,
    relation: group.relation === 'and' ? 'and' : 'or',
    rules,
    aiPrompt: type === 'ai' ? String(group.aiPrompt || '').slice(0, 1000) : '',
    commentImagePath: children.length ? '' : String(group.commentImagePath || '').slice(0, 500),
    commentImageType: group.commentImageType === 'file' ? 'file' : 'folder',
    commentImageName: children.length ? '' : String(group.commentImageName || '').slice(0, 200),
    ...(group.commentSource === 'model' ? { commentSource: 'model' } : {}),
  }
}

function normalizeCampaign(value) {
  if (!value || value.enabled !== true) return null
  const tags = toStringList(value.seedTags, []).slice(0, 12)
  return {
    enabled: true,
    briefId: String(value.briefId || '').slice(0, 40),
    form: value.form === 'image' ? 'image' : 'text',
    audience: String(value.audience || '').slice(0, 80),
    offer: String(value.offer || '').slice(0, 120),
    benefit: String(value.benefit || '').slice(0, 240),
    goal: String(value.goal || '').slice(0, 120),
    tone: String(value.tone || '').slice(0, 40),
    interaction: value.interaction === 'comment_like' ? 'comment_like' : 'comment',
    seedTags: tags,
    learnedTags: toStringList(value.learnedTags, []).slice(0, 12),
    learningCandidates: normalizeLearningCandidates(value.learningCandidates),
    excludes: toStringList(value.excludes, []).slice(0, 20),
    commentProvider: commentChoice(value.commentProvider),
    commentModel: commentChoice(value.commentModel),
  }
}

function commentChoice(value) {
  const text = String(value || '').trim()
  if (!text || text.length > 120 || /[\u0000-\u001f\u007f]/.test(text)) return ''
  return text
}

function normalizeLearningCandidates(value) {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const keyword = String(item.keyword || '').trim().slice(0, 40)
    const count = clampInt(item.count, 1, 3, 1)
    const videoIds = Array.isArray(item.videoIds)
      ? item.videoIds.map((id) => String(id || '').trim()).filter(Boolean).slice(-3)
      : []
    return keyword ? [{ keyword, count, videoIds }] : []
  }).slice(0, 24)
}

function walkLeaves(groups, visit) {
  for (const group of groups) {
    if (!group || typeof group !== 'object') continue
    if (Array.isArray(group.children) && group.children.length) walkLeaves(group.children, visit)
    else visit(group)
  }
}

function normalizePresets(value) {
  if (!Array.isArray(value)) return []
  return value.flatMap((item, index) => {
    if (!item || typeof item !== 'object') return []
    const name = String(item.name || `配置 ${index + 1}`).trim().slice(0, 40)
    if (!name) return []
    const payload = normalizeGrowthSettings({ ...item, presets: [] })
    return [{
      id: String(item.id || `p${index + 1}`).trim().slice(0, 40) || `p${index + 1}`,
      name,
      updatedAt: String(item.updatedAt || ''),
      maxCount: payload.maxCount,
      minWatchMs: payload.minWatchMs,
      maxWatchMs: payload.maxWatchMs,
      watchTimeRangeSeconds: payload.watchTimeRangeSeconds,
      simulateWatchBeforeComment: payload.simulateWatchBeforeComment,
      onlyCommentActiveVideo: payload.onlyCommentActiveVideo,
      comments: payload.comments,
      blockKeywords: payload.blockKeywords,
      authorBlockKeywords: payload.authorBlockKeywords,
      ruleGroups: payload.ruleGroups,
    }]
  }).slice(0, 30)
}

function clampInt(value, min, max, fallback) {
  const n = Math.floor(Number(value))
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function toStringList(value, fallback) {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/\n+/) : fallback
  const next = list.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 40)
  return next.length ? next : (Array.isArray(fallback) ? [...fallback] : fallback)
}
