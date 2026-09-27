function fold(value) {
  return String(value || '').toLowerCase()
}

export function includesFold(haystack, needle) {
  const word = fold(needle).trim()
  return Boolean(word) && fold(haystack).includes(word)
}

function matchRule(rule, video) {
  const keyword = String(rule?.keyword || '').trim()
  if (!keyword) return false
  if (rule.field === 'nickName') return includesFold(video?.author?.nickname, keyword)
  if (rule.field === 'videoDesc') return includesFold(video?.desc, keyword)
  if (rule.field === 'videoTag') return (video?.video_tag || []).some((tag) => includesFold(tag?.tag_name, keyword))
  return false
}

export function matchRuleGroup(group, video, onLog = () => {}) {
  if (!group) return null
  let currentMatched = false
  if (group.type === 'ai') onLog('warn', `AI规则组 "${group.name}" 暂不支持，跳过`)
  if (group.type === 'manual' && Array.isArray(group.rules) && group.rules.length > 0) {
    const matches = group.rules.map((rule) => matchRule(rule, video))
    currentMatched = group.relation === 'and' ? matches.every(Boolean) : matches.some(Boolean)
    if (currentMatched) {
      const matchedRules = group.rules.filter((rule, index) => matches[index]).map((rule) => `${rule.field}:${rule.keyword}`)
      onLog('success', `手动规则组 "${group.name}" 匹配成功，命中条件: ${matchedRules.join('、')}`)
    }
  }
  if (!currentMatched) return null
  if (Array.isArray(group.children) && group.children.length) return matchRuleGroups(group.children, video, onLog)
  return group
}

export function matchRuleGroups(groups, video, onLog = () => {}) {
  for (const group of groups || []) {
    const matched = matchRuleGroup(group, video, onLog)
    if (matched) return matched
  }
  return null
}

export function analyzeVideoType(video, settings, onLog = () => {}) {
  const matchedRuleGroup = matchRuleGroups(settings?.ruleGroups, video, onLog)
  if (!matchedRuleGroup) return { shouldSimulateWatch: false, shouldViewComment: false }
  onLog('success', `匹配到规则组: ${matchedRuleGroup.name}`)
  return { shouldSimulateWatch: settings?.simulateWatchBeforeComment !== false, shouldViewComment: true, matchedRuleGroup }
}
