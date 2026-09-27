import fs from 'node:fs'
import path from 'node:path'
import { log, logError } from '../log.mjs'
import { isBilibiliAccountId, isDouyinAccountId, isOutreachAccountId, isXiaohongshuAccountId, newBilibiliAccountId, newDouyinAccountId, newXiaohongshuAccountId } from './accounts/ids.mjs'
import {
  detectChromePath,
  readBrowserConfig,
  writeBrowserConfig,
} from './browser/browser.mjs'
import { DEFAULT_OUTREACH_SETTINGS, normalizeOutreachSettings } from './campaign/settings.mjs'
import { extractDouyinProfile, localStorageFromStorageState, presentDouyinIdentity } from './accounts/profile.mjs'
import { platformRegistry } from './platforms/index.mjs'
import { commentPrompt, commentSessionId } from './campaign/brief.mjs'
import { createOutreachPreview } from './browser/preview.mjs'

const LOGIN_WAIT_MS = 3 * 60 * 1000
const HISTORY_TASK_LIMIT = 10

export function createOutreachRuntime({
  root,
  store,
  emit = () => {},
  loginWaiter,
  xhsLoginWaiter,
  bilibiliLoginWaiter,
  feedRunner,
  noteRunner,
  bilibiliRunner,
  complete = async () => '',
} = {}) {
  const dataDir = path.join(root, 'data', 'outreach')
  const browserFile = path.join(dataDir, 'browser.json')
  const listeners = new Set()
  let loginClient = 'qq'
  let pendingAdd = false
  let pendingAccountId = ''
  let phase = 'idle'
  let message = ''
  let loginBrowser = null
  let loginCancelled = false
  let task = idleTask()
  let taskStop = false
  let taskPaused = false
  let taskPromise = null
  const preview = createOutreachPreview()

  function notify() {
    for (const fn of listeners) {
      try { fn() } catch { /* ignore */ }
    }
    emit()
  }

  function subscribe(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  }

  function accountDir(id) {
    return path.join(dataDir, 'accounts', id.replace(':', '_'))
  }

  function commentImageDirectory(accountId, briefId) {
    const safe = String(briefId || 'brief').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 40) || 'brief'
    return path.join(accountDir(accountId), 'comment-images', safe)
  }

  function storagePath(id) {
    return path.join(accountDir(id), 'storageState.json')
  }

  function settingsPath(id) {
    return path.join(accountDir(id), 'settings.json')
  }

  function historyPath(id) {
    return path.join(accountDir(id), 'history.json')
  }

  function avatarBinPath(id) {
    return path.join(accountDir(id), 'avatar.bin')
  }

  function avatarMetaPath(id) {
    return path.join(accountDir(id), 'avatar.json')
  }

  function avatarPublicUrl(id) {
    try {
      const mtime = fs.statSync(avatarBinPath(id)).mtimeMs
      return `/api/runtime/outreach/accounts/${encodeURIComponent(id)}/avatar?v=${Math.floor(mtime)}`
    } catch {
      return ''
    }
  }

  function saveAvatarBytes(id, bytes) {
    if (!bytes?.body) return ''
    const body = Buffer.isBuffer(bytes.body) ? bytes.body : Buffer.from(bytes.body)
    if (body.length < 4 || body.length > 2_000_000) return ''
    const contentType = String(bytes.contentType || 'image/jpeg').split(';')[0]
    fs.mkdirSync(accountDir(id), { recursive: true })
    fs.writeFileSync(avatarBinPath(id), body)
    fs.writeFileSync(avatarMetaPath(id), JSON.stringify({ contentType, updatedAt: new Date().toISOString() }) + '\n')
    return avatarPublicUrl(id)
  }

  function readAvatar(id) {
    if (!isOutreachAccountId(id)) return null
    try {
      const body = fs.readFileSync(avatarBinPath(id))
      let contentType = 'image/jpeg'
      try {
        const meta = JSON.parse(fs.readFileSync(avatarMetaPath(id), 'utf8'))
        if (typeof meta.contentType === 'string' && meta.contentType.startsWith('image/')) contentType = meta.contentType
      } catch { /* default jpeg */ }
      return { body, contentType }
    } catch {
      return null
    }
  }

  function browserState() {
    const override = readBrowserConfig(browserFile)
    return detectChromePath({ override })
  }

  function setBrowserPath(nextPath) {
    const detected = detectChromePath({ override: nextPath })
    if (detected.path) writeBrowserConfig(browserFile, detected.path)
    return detected
  }

  function readSettings(id) {
    try {
      return normalizeOutreachSettings(JSON.parse(fs.readFileSync(settingsPath(id), 'utf8')))
    } catch {
      return { ...DEFAULT_OUTREACH_SETTINGS }
    }
  }

  function writeSettings(id, value) {
    const settings = normalizeOutreachSettings(value)
    fs.mkdirSync(accountDir(id), { recursive: true })
    fs.writeFileSync(settingsPath(id), JSON.stringify(settings, null, 2) + '\n')
    return settings
  }

  function readHistory(id) {
    try {
      return JSON.parse(fs.readFileSync(historyPath(id), 'utf8'))
    } catch {
      return { tasks: [], videos: [], comments: [] }
    }
  }

  function writeHistory(id, history) {
    const next = {
      tasks: Array.isArray(history?.tasks) ? history.tasks.slice(0, HISTORY_TASK_LIMIT) : [],
      videos: Array.isArray(history?.videos) ? history.videos.slice(0, 200) : [],
      comments: Array.isArray(history?.comments) ? history.comments.slice(0, 200) : [],
    }
    fs.mkdirSync(accountDir(id), { recursive: true })
    fs.writeFileSync(historyPath(id), JSON.stringify(next, null, 2) + '\n')
  }

  function hasStorage(id) {
    try {
      const state = JSON.parse(fs.readFileSync(storagePath(id), 'utf8'))
      return Array.isArray(state?.cookies) && state.cookies.some((cookie) => cookie?.name && cookie?.value)
    } catch {
      return false
    }
  }

  function snapshotOutreach() {
    const browser = browserState()
    return {
      loginClient,
      pendingAdd,
      pendingAccountId,
      phase,
      message,
      browserPath: browser.path,
      browserDetected: browser.detected,
      task: {
        running: task.running,
        paused: task.running && taskPaused,
        accountId: task.accountId,
        status: task.status,
        logs: task.logs.slice(-80),
        commented: task.commented,
        scanned: task.scanned,
        id: task.id || '',
        startedAt: task.startedAt || '',
      },
      preview: preview.snapshot(),
    }
  }

  function decorateSnapshot(snap) {
    const outreach = snapshotOutreach()
    const accounts = (snap.accounts?.accounts || []).map((account) => {
      if (isBilibiliAccountId(account.id)) {
        const online = hasStorage(account.id) && phase !== 'logging_in'
        const nickname = account.nickname || account.label || '哔哩哔哩账号'
        return {
          ...account,
          nickname,
          label: account.label || nickname,
          client: 'bilibili',
          platform: 'bilibili',
          online,
          webui: '',
          webuiToken: '',
          obAddress: '',
          obToken: '',
        }
      }
      if (isXiaohongshuAccountId(account.id)) {
        const online = hasStorage(account.id) && phase !== 'logging_in'
        const avatar = avatarPublicUrl(account.id) || account.avatar || ''
        const nickname = account.nickname || account.label || '小红书账号'
        return {
          ...account,
          nickname,
          label: account.label || nickname,
          avatar,
          client: 'xiaohongshu',
          platform: 'xiaohongshu',
          online,
          webui: '',
          webuiToken: '',
          obAddress: '',
          obToken: '',
        }
      }
      if (!isDouyinAccountId(account.id)) return account
      const online = hasStorage(account.id) && phase !== 'logging_in'
      const avatar = avatarPublicUrl(account.id) || account.avatar || ''
      const identity = presentDouyinIdentity(account)
      return {
        ...account,
        nickname: identity.name || account.nickname || '抖音账号',
        label: identity.name || account.label || account.nickname || '抖音账号',
        ...(identity.douyinId ? { douyinId: identity.douyinId } : {}),
        avatar,
        client: 'douyin',
        platform: 'douyin',
        online,
        webui: '',
        webuiToken: '',
        obAddress: '',
        obToken: '',
      }
    })
    const next = {
      ...snap,
      accounts: { ...snap.accounts, accounts },
      outreach,
    }
    if (['douyin', 'xiaohongshu', 'bilibili'].includes(loginClient) && (pendingAdd || phase === 'logging_in' || phase === 'browser_setup' || phase === 'cancelling')) {
      next.phase = phase
      next.message = message
      next.pendingAdd = pendingAdd
      next.qr = { exists: false, mtime: 0, size: 0, path: '', expired: false, age: 0 }
    }
    return next
  }

  function prepareNew(accountId = '', client = 'douyin') {
    const kind = client === 'xiaohongshu' || client === 'bilibili' ? client : 'douyin'
    loginClient = kind
    const valid = kind === 'xiaohongshu'
      ? isXiaohongshuAccountId(accountId)
      : kind === 'bilibili' ? isBilibiliAccountId(accountId) : isDouyinAccountId(accountId)
    pendingAccountId = valid ? accountId : ''
    pendingAdd = !pendingAccountId
    phase = 'browser_setup'
    const name = kind === 'xiaohongshu' ? '小红书' : kind === 'bilibili' ? '哔哩哔哩' : '抖音'
    message = `选择本机 Chrome，然后登录${name}账号`
    const browser = browserState()
    if (!browser.detected) message = '未找到 Chrome，请填写可执行文件路径后再登录'
    log('outreach', `prepare account=${pendingAccountId || 'new'} browser=${browser.path} detected=${browser.detected}`)
    notify()
    return snapshotOutreach()
  }

  async function cancelLogin() {
    loginCancelled = true
    phase = 'cancelling'
    message = '正在取消登录…'
    pendingAdd = false
    notify()
    await closeLoginBrowser()
    pendingAccountId = ''
    loginClient = 'qq'
    phase = 'idle'
    message = ''
    loginCancelled = false
    notify()
  }

  async function closeLoginBrowser() {
    const browser = loginBrowser
    loginBrowser = null
    if (browser) await browser.close().catch(() => {})
  }

  async function login({ accountId = '', browserPath = '', client = '' } = {}) {
    const kind = client === 'xiaohongshu' || client === 'bilibili' || client === 'douyin'
      ? client
      : (loginClient === 'xiaohongshu' || loginClient === 'bilibili' ? loginClient : 'douyin')
    const name = kind === 'xiaohongshu' ? '小红书' : kind === 'bilibili' ? '哔哩哔哩' : '抖音'
    const matches = kind === 'xiaohongshu' ? isXiaohongshuAccountId : kind === 'bilibili' ? isBilibiliAccountId : isDouyinAccountId
    if (phase === 'logging_in') throw new Error(`正在登录${name}`)
    if (task.running) throw new Error('请先停止正在运行的浏览任务')
    if (browserPath) setBrowserPath(browserPath)
    const browser = browserState()
    if (!browser.detected) throw new Error(`找不到 Chrome：${browser.path || '未设置路径'}`)
    const targetId = accountId && matches(accountId)
      ? accountId
      : (pendingAccountId && matches(pendingAccountId) ? pendingAccountId : '')
    loginCancelled = false
    loginClient = kind
    pendingAccountId = targetId
    pendingAdd = !targetId
    phase = 'logging_in'
    message = `请在弹出的 Chrome 中登录${name}`
    notify()
    log('outreach', `login account=${targetId || 'new'} client=${kind} chrome=${browser.path}`)
    try {
      const adapter = platformRegistry.get(kind)
      if (!adapter) throw new Error(`不支持的平台：${kind}`)
      const waiter = kind === 'douyin'
        ? (loginWaiter || waitForDouyinLogin)
        : kind === 'bilibili' ? (bilibiliLoginWaiter || adapter.waitForLogin) : (xhsLoginWaiter || adapter.waitForLogin)
      const result = await waiter({
        executablePath: browser.path,
        storageStatePath: targetId && hasStorage(targetId) ? storagePath(targetId) : '',
        shouldCancel: () => loginCancelled,
        onBrowser: (value) => { loginBrowser = value },
      })
      if (loginCancelled) throw new Error('登录已取消')
      const id = targetId || (kind === 'xiaohongshu'
        ? newXiaohongshuAccountId()
        : kind === 'bilibili' ? newBilibiliAccountId() : newDouyinAccountId())
      fs.mkdirSync(accountDir(id), { recursive: true })
      fs.writeFileSync(storagePath(id), JSON.stringify(result.storageState, null, 2) + '\n')
      writeSettings(id, readSettings(id))
      if (kind === 'xiaohongshu') {
        const nickname = String(result.nickname || '').trim() || '小红书账号'
        store.upsert({
          id,
          client: 'xiaohongshu',
          platform: 'xiaohongshu',
          nickname,
          label: nickname,
          avatar: result.avatar || '',
          uid: result.uid || '',
        })
        pendingAdd = false
        pendingAccountId = ''
        phase = 'idle'
        message = ''
        loginClient = 'qq'
        log('outreach', `logged in ${id}`)
        notify()
        return { id }
      }
      if (kind === 'bilibili') {
        const nickname = String(result.nickname || '').trim() || '哔哩哔哩账号'
        store.upsert({
          id,
          client: 'bilibili',
          platform: 'bilibili',
          nickname,
          label: nickname,
          avatar: result.avatar || '',
          uid: result.uid || '',
        })
        pendingAdd = false
        pendingAccountId = ''
        phase = 'idle'
        message = ''
        loginClient = 'qq'
        log('outreach', `logged in ${id}`)
        notify()
        return { id }
      }
      const extracted = extractDouyinProfile({
        localStorage: localStorageFromStorageState(result.storageState),
        cookies: result.storageState?.cookies || [],
        images: result.images || [],
        nickname: result.nickname || '',
      })
      const identity = presentDouyinIdentity({
        nickname: result.nickname || extracted.nickname || '',
        douyinId: result.douyinId || extracted.douyinId || '',
      })
      const nickname = identity.name || '抖音账号'
      const uid = result.uid || extracted.uid || ''
      const savedAvatar = saveAvatarBytes(id, result.avatarBytes)
      const avatar = savedAvatar || result.avatar || extracted.avatar || ''
      store.upsert({
        id,
        client: 'douyin',
        platform: 'douyin',
        nickname,
        label: nickname,
        ...(identity.douyinId ? { douyinId: identity.douyinId } : {}),
        avatar,
        uid,
      })
      pendingAdd = false
      pendingAccountId = ''
      phase = 'idle'
      message = ''
      loginClient = 'qq'
      log('outreach', `logged in ${id}`)
      notify()
      return { id }
    } catch (error) {
      await closeLoginBrowser()
      const cancelled = loginCancelled || /取消/.test(String(error.message || ''))
      phase = cancelled ? 'idle' : (pendingAdd ? 'browser_setup' : 'idle')
      const failedName = loginClient === 'xiaohongshu' ? '小红书' : loginClient === 'bilibili' ? '哔哩哔哩' : '抖音'
      message = cancelled ? '' : (error.message || `${failedName}登录失败`)
      if (cancelled) {
        pendingAdd = false
        pendingAccountId = ''
        loginClient = 'qq'
      }
      loginCancelled = false
      logError('outreach', 'login', error)
      notify()
      throw error
    } finally {
      loginBrowser = null
    }
  }

  async function startTask(accountId, settingsPatch = {}) {
    const xhs = isXiaohongshuAccountId(accountId)
    const bilibili = isBilibiliAccountId(accountId)
    if (!xhs && !bilibili && !isDouyinAccountId(accountId)) throw new Error('invalid_account')
    const name = xhs ? '小红书' : bilibili ? '哔哩哔哩' : '抖音'
    if (task.running) throw new Error('已有任务在运行')
    if (phase === 'logging_in') throw new Error(`请先完成${name}登录`)
    if (!hasStorage(accountId)) throw new Error(`请先登录${name}`)
    const browser = browserState()
    if (!browser.detected) throw new Error(`找不到 Chrome：${browser.path || '未设置路径'}`)
    const settings = writeSettings(accountId, { ...readSettings(accountId), ...settingsPatch })
    if (!settings.comments.length) throw new Error('请先填写至少一条评论文案')
    taskStop = false
    taskPaused = false
    const startedAt = new Date().toISOString()
    const taskId = `${accountId}:${startedAt}`
    task = {
      running: true,
      accountId,
      status: 'running',
      logs: [],
      commented: 0,
      scanned: 0,
      id: taskId,
      startedAt,
    }
    const history = readHistory(accountId)
    history.tasks.unshift({
      id: taskId,
      accountId,
      startedAt,
      status: 'running',
      commented: 0,
      scanned: 0,
      logs: [],
      videos: [],
      comments: [],
    })
    writeHistory(accountId, history)
    pushLog('info', '任务已启动')
    persistTask(accountId)
    notify()
    const platform = xhs ? 'xiaohongshu' : bilibili ? 'bilibili' : 'douyin'
    const adapter = platformRegistry.get(platform)
    if (!adapter) throw new Error(`不支持的平台：${platform}`)
    const runFeed = platform === 'xiaohongshu'
      ? (noteRunner || adapter.run)
      : platform === 'bilibili' ? (bilibiliRunner || adapter.run) : (feedRunner || adapter.run)
    taskPromise = runFeed({
      executablePath: browser.path,
      storageStatePath: storagePath(accountId),
      settings,
      shouldStop: () => taskStop,
      shouldPause: () => taskPaused,
      onReady: async ({ page }) => {
        await preview.attach(page)
        await preview.setMuted(true)
        pushLog('info', '已接入画中画投屏，默认静音')
        notify()
      },
      onLog: (level, text) => {
        pushLog(level, text)
        persistTask(accountId)
        notify()
      },
      onVideo: (video) => {
        task.scanned += 1
        const row = { ...video, at: new Date().toISOString() }
        const current = readHistory(accountId)
        current.videos.unshift(row)
        current.videos = current.videos.slice(0, 200)
        const record = current.tasks.find((item) => item.id === taskId)
        if (record) {
          record.videos = [row, ...(record.videos || [])].slice(0, 200)
          record.scanned = task.scanned
        }
        writeHistory(accountId, current)
      },
      onSettings: (next) => {
        writeSettings(accountId, next)
        notify()
      },
      writeComment: async (current, video) => {
        return complete(commentPrompt(current.campaign, video), commentSessionId(current.campaign?.briefId, video), {
          provider: current.campaign?.commentProvider || '',
          model: current.campaign?.commentModel || '',
        })
      },
      onComment: (row) => {
        task.commented += 1
        task.scanned += 1
        const next = { ...row, at: new Date().toISOString() }
        const current = readHistory(accountId)
        current.comments.unshift(next)
        current.comments = current.comments.slice(0, 200)
        const record = current.tasks.find((item) => item.id === taskId)
        if (record) {
          record.comments = [next, ...(record.comments || [])].slice(0, 200)
          record.commented = task.commented
          record.scanned = task.scanned
          record.videos = [next, ...(record.videos || [])].slice(0, 200)
        }
        writeHistory(accountId, current)
      },
    }).then((result) => {
      task.scanned = result.scanned
      task.commented = result.commented
      task.status = 'completed'
      task.running = false
      taskPaused = false
      finishTask(accountId, taskId, {
        endedAt: new Date().toISOString(),
        status: 'completed',
        commented: result.commented,
        scanned: result.scanned,
      })
      pushLog('success', '任务结束')
      persistTask(accountId)
      notify()
    }).catch((error) => {
      const stopped = String(error.message || '').includes('Task stopped')
      task.status = stopped ? 'stopped' : 'error'
      task.running = false
      taskPaused = false
      finishTask(accountId, taskId, {
        endedAt: new Date().toISOString(),
        status: task.status,
        error: stopped ? '' : String(error.message || error),
        commented: task.commented,
        scanned: task.scanned,
      })
      pushLog(stopped ? 'warn' : 'error', stopped ? '任务已停止' : error.message)
      persistTask(accountId)
      notify()
    }).finally(() => {
      void preview.detach().then(() => notify())
    })
    return snapshotOutreach()
  }

  async function setPreviewMode(mode) {
    await preview.setMode(mode)
    notify()
    return snapshotOutreach()
  }

  async function setPreviewMuted(next) {
    await preview.setMuted(next !== false)
    notify()
    return snapshotOutreach()
  }

  async function setPaused(next) {
    if (!task.running) return snapshotOutreach()
    taskPaused = next === true
    task.status = taskPaused ? 'paused' : 'running'
    await preview.setPlayback(taskPaused ? 'paused' : 'playing')
    pushLog(taskPaused ? 'warn' : 'info', taskPaused ? '任务已暂停' : '任务已继续')
    persistTask(task.accountId)
    notify()
    return snapshotOutreach()
  }

  async function stopTask() {
    if (!task.running) return snapshotOutreach()
    taskPaused = false
    taskStop = true
    pushLog('warn', '正在停止…')
    notify()
    await taskPromise?.catch(() => {})
    return snapshotOutreach()
  }

  function pushLog(level, text) {
    task.logs.push({ level, text, at: new Date().toISOString() })
    if (task.logs.length > 200) task.logs = task.logs.slice(-200)
    log('outreach', `${level} ${text}`)
  }

  async function cleanup(accountId) {
    if (task.accountId === accountId) await stopTask()
    const loginTouchesAccount = !pendingAccountId || pendingAccountId === accountId
    if (loginTouchesAccount && (pendingAdd || phase === 'logging_in' || phase === 'browser_setup')) {
      await cancelLogin()
    }
    const dir = accountDir(accountId)
    fs.rmSync(dir, { recursive: true, force: true })
  }

  function accountView(id) {
    if (!isOutreachAccountId(id)) return null
    return {
      id,
      settings: readSettings(id),
      history: readHistory(id),
      loggedIn: hasStorage(id),
    }
  }

  function persistTask(accountId) {
    if (!task.id) return
    const history = readHistory(accountId)
    const record = history.tasks.find((item) => item.id === task.id)
    if (!record) return
    record.status = task.running ? 'running' : task.status
    record.commented = task.commented
    record.scanned = task.scanned
    record.logs = task.logs.slice(-200)
    writeHistory(accountId, history)
  }

  function finishTask(accountId, taskId, patch) {
    const history = readHistory(accountId)
    const record = history.tasks.find((item) => item.id === taskId)
    if (record) Object.assign(record, patch)
    writeHistory(accountId, history)
  }

  function isTaskRunning(accountId, taskId = '') {
    if (!task.running || task.accountId !== accountId) return false
    return !taskId || task.id === taskId
  }

  function deleteTaskHistory(accountId, taskId) {
    if (!isOutreachAccountId(accountId)) throw new Error('invalid_account')
    if (!taskId) throw new Error('missing_task')
    if (isTaskRunning(accountId, taskId)) throw new Error('任务正在运行，无法删除')
    const history = readHistory(accountId)
    history.tasks = history.tasks.filter((item) => item.id !== taskId)
    writeHistory(accountId, history)
    return accountView(accountId)
  }

  function clearTaskHistory(accountId) {
    if (!isOutreachAccountId(accountId)) throw new Error('invalid_account')
    const history = readHistory(accountId)
    if (isTaskRunning(accountId) || history.tasks.some((item) => item.status === 'running')) {
      throw new Error('任务正在运行，请等待完成后操作')
    }
    writeHistory(accountId, { tasks: [], videos: [], comments: [] })
    return accountView(accountId)
  }

  function safeImageName(name) {
    const base = path.basename(String(name || 'image.jpg')).replace(/[^\w.\u4e00-\u9fa5-]+/g, '_')
    return base.slice(0, 80) || 'image.jpg'
  }

  function saveCommentImages(accountId, groupId, type, files) {
    if (!isOutreachAccountId(accountId)) throw new Error('invalid_account')
    const id = String(groupId || '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80)
    if (!id) throw new Error('missing_group')
    const kind = type === 'file' ? 'file' : 'folder'
    const list = Array.isArray(files) ? files : []
    const dir = path.join(accountDir(accountId), 'comment-images', id)
    fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(dir, { recursive: true })
    const saved = []
    for (const file of list.slice(0, kind === 'file' ? 1 : 40)) {
      const name = safeImageName(file?.name)
      if (!/\.(png|jpe?g|gif|webp)$/i.test(name)) continue
      const raw = String(file?.body || '')
      const body = Buffer.from(raw, 'base64')
      if (body.length < 8 || body.length > 8_000_000) continue
      fs.writeFileSync(path.join(dir, name), body)
      saved.push(name)
    }
    if (!saved.length) throw new Error('未保存任何图片')
    return {
      path: kind === 'file' ? path.join(dir, saved[0]) : dir,
      type: kind,
      count: saved.length,
    }
  }

  return {
    prepareNew,
    login,
    cancelLogin,
    setBrowserPath,
    browserState,
    startTask,
    stopTask,
    setPaused,
    setPreviewMuted,
    cleanup,
    accountView,
    readSettings,
    writeSettings,
    readAvatar,
    decorateSnapshot,
    snapshotOutreach,
    subscribe,
    subscribePreview: preview.subscribe,
    previewFrame: preview.frame,
    setPreviewMode,
    hasStorage,
    commentImageDirectory,
    deleteTaskHistory,
    clearTaskHistory,
    saveCommentImages,
  }
}


function idleTask() {
  return { running: false, paused: false, accountId: '', status: 'idle', logs: [], commented: 0, scanned: 0, id: '', startedAt: '' }
}

async function waitForDouyinLogin({ executablePath, storageStatePath, onBrowser, shouldCancel = () => false }) {
  const { chromium } = await import('playwright-core')
  const browser = await chromium.launch({
    executablePath,
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
  })
  onBrowser?.(browser)
  try {
    const context = await browser.newContext(storageStatePath ? { storageState: storageStatePath } : {})
    const page = await context.newPage()
    await page.goto('https://www.douyin.com/?recommend=1', { waitUntil: 'domcontentloaded', timeout: 90000 })
    const deadline = Date.now() + LOGIN_WAIT_MS
    let loggedIn = false
    while (Date.now() < deadline) {
      if (shouldCancel() || !browser.isConnected()) throw new Error('登录已取消')
      loggedIn = await page.evaluate(() => {
        try {
          return window.localStorage.getItem('HasUserLogin') === '1'
        } catch {
          return false
        }
      }).catch(() => false)
      if (!loggedIn) {
        const cookies = await context.cookies('https://www.douyin.com').catch(() => [])
        loggedIn = cookies.some((cookie) => cookie.name === 'sessionid' && cookie.value)
      }
      if (loggedIn) break
      await new Promise((resolve) => { setTimeout(resolve, 1500) })
    }
    if (!loggedIn) throw new Error('等待抖音登录超时，请重试')
    await new Promise((resolve) => { setTimeout(resolve, 1200) })
    let signals = await collectDouyinSignals(page)
    try {
      await page.goto('https://www.douyin.com/user/self', { waitUntil: 'domcontentloaded', timeout: 20000 })
      await new Promise((resolve) => { setTimeout(resolve, 1500) })
      const selfSignals = await collectDouyinSignals(page)
      signals = {
        storage: { ...signals.storage, ...selfSignals.storage },
        images: [...selfSignals.images, ...signals.images],
        nickname: selfSignals.nickname || signals.nickname,
        profileText: selfSignals.profileText || signals.profileText,
      }
    } catch {
      /* home-page signals are enough */
    }
    const storageState = await context.storageState()
    const profile = extractDouyinProfile({
      localStorage: { ...localStorageFromStorageState(storageState), ...signals.storage },
      cookies: storageState.cookies || [],
      images: signals.images,
      nickname: signals.profileText || signals.nickname,
    })
    const avatarBytes = profile.avatar ? await downloadAvatar(context, profile.avatar) : null
    return {
      storageState,
      nickname: profile.nickname,
      douyinId: profile.douyinId,
      uid: profile.uid,
      avatar: profile.avatar,
      images: signals.images,
      avatarBytes,
    }
  } finally {
    await browser.close().catch(() => {})
  }
}

async function collectDouyinSignals(page) {
  return page.evaluate(() => {
    const storage = {}
    const dump = (store) => {
      try {
        for (let i = 0; i < store.length; i += 1) {
          const key = store.key(i)
          if (!key) continue
          const value = store.getItem(key)
          storage[key] = value && value.length > 80000 ? value.slice(0, 80000) : (value || '')
        }
      } catch { /* ignore */ }
    }
    dump(window.localStorage)
    dump(window.sessionStorage)
    const render = document.getElementById('RENDER_DATA')?.textContent
      || document.getElementById('RENDER_DATA_1')?.textContent
      || ''
    if (render) storage.RENDER_DATA = render.slice(0, 120000)
    const images = []
    for (const img of document.querySelectorAll('img')) {
      const src = img.currentSrc || img.src || ''
      if (!src || src.startsWith('data:')) continue
      images.push(src)
      if (images.length >= 40) break
    }
    const root = document.querySelector('[data-e2e="user-info"]')
    const profileText = String(root?.innerText || root?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300)
    const nickname = String(
      root?.querySelector('h1')?.textContent
      || document.querySelector('[data-e2e="user-info"] h1')?.textContent
      || document.querySelector('[class*="nickname"]')?.textContent
      || profileText
    ).trim().slice(0, 80)
    return { storage, images, nickname, profileText }
  }).catch(() => ({ storage: {}, images: [], nickname: '', profileText: '' }))
}

async function downloadAvatar(context, url) {
  try {
    const abs = url.startsWith('//') ? `https:${url}` : url
    const response = await context.request.get(abs, { timeout: 15000 })
    if (!response.ok()) return null
    const contentType = String(response.headers()['content-type'] || 'image/jpeg').split(';')[0]
    if (!contentType.startsWith('image/') || contentType.includes('svg')) return null
    const body = Buffer.from(await response.body())
    if (body.length < 32 || body.length > 2_000_000) return null
    return { body, contentType }
  } catch {
    return null
  }
}
