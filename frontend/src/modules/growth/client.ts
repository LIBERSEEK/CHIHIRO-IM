export type GrowthRuleType = 'manual' | 'ai'
export type GrowthRuleField = 'nickName' | 'videoDesc' | 'videoTag'

export interface GrowthMatchRule {
  field: GrowthRuleField
  keyword: string
}

export type GrowthImageType = 'folder' | 'file'

export interface GrowthRuleGroup {
  id: string
  name: string
  type: GrowthRuleType
  comments: string[]
  children: GrowthRuleGroup[]
  relation: 'and' | 'or'
  rules: GrowthMatchRule[]
  aiPrompt: string
  commentImagePath?: string
  commentImageType?: GrowthImageType
  commentImageName?: string
  commentSource?: 'model'
}

export interface GrowthCampaignSettings {
  enabled: true
  briefId: string
  form: 'text' | 'image'
  audience: string
  offer: string
  benefit: string
  goal: string
  tone: string
  interaction: 'comment' | 'comment_like'
  seedTags: string[]
  learnedTags: string[]
  learningCandidates: { keyword: string; count: number; videoIds?: string[] }[]
  excludes: string[]
  commentProvider?: string
  commentModel?: string
}

export interface GrowthPreset {
  id: string
  name: string
  updatedAt?: string
  maxCount: number
  minWatchMs: number
  maxWatchMs: number
  watchTimeRangeSeconds: [number, number]
  simulateWatchBeforeComment: boolean
  onlyCommentActiveVideo: boolean
  comments: string[]
  blockKeywords: string[]
  authorBlockKeywords: string[]
  ruleGroups: GrowthRuleGroup[]
}

export interface GrowthSettings {
  maxCount: number
  minWatchMs: number
  maxWatchMs: number
  watchTimeRangeSeconds: [number, number]
  simulateWatchBeforeComment: boolean
  onlyCommentActiveVideo: boolean
  comments: string[]
  blockKeywords: string[]
  authorBlockKeywords: string[]
  ruleGroups: GrowthRuleGroup[]
  presets: GrowthPreset[]
  campaign?: GrowthCampaignSettings | null
}

export interface GrowthLogLine {
  level?: string
  text?: string
  at?: string
}

export interface GrowthHistoryRow {
  id?: string
  awemeId?: string
  desc?: string
  nickname?: string
  text?: string
  status?: string
  reason?: string
  at?: string
  startedAt?: string
  endedAt?: string
  commented?: number
  scanned?: number
  error?: string
  logs?: GrowthLogLine[]
  videos?: GrowthHistoryRow[]
  comments?: GrowthHistoryRow[]
  tags?: string[]
  shareUrl?: string
  watchDuration?: number
  isCommented?: boolean
}

export interface GrowthAccountView {
  id: string
  loggedIn: boolean
  settings: GrowthSettings
  history: {
    tasks: GrowthHistoryRow[]
    videos: GrowthHistoryRow[]
    comments: GrowthHistoryRow[]
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return typeof value === 'string' ? value.split(/\n+/).map(item => item.trim()).filter(Boolean) : []
  return value.map(item => String(item || '').trim()).filter(Boolean)
}

function parseMatchRules(value: unknown): GrowthMatchRule[] {
  if (!Array.isArray(value)) return []
  return value.filter(record).map(rule => ({
    field: rule.field === 'videoDesc' || rule.field === 'videoTag' ? rule.field : 'nickName',
    keyword: String(rule.keyword || '').trim(),
  }))
}

function parseRuleGroup(value: unknown, index: number, depth: number): GrowthRuleGroup | null {
  if (!record(value) || depth > 4) return null
  const childrenSrc = Array.isArray(value.children) ? value.children : []
  const children = childrenSrc
    .map((child, childIndex) => parseRuleGroup(child, childIndex, depth + 1))
    .filter((child): child is GrowthRuleGroup => Boolean(child))
  const comments = children.length ? [] : stringList(value.comments ?? value.commentTexts)
  return {
    id: String(value.id || `g${index + 1}`),
    name: String(value.name || `规则组 ${index + 1}`).trim() || `规则组 ${index + 1}`,
    type: value.type === 'ai' ? 'ai' : 'manual',
    comments,
    children,
    relation: value.relation === 'and' ? 'and' : 'or',
    rules: parseMatchRules(value.rules),
    aiPrompt: typeof value.aiPrompt === 'string' ? value.aiPrompt : '',
    commentImagePath: children.length ? '' : String(value.commentImagePath || ''),
    commentImageType: value.commentImageType === 'file' ? 'file' : 'folder',
    commentImageName: children.length ? '' : String(value.commentImageName || ''),
    ...(value.commentSource === 'model' ? { commentSource: 'model' as const } : {}),
  }
}

function parseRuleGroups(value: unknown, fallbackComments: string[]): GrowthRuleGroup[] {
  const groups = Array.isArray(value) ? value.map((group, index) => parseRuleGroup(group, index, 0)).filter((group): group is GrowthRuleGroup => Boolean(group)) : []
  if (groups.length) return groups
  return [{
    id: 'default',
    name: '默认规则组',
    type: 'manual',
    comments: fallbackComments.length ? fallbackComments : ['学到了', '说得很清楚'],
    children: [],
    relation: 'or',
    rules: [],
    aiPrompt: '',
    commentImagePath: '',
    commentImageType: 'folder',
    commentImageName: '',
  }]
}

export function flattenRuleComments(groups: GrowthRuleGroup[]): string[] {
  const next: string[] = []
  const walk = (list: GrowthRuleGroup[]) => {
    for (const group of list) {
      if (group.children.length) walk(group.children)
      else next.push(...group.comments.map(item => item.trim()).filter(Boolean))
    }
  }
  walk(groups)
  return next
}

function parseWatchRange(row: Record<string, unknown>): { minWatchMs: number; maxWatchMs: number; watchTimeRangeSeconds: [number, number] } {
  const raw = Array.isArray(row.watchTimeRangeSeconds) ? row.watchTimeRangeSeconds : null
  if (raw && raw.length >= 2) {
    const minS = Math.max(0, Math.min(60, Math.floor(Number.isFinite(Number(raw[0])) ? Number(raw[0]) : 5)))
    const maxS = Math.max(minS, Math.min(60, Math.floor(Number.isFinite(Number(raw[1])) ? Number(raw[1]) : 15)))
    return {
      minWatchMs: minS * 1000,
      maxWatchMs: Math.max(1000, maxS * 1000),
      watchTimeRangeSeconds: [minS, maxS],
    }
  }
  const minWatchMs = Math.max(0, Math.floor(Number(row.minWatchMs) || 5000))
  const maxWatchMs = Math.max(Math.max(1000, minWatchMs), Math.floor(Number(row.maxWatchMs) || 15000))
  return {
    minWatchMs,
    maxWatchMs,
    watchTimeRangeSeconds: [Math.round(minWatchMs / 1000), Math.round(maxWatchMs / 1000)],
  }
}

export function parseGrowthSettings(value: unknown): GrowthSettings {
  const row = record(value) ? value : {}
  const comments = stringList(row.comments)
  const ruleGroups = parseRuleGroups(row.ruleGroups, comments)
  const flattened = flattenRuleComments(ruleGroups)
  const watch = parseWatchRange(row)
  return {
    maxCount: Math.max(1, Math.floor(Number(row.maxCount) || 10)),
    minWatchMs: watch.minWatchMs,
    maxWatchMs: watch.maxWatchMs,
    watchTimeRangeSeconds: watch.watchTimeRangeSeconds,
    simulateWatchBeforeComment: row.simulateWatchBeforeComment !== false,
    onlyCommentActiveVideo: row.onlyCommentActiveVideo === true,
    comments: flattened.length ? flattened : (comments.length ? comments : ['学到了', '说得很清楚']),
    blockKeywords: stringList(row.blockKeywords),
    authorBlockKeywords: stringList(row.authorBlockKeywords),
    ruleGroups,
    campaign: parseCampaign(row.campaign),
    presets: Array.isArray(row.presets) ? row.presets.filter(record).map((item, index) => {
      const nested = parseGrowthSettings({ ...item, presets: [] })
      return {
        id: String(item.id || `p${index + 1}`),
        name: String(item.name || `配置 ${index + 1}`).trim() || `配置 ${index + 1}`,
        updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : '',
        maxCount: nested.maxCount,
        minWatchMs: nested.minWatchMs,
        maxWatchMs: nested.maxWatchMs,
        watchTimeRangeSeconds: nested.watchTimeRangeSeconds,
        simulateWatchBeforeComment: nested.simulateWatchBeforeComment,
        onlyCommentActiveVideo: nested.onlyCommentActiveVideo,
        comments: nested.comments,
        blockKeywords: nested.blockKeywords,
        authorBlockKeywords: nested.authorBlockKeywords,
        ruleGroups: nested.ruleGroups,
      }
    }) : [],
  }
}

function parseLogLine(value: unknown): GrowthLogLine | null {
  if (!record(value)) return null
  return {
    level: typeof value.level === 'string' ? value.level : '',
    text: typeof value.text === 'string' ? value.text : '',
    at: typeof value.at === 'string' ? value.at : '',
  }
}

function parseVideoRecord(value: unknown): GrowthHistoryRow {
  const row = record(value) ? value : {}
  const isCommented = row.isCommented === true || row.status === 'commented'
  const timestamp = typeof row.timestamp === 'number' ? row.timestamp : 0
  return {
    awemeId: String(row.awemeId || row.videoId || ''),
    nickname: String(row.nickname || row.authorName || ''),
    desc: String(row.desc || row.videoDesc || ''),
    tags: stringList(row.tags ?? row.videoTags),
    shareUrl: String(row.shareUrl || ''),
    watchDuration: Math.max(0, Math.floor(Number(row.watchDuration) || 0)),
    status: isCommented ? 'commented' : String(row.status || ''),
    text: String(row.text || row.commentText || ''),
    reason: String(row.reason || row.skipReason || ''),
    at: typeof row.at === 'string' ? row.at : (timestamp ? new Date(timestamp).toISOString() : ''),
    isCommented,
  }
}

function parseTaskRecord(value: unknown): GrowthHistoryRow {
  const row = record(value) ? value : {}
  const videosSrc = Array.isArray(row.videos) ? row.videos : (Array.isArray(row.videoRecords) ? row.videoRecords : [])
  const videos = videosSrc.map(parseVideoRecord)
  const startedAt = typeof row.startedAt === 'string'
    ? row.startedAt
    : (typeof row.startTime === 'number' ? new Date(row.startTime).toISOString() : '')
  const endedAt = typeof row.endedAt === 'string'
    ? row.endedAt
    : (typeof row.endTime === 'number' ? new Date(row.endTime).toISOString() : '')
  return {
    id: String(row.id || ''),
    status: String(row.status || ''),
    startedAt,
    endedAt,
    commented: Math.max(0, Math.floor(Number(row.commented ?? row.commentCount) || 0)),
    scanned: Math.max(0, Math.floor(Number(row.scanned) || videos.length || 0)),
    error: String(row.error || row.errorMessage || ''),
    logs: Array.isArray(row.logs) ? row.logs.map(parseLogLine).filter((line): line is GrowthLogLine => Boolean(line)) : [],
    videos,
    comments: Array.isArray(row.comments) ? row.comments.map(parseVideoRecord) : [],
  }
}

export function parseGrowthAccountView(value: unknown): GrowthAccountView {
  if (!record(value) || typeof value.id !== 'string') throw new Error('抖音账号数据无效')
  const history = record(value.history) ? value.history : {}
  return {
    id: value.id,
    loggedIn: value.loggedIn === true,
    settings: parseGrowthSettings(value.settings),
    history: {
      tasks: Array.isArray(history.tasks) ? history.tasks.filter(record).map(parseTaskRecord) : [],
      videos: Array.isArray(history.videos) ? history.videos.filter(record).map(parseVideoRecord) : [],
      comments: Array.isArray(history.comments) ? history.comments.filter(record).map(parseVideoRecord) : [],
    },
  }
}

async function readJson(response: Response, fallback: string): Promise<unknown> {
  const body: unknown = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = record(body) && typeof body.message === 'string' && body.message.trim()
      ? body.message
      : fallback
    throw new Error(message)
  }
  return body
}

export async function fetchGrowthAccount(id: string): Promise<GrowthAccountView> {
  const response = await fetch(`/api/runtime/growth/accounts/${encodeURIComponent(id)}`, { cache: 'no-store' })
  return parseGrowthAccountView(await readJson(response, `无法加载抖音工作台（HTTP ${response.status}）`))
}

export async function saveGrowthSettings(id: string, settings: GrowthSettings): Promise<unknown> {
  const response = await fetch(`/api/runtime/growth/accounts/${encodeURIComponent(id)}/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  })
  return readJson(response, `无法保存规则（HTTP ${response.status}）`)
}

export async function startGrowthTask(accountId: string, settings?: GrowthSettings): Promise<unknown> {
  const response = await fetch('/api/runtime/growth/task/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId, ...(settings ? { settings } : {}) }),
  })
  return readJson(response, `无法启动任务（HTTP ${response.status}）`)
}

export async function stopGrowthTask(): Promise<unknown> {
  const response = await fetch('/api/runtime/growth/task/stop', { method: 'POST' })
  return readJson(response, `无法停止任务（HTTP ${response.status}）`)
}

export async function pauseGrowthTask(paused: boolean): Promise<unknown> {
  const response = await fetch('/api/runtime/growth/task/pause', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paused }),
  })
  return readJson(response, `无法${paused ? '暂停' : '继续'}任务（HTTP ${response.status}）`)
}

export async function setGrowthPreviewMode(mode: 'pip' | 'window'): Promise<unknown> {
  const response = await fetch('/api/runtime/growth/preview/mode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  })
  return readJson(response, `无法切换预览窗口（HTTP ${response.status}）`)
}

export async function setGrowthPreviewMuted(muted: boolean): Promise<unknown> {
  const response = await fetch('/api/runtime/growth/preview/mute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ muted }),
  })
  return readJson(response, `无法切换静音（HTTP ${response.status}）`)
}

export async function deleteGrowthTask(accountId: string, taskId: string): Promise<unknown> {
  const response = await fetch(
    `/api/runtime/growth/accounts/${encodeURIComponent(accountId)}/history/${encodeURIComponent(taskId)}`,
    { method: 'DELETE' },
  )
  return readJson(response, `无法删除任务（HTTP ${response.status}）`)
}

export async function clearGrowthHistory(accountId: string): Promise<unknown> {
  const response = await fetch(
    `/api/runtime/growth/accounts/${encodeURIComponent(accountId)}/history`,
    { method: 'DELETE' },
  )
  return readJson(response, `无法清空历史任务（HTTP ${response.status}）`)
}

export async function uploadGrowthCommentImages(
  accountId: string,
  groupId: string,
  type: GrowthImageType,
  files: { name: string; body: string }[],
): Promise<{ path: string; type: GrowthImageType; count: number }> {
  const response = await fetch(
    `/api/runtime/growth/accounts/${encodeURIComponent(accountId)}/comment-images`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId, type, files }),
    },
  )
  const body = await readJson(response, `无法保存评论图片（HTTP ${response.status}）`)
  if (!record(body) || typeof body.path !== 'string' || !body.path) throw new Error('评论图片保存失败')
  return {
    path: body.path,
    type: body.type === 'file' ? 'file' : 'folder',
    count: Math.max(0, Math.floor(Number(body.count) || 0)),
  }
}

export function groupHasCommentConfig(group: GrowthRuleGroup): boolean {
  if (group.children.length) return false
  return group.comments.some(item => item.trim()) || Boolean(group.commentImagePath?.trim()) || group.commentSource === 'model'
}

function parseCampaign(value: unknown): GrowthCampaignSettings | null {
  if (!record(value) || value.enabled !== true) return null
  return {
    enabled: true,
    briefId: String(value.briefId || ''),
    form: value.form === 'image' ? 'image' : 'text',
    audience: String(value.audience || ''),
    offer: String(value.offer || ''),
    benefit: String(value.benefit || ''),
    goal: String(value.goal || ''),
    tone: String(value.tone || ''),
    interaction: value.interaction === 'comment_like' ? 'comment_like' : 'comment',
    seedTags: stringList(value.seedTags),
    learnedTags: stringList(value.learnedTags),
    learningCandidates: Array.isArray(value.learningCandidates)
      ? value.learningCandidates.filter(record).map(item => ({
        keyword: String(item.keyword || ''),
        count: Math.max(1, Math.floor(Number(item.count) || 1)),
        videoIds: Array.isArray(item.videoIds) ? item.videoIds.map(id => String(id || '')).filter(Boolean).slice(-3) : [],
      })).filter(item => item.keyword)
      : [],
    excludes: stringList(value.excludes),
    commentProvider: choice(value.commentProvider),
    commentModel: choice(value.commentModel),
  }
}

function choice(value: unknown) {
  const text = String(value || '').trim()
  if (!text || text.length > 120 || /[\u0000-\u001f\u007f]/.test(text)) return ''
  return text
}

export function leavesHaveCommentConfig(groups: GrowthRuleGroup[]): boolean {
  if (!groups.length) return false
  return groups.every(group => (
    group.children.length ? leavesHaveCommentConfig(group.children) : groupHasCommentConfig(group)
  ))
}

export function newRuleGroup(name = '未命名规则组'): GrowthRuleGroup {
  return {
    id: `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    type: 'manual',
    comments: [],
    children: [],
    relation: 'or',
    rules: [{ field: 'nickName', keyword: '' }],
    aiPrompt: '',
    commentImagePath: '',
    commentImageType: 'folder',
    commentImageName: '',
  }
}

export function cloneRuleGroup(group: GrowthRuleGroup, suffix = '副本'): GrowthRuleGroup {
  return {
    ...group,
    id: `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: `${group.name}${suffix}`,
    comments: [...group.comments],
    rules: group.rules.map(rule => ({ ...rule })),
    children: group.children.map(child => cloneRuleGroup(child, '')),
    commentImagePath: group.commentImagePath || '',
    commentImageType: group.commentImageType === 'file' ? 'file' : 'folder',
    commentImageName: group.commentImageName || '',
  }
}

export function mapRuleGroups(groups: GrowthRuleGroup[], id: string, mapper: (group: GrowthRuleGroup) => GrowthRuleGroup | null): GrowthRuleGroup[] {
  return groups.flatMap(group => {
    if (group.id === id) {
      const next = mapper(group)
      return next ? [next] : []
    }
    const children = mapRuleGroups(group.children, id, mapper)
    return [{ ...group, children }]
  })
}

export function insertChildGroup(groups: GrowthRuleGroup[], parentId: string, child: GrowthRuleGroup): GrowthRuleGroup[] {
  return groups.map(group => {
    if (group.id === parentId) {
      return { ...group, comments: [], children: [...group.children, child] }
    }
    return { ...group, children: insertChildGroup(group.children, parentId, child) }
  })
}

export function findRuleGroup(groups: GrowthRuleGroup[], id: string): GrowthRuleGroup | null {
  for (const group of groups) {
    if (group.id === id) return group
    const nested = findRuleGroup(group.children, id)
    if (nested) return nested
  }
  return null
}
