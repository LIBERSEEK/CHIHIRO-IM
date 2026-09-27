import fs from 'node:fs'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { analyzeVideoType } from '../../core/targeting.mjs'
import { learnMatchedVideo, parseModelCommentResult, peerCommentLines } from '../../campaign/brief.mjs'

const LOGIN_WAIT_MS = 5 * 60 * 1000
export const BILIBILI_LOGIN_URL = 'https://www.bilibili.com/'

export function bilibiliSearchUrl(keyword, page = 1) {
  const query = new URLSearchParams({
    search_type: 'video',
    keyword: String(keyword || '').trim(),
    page: String(Math.max(1, Number(page) || 1)),
  })
  return `https://api.bilibili.com/x/web-interface/search/type?${query}`
}

export function bilibiliVideoUrl(bvid) {
  return `https://www.bilibili.com/video/${encodeURIComponent(String(bvid || '').trim())}/`
}

export function collectBilibiliVideos(body) {
  const rows = Array.isArray(body?.data?.result) ? body.data.result : []
  return rows.flatMap((item) => {
    const bvid = String(item?.bvid || '').trim()
    if (!/^BV[A-Za-z0-9]+$/.test(bvid)) return []
    return [{
      bvid,
      aid: Number(item?.aid) || 0,
      title: stripHtml(item?.title),
      desc: stripHtml(item?.description),
      author: String(item?.author || '').trim(),
      authorId: String(item?.mid || '').trim(),
      tags: String(item?.tag || '').split(',').map((tag) => tag.trim()).filter(Boolean),
      play: Number(item?.play) || 0,
      reply: Number(item?.review) || 0,
      duration: String(item?.duration || ''),
      shareUrl: bilibiliVideoUrl(bvid),
    }]
  })
}

export function bilibiliToVideo(item) {
  return {
    aweme_id: item.bvid,
    aid: Number(item.aid) || 0,
    desc: [item.title, item.desc].filter(Boolean).join('\n'),
    author: { nickname: item.author || '', uid: item.authorId || '' },
    video_tag: (item.tags || []).map((name) => ({ tag_name: name })),
    share_url: item.shareUrl || bilibiliVideoUrl(item.bvid),
  }
}

export function isBilibiliLoginComplete(cookies) {
  const list = Array.isArray(cookies) ? cookies : []
  return list.some((cookie) => cookie?.name === 'SESSDATA' && cookie?.value)
    && list.some((cookie) => cookie?.name === 'bili_jct' && cookie?.value)
}

export async function waitForBilibiliLogin({ executablePath, storageStatePath, onBrowser, shouldCancel = () => false }) {
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
    await page.goto(BILIBILI_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 90000 })
    const deadline = Date.now() + LOGIN_WAIT_MS
    let cookies = []
    while (Date.now() < deadline) {
      if (shouldCancel() || !browser.isConnected()) throw new Error('登录已取消')
      cookies = await context.cookies('https://www.bilibili.com').catch(() => [])
      if (isBilibiliLoginComplete(cookies)) break
      await delay(1200)
    }
    if (!isBilibiliLoginComplete(cookies)) throw new Error('等待哔哩哔哩登录超时，请重试')
    const profile = await page.evaluate(async () => {
      try {
        const response = await fetch('https://api.bilibili.com/x/web-interface/nav', { credentials: 'include' })
        const body = await response.json()
        return body?.code === 0 ? body.data : null
      } catch {
        return null
      }
    })
    return {
      storageState: await context.storageState(),
      nickname: String(profile?.uname || '').trim() || '哔哩哔哩账号',
      uid: String(profile?.mid || '').trim(),
      avatar: String(profile?.face || '').trim(),
    }
  } finally {
    await browser.close().catch(() => {})
  }
}

export async function runBilibiliVideoTask({
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
    const terms = searchTerms(settings)
    if (!terms.length) {
      onLog('warn', '没有种子标签，任务结束')
      return { commented: 0, scanned: 0 }
    }
    const collected = new Map()
    for (const term of terms) {
      if (shouldStop()) break
      onLog('info', `搜索视频：${term}`)
      const body = await browserJson(context, bilibiliSearchUrl(term))
      for (const item of collectBilibiliVideos(body)) collected.set(item.bvid, item)
      await waitMs(settings, 500)
    }
    onLog('info', `搜索完成，去重后 ${collected.size} 个视频`)
    let commented = 0
    let scanned = 0
    const maxCount = settings.maxCount || 10
    for (const item of collected.values()) {
      if (commented >= maxCount || shouldStop()) break
      await waitMs(settings, 1)
      const detail = await browserJson(context, `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(item.bvid)}`)
      if (detail?.code === 0 && detail?.data) mergeDetail(item, detail.data)
      const video = bilibiliToVideo(item)
      scanned += 1
      onLog('info', `====== 开始处理第 ${scanned} 个视频，已评论次数：${commented}/${maxCount} ======`)
      onLog('info', `视频作者: @${video.author.nickname || '未知'}`)
      onLog('info', `视频：${video.desc}`)
      const blocked = blockReason(settings, video)
      if (blocked) {
        onLog('warn', blocked)
        onVideo(record(video, { status: 'skipped', reason: blocked }))
        continue
      }
      const analysis = analyzeVideoType(video, settings, onLog)
      if (!analysis.shouldViewComment) {
        onLog('warn', '当前视频不满足评论规则，跳过')
        onVideo(record(video, { status: 'skipped', reason: '不满足评论规则' }))
        continue
      }
      const learning = learnMatchedVideo(settings, video)
      if (learning.candidates.length || learning.promoted.length) {
        settings = { ...learning.settings, shouldStop, shouldPause }
        onSettings(learning.settings)
        for (const candidate of learning.candidates) onLog('info', `学习候选条件：${candidate.keyword}（${candidate.count}/3 个命中视频）`)
        for (const keyword of learning.promoted) onLog('success', `新增公共命中条件：${keyword}（已在 3 个命中视频中出现）`)
      }
      await page.goto(video.share_url, { waitUntil: 'domcontentloaded', timeout: 90000 })
      const comments = await readComments(context, video.aid)
      const peerComments = peerCommentLines(comments)
      onLog('info', peerComments.length ? `评论区语气样本：${peerComments.length} 条` : '评论区没有可参考的语气')
      let text = ''
      let commentReason = 'empty_response'
      try {
        const raw = typeof writeComment === 'function' ? await writeComment(settings, { ...video, peerComments }) : ''
        const parsed = parseModelCommentResult(raw, settings.campaign?.excludes)
        text = parsed.text
        commentReason = parsed.reason
      } catch {
        commentReason = 'model_error'
      }
      if (!text) {
        const reason = COMMENT_SKIP[commentReason] || '模型未生成评论'
        onLog('warn', `评论跳过：${reason}`)
        onVideo(record(video, { status: 'skipped', reason: `模型未生成评论：${reason}` }))
        continue
      }
      const imagePaths = settings.campaign?.form === 'image'
        ? listCommentImages(analysis.matchedRuleGroup?.commentImagePath, analysis.matchedRuleGroup?.commentImageType).slice(0, 9)
        : []
      let pictures = []
      if (settings.campaign?.form === 'image') {
        if (!imagePaths.length) {
          onLog('error', '评论发送失败：没有找到可上传的评论图片')
          onVideo(record(video, { status: 'skipped', reason: '评论发送失败：没有找到可上传的评论图片' }))
          continue
        }
        const uploaded = await uploadBilibiliCommentImages(page, imagePaths)
        if (!uploaded.ok) {
          onLog('error', `评论发送失败：${uploaded.reason}`)
          onVideo(record(video, { status: 'skipped', reason: `评论发送失败：${uploaded.reason}` }))
          continue
        }
        pictures = uploaded.pictures
        onLog('info', `评论配图上传成功：${pictures.length} 张`)
      }
      if (settings.campaign?.interaction === 'comment_like') await likeVideo(page, video.aid, onLog)
      onLog('info', `评论：${text}`)
      const posted = await postBilibiliComment(page, video.aid, text, pictures)
      if (!posted.ok) {
        onLog('error', `评论发送失败：${posted.reason}`)
        onVideo(record(video, { status: 'skipped', reason: `评论发送失败：${posted.reason}` }))
        continue
      }
      commented += 1
      onComment(record(video, { text, status: 'commented', receiptId: posted.rpid }))
      onLog('success', `评论发送成功，评论ID: ${posted.rpid}，已评论次数：${commented}/${maxCount}`)
      await waitMs(settings, 1200)
    }
    if (shouldStop()) throw new Error('Task stopped')
    onLog('success', `任务完成，评论 ${commented} 条`)
    return { commented, scanned }
  } finally {
    try { await context?.storageState({ path: storageStatePath }) } catch { /* keep previous */ }
    await browser.close().catch(() => {})
  }
}

export async function uploadBilibiliCommentImages(page, imagePaths) {
  const pictures = []
  for (const imagePath of imagePaths || []) {
    if (!fs.existsSync(imagePath)) return { ok: false, reason: `评论图片不存在：${path.basename(imagePath)}`, pictures: [] }
    const file = {
      name: path.basename(imagePath),
      type: imageMime(imagePath),
      base64: fs.readFileSync(imagePath).toString('base64'),
    }
    let uploaded
    try {
      uploaded = await page.evaluate(async ({ name, type, base64 }) => {
        const csrf = document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith('bili_jct='))?.slice(9) || ''
        if (!csrf) return { ok: false, reason: '登录态缺少 bili_jct，请重新登录' }
        const binary = atob(base64)
        const bytes = new Uint8Array(binary.length)
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
        const body = new FormData()
        body.append('csrf', csrf)
        body.append('file_up', new File([bytes], name, { type }))
        body.append('category', 'daily')
        body.append('biz', 'new_dyn')
        const response = await fetch('https://api.bilibili.com/x/dynamic/feed/draw/upload_bfs', {
          method: 'POST',
          credentials: 'include',
          body,
        })
        const json = await response.json().catch(() => null)
        if (json?.code !== 0) return { ok: false, reason: json?.message || `图片接口返回 ${json?.code ?? response.status}` }
        const data = json?.data || {}
        const picture = {
          img_src: String(data.image_url || '').trim(),
          img_width: Number(data.image_width) || 0,
          img_height: Number(data.image_height) || 0,
          img_size: Number(data.img_size) || 0,
        }
        return picture.img_src ? { ok: true, picture } : { ok: false, reason: '图片接口未返回图片地址' }
      }, file)
    } catch (error) {
      return { ok: false, reason: `图片上传失败：${String(error?.message || error).split('\n')[0]}`, pictures: [] }
    }
    if (!uploaded?.ok) return { ok: false, reason: uploaded?.reason || '图片上传失败', pictures: [] }
    pictures.push(uploaded.picture)
  }
  return pictures.length ? { ok: true, pictures } : { ok: false, reason: '没有可上传的评论图片', pictures: [] }
}

export async function postBilibiliComment(page, aid, text, pictures = []) {
  try {
    const result = await page.evaluate(async ({ oid, message, pictures }) => {
      const csrf = document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith('bili_jct='))?.slice(9) || ''
      if (!csrf) return { ok: false, reason: '登录态缺少 bili_jct，请重新登录' }
      const body = new FormData()
      body.append('oid', String(oid))
      body.append('type', '1')
      body.append('message', message)
      body.append('plat', '1')
      body.append('at_name_to_mid', '{}')
      body.append('pictures', JSON.stringify(Array.isArray(pictures) ? pictures : []))
      body.append('has_vote_option', 'true')
      body.append('gaia_source', 'main_web')
      body.append('csrf', csrf)
      body.append('csrf_token', csrf)
      const response = await fetch(`https://api.bilibili.com/x/v2/reply/add?csrf=${encodeURIComponent(csrf)}`, {
        method: 'POST',
        credentials: 'include',
        body,
      })
      const json = await response.json().catch(() => null)
      if (json?.code !== 0) return { ok: false, reason: json?.message || `接口返回 ${json?.code ?? response.status}` }
      const rpid = String(json?.data?.rpid_str || json?.data?.rpid || '').trim()
      return rpid ? { ok: true, rpid } : { ok: false, reason: '评论接口未返回评论ID' }
    }, { oid: Number(aid), message: text, pictures })
    return result || { ok: false, reason: '评论接口无响应' }
  } catch (error) {
    return { ok: false, reason: String(error?.message || error).split('\n')[0] }
  }
}

async function readComments(context, aid) {
  if (!aid) return []
  const body = await browserJson(context, `https://api.bilibili.com/x/v2/reply/main?type=1&oid=${encodeURIComponent(aid)}&mode=3&next=0`)
  return (body?.data?.replies || []).map((item) => ({ content: item?.content?.message || '' }))
}

async function likeVideo(page, aid, onLog) {
  if (!aid) return
  const result = await page.evaluate(async (oid) => {
    const csrf = document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith('bili_jct='))?.slice(9) || ''
    if (!csrf) return false
    const body = new URLSearchParams({ aid: String(oid), like: '1', csrf })
    const response = await fetch('https://api.bilibili.com/x/web-interface/archive/like', { method: 'POST', credentials: 'include', body })
    const json = await response.json().catch(() => null)
    return json?.code === 0
  }, Number(aid)).catch(() => false)
  onLog(result ? 'info' : 'warn', result ? '已点赞' : '点赞失败，继续评论')
}

async function browserJson(context, url) {
  const response = await context.request.get(url, {
    headers: {
      accept: 'application/json, text/plain, */*',
      referer: BILIBILI_LOGIN_URL,
    },
  })
  return response.json()
}

function searchTerms(settings) {
  const seen = new Set()
  const result = []
  const add = (value) => {
    const text = String(value || '').trim()
    const key = text.toLowerCase()
    if (!text || seen.has(key)) return
    seen.add(key)
    result.push(text)
  }
  for (const tag of settings?.campaign?.seedTags || []) add(tag)
  if (!result.length) for (const group of settings?.ruleGroups || []) for (const rule of group?.rules || []) add(rule?.keyword)
  return result.slice(0, 12)
}

function mergeDetail(item, detail) {
  item.aid = Number(detail.aid) || item.aid
  item.title = String(detail.title || item.title || '').trim()
  item.desc = String(detail.desc || item.desc || '').trim()
  item.author = String(detail.owner?.name || item.author || '').trim()
  item.authorId = String(detail.owner?.mid || item.authorId || '').trim()
  item.reply = Number(detail.stat?.reply) || item.reply
}

function blockReason(settings, video) {
  const desc = video.desc || ''
  const nickname = video.author?.nickname || ''
  const word = (settings.blockKeywords || []).find((keyword) => includesFold(desc, keyword))
  if (word) return `视频命中排除词：${word}`
  const author = (settings.authorBlockKeywords || []).find((keyword) => includesFold(nickname, keyword))
  if (author) return `视频作者命中排除词：${author}`
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

function stripHtml(value) {
  return String(value || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim()
}

function listCommentImages(filePath, type) {
  if (!filePath) return []
  if (type === 'file') return fs.existsSync(filePath) ? [filePath] : []
  try {
    return fs.readdirSync(filePath)
      .filter((name) => /\.(png|jpe?g|gif|webp)$/i.test(name))
      .map((name) => path.join(filePath, name))
  } catch {
    return []
  }
}

function imageMime(filePath) {
  const lower = String(filePath || '').toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.webp')) return 'image/webp'
  return 'image/jpeg'
}

async function waitMs(settings, ms) {
  let left = settings?.fast ? Math.min(ms, 5) : ms
  while (left > 0) {
    if (settings?.shouldStop?.()) throw new Error('Task stopped')
    while (settings?.shouldPause?.()) {
      if (settings?.shouldStop?.()) throw new Error('Task stopped')
      await delay(settings?.fast ? 1 : 300)
    }
    const step = Math.min(settings?.fast ? 1 : 200, left)
    await delay(step)
    left -= step
  }
}

const COMMENT_SKIP = {
  empty_response: '模型返回为空', invalid_json: '模型返回格式无法解析', missing_comment: '模型未提供评论正文',
  too_long: '模型评论超过 50 字', invalid_comment: '模型评论格式无效', refusal: '模型拒绝生成评论',
  excluded_word: '模型评论命中排除词', model_error: '模型调用失败',
}

async function defaultLaunch() {
  const { chromium } = await import('playwright-core')
  return { chromium }
}
