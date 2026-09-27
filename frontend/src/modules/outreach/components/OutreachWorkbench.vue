<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  ArrowLeft, ChevronDown, ChevronRight, CircleCheck, CircleHelp, CircleStop, CircleX,
  Clock, Pause, Play, Smile, Trash, X,
} from '@lucide/vue'
import { useShellStore } from '@/stores/shell'
import {
  clearOutreachHistory,
  cloneRuleGroup,
  deleteOutreachTask,
  fetchOutreachAccount,
  findRuleGroup,
  flattenRuleComments,
  groupHasCommentConfig,
  insertChildGroup,
  leavesHaveCommentConfig,
  mapRuleGroups,
  newRuleGroup,
  parseOutreachSettings,
  saveOutreachSettings,
  pauseOutreachTask,
  startOutreachTask,
  stopOutreachTask,
  uploadOutreachCommentImages,
  type OutreachAccountView,
  type OutreachImageType,
  type OutreachHistoryRow,
  type OutreachMatchRule,
  type OutreachRuleField,
  type OutreachRuleGroup,
  type OutreachSettings,
} from '../api/client'
import { OUTREACH_COMMENT_TEMPLATES, templateById } from '../domain/templates'

type Page = 'home' | 'history' | 'detail'
type DialogKind = 'clear' | 'delete' | 'template' | 'import' | 'clear-history' | 'delete-task'

const props = withDefaults(defineProps<{
  surface?: 'task' | 'settings'
}>(), {
  surface: 'task',
})
type VideoFilter = 'all' | 'commented'
type NoticeKind = 'success' | 'warning' | 'error'
type ModalKind = 'rule' | 'comments' | null

const BANNER_KEY = 'chihiro-outreach-template-alert-dismissed'
const FIELD_OPTIONS: { value: OutreachRuleField; label: string }[] = [
  { value: 'nickName', label: '作者名称' },
  { value: 'videoDesc', label: '视频描述' },
  { value: 'videoTag', label: '视频标签' },
]

const shell = useShellStore()
const page = ref<Page>('home')
const loading = ref(false)
const saving = ref(false)
const picking = ref(false)
const error = ref('')
const view = ref<OutreachAccountView | null>(null)
const RANGE_MAX = 60
const maxCount = ref(10)
const minWatch = ref(5)
const maxWatch = ref(15)
const rangeTrack = ref<HTMLElement | null>(null)
const rangeDrag = ref<'min' | 'max' | null>(null)
const rangeTip = ref<{ value: number; pct: number } | null>(null)
const simulateWatch = ref(true)
const onlyActive = ref(false)
const blockKeywords = ref<string[]>([])
const authorBlockKeywords = ref<string[]>([])
const ruleGroups = ref<OutreachRuleGroup[]>([newRuleGroup('默认规则组')])
const campaignSettings = ref<OutreachSettings['campaign']>(null)
const loadedRules = ref('')

function rulesSignature(groups: OutreachRuleGroup[]) {
  return JSON.stringify(groups.map(group => ({
    id: group.id,
    rules: group.rules,
    commentImagePath: group.commentImagePath || '',
    commentSource: group.commentSource || '',
  })))
}
const expanded = ref<Set<string>>(new Set())
const selectedTaskId = ref('')
const pendingTaskId = ref('')
const chromeDraft = ref(shell.browserPath)
const chromeSaving = ref(false)
const videoFilter = ref<VideoFilter>('all')
const videoPage = ref(1)
const notice = ref<{ kind: NoticeKind; text: string } | null>(null)
let noticeTimer: ReturnType<typeof setTimeout> | null = null
const runtimeOpen = ref(false)
const keywordOpen = ref(false)
const configMenuOpen = ref(false)
const bannerOpen = ref(localStorage.getItem(BANNER_KEY) !== '1')
const pendingTemplateId = ref('')
const importInput = ref<HTMLInputElement | null>(null)
const dialog = ref<{ kind: DialogKind; title: string; message: string; ok: string; danger?: boolean } | null>(null)
const modal = ref<ModalKind>(null)
const editingId = ref('')
const draftName = ref('')
const draftType = ref<'manual' | 'ai'>('manual')
const draftRelation = ref<'and' | 'or'>('or')
const draftRules = ref<OutreachMatchRule[]>([{ field: 'nickName', keyword: '' }])
const draftComments = ref<string[]>([])
const draftImageType = ref<OutreachImageType>('folder')
const draftImagePath = ref('')
const draftImageName = ref('')
const imageFileInput = ref<HTMLInputElement | null>(null)
const imageFolderInput = ref<HTMLInputElement | null>(null)
const pickingImage = ref(false)
const helpOpen = ref(false)

const accountId = computed(() => shell.activeAccount?.id || '')
const workbenchLabel = computed(() => (
  shell.activeAccount?.platform === 'bilibili' || String(accountId.value).startsWith('bilibili:')
    ? '哔哩哔哩工作台'
    : shell.activeAccount?.platform === 'xiaohongshu' || String(accountId.value).startsWith('xiaohongshu:')
      ? '小红书工作台'
      : '抖音工作台'
))
const task = computed(() => shell.outreachTask)
const runningHere = computed(() => task.value.running && task.value.accountId === accountId.value)
const tasks = computed(() => view.value?.history.tasks || [])
const historyTasks = computed(() => {
  const list = [...tasks.value]
  const live = liveTaskRow()
  if (live && !list.some(row => row.id === live.id)) list.unshift(live)
  return list.slice(0, 10)
})
const selectedTask = computed(() => {
  const live = runningHere.value && (!selectedTaskId.value || selectedTaskId.value === task.value.id)
    ? liveTaskRow()
    : null
  return historyTasks.value.find(row => row.id === selectedTaskId.value) || live || null
})
const detailLogs = computed(() => {
  const row = selectedTask.value
  if (row?.id && row.id === task.value.id && task.value.logs.length) return task.value.logs
  return row?.logs || []
})
const detailVideos = computed(() => selectedTask.value?.videos || [])
const commentedVideoCount = computed(() => detailVideos.value.filter(videoCommented).length)
const filteredVideos = computed(() => (
  videoFilter.value === 'commented'
    ? detailVideos.value.filter(videoCommented)
    : detailVideos.value
))
const videoPageCount = computed(() => Math.max(1, Math.ceil(filteredVideos.value.length / 20)))
const pagedVideos = computed(() => {
  const start = (videoPage.value - 1) * 20
  return filteredVideos.value.slice(start, start + 20)
})
const visibleRows = computed(() => flattenRows(ruleGroups.value, 0))
const hasComments = computed(() => leavesHaveCommentConfig(ruleGroups.value))

function flattenRows(groups: OutreachRuleGroup[], depth: number): { group: OutreachRuleGroup; depth: number }[] {
  const rows: { group: OutreachRuleGroup; depth: number }[] = []
  for (const group of groups) {
    rows.push({ group, depth })
    if (group.children.length && expanded.value.has(group.id)) {
      rows.push(...flattenRows(group.children, depth + 1))
    }
  }
  return rows
}

function liveTaskRow(): OutreachHistoryRow | null {
  if (!runningHere.value) return null
  const existing = tasks.value.find(row => row.id === task.value.id)
  return {
    id: task.value.id || 'running',
    status: task.value.paused ? 'paused' : 'running',
    startedAt: task.value.startedAt,
    commented: task.value.commented,
    scanned: task.value.scanned,
    logs: task.value.logs,
    videos: existing?.videos || [],
    error: existing?.error || '',
  }
}

function videoCommented(row: OutreachHistoryRow) {
  return row.isCommented === true || row.status === 'commented'
}

function showNotice(kind: NoticeKind, text: string) {
  notice.value = { kind, text }
  if (noticeTimer) clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => { notice.value = null }, 2400)
}

function settingsFromForm(): OutreachSettings {
  const groups = ruleGroups.value
  const comments = flattenRuleComments(groups)
  const minS = Math.max(0, Number(minWatch.value) || 0)
  const maxS = Math.max(minS, Number(maxWatch.value) || 0)
  return {
    maxCount: Math.max(1, Math.floor(Number(maxCount.value) || 1)),
    minWatchMs: minS * 1000,
    maxWatchMs: Math.max(1000, maxS * 1000),
    watchTimeRangeSeconds: [minS, maxS],
    simulateWatchBeforeComment: simulateWatch.value,
    onlyCommentActiveVideo: onlyActive.value,
    comments: comments.length ? comments : ['学到了', '说得很清楚'],
    blockKeywords: blockKeywords.value.map(item => item.trim()).filter(Boolean),
    authorBlockKeywords: authorBlockKeywords.value.map(item => item.trim()).filter(Boolean),
    ruleGroups: groups,
    presets: view.value?.settings.presets || [],
    ...(campaignSettings.value ? { campaign: campaignSettings.value } : {}),
  }
}

function expandParents(groups: OutreachRuleGroup[]) {
  const next = new Set(expanded.value)
  const walk = (list: OutreachRuleGroup[]) => {
    for (const group of list) {
      if (group.children.length) {
        next.add(group.id)
        walk(group.children)
      }
    }
  }
  walk(groups)
  expanded.value = next
}

function applyView(next: OutreachAccountView) {
  view.value = next
  maxCount.value = next.settings.maxCount
  minWatch.value = next.settings.watchTimeRangeSeconds[0]
  maxWatch.value = next.settings.watchTimeRangeSeconds[1]
  simulateWatch.value = next.settings.simulateWatchBeforeComment
  onlyActive.value = next.settings.onlyCommentActiveVideo
  blockKeywords.value = [...next.settings.blockKeywords]
  authorBlockKeywords.value = [...next.settings.authorBlockKeywords]
  ruleGroups.value = next.settings.ruleGroups.length
    ? next.settings.ruleGroups
    : [newRuleGroup('默认规则组')]
  campaignSettings.value = next.settings.campaign ?? null
  loadedRules.value = rulesSignature(ruleGroups.value)
  expandParents(ruleGroups.value)
}

async function load(silent = false) {
  if (!accountId.value) return
  if (!silent) loading.value = true
  error.value = ''
  try {
    applyView(await fetchOutreachAccount(accountId.value))
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : `无法加载${workbenchLabel.value}`
  } finally {
    loading.value = false
  }
}

async function persist(next = settingsFromForm()) {
  if (!accountId.value) return
  saving.value = true
  error.value = ''
  try {
    const body = await saveOutreachSettings(accountId.value, next)
    shell.applyRuntimeState(body)
    await load()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '无法保存规则'
  } finally {
    saving.value = false
  }
}

async function startTask() {
  if (!accountId.value || runningHere.value) return
  if (!hasComments.value) {
    showNotice('error', '还有未配置评论内容的规则组，请完善配置')
    return
  }
  error.value = ''
  try {
    const settings = settingsFromForm()
    const body = await startOutreachTask(accountId.value, settings)
    shell.applyRuntimeState(body)
    shell.setOutreachPipOpen(true)
    page.value = 'detail'
    selectedTaskId.value = shell.outreachTask.id || ''
    await load()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '无法启动任务'
  }
}

async function stopTask() {
  error.value = ''
  try {
    shell.applyRuntimeState(await stopOutreachTask())
    await load()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '无法停止任务'
  }
}

async function togglePause() {
  error.value = ''
  try {
    shell.applyRuntimeState(await pauseOutreachTask(!task.value.paused))
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '无法暂停任务'
  }
}

function toggleExpand(id: string) {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}

function openRuleModal(group: OutreachRuleGroup) {
  editingId.value = group.id
  draftName.value = group.name
  draftType.value = group.type
  draftRelation.value = group.relation
  draftRules.value = group.rules.length ? group.rules.map(rule => ({ ...rule })) : [{ field: 'nickName', keyword: '' }]
  modal.value = 'rule'
}

function openCommentModal(group: OutreachRuleGroup) {
  editingId.value = group.id
  draftComments.value = [...group.comments]
  draftImageType.value = group.commentImageType === 'file' ? 'file' : 'folder'
  draftImagePath.value = group.commentImagePath || ''
  draftImageName.value = group.commentImageName || group.commentImagePath || ''
  modal.value = 'comments'
}

function addRootGroup() {
  const group = newRuleGroup()
  ruleGroups.value = [...ruleGroups.value, group]
  openRuleModal(group)
}

function addChildGroup(parentId: string) {
  const child = newRuleGroup()
  ruleGroups.value = insertChildGroup(ruleGroups.value, parentId, child)
  expanded.value = new Set([...expanded.value, parentId])
  openRuleModal(child)
}

function duplicateGroup(id: string) {
  const target = findRuleGroup(ruleGroups.value, id)
  if (!target) return
  const copy = cloneRuleGroup(target, '副本')
  const insertBeside = (list: OutreachRuleGroup[]): OutreachRuleGroup[] => {
    const index = list.findIndex(item => item.id === id)
    if (index >= 0) {
      const next = [...list]
      next.splice(index + 1, 0, copy)
      return next
    }
    return list.map(item => ({ ...item, children: insertBeside(item.children) }))
  }
  ruleGroups.value = insertBeside(ruleGroups.value)
  void persist()
}

function askDeleteGroup(id: string) {
  editingId.value = id
  dialog.value = {
    kind: 'delete',
    title: '删除规则组',
    message: '确定删除该规则组及其子规则吗？',
    ok: '删除',
    danger: true,
  }
}

function saveRuleModal() {
  const id = editingId.value
  ruleGroups.value = mapRuleGroups(ruleGroups.value, id, group => ({
    ...group,
    name: draftName.value.trim() || group.name,
    type: draftType.value,
    relation: draftRelation.value,
    rules: draftRules.value.map(rule => ({ ...rule, keyword: rule.keyword.trim() })),
  }))
  modal.value = null
  void persist()
}

function saveCommentModal() {
  const id = editingId.value
  const comments = draftComments.value.map(item => item.trim()).filter(Boolean)
  const commentImagePath = draftImagePath.value.trim()
  const commentImageName = commentImagePath ? (draftImageName.value.trim() || commentImagePath) : ''
  ruleGroups.value = mapRuleGroups(ruleGroups.value, id, group => ({
    ...group,
    comments,
    commentImagePath,
    commentImageType: draftImageType.value,
    commentImageName,
  }))
  modal.value = null
  void persist()
}

function commentPreviewText(group: OutreachRuleGroup) {
  if (group.comments.length) return group.comments[0]
  if (group.commentImagePath) return '[图片评论]'
  return ''
}

function commentPreviewExtra(group: OutreachRuleGroup) {
  return group.comments.length > 1 ? `(+${group.comments.length - 1})` : ''
}

function pickCommentImages() {
  if (draftImageType.value === 'folder') imageFolderInput.value?.click()
  else imageFileInput.value?.click()
}

function clearCommentImage() {
  draftImagePath.value = ''
  draftImageName.value = ''
}

async function onPickCommentImages(event: Event) {
  const input = event.target as HTMLInputElement
  const files = input.files ? [...input.files] : []
  input.value = ''
  const images = files.filter(file => /\.(png|jpe?g|gif|webp)$/i.test(file.name))
  if (!images.length) {
    showNotice('warning', '未选择有效图片')
    return
  }
  if (!accountId.value || !editingId.value) return
  pickingImage.value = true
  try {
    const payload = []
    for (const file of images.slice(0, draftImageType.value === 'file' ? 1 : 40)) {
      const buffer = new Uint8Array(await file.arrayBuffer())
      let binary = ''
      for (const byte of buffer) binary += String.fromCharCode(byte)
      payload.push({ name: file.name, body: btoa(binary) })
    }
    const saved = await uploadOutreachCommentImages(accountId.value, editingId.value, draftImageType.value, payload)
    draftImagePath.value = saved.path
    const relative = images[0]?.webkitRelativePath || ''
    draftImageName.value = draftImageType.value === 'folder'
      ? (relative.split('/')[0] || `${saved.count} 张图片`)
      : (images[0]?.name || saved.path)
  } catch (cause) {
    showNotice('error', cause instanceof Error ? cause.message : '无法保存评论图片')
  } finally {
    pickingImage.value = false
  }
}

function typeLabel(group: OutreachRuleGroup) {
  return group.type === 'ai' ? 'AI判断' : '手动配置规则'
}

function applyTemplate(id: string) {
  const template = templateById(id)
  if (!template) return
  ruleGroups.value = template.groups.map(group => cloneRuleGroup(group, ''))
  expandParents(ruleGroups.value)
  void persist()
}

function dismissBanner() {
  bannerOpen.value = false
  localStorage.setItem(BANNER_KEY, '1')
}

function askTemplate(id: string) {
  const template = templateById(id)
  pendingTemplateId.value = id
  dialog.value = {
    kind: 'template',
    title: '确认导入模板',
    message: `即将导入“${template?.name || id}”模板，这将覆盖当前配置，是否继续？`,
    ok: '继续',
  }
}

function exportConfig() {
  const blob = new Blob([JSON.stringify(settingsFromForm(), null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'chihiro-outreach-config.json'
  link.click()
  URL.revokeObjectURL(url)
  configMenuOpen.value = false
}

async function onImportFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  ;(event.target as HTMLInputElement).value = ''
  if (!file) return
  try {
    const parsed = parseOutreachSettings(JSON.parse(await file.text()))
    await persist(parsed)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '无法导入配置'
  }
}

function confirmDialog() {
  const kind = dialog.value?.kind
  const id = editingId.value
  const templateId = pendingTemplateId.value
  const taskId = pendingTaskId.value
  dialog.value = null
  if (kind === 'clear') {
    ruleGroups.value = [newRuleGroup('默认规则组')]
    maxCount.value = 10
    minWatch.value = 5
    maxWatch.value = 15
    simulateWatch.value = true
    onlyActive.value = false
    blockKeywords.value = []
    authorBlockKeywords.value = []
    void persist()
  }
  if (kind === 'delete' && id) {
    ruleGroups.value = mapRuleGroups(ruleGroups.value, id, () => null)
    if (!ruleGroups.value.length) ruleGroups.value = [newRuleGroup('默认规则组')]
    void persist()
  }
  if (kind === 'template' && templateId) applyTemplate(templateId)
  if (kind === 'import') importInput.value?.click()
  if (kind === 'clear-history') void doClearHistory()
  if (kind === 'delete-task' && taskId) void doDeleteTask(taskId)
}

function statusLabel(status?: string) {
  if (status === 'running') return '运行中'
  if (status === 'paused') return '已暂停'
  if (status === 'completed') return '已完成'
  if (status === 'stopped') return '已停止'
  if (status === 'error') return '异常错误'
  if (status === 'commented') return '已评论'
  if (status === 'skipped') return '未评论'
  return status || '—'
}

function statusTone(status?: string) {
  if (status === 'running') return 'info'
  if (status === 'paused') return 'warning'
  if (status === 'completed') return 'success'
  if (status === 'error') return 'error'
  return 'default'
}

function rate(row: OutreachHistoryRow | null) {
  if (!row) return '0%'
  const scanned = Number(row.videos?.length || row.scanned) || 0
  const commented = Number(row.commented) || 0
  if (!scanned) return '0%'
  return `${((commented / scanned) * 100).toFixed(1)}%`
}

function formatTime(value?: string) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function formatDuration(row: OutreachHistoryRow) {
  if (!row.endedAt) return '运行中...'
  const start = new Date(row.startedAt || '').getTime()
  const end = new Date(row.endedAt).getTime()
  if (!start || Number.isNaN(end)) return '-'
  const seconds = Math.max(0, Math.floor((end - start) / 1000))
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  if (hours > 0) return `${hours}小时${minutes % 60}分钟`
  if (minutes > 0) return `${minutes}分钟${seconds % 60}秒`
  return `${seconds}秒`
}

function formatWatchDuration(ms?: number) {
  if (!ms) return '-'
  return `${(ms / 1000).toFixed(1)} 秒`
}

function videoShareUrl(row: OutreachHistoryRow) {
  if (row.shareUrl) return row.shareUrl
  if (shell.activeAccount?.platform === 'bilibili' && row.awemeId) return `https://www.bilibili.com/video/${row.awemeId}/`
  return row.awemeId ? `https://www.douyin.com/video/${row.awemeId}` : ''
}

function processedCount(row: OutreachHistoryRow | null) {
  if (!row) return 0
  return row.videos?.length || Number(row.scanned) || 0
}

function openTask(row: OutreachHistoryRow) {
  selectedTaskId.value = row.id || ''
  videoFilter.value = 'all'
  videoPage.value = 1
  page.value = 'detail'
}

function askClearHistory() {
  if (!historyTasks.value.length) return
  dialog.value = {
    kind: 'clear-history',
    title: '清空所有',
    message: '确定要清空所有历史任务吗？此操作不可恢复。',
    ok: '清空所有',
    danger: true,
  }
}

function askDeleteTask(row: OutreachHistoryRow, event: Event) {
  event.stopPropagation()
  if (row.status === 'running') {
    showNotice('warning', '任务正在运行，无法删除')
    return
  }
  pendingTaskId.value = row.id || ''
  dialog.value = {
    kind: 'delete-task',
    title: '删除任务',
    message: '确定要删除这个任务吗？此操作不可恢复。',
    ok: '删除',
    danger: true,
  }
}

async function doClearHistory() {
  if (!accountId.value) return
  if (runningHere.value || historyTasks.value.some(row => row.status === 'running')) {
    showNotice('warning', '任务正在运行，请等待完成后操作')
    return
  }
  error.value = ''
  try {
    await clearOutreachHistory(accountId.value)
    showNotice('success', '已清空所有历史任务')
    selectedTaskId.value = ''
    await load()
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : '无法清空历史任务'
    showNotice('warning', message)
  }
}

async function doDeleteTask(taskId: string) {
  if (!accountId.value || !taskId) return
  error.value = ''
  try {
    await deleteOutreachTask(accountId.value, taskId)
    showNotice('success', '删除成功')
    if (selectedTaskId.value === taskId) selectedTaskId.value = ''
    await load()
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : '无法删除任务'
    showNotice('warning', message)
  }
}

async function chooseChrome() {
  picking.value = true
  try {
    await shell.saveBrowserPath(chromeDraft.value.trim())
    chromeDraft.value = shell.browserPath
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '无法保存 Chrome 路径'
  } finally {
    picking.value = false
  }
}

async function saveChromePath() {
  if (chromeSaving.value) return
  chromeSaving.value = true
  error.value = ''
  try {
    await shell.saveBrowserPath(chromeDraft.value.trim())
    chromeDraft.value = shell.browserPath
    if (!shell.browserDetected) {
      showNotice('error', `路径错误：找不到 Chrome：${chromeDraft.value || '未设置路径'}`)
      return
    }
    showNotice('success', '已保存Chrome浏览器路径')
  } catch (cause) {
    showNotice('error', `路径检测异常：${cause instanceof Error ? cause.message : '无法保存 Chrome 路径'}`)
  } finally {
    chromeSaving.value = false
  }
}

function bumpCount(delta: number) {
  maxCount.value = Math.min(999, Math.max(1, Number(maxCount.value || 1) + delta))
  void persist()
}

function clampWatch(value: number) {
  return Math.max(0, Math.min(RANGE_MAX, Math.round(value)))
}

function watchFromPointer(event: PointerEvent) {
  const el = rangeTrack.value
  if (!el) return 0
  const rect = el.getBoundingClientRect()
  const ratio = (event.clientX - rect.left) / Math.max(1, rect.width)
  return clampWatch(ratio * RANGE_MAX)
}

function applyWatchHandle(handle: 'min' | 'max', value: number) {
  if (handle === 'min') minWatch.value = Math.min(value, maxWatch.value)
  else maxWatch.value = Math.max(value, minWatch.value)
  const current = handle === 'min' ? minWatch.value : maxWatch.value
  rangeTip.value = { value: current, pct: (current / RANGE_MAX) * 100 }
}

function onRangePointerDown(event: PointerEvent, handle?: 'min' | 'max') {
  event.preventDefault()
  const value = watchFromPointer(event)
  const next = handle || (Math.abs(value - minWatch.value) <= Math.abs(value - maxWatch.value) ? 'min' : 'max')
  rangeDrag.value = next
  applyWatchHandle(next, value)
  window.addEventListener('pointermove', onRangePointerMove)
  window.addEventListener('pointerup', onRangePointerUp)
}

function onRangePointerMove(event: PointerEvent) {
  if (!rangeDrag.value) return
  applyWatchHandle(rangeDrag.value, watchFromPointer(event))
}

function onRangePointerUp() {
  rangeDrag.value = null
  rangeTip.value = null
  window.removeEventListener('pointermove', onRangePointerMove)
  window.removeEventListener('pointerup', onRangePointerUp)
  void persist()
}

function onRangeKey(handle: 'min' | 'max', event: KeyboardEvent) {
  const delta = event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1
    : event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1
      : 0
  if (!delta) return
  event.preventDefault()
  applyWatchHandle(handle, clampWatch((handle === 'min' ? minWatch.value : maxWatch.value) + delta))
  void persist()
}

const rangeFillStyle = computed(() => ({
  left: `${(minWatch.value / RANGE_MAX) * 100}%`,
  width: `${((maxWatch.value - minWatch.value) / RANGE_MAX) * 100}%`,
}))

function goHome() {
  page.value = 'home'
  configMenuOpen.value = false
}

watch(accountId, () => {
  if (props.surface === 'settings') return
  page.value = 'home'
  selectedTaskId.value = ''
  videoFilter.value = 'all'
  videoPage.value = 1
  void load()
})
watch([videoFilter, selectedTaskId], () => { videoPage.value = 1 })
watch(() => task.value.running, (running, wasRunning) => {
  if (wasRunning && !running) void load()
})
watch(() => `${task.value.running}:${task.value.scanned}:${task.value.commented}`, () => {
  if (props.surface !== 'task' || !task.value.running || modal.value) return
  if (rulesSignature(ruleGroups.value) !== loadedRules.value) return
  void load(true)
})
watch(() => shell.browserPath, (value) => {
  if (value && value !== chromeDraft.value) chromeDraft.value = value
}, { immediate: true })
onMounted(() => { if (props.surface !== 'settings') void load() })
onUnmounted(() => {
  window.removeEventListener('pointermove', onRangePointerMove)
  window.removeEventListener('pointerup', onRangePointerUp)
})

function closeMenus(event: MouseEvent) {
  const target = event.target as HTMLElement
  if (!target.closest('.lz-config-wrap')) configMenuOpen.value = false
  if (!target.closest('.lz-help')) helpOpen.value = false
}
</script>

<template>
  <section class="lz-workbench" :aria-label="surface === 'settings' ? '全局设置' : workbenchLabel" @click="closeMenus">
    <main class="lz-main">
      <div v-if="notice" class="lz-toast" :data-kind="notice.kind">{{ notice.text }}</div>

      <div v-if="surface === 'settings'" class="lz-body lz-settings-body">
        <section class="lz-settings-block">
          <div class="lz-settings-title">
            <h2>Chrome浏览器路径</h2>
            <button
              type="button"
              class="lz-start lz-save"
              :disabled="chromeSaving"
              @click="saveChromePath"
            >{{ chromeSaving ? '正在验证路径...' : '保存' }}</button>
          </div>
          <div class="lz-settings-card">
            <label class="lz-field">可执行文件路径
              <span class="lz-path">
                <input v-model="chromeDraft" type="text" spellcheck="false" placeholder="/path/to/Google Chrome" :disabled="picking || chromeSaving" />
                <button type="button" class="lz-ghost" :disabled="picking || chromeSaving" @click="chooseChrome">选择</button>
              </span>
            </label>
            <div class="lz-settings-hint">
              <p>Mac：默认/Applications/Google Chrome.app/Contents/MacOS/Google Chrome</p>
              <p>Windows：请选择 chrome.exe 或手动输入</p>
            </div>
          </div>
        </section>
      </div>

      <template v-else>
      <header v-if="page === 'home'" class="lz-top">
        <div class="lz-top-left">
          <button type="button" class="lz-ghost" @click="page = 'history'">
            <Clock :size="14" />
            历史任务
            <span v-if="runningHere" class="lz-dot" />
          </button>
        </div>
        <div class="lz-top-right">
          <div class="lz-config-wrap">
            <button type="button" class="lz-ghost" @click.stop="configMenuOpen = !configMenuOpen">配置管理</button>
            <div v-if="configMenuOpen" class="lz-menu-pop" @click.stop>
              <button type="button" @click="dialog = { kind: 'import', title: '导入配置', message: '导入后将覆盖当前规则配置，是否继续？', ok: '选择文件' }">导入配置</button>
              <button type="button" @click="exportConfig">导出配置</button>
              <button type="button" @click="dialog = { kind: 'clear', title: '清空配置', message: '确定清空当前规则配置吗？', ok: '清空', danger: true }">清空配置</button>
              <button type="button" @click="bannerOpen = true; configMenuOpen = false">配置模版</button>
            </div>
          </div>
          <button
            type="button"
            class="lz-start"
            :disabled="runningHere || saving"
            :title="runningHere ? '任务正在运行，请等待完成或前往历史任务停止' : ''"
            @click="startTask"
          >
            <Play :size="14" />
            开始任务
          </button>
        </div>
      </header>

      <header v-else-if="page === 'history'" class="lz-top lz-top-sub">
        <div class="lz-top-left">
          <button type="button" class="lz-back" aria-label="返回" @click="goHome">
            <ArrowLeft :size="20" />
          </button>
          <h1>历史任务</h1>
        </div>
        <button
          v-if="historyTasks.length"
          type="button"
          class="lz-error-secondary"
          @click="askClearHistory"
        >
          <Trash :size="16" />
          清空所有
        </button>
      </header>

      <header v-else-if="page === 'detail'" class="lz-detail-head">
        <div class="lz-detail-card">
          <div class="lz-detail-bar">
            <div class="lz-top-left">
              <button type="button" class="lz-back" aria-label="返回" @click="page = 'history'">
                <ArrowLeft :size="20" />
              </button>
              <h1>任务详情</h1>
            </div>
            <div v-if="selectedTask?.status === 'running' || selectedTask?.status === 'paused'" class="lz-detail-actions">
              <button type="button" class="lz-error-secondary" @click="togglePause">
                <Pause v-if="!task.paused" :size="16" />
                <Play v-else :size="16" />
                {{ task.paused ? '继续' : '暂停' }}
              </button>
              <button type="button" class="lz-danger-fill" @click="stopTask">
                <CircleStop :size="16" />
                停止任务
              </button>
            </div>
          </div>
          <template v-if="selectedTask">
            <div class="lz-detail-metrics">
              <div>
                <span>任务状态</span>
                <b class="lz-tag" :data-tone="statusTone(selectedTask.status)">
                  <Pause v-if="selectedTask.status === 'paused'" :size="14" />
                  <Clock v-else-if="selectedTask.status === 'running'" :size="14" />
                  <CircleCheck v-else-if="selectedTask.status === 'completed'" :size="14" />
                  <CircleX v-else-if="selectedTask.status === 'error'" :size="14" />
                  <CircleStop v-else :size="14" />
                  {{ statusLabel(selectedTask.status) }}
                </b>
              </div>
              <div>
                <span>评论成功</span>
                <strong>{{ selectedTask.commented || 0 }} 次</strong>
              </div>
              <div>
                <span>处理视频</span>
                <strong>{{ processedCount(selectedTask) }} 个</strong>
              </div>
              <div>
                <span>评论成功率</span>
                <strong>{{ rate(selectedTask) }}</strong>
              </div>
            </div>
            <div class="lz-detail-times">
              <div>
                <span>开始时间</span>
                <p>{{ formatTime(selectedTask.startedAt) }}</p>
              </div>
              <div>
                <span>结束时间</span>
                <p>{{ formatTime(selectedTask.endedAt) }}</p>
              </div>
            </div>
            <div v-if="selectedTask.status === 'error' && selectedTask.error" class="lz-detail-error">
              <span>错误信息</span>
              <p>{{ selectedTask.error }}</p>
            </div>
          </template>
          <p v-else class="lz-empty-inline">任务不存在</p>
        </div>
      </header>

      <div class="lz-body" :class="{ 'lz-subpage': page !== 'home' }">
        <p v-if="error" class="lz-error" role="alert">{{ error }}</p>
        <p v-if="loading && page === 'home'" class="lz-muted">加载中…</p>

        <template v-if="page === 'home'">
          <section v-if="bannerOpen" class="lz-banner">
            <div class="lz-banner-title">
              <Smile :size="18" />
              <strong>快速体验“自动评论引流”功能</strong>
            </div>
            <button type="button" class="lz-banner-close" aria-label="关闭" @click="dismissBanner"><X :size="14" /></button>
            <p>以下是我们使用AI生成的一些简易模版，方便您快速体验功能，而非各个行业的最佳实践，请您根据实际需求自行调整规则。</p>
            <div class="lz-chips">
              <button v-for="item in OUTREACH_COMMENT_TEMPLATES" :key="item.id" type="button" @click="askTemplate(item.id)">{{ item.name }}</button>
            </div>
          </section>

          <div class="lz-rules-head">
            <div>
              <h2>规则配置：</h2>
              <p>只有配置了评论内容系统才会发布评论哦～</p>
            </div>
            <button type="button" class="lz-link" @click="addRootGroup">新增规则组</button>
          </div>

          <div class="lz-table" role="table" aria-label="规则组">
            <div class="lz-tr lz-th" role="row">
              <span>规则组名称</span>
              <span>类型</span>
              <span>评论内容</span>
              <span>操作</span>
            </div>
            <div v-for="row in visibleRows" :key="row.group.id" class="lz-tr" role="row">
              <span class="lz-name" :style="{ paddingLeft: `${12 + row.depth * 22}px` }">
                <button
                  v-if="row.group.children.length"
                  type="button"
                  class="lz-expand"
                  @click="toggleExpand(row.group.id)"
                >
                  <ChevronDown v-if="expanded.has(row.group.id)" :size="14" />
                  <ChevronRight v-else :size="14" />
                </button>
                <span v-else class="lz-expand-spacer" />
                {{ row.group.name }}
              </span>
              <span class="lz-muted">{{ typeLabel(row.group) }}</span>
              <span v-if="row.group.children.length" class="lz-muted">/</span>
              <button
                v-else-if="groupHasCommentConfig(row.group)"
                type="button"
                class="lz-comment-preview"
                @click="openCommentModal(row.group)"
              >
                <span>{{ commentPreviewText(row.group) }}</span>
                <span v-if="commentPreviewExtra(row.group)" class="lz-comment-extra">{{ commentPreviewExtra(row.group) }}</span>
              </button>
              <button v-else type="button" class="lz-link" @click="openCommentModal(row.group)">配置评论内容</button>
              <span class="lz-actions">
                <button type="button" @click="openRuleModal(row.group)">编辑</button>
                <button type="button" @click="duplicateGroup(row.group.id)">复制</button>
                <button type="button" @click="askDeleteGroup(row.group.id)">删除</button>
                <button type="button" @click="addChildGroup(row.group.id)">新增子规则组</button>
              </span>
            </div>
          </div>

          <label class="lz-count">
            <span>评论次数：</span>
            <span class="lz-stepper">
              <input v-model.number="maxCount" type="number" min="1" max="999" @change="persist()" />
              <button type="button" @click="bumpCount(-1)">−</button>
              <button type="button" @click="bumpCount(1)">+</button>
            </span>
          </label>

          <section class="lz-fold">
            <button type="button" class="lz-fold-head" @click="runtimeOpen = !runtimeOpen">
              <ChevronDown :class="{ 'is-open': runtimeOpen }" :size="14" />
              运行设置
            </button>
            <div v-if="runtimeOpen" class="lz-fold-body">
              <label class="lz-check">
                <input v-model="simulateWatch" type="checkbox" @change="persist()" />
                是否模拟真人先观看视频再评论
              </label>
              <div v-if="simulateWatch" class="lz-range">
                <p class="lz-range-copy">
                  视频将随机播放<span>{{ minWatch }}秒</span>至<span>{{ maxWatch }}秒</span>后评论
                </p>
                <div
                  ref="rangeTrack"
                  class="lz-range-track"
                  role="group"
                  aria-label="观看时长区间"
                  @pointerdown="onRangePointerDown($event)"
                >
                  <div class="lz-range-fill" :style="rangeFillStyle" />
                  <button
                    type="button"
                    class="lz-range-thumb"
                    :class="{ 'is-drag': rangeDrag === 'min' }"
                    :style="{ left: `${(minWatch / RANGE_MAX) * 100}%` }"
                    :aria-valuemin="0"
                    :aria-valuemax="maxWatch"
                    :aria-valuenow="minWatch"
                    aria-label="最短观看秒数"
                    role="slider"
                    @pointerdown.stop="onRangePointerDown($event, 'min')"
                    @keydown="onRangeKey('min', $event)"
                  />
                  <button
                    type="button"
                    class="lz-range-thumb"
                    :class="{ 'is-drag': rangeDrag === 'max' }"
                    :style="{ left: `${(maxWatch / RANGE_MAX) * 100}%` }"
                    :aria-valuemin="minWatch"
                    :aria-valuemax="RANGE_MAX"
                    :aria-valuenow="maxWatch"
                    aria-label="最长观看秒数"
                    role="slider"
                    @pointerdown.stop="onRangePointerDown($event, 'max')"
                    @keydown="onRangeKey('max', $event)"
                  />
                  <span
                    v-if="rangeTip"
                    class="lz-range-tip"
                    :style="{ left: `${rangeTip.pct}%` }"
                  >{{ rangeTip.value }}秒</span>
                </div>
              </div>
              <label class="lz-check">
                <input v-model="onlyActive" type="checkbox" @change="persist()" />
                只评论活跃视频
                <span class="lz-help">
                  <button type="button" class="lz-help-btn" @click.stop="helpOpen = !helpOpen"><CircleHelp :size="14" /></button>
                  <span v-if="helpOpen" class="lz-help-pop">只评论2天内有人评论的视频</span>
                </span>
              </label>
            </div>
          </section>

          <section class="lz-fold">
            <button type="button" class="lz-fold-head" @click="keywordOpen = !keywordOpen">
              <ChevronDown :class="{ 'is-open': keywordOpen }" :size="14" />
              关键词屏蔽设置
            </button>
            <p class="lz-fold-sub">若视频命中设置的关键词，则跳过视频</p>
            <div v-if="keywordOpen" class="lz-fold-body">
              <div class="lz-dyn">
                <span>作者昵称</span>
                <div v-for="(_, index) in authorBlockKeywords" :key="`a-${index}`" class="lz-dyn-row">
                  <input v-model="authorBlockKeywords[index]" placeholder="包含该关键词的作者将被跳过" @change="persist()" />
                  <button type="button" @click="authorBlockKeywords.splice(index, 1); persist()">删除</button>
                </div>
                <button type="button" class="lz-ghost" @click="authorBlockKeywords.push('')">添加</button>
              </div>
              <div class="lz-dyn">
                <span>视频描述</span>
                <div v-for="(_, index) in blockKeywords" :key="`b-${index}`" class="lz-dyn-row">
                  <input v-model="blockKeywords[index]" placeholder="包含该关键词的视频将被跳过" @change="persist()" />
                  <button type="button" @click="blockKeywords.splice(index, 1); persist()">删除</button>
                </div>
                <button type="button" class="lz-ghost" @click="blockKeywords.push('')">添加</button>
              </div>
            </div>
          </section>
        </template>

        <template v-else-if="page === 'history'">
          <p v-if="loading" class="lz-muted">加载中…</p>
          <div v-else-if="historyTasks.length" class="lz-task-list">
            <article
              v-for="row in historyTasks"
              :key="row.id || row.startedAt"
              class="lz-task-card"
              @click="openTask(row)"
            >
              <div class="lz-task-head">
                <div class="lz-task-status">
                  <span class="lz-tag" :data-tone="statusTone(row.status)">
                    <Clock v-if="row.status === 'running'" :size="12" />
                    <CircleCheck v-else-if="row.status === 'completed'" :size="12" />
                    <CircleX v-else-if="row.status === 'error'" :size="12" />
                    <CircleStop v-else :size="12" />
                    {{ statusLabel(row.status) }}
                  </span>
                  <span class="lz-task-count">评论成功 {{ row.commented || 0 }} 次</span>
                </div>
                <button
                  type="button"
                  class="lz-task-trash"
                  :disabled="row.status === 'running'"
                  :aria-label="row.status === 'running' ? '任务正在运行，无法删除' : '删除任务'"
                  @click="askDeleteTask(row, $event)"
                >
                  <Trash :size="16" />
                </button>
              </div>
              <div class="lz-task-meta">
                <p><span>开始时间：</span>{{ formatTime(row.startedAt) }}</p>
                <p v-if="row.endedAt"><span>结束时间：</span>{{ formatTime(row.endedAt) }}</p>
                <p><span>持续时间：</span>{{ formatDuration(row) }}</p>
              </div>
              <p v-if="row.status === 'error' && row.error" class="lz-task-error">
                <span>错误信息：</span>{{ row.error }}
              </p>
              <p class="lz-task-videos"><span>处理视频：</span>{{ processedCount(row) }} 个</p>
            </article>
            <p class="lz-history-foot">仅保留最近10条记录</p>
          </div>
          <div v-else class="lz-empty">暂无任务历史记录</div>
        </template>

        <template v-else-if="page === 'detail'">
          <section v-if="selectedTask?.status === 'running' || selectedTask?.status === 'paused'" class="lz-panel">
            <h2>运行日志</h2>
            <pre v-if="detailLogs.length" class="lz-log">{{ detailLogs.map(line => line.text).join('\n') }}</pre>
            <p v-else class="lz-muted">暂无日志</p>
          </section>
          <section class="lz-panel">
            <div class="lz-panel-head">
              <h2>视频观看记录</h2>
              <div class="lz-radio" role="radiogroup" aria-label="筛选视频记录">
                <button type="button" :class="{ 'is-on': videoFilter === 'all' }" @click="videoFilter = 'all'">
                  全部 ({{ detailVideos.length }})
                </button>
                <button type="button" :class="{ 'is-on': videoFilter === 'commented' }" @click="videoFilter = 'commented'">
                  已评论 ({{ commentedVideoCount }})
                </button>
              </div>
            </div>
            <div v-if="pagedVideos.length" class="lz-table-wrap">
              <table class="lz-video-table">
                <thead>
                  <tr>
                    <th>作者</th>
                    <th>视频描述</th>
                    <th>视频标签</th>
                    <th>观看时长</th>
                    <th>评论状态</th>
                    <th>评论内容/跳过原因</th>
                    <th>视频链接</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(row, index) in pagedVideos" :key="row.awemeId || `${row.at}-${index}`">
                    <td>{{ row.nickname || '-' }}</td>
                    <td>{{ row.desc || '-' }}</td>
                    <td>{{ (row.tags || []).join(', ') || '-' }}</td>
                    <td>{{ formatWatchDuration(row.watchDuration) }}</td>
                    <td>
                      <span class="lz-tag" :data-tone="videoCommented(row) ? 'success' : 'default'">
                        {{ videoCommented(row) ? '已评论' : '未评论' }}
                      </span>
                    </td>
                    <td>{{ videoCommented(row) ? (row.text || '-') : (row.reason || '-') }}</td>
                    <td>
                      <a v-if="videoShareUrl(row)" :href="videoShareUrl(row)" target="_blank" rel="noreferrer">查看视频</a>
                      <span v-else>-</span>
                    </td>
                  </tr>
                </tbody>
              </table>
              <div v-if="filteredVideos.length > 20" class="lz-pager">
                <button type="button" :disabled="videoPage <= 1" @click="videoPage -= 1">上一页</button>
                <span>{{ videoPage }} / {{ videoPageCount }}</span>
                <button type="button" :disabled="videoPage >= videoPageCount" @click="videoPage += 1">下一页</button>
              </div>
            </div>
            <div v-else class="lz-empty lz-empty-sm">暂无视频记录</div>
          </section>
        </template>
      </div>
      </template>
    </main>

    <input ref="importInput" class="lz-file" type="file" accept="application/json" @change="onImportFile" />
    <input ref="imageFileInput" class="lz-file" type="file" accept="image/png,image/jpeg,image/gif,image/webp" @change="onPickCommentImages" />
    <input ref="imageFolderInput" class="lz-file" type="file" webkitdirectory @change="onPickCommentImages" />

    <div v-if="dialog" class="lz-mask" @click.self="dialog = null">
      <div class="lz-dialog" role="dialog">
        <h3>{{ dialog.title }}</h3>
        <p>{{ dialog.message }}</p>
        <div class="lz-dialog-actions">
          <button type="button" class="lz-ghost" @click="dialog = null">取消</button>
          <button type="button" :class="dialog.danger ? 'lz-danger-fill' : 'lz-start'" @click="confirmDialog">{{ dialog.ok }}</button>
        </div>
      </div>
    </div>

    <div v-if="modal === 'rule'" class="lz-mask" @click.self="modal = null">
      <div class="lz-dialog lz-wide" role="dialog">
        <h3>规则组配置</h3>
        <label class="lz-field">规则组名称
          <input v-model="draftName" />
        </label>
        <label class="lz-field">规则类型
          <select v-model="draftType">
            <option value="manual">手动配置规则</option>
            <option value="ai" disabled>AI判断规则（请前往全局设置配置 API Key）</option>
          </select>
        </label>
        <label class="lz-field">规则关系
          <select v-model="draftRelation">
            <option value="or">任一满足</option>
            <option value="and">全部满足</option>
          </select>
        </label>
        <div class="lz-field">
          <span>规则列表</span>
          <div v-for="(rule, index) in draftRules" :key="index" class="lz-rule-row">
            <select v-model="rule.field">
              <option v-for="option in FIELD_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select>
            <span>包含关键字</span>
            <input v-model="rule.keyword" />
            <button type="button" @click="draftRules.splice(index, 1)">删除</button>
          </div>
          <button type="button" class="lz-ghost" @click="draftRules.push({ field: 'nickName', keyword: '' })">添加规则</button>
        </div>
        <div class="lz-dialog-actions">
          <button type="button" class="lz-ghost" @click="modal = null">取消</button>
          <button type="button" class="lz-start" @click="saveRuleModal">确定</button>
        </div>
      </div>
    </div>

    <div v-if="modal === 'comments'" class="lz-mask" @click.self="modal = null">
      <div class="lz-dialog lz-comment-modal" role="dialog" aria-labelledby="lz-comment-title">
        <header class="lz-comment-head">
          <h3 id="lz-comment-title">配置评论内容</h3>
          <button type="button" class="lz-comment-close" aria-label="关闭" @click="modal = null"><X :size="16" /></button>
        </header>
        <div class="lz-comment-form">
          <span class="lz-comment-form-label">评论内容：</span>
          <div class="lz-comment-form-body">
            <div class="lz-comment-block">
              <h4><strong>*</strong>评论文案</h4>
              <p>若配置多个文案则随机抽取一个评论</p>
              <div v-if="!draftComments.length" class="lz-comment-empty">
                <svg class="lz-empty-icon" viewBox="0 0 28 28" fill="none" aria-hidden="true">
                  <path d="M26 7.5C26 11.0899 23.0899 14 19.5 14C15.9101 14 13 11.0899 13 7.5C13 3.91015 15.9101 1 19.5 1C23.0899 1 26 3.91015 26 7.5ZM16.8536 4.14645C16.6583 3.95118 16.3417 3.95118 16.1464 4.14645C15.9512 4.34171 15.9512 4.65829 16.1464 4.85355L18.7929 7.5L16.1464 10.1464C15.9512 10.3417 15.9512 10.6583 16.1464 10.8536C16.3417 11.0488 16.6583 11.0488 16.8536 10.8536L19.5 8.20711L22.1464 10.8536C22.3417 11.0488 22.6583 11.0488 22.8536 10.8536C23.0488 10.6583 23.0488 10.3417 22.8536 10.1464L20.2071 7.5L22.8536 4.85355C23.0488 4.65829 23.0488 4.34171 22.8536 4.14645C22.6583 3.95118 22.3417 3.95118 22.1464 4.14645L19.5 6.79289L16.8536 4.14645Z" fill="currentColor" />
                  <path d="M25 22.75V12.5991C24.5572 13.0765 24.053 13.4961 23.5 13.8454V16H17.5L17.3982 16.0068C17.0322 16.0565 16.75 16.3703 16.75 16.75C16.75 18.2688 15.5188 19.5 14 19.5C12.4812 19.5 11.25 18.2688 11.25 16.75L11.2432 16.6482C11.1935 16.2822 10.8797 16 10.5 16H4.5V7.25C4.5 6.2835 5.2835 5.5 6.25 5.5H12.2696C12.4146 4.97463 12.6153 4.47237 12.865 4H6.25C4.45507 4 3 5.45507 3 7.25V22.75C3 24.5449 4.45507 26 6.25 26H21.75C23.5449 26 25 24.5449 25 22.75ZM4.5 22.75V17.5H9.81597L9.85751 17.7041C10.2905 19.5919 11.9808 21 14 21L14.215 20.9947C16.2095 20.8953 17.842 19.4209 18.184 17.5H23.5V22.75C23.5 23.7165 22.7165 24.5 21.75 24.5H6.25C5.2835 24.5 4.5 23.7165 4.5 22.75Z" fill="currentColor" />
                </svg>
                <span>暂无评论文案</span>
                <div class="lz-comment-empty-actions">
                  <button type="button" class="lz-add-comment" @click="draftComments.push('')">添加文案</button>
                  <button type="button" class="lz-ai-soon" disabled>AI自动评论（敬请期待）</button>
                </div>
              </div>
              <div v-else class="lz-comment-list">
                <div v-for="(_, index) in draftComments" :key="index" class="lz-dyn-row">
                  <input v-model="draftComments[index]" placeholder="输入评论文案" />
                  <button type="button" class="lz-comment-delete" @click="draftComments.splice(index, 1)">删除</button>
                </div>
                <button type="button" class="lz-add-comment lz-add-comment-plain" @click="draftComments.push('')">添加文案</button>
              </div>
            </div>
            <div class="lz-comment-block">
              <div class="lz-image-head">
                <div>
                  <h4>评论图片（可选）</h4>
                  <p>若选择文件夹则会从文件夹中随机抽取图片评论</p>
                </div>
                <div class="lz-image-radios" role="radiogroup" aria-label="图片选择方式">
                  <label><input v-model="draftImageType" type="radio" value="folder" /> 文件夹</label>
                  <label><input v-model="draftImageType" type="radio" value="file" /> 单文件</label>
                </div>
              </div>
              <div class="lz-path">
                <span class="lz-path-field">
                  <input
                    :value="draftImageName || draftImagePath"
                    type="text"
                    readonly
                    placeholder="点击右侧选择文件或文件夹，不选择则不评论图片"
                  />
                  <button v-if="draftImagePath" type="button" class="lz-path-clear" aria-label="清除图片" @click="clearCommentImage"><X :size="14" /></button>
                </span>
                <button type="button" class="lz-select-btn" :disabled="pickingImage" @click="pickCommentImages">
                  {{ pickingImage ? '上传中...' : '选择' }}
                </button>
              </div>
            </div>
          </div>
        </div>
        <div class="lz-dialog-actions">
          <button type="button" class="lz-ghost" @click="modal = null">取消</button>
          <button type="button" class="lz-start" @click="saveCommentModal">确定</button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.lz-workbench {
  --lz-bg: #101014;
  --lz-panel: #18181c;
  --lz-text: #e6e6e6;
  --lz-muted: #9a9aa0;
  --lz-line: rgba(255, 255, 255, .09);
  --lz-green: #32f08c;
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  color: var(--lz-text);
  background: var(--lz-bg);
  font-family: Inter, ui-sans-serif, system-ui, "PingFang SC", "Noto Sans SC", sans-serif;
}
.lz-main { position: relative; display: flex; min-width: 0; min-height: 0; flex: 1; flex-direction: column; }
.lz-settings-body { padding-top: 28px; }
.lz-top {
  position: sticky;
  top: 0;
  z-index: 8;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 22px 40px 12px;
  background: rgba(16, 16, 20, .5);
  backdrop-filter: blur(12px);
}
.lz-top-sub { padding: 24px 24px 12px; }
.lz-top-left, .lz-top-right { display: flex; align-items: center; gap: 8px; }
.lz-top h1, .lz-detail-bar h1 {
  margin: 0;
  color: #fff;
  font-size: 20px;
  font-weight: 700;
  line-height: 1.2;
}
.lz-body {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: 16px;
  padding: 8px 40px 40px;
  overflow: auto;
}
.lz-body.lz-subpage { padding: 24px; gap: 16px; }
.lz-ghost, .lz-link, .lz-danger, .lz-start, .lz-danger-fill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--lz-line);
  border-radius: 6px;
  color: var(--lz-text);
  background: transparent;
  cursor: pointer;
  font: inherit;
  font-size: 13px;
}
.lz-ghost.is-on { color: var(--lz-green); border-color: transparent; background: rgba(50, 240, 140, .1); }
.lz-link, .lz-actions button, .lz-comment-preview { border: 0; color: var(--lz-green); background: transparent; cursor: pointer; font: inherit; }
.lz-start { border: 0; color: #062314; background: var(--lz-green); font-weight: 650; }
.lz-start:disabled { cursor: not-allowed; opacity: .45; }
.lz-danger { color: #ff6b6b; }
.lz-danger-fill { border: 0; color: #fff; background: #d03050; }
.lz-back {
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border: 0;
  color: var(--lz-text);
  background: transparent;
  cursor: pointer;
}
.lz-error-secondary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 12px;
  border: 1px solid rgba(208, 48, 80, .28);
  border-radius: 6px;
  color: #e88080;
  background: rgba(208, 48, 80, .16);
  cursor: pointer;
  font: inherit;
  font-size: 13px;
}
.lz-toast {
  position: absolute;
  top: 16px;
  right: 24px;
  z-index: 20;
  padding: 10px 14px;
  border-radius: 8px;
  color: #fff;
  background: #2a2a32;
  box-shadow: 0 10px 28px rgba(0, 0, 0, .35);
  font-size: 13px;
}
.lz-toast[data-kind="success"] { background: #1b4b34; color: var(--lz-green); }
.lz-toast[data-kind="warning"] { background: #4a3a16; color: #f6c768; }
.lz-toast[data-kind="error"] { background: #4a1d28; color: #ff8a8a; }
.lz-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--lz-green);
  box-shadow: 0 0 0 4px rgba(50, 240, 140, .18);
}
.lz-config-wrap { position: relative; }
.lz-menu-pop {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 12;
  display: grid;
  min-width: 148px;
  padding: 6px;
  border: 1px solid var(--lz-line);
  border-radius: 8px;
  background: #1c1c22;
  box-shadow: 0 12px 32px rgba(0, 0, 0, .35);
}
.lz-menu-pop button {
  padding: 8px 10px;
  border: 0;
  border-radius: 6px;
  color: var(--lz-text);
  background: transparent;
  text-align: left;
  cursor: pointer;
  font: inherit;
  font-size: 13px;
}
.lz-menu-pop button:hover { background: rgba(255, 255, 255, .06); }
.lz-error { margin: 0; color: #ff6b6b; font-size: 13px; }
.lz-muted { margin: 0; color: var(--lz-muted); font-size: 13px; line-height: 1.6; }
.lz-banner {
  position: relative;
  display: grid;
  gap: 8px;
  padding: 14px 40px 14px 16px;
  border: 1px solid rgba(240, 180, 40, .28);
  border-radius: 8px;
  color: #f3d19e;
  background: rgba(140, 90, 20, .28);
}
.lz-banner-title { display: flex; align-items: center; gap: 8px; color: #f6c768; }
.lz-banner p { margin: 0; color: #e8d3a8; font-size: 13px; line-height: 1.6; }
.lz-banner-close {
  position: absolute;
  top: 10px;
  right: 10px;
  border: 0;
  color: #e8d3a8;
  background: transparent;
  cursor: pointer;
}
.lz-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.lz-chips button {
  height: 26px;
  padding: 0 8px;
  border: 1px solid rgba(240, 180, 40, .35);
  border-radius: 4px;
  color: #f6c768;
  background: rgba(80, 50, 10, .35);
  cursor: pointer;
  font-size: 12px;
}
.lz-rules-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; }
.lz-rules-head h2 { margin: 0; font-size: 14px; font-weight: 600; }
.lz-rules-head p { margin: 4px 0 0; color: var(--lz-muted); font-size: 12px; }
.lz-table {
  overflow: hidden;
  border: 1px solid var(--lz-line);
  border-radius: 8px;
  background: var(--lz-panel);
}
.lz-tr {
  display: grid;
  grid-template-columns: minmax(180px, 1.1fr) 140px minmax(180px, 1.4fr) 260px;
  gap: 8px;
  align-items: center;
  min-height: 48px;
  padding: 0 12px;
  border-top: 1px solid var(--lz-line);
}
.lz-th { border-top: 0; color: var(--lz-muted); background: rgba(255, 255, 255, .02); font-size: 13px; }
.lz-name { display: flex; align-items: center; gap: 4px; min-width: 0; }
.lz-expand, .lz-expand-spacer {
  display: grid;
  width: 18px;
  height: 18px;
  place-items: center;
  border: 0;
  color: var(--lz-muted);
  background: transparent;
  cursor: pointer;
}
.lz-comment-preview {
  display: flex;
  align-items: center;
  min-width: 0;
  max-width: 224px;
  overflow: hidden;
  color: #86efac;
  text-align: left;
  white-space: nowrap;
  font-size: 13px;
}
.lz-comment-preview:hover { color: #bbf7d0; }
.lz-comment-preview span:first-child {
  min-width: 0;
  overflow: hidden;
  text-decoration: underline;
  text-underline-offset: 3px;
  text-overflow: ellipsis;
}
.lz-comment-extra { flex-shrink: 0; }
.lz-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.lz-actions button { padding: 0; font-size: 13px; }
.lz-count {
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--lz-text);
  font-size: 14px;
}
.lz-stepper {
  display: grid;
  grid-template-columns: 1fr 32px 32px;
  width: min(520px, 100%);
  overflow: hidden;
  border: 1px solid var(--lz-line);
  border-radius: 6px;
  background: #101014;
}
.lz-stepper input {
  min-width: 0;
  height: 34px;
  padding: 0 12px;
  border: 0;
  color: inherit;
  background: transparent;
  font: inherit;
}
.lz-stepper button {
  height: 34px;
  border: 0;
  border-left: 1px solid var(--lz-line);
  color: var(--lz-text);
  background: transparent;
  cursor: pointer;
}
.lz-fold { border-top: 1px solid var(--lz-line); }
.lz-fold-head {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 14px 0;
  border: 0;
  color: var(--lz-text);
  background: transparent;
  cursor: pointer;
  font: inherit;
  font-size: 14px;
}
.lz-fold-head svg { transition: transform .15s; }
.lz-fold-head svg.is-open { transform: rotate(180deg); }
.lz-fold-sub { margin: -8px 0 8px 22px; color: var(--lz-muted); font-size: 12px; }
.lz-fold-body { display: grid; gap: 12px; padding: 0 0 16px 22px; }
.lz-check { display: flex; align-items: center; gap: 8px; font-size: 14px; }
.lz-range { display: grid; gap: 10px; padding: 8px 0 4px; }
.lz-range-copy { margin: 0; color: var(--lz-text); font-size: 14px; }
.lz-range-copy span { padding: 0 4px; color: #bbf7d0; }
.lz-range-track {
  position: relative;
  height: 4px;
  margin: 10px 9px 14px;
  border-radius: 999px;
  background: rgba(255, 255, 255, .18);
  touch-action: none;
  cursor: pointer;
  user-select: none;
}
.lz-range-fill {
  position: absolute;
  top: 0;
  height: 100%;
  border-radius: inherit;
  background: var(--lz-green);
  pointer-events: none;
}
.lz-range-thumb {
  position: absolute;
  top: 50%;
  z-index: 1;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, .4);
  transform: translate(-50%, -50%);
  cursor: grab;
}
.lz-range-thumb.is-drag { cursor: grabbing; box-shadow: 0 0 0 4px rgba(50, 240, 140, .22), 0 1px 4px rgba(0, 0, 0, .4); }
.lz-range-thumb:focus-visible { outline: 2px solid var(--lz-green); outline-offset: 2px; }
.lz-range-tip {
  position: absolute;
  top: -30px;
  z-index: 2;
  padding: 2px 8px;
  border-radius: 4px;
  color: #fff;
  background: #2a2a32;
  transform: translateX(-50%);
  pointer-events: none;
  font-size: 12px;
  white-space: nowrap;
}
.lz-help { position: relative; display: inline-flex; }
.lz-help-btn { display: grid; place-items: center; border: 0; color: var(--lz-muted); background: transparent; cursor: pointer; }
.lz-help-pop {
  position: absolute;
  top: 22px;
  left: 0;
  z-index: 6;
  width: max-content;
  padding: 8px 10px;
  border-radius: 6px;
  color: var(--lz-text);
  background: #2a2a32;
  font-size: 12px;
}
.lz-dyn { display: grid; gap: 8px; }
.lz-dyn > span { color: var(--lz-muted); font-size: 13px; }
.lz-dyn-row, .lz-rule-row, .lz-path { display: flex; gap: 8px; }
.lz-dyn-row input, .lz-rule-row input, .lz-field input, .lz-field select, .lz-path input, .lz-settings input {
  min-width: 0;
  flex: 1;
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--lz-line);
  border-radius: 6px;
  color: inherit;
  background: #101014;
  font: inherit;
}
.lz-task-list { display: grid; gap: 16px; }
.lz-task-card {
  display: grid;
  gap: 12px;
  padding: 16px 18px;
  border: 1px solid var(--lz-line);
  border-radius: 10px;
  background: var(--lz-panel);
  cursor: pointer;
  transition: box-shadow .2s ease;
}
.lz-task-card:hover { box-shadow: 0 18px 40px rgba(50, 240, 140, .05); }
.lz-task-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.lz-task-status { display: flex; align-items: center; gap: 10px; min-width: 0; }
.lz-task-count { color: var(--lz-muted); font-size: 13px; }
.lz-task-trash {
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border: 0;
  color: #e88080;
  background: transparent;
  cursor: pointer;
}
.lz-task-trash:disabled { color: var(--lz-muted); cursor: not-allowed; }
.lz-task-meta { display: grid; gap: 4px; color: #b4b4bb; font-size: 13px; }
.lz-task-meta span, .lz-task-videos span, .lz-task-error span { color: #7d7d86; }
.lz-task-videos { margin: 0; color: var(--lz-muted); font-size: 13px; }
.lz-task-error { margin: 0; color: #ff6b6b; font-size: 13px; }
.lz-history-foot { margin: 4px 0 0; color: var(--lz-muted); font-size: 13px; text-align: center; }
.lz-empty {
  display: grid;
  place-items: center;
  min-height: 280px;
  margin-top: 96px;
  color: var(--lz-muted);
  font-size: 14px;
}
.lz-empty-sm { min-height: 160px; margin-top: 0; }
.lz-empty-inline { margin: 8px 0 0; color: var(--lz-muted); }
.lz-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding: 0 8px;
  border: 1px solid var(--lz-line);
  border-radius: 4px;
  color: var(--lz-text);
  background: rgba(255, 255, 255, .04);
  font-size: 12px;
  font-weight: 500;
}
.lz-tag[data-tone="info"] { color: #70c0e8; border-color: rgba(112, 192, 232, .28); background: rgba(112, 192, 232, .12); }
.lz-tag[data-tone="success"] { color: var(--lz-green); border-color: rgba(50, 240, 140, .28); background: rgba(50, 240, 140, .12); }
.lz-tag[data-tone="error"] { color: #ff6b6b; border-color: rgba(208, 48, 80, .28); background: rgba(208, 48, 80, .12); }
.lz-detail-head {
  position: sticky;
  top: 0;
  z-index: 8;
  padding: 16px 24px 0;
  background: rgba(16, 16, 20, .5);
  backdrop-filter: blur(16px);
}
.lz-detail-card {
  display: grid;
  gap: 16px;
  padding: 16px 18px 18px;
  border: 1px solid var(--lz-line);
  border-radius: 10px;
  background: var(--lz-panel);
  box-shadow: 0 8px 24px rgba(0, 0, 0, .25);
}
.lz-detail-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.lz-detail-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; }
.lz-tag[data-tone="warning"] { color: #ffd60a; border-color: rgba(255, 214, 10, .28); background: rgba(255, 214, 10, .12); }
.lz-detail-metrics, .lz-detail-times {
  display: grid;
  gap: 16px;
}
.lz-detail-metrics { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.lz-detail-times { grid-template-columns: 1fr 1fr; }
.lz-detail-metrics span, .lz-detail-times span, .lz-detail-error span {
  display: block;
  margin-bottom: 6px;
  color: var(--lz-muted);
  font-size: 13px;
}
.lz-detail-metrics strong, .lz-detail-times p { margin: 0; font-size: 16px; font-weight: 600; }
.lz-detail-times p { font-size: 13px; font-weight: 400; }
.lz-detail-error {
  padding: 12px;
  border-radius: 8px;
  background: rgba(208, 48, 80, .12);
}
.lz-detail-error p { margin: 0; color: #ff8a8a; font-size: 13px; }
.lz-panel {
  display: grid;
  gap: 12px;
  padding: 16px 18px;
  border: 1px solid var(--lz-line);
  border-radius: 10px;
  background: var(--lz-panel);
}
.lz-panel h2 { margin: 0; font-size: 16px; font-weight: 600; }
.lz-panel-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.lz-log {
  max-height: 330px;
  margin: 0;
  overflow: auto;
  color: #c8c8ce;
  font: 12px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: pre-wrap;
}
.lz-radio {
  display: inline-flex;
  overflow: hidden;
  border: 1px solid var(--lz-line);
  border-radius: 6px;
}
.lz-radio button {
  height: 28px;
  padding: 0 10px;
  border: 0;
  border-right: 1px solid var(--lz-line);
  color: var(--lz-muted);
  background: transparent;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
}
.lz-radio button:last-child { border-right: 0; }
.lz-radio button.is-on { color: var(--lz-text); background: rgba(255, 255, 255, .08); }
.lz-table-wrap { overflow: auto; }
.lz-video-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.lz-video-table th, .lz-video-table td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--lz-line);
  text-align: left;
  vertical-align: middle;
  white-space: nowrap;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.lz-video-table th { color: var(--lz-muted); font-weight: 500; }
.lz-video-table a { color: #70c0e8; text-decoration: none; }
.lz-video-table a:hover { text-decoration: underline; }
.lz-pager {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 0 0;
  color: var(--lz-muted);
  font-size: 12px;
}
.lz-pager button {
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--lz-line);
  border-radius: 6px;
  color: inherit;
  background: transparent;
  cursor: pointer;
}
.lz-pager button:disabled { opacity: .4; cursor: not-allowed; }
.lz-settings-block { display: grid; gap: 12px; max-width: 760px; }
.lz-settings-title { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.lz-settings-title h2 { margin: 0; font-size: 18px; font-weight: 700; }
.lz-save { height: 28px; padding: 0 12px; font-size: 12px; }
.lz-settings-card {
  display: grid;
  gap: 12px;
  padding: 16px 18px;
  border: 1px solid var(--lz-line);
  border-radius: 10px;
  background: var(--lz-panel);
}
.lz-settings-hint { color: var(--lz-muted); font-size: 13px; line-height: 1.7; }
.lz-settings-hint p { margin: 0; }
.lz-file { display: none; }
.lz-mask {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: grid;
  place-items: center;
  background: rgba(0, 0, 0, .45);
}
.lz-dialog {
  display: grid;
  width: min(420px, calc(100% - 32px));
  gap: 12px;
  padding: 20px;
  border: 1px solid var(--lz-line);
  border-radius: 10px;
  background: #1c1c22;
  box-shadow: 0 18px 48px rgba(0, 0, 0, .4);
}
.lz-dialog.lz-wide { width: min(640px, calc(100% - 32px)); }
.lz-dialog.lz-comment-modal {
  width: min(600px, calc(100% - 32px));
  padding: 0;
  gap: 0;
  overflow: hidden;
  background: #18181c;
}
.lz-dialog h3 { margin: 0; font-size: 16px; }
.lz-dialog p { margin: 0; color: var(--lz-muted); font-size: 13px; line-height: 1.6; }
.lz-dialog-actions { display: flex; justify-content: flex-end; gap: 8px; }
.lz-comment-modal .lz-dialog-actions { padding: 4px 24px 16px; }
.lz-comment-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 16px 24px;
  border-bottom: 1px solid var(--lz-line);
}
.lz-comment-head h3 { font-size: 18px; font-weight: 500; }
.lz-comment-close {
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border: 0;
  border-radius: 4px;
  color: var(--lz-muted);
  background: transparent;
  cursor: pointer;
}
.lz-comment-close:hover { color: var(--lz-text); background: rgba(255, 255, 255, .06); }
.lz-comment-form { display: flex; gap: 12px; align-items: flex-start; padding: 12px 24px 8px; }
.lz-comment-form-label { flex: 0 0 auto; padding-top: 10px; color: var(--lz-text); font-size: 14px; }
.lz-comment-form-body { display: grid; gap: 20px; min-width: 0; flex: 1; padding: 8px 0; }
.lz-comment-block h4 { margin: 0 0 4px; font-size: 14px; font-weight: 500; color: var(--lz-text); }
.lz-comment-block h4 strong { margin-right: 4px; color: #f87171; font-weight: 700; }
.lz-comment-block p { margin: 0 0 12px; color: var(--lz-muted); font-size: 12px; }
.lz-comment-empty {
  display: grid;
  justify-items: center;
  gap: 8px;
  min-height: 132px;
  padding: 8px 0 4px;
  color: var(--lz-muted);
  font-size: 14px;
}
.lz-empty-icon { width: 48px; height: 48px; color: #5c5c66; }
.lz-comment-empty-actions { display: flex; gap: 8px; justify-content: center; margin-top: 4px; }
.lz-comment-list { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; }
.lz-comment-list .lz-dyn-row { width: 100%; align-items: center; }
.lz-add-comment, .lz-ai-soon, .lz-comment-delete, .lz-select-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 28px;
  padding: 0 12px;
  border: 0;
  border-radius: 6px;
  cursor: pointer;
  font: inherit;
  font-size: 13px;
}
.lz-add-comment { color: var(--lz-green); background: rgba(50, 240, 140, .16); }
.lz-add-comment:hover { background: rgba(50, 240, 140, .22); }
.lz-add-comment-plain, .lz-select-btn {
  height: 34px;
  color: var(--lz-green);
  background: transparent;
}
.lz-add-comment-plain:hover, .lz-select-btn:hover { background: rgba(50, 240, 140, .1); }
.lz-select-btn:disabled { cursor: not-allowed; opacity: .45; }
.lz-comment-delete {
  height: 34px;
  color: #e88080;
  background: transparent;
}
.lz-comment-delete:hover { background: rgba(208, 48, 80, .12); }
.lz-ai-soon {
  color: var(--lz-muted);
  cursor: not-allowed;
  border: 1px solid transparent;
  background-image: linear-gradient(#18181c, #18181c), linear-gradient(to right, #f54180, #338ef7);
  background-origin: border-box;
  background-clip: padding-box, border-box;
}
.lz-image-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
.lz-image-head p { margin: 4px 0 0; }
.lz-image-radios { display: flex; align-items: center; gap: 18px; color: var(--lz-text); font-size: 14px; }
.lz-image-radios label { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; }
.lz-image-radios input {
  appearance: none;
  width: 16px;
  height: 16px;
  margin: 0;
  border: 2px solid #6b6b73;
  border-radius: 50%;
  background: transparent;
}
.lz-image-radios input:checked {
  border-color: var(--lz-green);
  background: radial-gradient(circle, var(--lz-green) 0 5px, transparent 6px);
}
.lz-path-field {
  position: relative;
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
}
.lz-path-field input { padding-right: 32px; }
.lz-path-clear {
  position: absolute;
  right: 6px;
  display: grid;
  width: 22px;
  height: 22px;
  place-items: center;
  border: 0;
  border-radius: 50%;
  color: var(--lz-muted);
  background: transparent;
  cursor: pointer;
}
.lz-path-clear:hover { color: var(--lz-text); background: rgba(255, 255, 255, .08); }
.lz-field { display: grid; gap: 6px; color: var(--lz-muted); font-size: 13px; }
.lz-rule-row { align-items: center; }
.lz-rule-row select { width: 120px; flex: 0 0 120px; }
@media (max-width: 980px) {
  .lz-tr { grid-template-columns: 1fr; padding: 10px 12px; }
  .lz-detail-metrics, .lz-detail-times { grid-template-columns: 1fr 1fr; }
  .lz-top, .lz-body, .lz-detail-head { padding-left: 16px; padding-right: 16px; }
}
</style>
