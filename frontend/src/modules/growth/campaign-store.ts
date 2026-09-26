import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { accountId } from '@/contracts'
import { useShellStore } from '@/stores/shell'
import { useWorkspace } from '@/modules/workspace/workspace'
import { campaignSteer, readCampaignPlan, type PlanState } from './campaign-plan'

export interface LibraryItem {
  id: string
  name: string
  mime: string
  kind: 'image' | 'video'
  bytes: number
  createdAt: string
}

export interface ComposerFile {
  key: string
  name: string
  mime: string
  kind: 'image' | 'video' | 'file'
  libraryId?: string
  file?: File
}

export interface BriefMessage {
  role: 'user' | 'assistant'
  text: string
}

export interface GrowthBrief {
  id: string
  status: 'collecting' | 'ready' | 'started'
  form: 'text' | 'image'
  audience: string
  tags: string[]
  excludes: string[]
  excludesAsked: boolean
  tone: string
  interaction: 'comment' | 'comment_like'
  maxCount: number
  commentImageIds: string[]
  referenceIds: string[]
  messages: BriefMessage[]
  accountId: string
}

let computerPick: () => void = () => {}

export const useGrowthCampaignStore = defineStore('growth-campaign', () => {
  const router = useRouter()
  const shell = useShellStore()
  const workspace = useWorkspace()
  const sessionId = ref('')
  const viewSession = ref('')
  const modes = ref<Record<string, '' | 'comment'>>({})
  const choices = ref<Record<string, { tone?: string; interaction?: GrowthBrief['interaction'] }>>({})
  const active = computed(() => modes.value[viewSession.value] === 'comment')
  const method = computed(() => modes.value[viewSession.value] || '')
  const libraryOpen = ref(false)
  const sending = ref(false)
  const starting = ref(false)
  const awaitingLogin = ref(false)
  const sawLogin = ref(false)
  const notice = ref('')
  const error = ref('')
  const items = ref<LibraryItem[]>([])
  const brief = ref<GrowthBrief | null>(null)
  const composerFiles = ref<ComposerFile[]>([])
  let loginRetries = 0
  let settling = false

  const commentImages = computed(() => items.value.filter(item => brief.value?.commentImageIds.includes(item.id)))
  const references = computed(() => items.value.filter(item => brief.value?.referenceIds.includes(item.id)))
  const imageCounts = ref<Record<string, number>>({})
  const imageCount = computed(() => {
    const staged = composerFiles.value.filter(file => file.kind === 'image').length
    return staged || commentImages.value.length || imageCounts.value[sessionId.value] || 0
  })
  const ownedBrief = computed(() => brief.value && sessionId.value && sessionId.value === viewSession.value ? brief.value : null)
  const sessionTone = computed(() => ownedBrief.value?.tone || choices.value[viewSession.value]?.tone || '')
  const sessionInteraction = computed(() => ownedBrief.value?.interaction || choices.value[viewSession.value]?.interaction || 'comment')

  async function load() {
    const response = await fetch('/api/runtime/growth/brief', { cache: 'no-store' })
    if (!response.ok) return
    const body = await response.json().catch(() => null) as { brief?: GrowthBrief; items?: LibraryItem[] } | null
    if (!body?.brief) return
    brief.value = body.brief
    items.value = Array.isArray(body.items) ? body.items : []
  }

  function showSession(id: string) {
    viewSession.value = id || ''
    if (!id || sessionId.value === id) return
    const stored = readPlans()[id]
    if (!stored || stored.status === 'started') return
    brief.value = stored
    sessionId.value = id
  }

  function setMode(id: string, value: '' | 'comment') {
    const key = id || ''
    const copy = { ...modes.value }
    if (value) copy[key] = value
    else delete copy[key]
    modes.value = copy
  }

  function rekey(from: string, to: string) {
    if (!to || from === to) return
    const copy = { ...modes.value }
    if (copy[from]) {
      copy[to] = copy[from]
      delete copy[from]
      modes.value = copy
    }
    if (choices.value[from]) {
      const nextChoices = { ...choices.value, [to]: choices.value[from] }
      delete nextChoices[from]
      choices.value = nextChoices
    }
    if (sessionId.value === from && brief.value?.status === 'collecting' && brief.value.messages.length === 0) sessionId.value = to
  }

  function markEditable() {
    if (brief.value?.status === 'started') brief.value = { ...brief.value, status: 'ready' }
  }

  function toggle(id = viewSession.value) {
    const key = id || ''
    setMode(key, modes.value[key] ? '' : 'comment')
    libraryOpen.value = false
    if (!modes.value[key] && sessionId.value === key) sessionId.value = ''
  }

  function bindSession(id: string) {
    if (!id || sessionId.value === id) return
    const stored = readPlans()[id]
    if (stored && stored.status !== 'started') {
      brief.value = stored
      sessionId.value = id
      return
    }
    if (brief.value && brief.value.status !== 'collecting') return
    sessionId.value = id
  }

  function setMethod(value: '' | 'comment') {
    setMode(viewSession.value, value)
  }

  async function applyQuickPick(pick: { audience: string; tags: string[]; tone: string }) {
    setMode(viewSession.value, 'comment')
    if (!brief.value) return
    await commitPatch({
      audience: pick.audience,
      tags: pick.tags,
      tone: pick.tone,
      interaction: 'comment',
    })
  }

  async function openLibrary() {
    libraryOpen.value = true
    const response = await fetch('/api/runtime/library', { cache: 'no-store' })
    if (!response.ok) return
    const body = await response.json().catch(() => null) as { items?: LibraryItem[] } | null
    if (Array.isArray(body?.items)) items.value = body.items
  }

  function closeLibrary() {
    libraryOpen.value = false
  }

  function bindComputerPick(fn: () => void) {
    computerPick = fn
  }

  function requestComputerPick() {
    computerPick()
  }

  function syncComposerFiles(files: ComposerFile[]) {
    composerFiles.value = files
    if (!active.value || !brief.value || brief.value.status !== 'collecting') return
    const images = files.filter(file => file.kind === 'image')
    const commentImageIds = images.flatMap(file => file.libraryId ? [file.libraryId] : [])
    const referenceIds = files.flatMap(file => file.kind === 'video' && file.libraryId ? [file.libraryId] : [])
    const remembered = imageCounts.value[sessionId.value] || 0
    const form: GrowthBrief['form'] = images.length || remembered ? 'image' : 'text'
    if (
      brief.value.form === form
      && sameIds(brief.value.commentImageIds, commentImageIds)
      && sameIds(brief.value.referenceIds, referenceIds)
    ) return
    markEditable()
    brief.value = { ...brief.value, form, commentImageIds, referenceIds }
    void save()
  }

  async function addBlobToLibrary(blob: Blob, name: string) {
    error.value = ''
    if (blob.size > 20 * 1024 * 1024) {
      error.value = `${name} 超过 20MB`
      return null
    }
    const dataBase64 = await blobToBase64(blob)
    const response = await fetch('/api/runtime/library', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mime: blob.type || guessMime(name), dataBase64 }),
    })
    const body = await response.json().catch(() => ({})) as { item?: LibraryItem; message?: string }
    if (!response.ok || !body.item) {
      error.value = body.message || '没有放进资料库'
      return null
    }
    items.value = [body.item, ...items.value.filter(item => item.id !== body.item?.id)]
    notice.value = '已加入资料库'
    return body.item
  }

  async function setForm(form: 'text' | 'image') {
    if (!brief.value) return
    markEditable()
    brief.value = {
      ...brief.value,
      form,
      commentImageIds: form === 'text' ? [] : brief.value.commentImageIds,
    }
    await save()
  }

  async function save() {
    if (!brief.value) return
    const response = await fetch('/api/runtime/growth/brief', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brief: brief.value }),
    })
    const body = await response.json().catch(() => null) as { brief?: GrowthBrief } | null
    if (response.ok && body?.brief) brief.value = body.brief
  }

  let turnQueue: Promise<void> = Promise.resolve()

  function openBrief(session: string) {
    const current = brief.value
    if (current && sessionId.value === session && current.status !== 'started') return
    const stored = readPlans()[session]
    if (stored && stored.status !== 'started') {
      brief.value = stored
      sessionId.value = session
      return
    }
    brief.value = {
      id: Math.random().toString(36).slice(2, 14),
      status: 'collecting',
      form: 'text',
      audience: '',
      tags: [],
      excludes: [],
      excludesAsked: false,
      tone: '',
      interaction: 'comment',
      maxCount: 10,
      commentImageIds: [],
      referenceIds: [],
      messages: [],
      accountId: '',
    }
    sessionId.value = session
  }

  function choose(partial: { tone?: string; interaction?: GrowthBrief['interaction'] }) {
    const id = viewSession.value || ''
    choices.value = { ...choices.value, [id]: { ...choices.value[id], ...partial } }
    if (brief.value && sessionId.value === id) void commitPatch(partial)
  }

  function beginTurn(session: string, images = 0) {
    openBrief(session)
    const source = brief.value
    if (!source) return
    const choice = choices.value[session] || {}
    brief.value = {
      ...source,
      tone: source.tone || choice.tone || '',
      interaction: choice.interaction || source.interaction,
      form: images > 0 ? 'image' : source.form,
    }
    if (images > 0) imageCounts.value = { ...imageCounts.value, [session]: images }
  }

  function steer(userText: string, images = 0) {
    const source = brief.value
    return campaignSteer(planOf(source), userText, images || imageCounts.value[sessionId.value] || 0)
  }

  async function finishTurn(session: string, userText: string, assistantText: string) {
    if (!assistantText.trim() || sessionId.value !== session || !brief.value) return
    const source = brief.value
    const result = readCampaignPlan(planOf(source), userText, assistantText)
    const prose = result.prose || '这次没接上，换种说法再说一句。'
    const next: GrowthBrief = {
      ...source,
      audience: result.state.audience,
      tags: result.state.tags,
      excludes: result.state.excludes,
      excludesAsked: result.state.excludesAsked,
      tone: result.state.tone,
      interaction: result.state.interaction,
      maxCount: result.state.maxCount,
      status: result.ready ? 'ready' : 'collecting',
      messages: [...source.messages, { role: 'user' as const, text: userText.trim() }, { role: 'assistant' as const, text: prose }].slice(-40),
    }
    brief.value = next
    rememberPlan(session, next)
    await save()
  }

  function send(text: string) {
    const run = turnQueue.then(() => deliverTurn(text))
    turnQueue = run.then(() => {}, () => {})
    return run
  }

  async function deliverTurn(text: string) {
    if (!brief.value) return
    sending.value = true
    error.value = ''
    const mine = brief.value
    brief.value = { ...mine, messages: [...mine.messages, { role: 'user', text }] }
    try {
      const response = await fetch('/api/runtime/growth/brief/turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: mine.id,
          text,
          form: mine.form,
          commentImageIds: mine.commentImageIds,
          referenceIds: mine.referenceIds,
        }),
      })
      const body = await response.json().catch(() => ({})) as { brief?: GrowthBrief; message?: string }
      if (!response.ok || !body.brief) throw new Error(body.message || '没能整理这次投放')
      brief.value = body.brief
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '没能整理这次投放'
      brief.value = mine
    } finally {
      sending.value = false
    }
  }

  async function commitPatch(partial: Partial<GrowthBrief>) {
    if (!brief.value) return
    markEditable()
    brief.value = { ...brief.value, ...partial }
    await save()
  }

  function fileUrl(id: string) {
    return `/api/runtime/library/${encodeURIComponent(id)}/file`
  }

  async function ingest(files: File[]) {
    setMode(viewSession.value, 'comment')
    error.value = ''
    for (const file of files) {
      if (file.size > 20 * 1024 * 1024) {
        error.value = `${file.name} 超过 20MB`
        continue
      }
      const dataBase64 = await fileToBase64(file)
      const response = await fetch('/api/runtime/library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: file.name, mime: file.type || guessMime(file.name), dataBase64 }),
      })
      const body = await response.json().catch(() => ({})) as { item?: LibraryItem; message?: string }
      if (!response.ok || !body.item) {
        error.value = body.message || '文件没有放进资料库'
        continue
      }
      items.value = [body.item, ...items.value.filter(item => item.id !== body.item?.id)]
      attach(body.item)
    }
    await save()
  }

  function attach(item: LibraryItem) {
    if (!brief.value) return
    markEditable()
    if (item.kind === 'video' || brief.value.form !== 'image') {
      brief.value = {
        ...brief.value,
        referenceIds: unique([...brief.value.referenceIds, item.id]),
        commentImageIds: brief.value.commentImageIds.filter(id => id !== item.id),
      }
      return
    }
    brief.value = {
      ...brief.value,
      commentImageIds: unique([...brief.value.commentImageIds, item.id]),
      referenceIds: brief.value.referenceIds.filter(id => id !== item.id),
    }
  }

  function useAsReference(id: string) {
    if (!brief.value) return
    markEditable()
    brief.value = {
      ...brief.value,
      referenceIds: unique([...brief.value.referenceIds, id]),
      commentImageIds: brief.value.commentImageIds.filter(item => item !== id),
    }
    void save()
  }

  function useAsCommentImage(id: string) {
    if (!brief.value) return
    const item = items.value.find(entry => entry.id === id)
    if (!item || item.kind !== 'image') return
    markEditable()
    brief.value = { ...brief.value, form: 'image', commentImageIds: unique([...brief.value.commentImageIds, id]), referenceIds: brief.value.referenceIds.filter(itemId => itemId !== id) }
    void save()
  }

  function detach(id: string) {
    if (!brief.value) return
    markEditable()
    brief.value = {
      ...brief.value,
      commentImageIds: brief.value.commentImageIds.filter(item => item !== id),
      referenceIds: brief.value.referenceIds.filter(item => item !== id),
    }
    void save()
  }

  async function removeFromLibrary(id: string) {
    await fetch(`/api/runtime/library/${encodeURIComponent(id)}`, { method: 'DELETE' })
    items.value = items.value.filter(item => item.id !== id)
    detach(id)
  }

  function toggleLibraryItem(item: LibraryItem) {
    if (!brief.value) return
    const selected = brief.value.commentImageIds.includes(item.id) || brief.value.referenceIds.includes(item.id)
    if (selected) detach(item.id)
    else {
      attach(item)
      void save()
    }
  }

  async function start() {
    if (!brief.value || starting.value) return
    starting.value = true
    error.value = ''
    try {
      const current = brief.value
      const images = composerFiles.value.filter(file => file.kind === 'image')
      const commentImageIds = images.flatMap(file => file.libraryId ? [file.libraryId] : [])
      const commentImageFiles = []
      for (const image of images) {
        if (image.libraryId || !image.file) continue
        commentImageFiles.push({
          name: image.name,
          mime: image.file.type || guessMime(image.name),
          dataBase64: await fileToBase64(image.file),
        })
      }
      const referenceIds = composerFiles.value.flatMap(file => file.kind === 'video' && file.libraryId ? [file.libraryId] : [])
      const response = await fetch('/api/runtime/growth/brief/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: current.id,
          form: images.length ? 'image' : current.form,
          audience: current.audience,
          tone: current.tone,
          tags: current.tags,
          excludes: current.excludes,
          interaction: current.interaction,
          maxCount: current.maxCount,
          commentImageIds: commentImageIds.length ? commentImageIds : current.commentImageIds,
          referenceIds: referenceIds.length ? referenceIds : current.referenceIds,
          commentImageFiles,
          accountId: shell.activeAccount?.platform === 'douyin' ? shell.activeAccount.id : current.accountId,
        }),
      })
      const body = await response.json().catch(() => ({})) as {
        brief?: GrowthBrief
        needsLogin?: boolean
        started?: boolean
        accountId?: string
        message?: string
      }
      if (body.brief) brief.value = body.brief
      if (body.needsLogin) {
        if (sawLogin.value) {
          awaitingLogin.value = false
          sawLogin.value = false
          notice.value = '登录还没完成，任务卡留在这里。'
          return
        }
        awaitingLogin.value = true
        sawLogin.value = false
        notice.value = '登录抖音后会自动开始。取消登录的话，任务卡留在这里。'
        if (body.accountId) await shell.reloginAccount(accountId(body.accountId))
        else await shell.addAccount('douyin')
        return
      }
      if (!response.ok || !body.started) throw new Error(body.message || '没有启动')
      awaitingLogin.value = false
      sawLogin.value = false
      loginRetries = 0
      notice.value = ''
      openRuntime(body.accountId)
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '没有启动'
    } finally {
      starting.value = false
    }
  }

  function openRuntime(nextAccountId?: string) {
    if (nextAccountId) shell.selectAccount(accountId(nextAccountId))
    workspace.growthChatRequest = true
    workspace.selectList('messages')
    workspace.mobilePane = 'chat'
    void router.replace({ path: '/im' })
  }

  async function onLoginSettled() {
    if (!awaitingLogin.value || starting.value || settling) return
    const logging = shell.pendingAdd || shell.runtimePhase === 'browser_setup' || shell.runtimePhase === 'logging_in' || shell.runtimePhase === 'cancelling'
    if (logging) {
      sawLogin.value = true
      return
    }
    if (!sawLogin.value) return
    const online = shell.accounts.some(account => account.platform === 'douyin' && account.status === 'online')
    if (!online) {
      awaitingLogin.value = false
      sawLogin.value = false
      notice.value = '登录已取消，任务卡留在这里。'
      return
    }
    if (loginRetries >= 1) {
      awaitingLogin.value = false
      sawLogin.value = false
      notice.value = '登录还没完成，任务卡留在这里。'
      return
    }
    loginRetries += 1
    sawLogin.value = false
    awaitingLogin.value = false
    notice.value = ''
    settling = true
    try { await start() } finally { settling = false }
  }

  watch(
    () => `${shell.runtimePhase}|${shell.pendingAdd}|${shell.accounts.map(account => `${account.id}:${account.status}`).join(',')}`,
    () => { void onLoginSettled() },
  )

  return {
    active, sessionId, method, libraryOpen, sending, starting, notice, error, items, brief, commentImages, references,
    composerFiles, imageCount, sessionTone, sessionInteraction,
    load, toggle, bindSession, showSession, rekey, setMethod, applyQuickPick, openLibrary, closeLibrary, bindComputerPick, requestComputerPick, setForm, save, send,
    beginTurn, steer, finishTurn, choose,
    commitPatch, fileUrl, ingest, syncComposerFiles, addBlobToLibrary, useAsReference, useAsCommentImage, detach, removeFromLibrary,
    toggleLibraryItem, start,
  }
})

const PLAN_KEY = 'chihiro.campaign.sessions'

function readPlans(): Record<string, GrowthBrief> {
  if (typeof localStorage === 'undefined') return {}
  try {
    const parsed = JSON.parse(localStorage.getItem(PLAN_KEY) || '{}') as Record<string, GrowthBrief>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function rememberPlan(session: string, value: GrowthBrief) {
  if (!session || typeof localStorage === 'undefined') return
  const all = readPlans()
  all[session] = value
  localStorage.setItem(PLAN_KEY, JSON.stringify(all))
}

function planOf(source: GrowthBrief | null): PlanState {
  return {
    audience: source?.audience || '',
    tags: source?.tags || [],
    excludes: source?.excludes || [],
    excludesAsked: Boolean(source?.excludesAsked),
    tone: source?.tone || '',
    interaction: source?.interaction || 'comment',
    maxCount: source?.maxCount || 10,
    messages: source?.messages || [],
  }
}

function unique(list: string[]) {
  return [...new Set(list)]
}

function sameIds(left: string[], right: string[]) {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

function blobToBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const value = String(reader.result || '')
      resolve(value.slice(value.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const value = String(reader.result || '')
      resolve(value.slice(value.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function guessMime(name: string) {
  if (/\.png$/i.test(name)) return 'image/png'
  if (/\.gif$/i.test(name)) return 'image/gif'
  if (/\.webp$/i.test(name)) return 'image/webp'
  if (/\.mp4$/i.test(name)) return 'video/mp4'
  if (/\.mov$/i.test(name)) return 'video/quicktime'
  if (/\.webm$/i.test(name)) return 'video/webm'
  return 'image/jpeg'
}
