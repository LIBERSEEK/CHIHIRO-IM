import fs from 'node:fs'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { analyzeVideoType } from '../../core/targeting.mjs'
import { learnMatchedVideo, parseModelCommentResult, peerCommentLines } from '../../campaign/brief.mjs'

const LOGIN_WAIT_MS = 3 * 60 * 1000
export const XIAOHONGSHU_LOGIN_URL = 'https://www.xiaohongshu.com'

// 访客打开小红书就会带 web_session。登录完成要看到自己的头像，并且登录框已经关掉。
export function isXiaohongshuLoginComplete({ url = '', loginBoxVisible = false, hasOwnProfile = false } = {}) {
  const current = String(url || '')
  if (!current.startsWith('https://www.xiaohongshu.com')) return false
  if (loginBoxVisible) return false
  return hasOwnProfile === true
}

export function xiaohongshuSearchUrl(keyword) {
  const query = String(keyword || '').trim()
  if (query.includes(',')) {
    return `https://www.xiaohongshu.com/search_result_ai?keyword=${encodeURIComponent(encodeURIComponent(query))}&source=unknown`
  }
  return `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(query)}&source=web_search_result_notes`
}

export function xiaohongshuNoteUrl(id, token = '') {
  const noteId = encodeURIComponent(String(id || '').trim())
  const base = `https://www.xiaohongshu.com/explore/${noteId}`
  const xsec = String(token || '').trim()
  return xsec ? `${base}?xsec_token=${encodeURIComponent(xsec)}&xsec_source=pc_search` : base
}

export function isXiaohongshuNotePayloadUrl(url) {
  const text = String(url || '')
  return text.includes('xiaohongshu.com') && (
    /\/api\/sns\/web\/v\d+\/search\/notes/.test(text)
    || /\/api\/sns\/web\/v\d+\/feed/.test(text)
  )
}

export function isXiaohongshuCommentPayloadUrl(url) {
  return String(url || '').includes('xiaohongshu.com') && String(url || '').includes('/comment/page')
}

export function collectNotes(body) {
  const found = []
  const seen = new Set()
  walk(body, (node) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return
    const card = noteCardOf(node)
    const id = firstText(node.id, node.note_id, node.noteId, card.note_id, card.noteId, card.id)
    const title = firstText(card.display_title, card.displayTitle, node.display_title, node.displayTitle, card.title, node.title)
    const desc = firstText(card.desc, node.desc)
    if (!id || id.length > 64 || (!title && !desc)) return
    if (seen.has(id)) return
    const user = card.user || node.user || {}
    const tags = []
    for (const tag of [...listOf(card.tag_list), ...listOf(card.tagList), ...listOf(node.tag_list), ...listOf(node.tagList)]) {
      const name = firstText(tag?.name, tag?.tag_name, tag?.tagName)
      if (name) tags.push(name)
    }
    seen.add(id)
    found.push({
      id,
      title: title.slice(0, 180),
      desc: desc.slice(0, 800),
      author: firstText(user.nickname, user.nick_name, user.nickName).slice(0, 80),
      authorId: firstText(user.user_id, user.userId),
      tags,
      xsecToken: firstText(node.xsec_token, node.xsecToken, card.xsec_token, card.xsecToken),
      shareUrl: '',
    })
  })
  return found
}

export function noteToVideo(note) {
  return {
    aweme_id: note.id,
    aweme_type: 0,
    desc: [note.title, note.desc].filter(Boolean).join('\n'),
    author: { nickname: note.author || '', uid: note.authorId || '' },
    video_tag: (note.tags || []).map((name) => ({ tag_name: name })),
    share_url: note.shareUrl || xiaohongshuNoteUrl(note.id, note.xsecToken),
  }
}

export async function waitForXiaohongshuLogin({ executablePath, onBrowser, shouldCancel = () => false }) {
  const { chromium } = await import('playwright-core')
  const browser = await chromium.launch({
    executablePath,
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
  })
  onBrowser?.(browser)
  try {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto(XIAOHONGSHU_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 90000 })
    const deadline = Date.now() + LOGIN_WAIT_MS
    let loggedIn = false
    let prompts = 0
    while (Date.now() < deadline) {
      if (shouldCancel() || !browser.isConnected()) throw new Error('登录已取消')
      const state = await readXiaohongshuLoginState(page)
      loggedIn = isXiaohongshuLoginComplete(state)
      if (loggedIn) break
      if (!state.loginBoxVisible && !state.hasOwnProfile && prompts < 2) {
        prompts += 1
        await openXiaohongshuLogin(page)
      }
      await delay(1500)
    }
    if (!loggedIn) throw new Error('等待小红书登录超时，请重试')
    await delay(1200)
    const nickname = await page.evaluate(() => {
      const node = document.querySelector('.user-name, [class*="user-name"], [class*="nickname"]')
      return String(node?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80)
    }).catch(() => '')
    return {
      storageState: await context.storageState(),
      nickname,
    }
  } finally {
    await browser.close().catch(() => {})
  }
}

export async function runXiaohongshuNoteTask({
  executablePath,
  storageStatePath,
  settings,
  launch,
  shouldStop = () => false,
  shouldPause = () => false,
  onLog = () => {},
  onVideo = () => {},
  onComment = () => {},
  onReady = () => {},
  onSettings = () => {},
  writeComment,
}) {
  if (!executablePath) throw new Error('未设置 Chrome 路径')
  settings = { ...settings, shouldStop, shouldPause }
  const browserApi = launch || await defaultLaunch()
  const browser = await browserApi.chromium.launch({
    executablePath,
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
  })
  let context
  try {
    context = await browser.newContext({ storageState: storageStatePath })
    const page = await context.newPage()
    try { await onReady({ page, browser }) } catch { /* preview is optional */ }
    const collected = new Map()
    page.on('response', async (response) => {
      try {
        const url = typeof response.url === 'function' ? response.url() : ''
        if (!isXiaohongshuNotePayloadUrl(url)) return
        const body = await response.json().catch(() => null)
        for (const note of collectNotes(body)) collected.set(note.id, note)
      } catch {
        /* ignore parse errors */
      }
    })
    const searchQuery = pickSearchTag(settings)
    if (!searchQuery) {
      onLog('warn', '没有种子标签，任务结束')
      return { commented: 0, scanned: 0 }
    }
    const seen = new Set()
    let commented = 0
    let scanned = 0
    const maxCount = settings.maxCount || 10
    onLog('info', `搜索笔记：${searchQuery}`)
    await page.goto(xiaohongshuSearchUrl(searchQuery), { waitUntil: 'domcontentloaded', timeout: 90000 })
    await absorbVisibleNotes(page, collected)
    if (!settings.fast && collected.size === 0) {
      onLog('info', '等待搜索页加载完成')
      await waitForSearchResults(page, collected, settings)
    }
    const deadline = Date.now() + (settings.fast ? 40 : 30000)
    let idle = 0
    while (Date.now() < deadline && idle < 5 && unseen(collected, seen).length < maxCount * 3) {
      if (shouldStop()) break
      if (!settings.fast && collected.size === 0) break
      const login = await readXiaohongshuLoginState(page)
      if (login.loginBoxVisible) break
      const before = collected.size
      if (page.mouse?.wheel) await page.mouse.wheel(0, 1600).catch(() => {})
      else if (unseen(collected, seen).length) break
      await waitMs(settings, 2000)
      await absorbVisibleNotes(page, collected)
      idle = collected.size === before ? idle + 1 : 0
    }
    const batch = unseen(collected, seen)
    if (!batch.length) onLog('warn', await emptySearchReason(page, searchQuery))
    for (const note of batch) {
        if (commented >= maxCount || shouldStop()) break
        seen.add(note.id)
        scanned += 1
        const video = noteToVideo(note)
        onLog('info', `====== 开始处理第 ${scanned} 篇笔记，已评论次数：${commented}/${maxCount} ======`)
        onLog('info', `笔记作者: @${video.author.nickname || '未知'}`)
        onLog('info', `笔记：${video.desc}`)
        const blocked = blockReason(settings, video)
        if (blocked) {
          onLog('warn', blocked)
          onVideo(record(video, { status: 'skipped', reason: blocked }))
          continue
        }
        const analysis = analyzeVideoType(video, settings, onLog)
        if (!analysis.shouldViewComment) {
          onLog('warn', '当前笔记不满足评论规则，跳过')
          onVideo(record(video, { status: 'skipped', reason: '不满足评论规则' }))
          continue
        }
        const learning = learnMatchedVideo(settings, video)
        if (learning.candidates.length || learning.promoted.length) {
          settings = { ...learning.settings, shouldStop, shouldPause }
          onSettings(learning.settings)
          for (const candidate of learning.candidates) {
            onLog('info', `学习候选条件：${candidate.keyword}（${candidate.count}/3 个命中视频）`)
          }
          for (const keyword of learning.promoted) {
            onLog('success', `新增公共命中条件：${keyword}（已在 3 个命中视频中出现）`)
          }
        }
        const pending = listenForComments(page, settings, onLog)
        await page.goto(video.share_url, { waitUntil: 'domcontentloaded', timeout: 90000 })
        const heard = await pending
        const peerComments = peerCommentLines(commentList(heard?.body))
        onLog('info', peerComments.length ? `评论区语气样本：${peerComments.length} 条` : '评论区没有可参考的语气')
        let text = ''
        let commentReason = 'empty_response'
        try {
          const raw = typeof writeComment === 'function'
            ? await writeComment(settings, { ...video, peerComments })
            : ''
          const parsed = parseModelCommentResult(raw, settings.campaign?.excludes)
          text = parsed.text
          commentReason = parsed.reason
        } catch {
          text = ''
          commentReason = 'model_error'
        }
        if (!text) {
          const reason = COMMENT_SKIP[commentReason] || '模型未生成评论'
          onLog('warn', `评论跳过：${reason}`)
          onVideo(record(video, { status: 'skipped', reason: `模型未生成评论：${reason}` }))
          continue
        }
        if (settings.campaign?.interaction === 'comment_like') await tryLike(page, onLog)
        if (settings.campaign?.form === 'image') {
          const image = firstImage(analysis.matchedRuleGroup?.commentImagePath)
          const attached = image ? await attachImage(page, image) : false
          if (!attached) onLog('info', '小红书网页版评论区未提供图片上传入口，本条使用文字评论')
        }
        onLog('info', `评论：${text}`)
        const posted = await postNoteComment(page, text)
        if (!posted.ok) {
          onLog('error', `评论发送失败：${posted.reason}`)
          onVideo(record(video, { status: 'skipped', reason: `评论发送失败：${posted.reason}` }))
          continue
        }
        commented += 1
        onComment(record(video, { text, status: 'commented' }))
        onLog('success', `评论发送成功，已评论次数：${commented}/${maxCount}`)
        await waitMs(settings, 800)
      }
    if (shouldStop()) throw new Error('Task stopped')
    onLog('success', `任务完成，评论 ${commented} 条`)
    return { commented, scanned }
  } finally {
    try { await context?.storageState({ path: storageStatePath }) } catch { /* keep previous */ }
    await browser.close().catch(() => {})
  }
}

const COMMENT_SKIP = {
  empty_response: '模型返回为空',
  invalid_json: '模型返回格式无法解析',
  missing_comment: '模型未提供评论正文',
  too_long: '模型评论超过 50 字',
  invalid_comment: '模型评论格式无效',
  refusal: '模型拒绝生成评论',
  excluded_word: '模型评论命中排除词',
  model_error: '模型调用失败',
}

function commentList(body) {
  if (Array.isArray(body?.comments)) return body
  if (Array.isArray(body?.data?.comments)) return { comments: body.data.comments }
  return body
}

export function pickSearchTag(settings) {
  const seeds = uniqueSearchTerms(settings?.campaign?.seedTags)
  if (seeds.length) return seeds.join(', ')
  const rules = []
  for (const group of settings?.ruleGroups || []) {
    for (const rule of group?.rules || []) {
      const keyword = String(rule?.keyword || '').trim()
      if (keyword) rules.push(keyword)
    }
  }
  return uniqueSearchTerms(rules).join(', ')
}

function uniqueSearchTerms(values) {
  const seen = new Set()
  const result = []
  for (const value of values || []) {
    const term = String(value || '').trim()
    const key = term.toLocaleLowerCase()
    if (!term || seen.has(key)) continue
    seen.add(key)
    result.push(term)
  }
  return result
}

function noteCardOf(node) {
  if (node?.note_card && typeof node.note_card === 'object') return node.note_card
  if (node?.noteCard && typeof node.noteCard === 'object') return node.noteCard
  return node
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value || '').trim()
    if (text) return text
  }
  return ''
}

function rememberNotes(collected, notes) {
  for (const note of notes || []) {
    if (!note?.id) continue
    const prev = collected.get(note.id)
    collected.set(note.id, prev ? {
      ...prev,
      title: prev.title || note.title,
      desc: prev.desc || note.desc,
      author: prev.author || note.author,
      authorId: prev.authorId || note.authorId,
      tags: prev.tags?.length ? prev.tags : (note.tags || []),
      xsecToken: prev.xsecToken || note.xsecToken || '',
      shareUrl: note.shareUrl || prev.shareUrl || '',
    } : note)
  }
}

async function absorbVisibleNotes(page, collected) {
  if (typeof page.evaluate !== 'function') return
  const notes = await page.evaluate(() => {
    const found = []
    const seen = new Set()
    const push = (note) => {
      const id = String(note.id || '').trim()
      if (!id || id.length > 64 || seen.has(id)) return
      seen.add(id)
      found.push(note)
    }
    const state = window.__INITIAL_STATE__
    const raw = state?.search?.feeds || state?.search?.notes
    const list = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' ? Object.values(raw) : [])
    for (const item of list) {
      if (!item || typeof item !== 'object') continue
      const card = item.noteCard || item.note_card || item
      const id = String(item.id || card.noteId || card.note_id || card.id || '').trim()
      const title = String(card.displayTitle || card.display_title || '').trim()
      const desc = String(card.desc || '').trim()
      if (!id || (!title && !desc)) continue
      const user = card.user || {}
      push({
        id,
        title: title.slice(0, 180),
        desc: desc.slice(0, 800),
        author: String(user.nickName || user.nickname || user.nick_name || '').trim().slice(0, 80),
        authorId: String(user.userId || user.user_id || '').trim(),
        tags: [],
        xsecToken: String(item.xsecToken || item.xsec_token || card.xsecToken || card.xsec_token || '').trim(),
        shareUrl: '',
      })
    }
    for (const anchor of document.querySelectorAll('a[href*="/explore/"]')) {
      const href = anchor.href || ''
      const matched = href.match(/\/explore\/([0-9a-fA-F]{16,32})/)
      if (!matched) continue
      const title = (anchor.querySelector('[class*="title"]')?.textContent || '').replace(/\s+/g, ' ').trim()
      if (!title) continue
      const author = (anchor.querySelector('[class*="author"], [class*="name"]')?.textContent || '').replace(/\s+/g, ' ').trim()
      push({
        id: matched[1],
        title: title.slice(0, 180),
        desc: '',
        author: author.slice(0, 80),
        authorId: '',
        tags: [],
        xsecToken: '',
        shareUrl: href,
      })
    }
    return found
  }).catch(() => [])
  rememberNotes(collected, notes)
}

// 搜索接口经常在文档出来之后才返回。空结果先等页面和网络加载，再继续看一分钟。
const SEARCH_EMPTY_WAIT_MS = 60000

async function waitForSearchResults(page, collected, settings) {
  const started = Date.now()
  const remain = () => Math.max(0, SEARCH_EMPTY_WAIT_MS - (Date.now() - started))
  if (typeof page.waitForLoadState === 'function' && remain() > 0) {
    await page.waitForLoadState('load', { timeout: Math.min(30000, remain()) }).catch(() => {})
    await absorbVisibleNotes(page, collected)
    if (collected.size > 0 || settings?.shouldStop?.()) return
    const idleBudget = Math.min(25000, remain())
    if (idleBudget > 0) {
      await page.waitForLoadState('networkidle', { timeout: idleBudget }).catch(() => {})
      await absorbVisibleNotes(page, collected)
      if (collected.size > 0 || settings?.shouldStop?.()) return
    }
  }
  while (remain() > 0 && collected.size === 0) {
    if (settings?.shouldStop?.()) throw new Error('Task stopped')
    const login = await readXiaohongshuLoginState(page)
    if (login.loginBoxVisible) return
    if (page.mouse?.wheel) await page.mouse.wheel(0, 1200).catch(() => {})
    await waitMs(settings, Math.min(2000, remain()))
    await absorbVisibleNotes(page, collected)
  }
}

async function emptySearchReason(page, tag) {
  const login = await readXiaohongshuLoginState(page)
  if (login.loginBoxVisible) return `「${tag}」没有拿到笔记，搜索页还停在登录框`
  const url = typeof page.url === 'function' ? page.url() : ''
  if (url && !url.includes('search_result')) return `「${tag}」没有拿到笔记，页面停在 ${url.slice(0, 140)}`
  return `「${tag}」等待加载后仍没有拿到笔记`
}

async function readXiaohongshuLoginState(page) {
  if (typeof page.evaluate !== 'function') {
    return { url: typeof page.url === 'function' ? page.url() : '', loginBoxVisible: false, hasOwnProfile: false }
  }
  const state = await page.evaluate(() => {
    const box = document.querySelector('div[class*="login-container"], div[class*="login-box"]')
    let loginBoxVisible = false
    if (box) {
      const style = getComputedStyle(box)
      const rect = box.getBoundingClientRect()
      loginBoxVisible = style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }
    const hasOwnProfile = Boolean(document.querySelector('.side-bar .user a[href*="/user/profile"], .user.side-bar-component a[href*="/user/profile"]'))
    return { url: location.href, loginBoxVisible, hasOwnProfile }
  }).catch(() => null)
  return state || { url: typeof page.url === 'function' ? page.url() : '', loginBoxVisible: false, hasOwnProfile: false }
}

async function openXiaohongshuLogin(page) {
  await page.evaluate(() => {
    const target = [...document.querySelectorAll('button, a, div, span')].find((node) => (
      node.childElementCount === 0 && (node.textContent || '').trim() === '登录'
    ))
    ;(target?.closest('button, a') || target)?.click()
  }).catch(() => {})
}

function unseen(collected, seen) {
  return [...collected.values()].filter((note) => !seen.has(note.id))
}

function blockReason(settings, video) {
  const desc = video.desc || ''
  const nickname = video.author?.nickname || ''
  const word = (settings.blockKeywords || []).find((keyword) => includesFold(desc, keyword))
  if (word) return `笔记命中排除词：${word}`
  const author = (settings.authorBlockKeywords || []).find((keyword) => includesFold(nickname, keyword))
  if (author) return `笔记作者命中排除词：${author}`
  return ''
}

function includesFold(text, word) {
  const needle = String(word || '').trim().toLowerCase()
  return Boolean(needle) && String(text || '').toLowerCase().includes(needle)
}

function record(video, extra = {}) {
  return {
    awemeId: video?.aweme_id || '',
    desc: video?.desc || '',
    nickname: video?.author?.nickname || '',
    shareUrl: video?.share_url || '',
    tags: (video?.video_tag || []).map((tag) => String(tag?.tag_name || '').trim()).filter(Boolean),
    ...extra,
  }
}

function listenForComments(page, settings, onLog) {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      page.removeListener?.('response', onResponse)
      clearTimeout(timer)
      resolve(value)
    }
    const onResponse = async (response) => {
      const url = typeof response.url === 'function' ? response.url() : ''
      if (!isXiaohongshuCommentPayloadUrl(url)) return
      onLog('info', '捕获到笔记评论')
      try {
        const body = await response.json().catch(() => null)
        finish(body ? { body } : { body: null, failed: true })
      } catch {
        finish({ body: null, failed: true })
      }
    }
    page.on('response', onResponse)
    const timer = setTimeout(() => finish({ body: null, timedOut: true }), settings?.fast ? 20 : 8000)
  })
}

export async function postNoteComment(page, text) {
  // The search page keeps a hidden textarea named "搜索小红书" in the DOM.
  // Xiaohongshu only activates its Vue editor after the visible “说点什么...”
  // layer is clicked. Focusing the underlying contenteditable changes the DOM
  // but leaves the component state inactive and the send button disabled.
  const box = first(page, [
    '.note-detail-mask #content-textarea:visible',
    '#content-textarea[contenteditable="true"]:visible',
    '.note-detail-mask [contenteditable="true"]:visible',
    'textarea:visible:not([aria-hidden="true"]):not([placeholder*="搜索"])',
  ].join(', '))
  try {
    if (!await box.count()) return { ok: false, reason: '没有找到可见评论框' }
    if (typeof box.waitFor === 'function') {
      await box.waitFor({ state: 'visible', timeout: 10000 })
    }
    const activator = first(page, '.note-detail-mask .content-edit .inner-when-not-active:visible')
    if (await activator.count()) await activator.click({ force: true, timeout: 10000 })
    else if (typeof box.click === 'function') await box.click({ force: true, timeout: 10000 })
    // Keep the focus established by the activator. Locator.pressSequentially
    // focuses the underlying <p> again and loses the component's active state.
    if (page.keyboard?.type) await page.keyboard.type(text)
    else if (typeof box.pressSequentially === 'function') await box.pressSequentially(text, { delay: 0 })
    else if (typeof box.fill === 'function') await box.fill(text)
    const send = first(page, [
      '.note-detail-mask button.btn.submit:visible',
      'button.comment-submit:visible',
      'button.submit:visible',
      'button.send:visible',
      'button:has-text("发送"):visible',
    ].join(', '))
    if (await send.count()) {
      if (typeof send.waitFor === 'function') await send.waitFor({ state: 'visible', timeout: 10000 })
      if (typeof send.isEnabled === 'function') {
        const deadline = Date.now() + 2000
        while (!await send.isEnabled() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100))
        if (!await send.isEnabled()) return { ok: false, reason: '评论已填写，但发送按钮仍不可用' }
      }
      await send.click({ timeout: 10000 })
    }
    else await page.keyboard.press('Enter')
    return { ok: true }
  } catch (error) {
    const message = String(error?.message || '').split('\n')[0].trim()
    return { ok: false, reason: message || '评论发送控件不可用' }
  }
}

async function attachImage(page, file) {
  const input = first(page, 'input[type="file"]')
  if (!await input.count() || typeof input.setInputFiles !== 'function') return false
  await input.setInputFiles(file)
  return true
}

async function tryLike(page, onLog) {
  const like = first(page, '.like-wrapper, [class*="like"]')
  if (!await like.count()) {
    onLog('info', '没有找到点赞按钮')
    return
  }
  await like.click().catch(() => {})
  onLog('info', '已点赞')
}

function firstImage(dir) {
  const folder = String(dir || '')
  if (!folder || !fs.existsSync(folder)) return ''
  const name = fs.readdirSync(folder).find((item) => /\.(png|jpe?g|gif|webp)$/i.test(item))
  return name ? path.join(folder, name) : ''
}

function first(page, selector) {
  return page.locator(selector).first()
}

async function waitMs(settings, ms) {
  const total = settings?.fast ? Math.min(ms, 5) : ms
  const step = settings?.fast ? 1 : 200
  let left = total
  while (left > 0) {
    if (settings?.shouldStop?.()) throw new Error('Task stopped')
    while (settings?.shouldPause?.()) {
      if (settings?.shouldStop?.()) throw new Error('Task stopped')
      await delay(settings?.fast ? 1 : 300)
    }
    const slice = Math.min(step, left)
    await delay(slice)
    left -= slice
  }
}

function listOf(value) {
  return Array.isArray(value) ? value : []
}

function walk(node, visit, seen = new Set()) {
  if (!node || typeof node !== 'object' || seen.has(node)) return
  seen.add(node)
  visit(node)
  for (const value of Object.values(node)) {
    if (value && typeof value === 'object') walk(value, visit, seen)
  }
}

async function defaultLaunch() {
  const { chromium } = await import('playwright-core')
  return { chromium }
}
