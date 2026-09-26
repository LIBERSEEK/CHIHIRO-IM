import fs from 'node:fs'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { learnMatchedVideo, parseModelCommentResult, peerCommentLines } from './growth-brief.mjs'

function randomBetween(min, max) {
  return min + Math.floor(Math.random() * Math.max(1, max - min + 1))
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)]
}

function videoRecord(video, extra = {}) {
  return {
    awemeId: video?.aweme_id || '',
    desc: video?.desc || '',
    nickname: video?.author?.nickname || '',
    shareUrl: video?.share_url || '',
    tags: (video?.video_tag || []).map((tag) => String(tag?.tag_name || '').trim()).filter(Boolean),
    ...extra,
  }
}

function videoTopics(desc) {
  return [...String(desc || '').matchAll(/#([^\s#]+)/g)]
    .map((match) => match[1].replace(/[，。！？、,.!?]+$/g, '').trim())
    .filter(Boolean)
}

function cacheFeedItem(item) {
  const awemeId = String(item?.aweme_id || item?.awemeId || '')
  if (!awemeId) return null
  const videoTag = Array.isArray(item.video_tag)
    ? item.video_tag.map((tag) => ({ tag_name: String(tag?.tag_name || tag?.name || '').trim() })).filter((tag) => tag.tag_name)
    : []
  return {
    aweme_id: awemeId,
    aweme_type: Number(item.aweme_type ?? 0),
    desc: String(item.desc || ''),
    author: {
      nickname: String(item.author?.nickname || ''),
      uid: String(item.author?.uid || ''),
    },
    video_tag: videoTag,
    share_url: String(item.share_url || item.share_info?.share_url || ''),
  }
}

function fold(value) {
  return String(value || '').toLowerCase()
}

function includesFold(haystack, needle) {
  const word = fold(needle).trim()
  return Boolean(word) && fold(haystack).includes(word)
}

function matchRule(rule, video) {
  const keyword = String(rule?.keyword || '').trim()
  if (!keyword) return false
  if (rule.field === 'nickName') return includesFold(video?.author?.nickname, keyword)
  if (rule.field === 'videoDesc') return includesFold(video?.desc, keyword)
  if (rule.field === 'videoTag') {
    return (video?.video_tag || []).some((tag) => includesFold(tag?.tag_name, keyword))
  }
  return false
}

export function matchRuleGroup(group, video, onLog = () => {}) {
  if (!group) return null
  let currentMatched = false
  if (group.type === 'ai') {
    onLog('warn', `AI规则组 "${group.name}" 暂不支持，跳过`)
    currentMatched = false
  }
  if (group.type === 'manual' && Array.isArray(group.rules) && group.rules.length > 0) {
    const matches = group.rules.map((rule) => matchRule(rule, video))
    currentMatched = group.relation === 'and' ? matches.every(Boolean) : matches.some(Boolean)
    if (currentMatched) {
      const matchedRules = group.rules
        .filter((rule, index) => matches[index])
        .map((rule) => `${rule.field}:${rule.keyword}`)
      onLog('success', `手动规则组 "${group.name}" 匹配成功，命中条件: ${matchedRules.join('、')}`)
    }
  }
  if (!currentMatched) return null
  if (Array.isArray(group.children) && group.children.length) {
    return matchRuleGroups(group.children, video, onLog)
  }
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
  if (!matchedRuleGroup) {
    return { shouldSimulateWatch: false, shouldViewComment: false }
  }
  onLog('success', `匹配到规则组: ${matchedRuleGroup.name}`)
  return {
    shouldSimulateWatch: settings?.simulateWatchBeforeComment !== false,
    shouldViewComment: true,
    matchedRuleGroup,
  }
}

export function checkVideoActivity(commentData, now = Math.floor(Date.now() / 1000)) {
  if (!commentData || !Array.isArray(commentData.comments)) {
    return { isActive: false, reason: '评论数据格式错误' }
  }
  const comments = commentData.comments
  const twoDays = 2 * 24 * 60 * 60
  const oneDay = 24 * 60 * 60
  if (comments.length >= 5) {
    const recent = comments.slice(0, 5).filter((item) => now - Number(item.create_time || 0) < twoDays)
    const isActive = recent.length >= 2
    return {
      isActive,
      reason: isActive
        ? `前5条评论中有${recent.length}条在2天内，符合活跃标准`
        : `前5条评论中只有${recent.length}条在2天内，不符合活跃标准`,
    }
  }
  const recent = comments.filter((item) => now - Number(item.create_time || 0) < oneDay)
  const isActive = recent.length >= 1
  return {
    isActive,
    reason: isActive
      ? `评论数量为${comments.length}，有${recent.length}条在1天内，符合活跃标准`
      : `评论数量为${comments.length}，但没有评论在1天内，不符合活跃标准`,
  }
}

function commentTextsFromGroup(group) {
  return (group?.comments || group?.commentTexts || []).map((item) => String(item || '').trim()).filter(Boolean)
}

function selectImagePaths(group) {
  const images = listCommentImages(group?.commentImagePath, group?.commentImageType)
  return images.length ? [pick(images)] : []
}

function blockHit(settings, video) {
  const desc = video.desc || ''
  const nickname = video.author?.nickname || ''
  const hitBlock = (settings.blockKeywords || []).some((keyword) => includesFold(desc, keyword))
  const hitAuthor = (settings.authorBlockKeywords || []).some((keyword) => includesFold(nickname, keyword))
  if (!hitBlock && !hitAuthor) return ''
  if (hitBlock) {
    const words = (settings.blockKeywords || []).filter((keyword) => includesFold(desc, keyword)).join(',')
    return `视频描述命中屏蔽关键词，跳过该视频。屏蔽关键词: ${words} 视频描述: ${desc}`
  }
  const words = (settings.authorBlockKeywords || []).filter((keyword) => includesFold(nickname, keyword)).join(',')
  return `视频作者命中屏蔽关键词，跳过该视频。屏蔽关键词: ${words} 视频作者: ${nickname}`
}

function watchMsFromSettings(settings) {
  const range = Array.isArray(settings?.watchTimeRangeSeconds) ? settings.watchTimeRangeSeconds : null
  const minS = Number.isFinite(Number(range?.[0])) ? Number(range[0]) : Math.round((settings?.minWatchMs || 5000) / 1000)
  const maxS = Math.max(minS, Number.isFinite(Number(range?.[1])) ? Number(range[1]) : Math.round((settings?.maxWatchMs || 15000) / 1000))
  return (Math.floor(Math.random() * (maxS - minS + 1)) + minS) * 1000
}

export async function runDouyinFeedTask({
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
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
    ],
  })
  let context
  try {
    context = await browser.newContext({
      storageState: storageStatePath,
    })
    const page = await context.newPage()
    try { await onReady({ page, browser }) } catch { /* preview is optional */ }
    const videos = new Map()
    page.on('response', async (response) => {
      try {
        const url = response.url()
        if (!url.includes('/aweme/v1/web/tab/feed/')) return
        const body = await response.json().catch(() => null)
        for (const item of body?.aweme_list || []) {
          const cached = cacheFeedItem(item)
          if (cached) videos.set(cached.aweme_id, cached)
        }
      } catch {
        /* ignore parse errors */
      }
    })
    onLog('info', '打开抖音推荐流')
    await page.goto('https://www.douyin.com/?recommend=1', { waitUntil: 'domcontentloaded', timeout: 90000 })
    await page.locator('.recommend-fake-video-img').waitFor({ state: 'detached', timeout: 20000 }).catch(() => {})
    onLog('info', '视频已加载完成')
    await waitMs(settings, 2000)

    let commented = 0
    let scanned = 0
    const maxCount = settings.maxCount || 10
    while (commented < maxCount) {
      if (shouldStop()) throw new Error('Task stopped')
      scanned += 1
      onLog('info', `====== 开始处理第 ${scanned} 个视频，已评论次数：${commented}/${maxCount} ======`)
      const video = await getCurrentVideoInfo(page, videos, onLog)
      if (!video) {
        onLog('warn', '未获取到当前视频信息，跳到下一个视频')
        onVideo(videoRecord({ aweme_id: 'unknown' }, { status: 'skipped', reason: '未获取到当前视频信息', watchDuration: 0 }))
        await waitMs(settings, randomBetween(1000, 3000))
        await goToNextVideo(page, settings)
        continue
      }
      if (video.aweme_type !== 0) {
        onLog('warn', '不是常规视频，直接跳过')
        onVideo(videoRecord(video, { status: 'skipped', reason: '非常规视频类型', watchDuration: 0 }))
        await goToNextVideo(page, settings)
        continue
      }
      onLog('info', `视频作者: @${video.author.nickname} (ID: ${video.author.uid})`)
      onLog('info', `视频描述: ${video.desc}`)
      const topics = videoTopics(video.desc)
      onLog('info', `视频话题: ${topics.length ? topics.join('、') : '无'}`)
      onLog('info', `平台分类标签: ${video.video_tag.length ? JSON.stringify(video.video_tag) : '无'}`)

      const blocked = blockHit(settings, video)
      if (blocked) {
        onLog('warn', blocked)
        onVideo(videoRecord(video, { status: 'skipped', reason: '命中屏蔽关键词', watchDuration: 0 }))
        await waitMs(settings, randomBetween(500, 1000))
        await goToNextVideo(page, settings)
        continue
      }

      const analysis = analyzeVideoType(video, settings, onLog)
      if (!analysis.shouldViewComment) {
        await waitMs(settings, randomBetween(500, 1500))
        onLog('warn', '当前视频不满足评论规则，快速滑走')
        onVideo(videoRecord(video, { status: 'skipped', reason: '不满足评论规则', watchDuration: 0 }))
        onLog('info', '跳转至下一条视频')
        await goToNextVideo(page, settings)
        continue
      }

      const learning = learnMatchedVideo(settings, video)
      if (learning.candidates.length || learning.promoted.length) {
        settings = learning.settings
        onSettings(settings)
        for (const candidate of learning.candidates) {
          onLog('info', `学习候选条件：${candidate.keyword}（${candidate.count}/3 个命中视频）`)
        }
        for (const keyword of learning.promoted) {
          onLog('success', `新增公共命中条件：${keyword}（已在 3 个命中视频中出现）`)
        }
      }

      onLog('info', '视频需要评论')
      let watchMs = 0
      const watchPromise = (async () => {
        if (!analysis.shouldSimulateWatch) return
        watchMs = watchMsFromSettings(settings)
        onLog('info', `先模拟观看 ${Math.round(watchMs / 1000)} 秒`)
        await waitMs(settings, watchMs)
      })()
      const campaignComment = Boolean(settings.campaign?.enabled && typeof writeComment === 'function')
      const listPromise = (campaignComment || settings.onlyCommentActiveVideo)
        ? readCommentList(page, settings, onLog)
        : null
      let heard = null
      try {
        const [list] = await Promise.all([listPromise || Promise.resolve(null), watchPromise])
        heard = list
      } catch (error) {
        await listPromise?.catch(() => {})
        throw error
      }
      if (shouldStop()) throw new Error('Task stopped')

      let shouldComment = true
      let peerComments = []
      if (listPromise) {
        peerComments = peerCommentLines(heard?.body)
        if (settings.onlyCommentActiveVideo) {
          const activity = activityFromList(heard)
          if (heard?.body) onLog('info', `视频活跃度检查结果: ${activity.activityInfo}`)
          onLog('info', `视频活跃度判断结果: ${activity.activityInfo}`)
          onLog('info', activity.activityInfo)
          shouldComment = activity.shouldComment
        }
        if (campaignComment) onLog('info', peerComments.length ? `评论区语气样本：${peerComments.length} 条` : '评论区没有可参考的语气')
      } else {
        onLog('info', '跳过活跃度检查，直接评论')
      }

      let commentPromise = null
      if (shouldComment && campaignComment) {
        commentPromise = Promise.resolve()
          .then(() => writeComment(settings, { ...video, peerComments }))
          .catch((error) => ({ __commentError: error }))
      }
      onLog('info', '浏览评论区2-4秒')
      await waitMs(settings, randomBetween(2000, 4000))

      if (!shouldComment) {
        onLog('warn', '视频活跃度不符合标准，不发布评论')
        onVideo(videoRecord(video, { status: 'skipped', reason: '视频活跃度不符合标准', watchDuration: watchMs }))
        await closeCommentSection(page, settings)
      } else {
        let text = ''
        let commentReason = 'empty_response'
        let imagePaths = []
        if (settings.campaign?.enabled) {
          try {
            const raw = commentPromise ? await commentPromise : ''
            if (raw && typeof raw === 'object' && raw.__commentError) throw raw.__commentError
            const parsed = parseModelCommentResult(raw, settings.campaign?.excludes)
            text = parsed.text
            commentReason = parsed.reason
          } catch {
            text = ''
            commentReason = 'model_error'
          }
          imagePaths = settings.campaign.form === 'image' ? selectImagePaths(analysis.matchedRuleGroup) : []
          if (text && settings.campaign.interaction === 'comment_like') await tryLike(page, onLog)
        } else {
          const texts = commentTextsFromGroup(analysis.matchedRuleGroup)
          text = texts.length ? pick(texts) : ''
          imagePaths = selectImagePaths(analysis.matchedRuleGroup)
        }
        if (settings.campaign?.enabled && !text) {
          const reason = {
            empty_response: '模型返回为空',
            invalid_json: '模型返回格式无法解析',
            missing_comment: '模型未提供评论正文',
            too_long: '模型评论超过 50 字',
            invalid_comment: '模型评论格式无效',
            refusal: '模型拒绝生成评论',
            excluded_word: '模型评论命中排除词',
            model_error: '模型调用失败',
          }[commentReason] || '模型未生成评论'
          onLog('warn', `评论跳过：${reason}`)
          onVideo(videoRecord(video, { status: 'skipped', reason: `模型未生成评论：${reason}`, watchDuration: watchMs }))
          await closeCommentSection(page, settings)
        } else if (!text && !imagePaths.length) {
          onLog('error', '评论发送失败，尝试通过点击按钮关闭评论区')
          onVideo(videoRecord(video, { status: 'skipped', reason: '未配置评论文案，请在规则组中配置评论内容', watchDuration: watchMs }))
          await closeCommentSection(page, settings)
        } else {
          onLog('info', settings.campaign?.enabled ? `评论：${text}` : `随机选择评论内容: ${text}`)
          onLog('info', '尝试发布评论')
          const posted = await postComment(page, text, settings, imagePaths)
          if (posted.ok) {
            commented += 1
            onComment(videoRecord(video, { text, status: 'commented', watchDuration: watchMs }))
            onLog('success', `评论发送成功，已评论次数：${commented}/${maxCount}`)
            await waitMs(settings, randomBetween(1000, 3000))
            onLog('info', '关闭评论区')
            await closeCommentSection(page, settings)
            if (commented >= maxCount) {
              onLog('success', `已达到评论次数限制 ${maxCount}，任务完成`)
              break
            }
          } else {
            onLog('error', `评论发送失败：${posted.reason}，尝试通过点击按钮关闭评论区`)
            onVideo(videoRecord(video, { status: 'skipped', reason: `评论发送失败：${posted.reason}`, watchDuration: watchMs }))
            await closeCommentSection(page, settings)
          }
        }
      }
      await waitMs(settings, randomBetween(500, 3000))
      onLog('info', '跳转至下一条视频')
      await goToNextVideo(page, settings)
    }
    onLog('success', `任务完成，评论 ${commented} 条`)
    return { commented, scanned }
  } finally {
    try { await context?.storageState({ path: storageStatePath }) } catch { /* keep previous */ }
    await browser.close().catch(() => {})
  }
}

async function getCurrentVideoInfo(page, cache, onLog) {
  try {
    const active = firstLocator(page, '[data-e2e="feed-active-video"]')
    if (!await active.count()) {
      onLog('info', '未找到当前活跃视频元素')
      return null
    }
    const videoId = await active.getAttribute('data-e2e-vid')
    if (!videoId) {
      onLog('info', '未找到视频ID')
      return null
    }
    onLog('info', `当前活跃视频ID: ${videoId}`)
    const videoData = cache.get(videoId)
    if (!videoData) {
      onLog('info', `未在缓存中找到视频ID: ${videoId} 的数据`)
      return null
    }
    cache.delete(videoId)
    return videoData
  } catch (error) {
    onLog('error', `获取当前视频信息时出错: ${error}`)
    return null
  }
}

function activityFromList(heard) {
  if (!heard?.body) {
    if (heard?.timedOut) return { shouldComment: false, activityInfo: '监听超时，未捕获到评论数据' }
    if (heard?.failed) return { shouldComment: false, activityInfo: '解析评论数据出错' }
    return { shouldComment: false, activityInfo: '无法解析评论数据' }
  }
  const activity = checkVideoActivity(heard.body)
  return { shouldComment: activity.isActive, activityInfo: activity.reason }
}

function listenForCommentList(page, settings, onLog) {
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
      if (!url.includes('https://www.douyin.com/aweme/v1/web/comment/list/')) return
      onLog('info', '捕获到评论列表接口请求')
      try {
        const body = await response.json().catch(() => null)
        finish(body ? { body } : { body: null, failed: true })
      } catch {
        finish({ body: null, failed: true })
      }
    }
    page.on('response', onResponse)
    const timer = setTimeout(() => {
      onLog('warn', '评论数据监听超时，未捕获到数据')
      finish({ body: null, timedOut: true })
    }, settings?.fast ? 20 : 10000)
  })
}

async function readCommentList(page, settings, onLog) {
  try {
    const pending = listenForCommentList(page, settings, onLog)
    onLog('info', '使用快捷键X打开评论区')
    await openCommentSection(page, settings)
    return await pending
  } catch (error) {
    onLog('error', `打开评论区并监听数据时出错: ${error}`)
    return { body: null, failed: true }
  }
}

function firstLocator(page, selector) {
  return page.locator(selector).first()
}

async function commentSectionOpen(page) {
  const card = firstLocator(page, '#videoSideCard')
  try {
    if (!await card.count()) return false
    return (await card.evaluate((el) => el.clientWidth)) > 0
  } catch {
    return false
  }
}

async function openCommentSection(page, settings = {}) {
  if (await commentSectionOpen(page)) return
  await page.keyboard.press('x').catch(() => {})
  await waitMs(settings, 600)
}

async function closeCommentSection(page, settings = {}) {
  if (!await commentSectionOpen(page)) return
  await page.keyboard.press('x').catch(() => {})
  await waitMs(settings, 500)
  if (!await commentSectionOpen(page)) return
  try {
    await firstLocator(page, '[data-e2e="feed-active-video"] [data-e2e="feed-comment-icon"]').click({ timeout: 3000 })
    await waitMs(settings, 500)
  } catch {
    await page.keyboard.press('x').catch(() => {})
    await waitMs(settings, 500)
  }
}

async function goToNextVideo(page, settings = {}) {
  await closeCommentSection(page, settings)
  await page.keyboard.press('ArrowDown').catch(() => {})
  await waitMs(settings, randomBetween(800, 1600))
}

async function postComment(page, text, settings = {}, imagePaths = []) {
  try {
    await openCommentSection(page, settings)
    const container = firstLocator(page, '.comment-input-inner-container')
    try {
      await container.waitFor({ state: 'visible', timeout: 5000 })
    } catch {
      return { ok: false, reason: '评论输入框不可见' }
    }
    await container.click()
    await waitMs(settings, 1000)
    if (text) {
      if (settings.fast) await page.keyboard.type(text)
      else {
        for (const ch of text) {
          await page.keyboard.type(ch)
          await waitMs(settings, randomBetween(100, 300))
        }
      }
    }
    await waitMs(settings, randomBetween(400, 900))
    const availableImages = imagePaths.filter((imagePath) => fs.existsSync(imagePath))
    if (availableImages.length) {
      for (const imagePath of availableImages) {
        try {
          const chooserPromise = page.waitForEvent('filechooser', { timeout: 5000 })
          await firstLocator(page, '.commentInput-right-ct > div > span:nth-child(2)').click({ timeout: 5000 })
          const chooser = await chooserPromise
          await chooser.setFiles(imagePath)
          await waitMs(settings, 1200)
          continue
        } catch {
          // Some Douyin builds expose the file input without emitting filechooser.
        }
        try {
          const input = firstLocator(page, 'input[type="file"]')
          if (!await input.count() || typeof input.setInputFiles !== 'function') {
            return { ok: false, reason: '图片上传控件未出现' }
          }
          await input.setInputFiles(imagePath)
          await waitMs(settings, 1200)
        } catch {
          return { ok: false, reason: '图片上传失败' }
        }
      }
    }
    await page.keyboard.press('Enter')
    await waitMs(settings, 800)
    return { ok: true, reason: '' }
  } catch (error) {
    return { ok: false, reason: error?.message ? `评论输入失败: ${error.message}` : '评论输入失败' }
  }
}

async function tryLike(page, onLog) {
  try {
    const button = page.locator('[data-e2e="video-player-digg"]').first()
    if (!await button.count()) {
      onLog('warn', '没有点到赞，继续评论')
      return
    }
    await button.click({ timeout: 2000 })
    onLog('info', '已点赞')
  } catch {
    onLog('warn', '没有点到赞，继续评论')
  }
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

function waitMs(settings, ms) {
  const shouldStop = typeof settings?.shouldStop === 'function' ? settings.shouldStop : () => false
  const shouldPause = typeof settings?.shouldPause === 'function' ? settings.shouldPause : () => false
  const slice = settings?.fast ? 1 : 200
  let remain = settings?.fast ? 1 : Math.max(0, Number(ms) || 0)
  return (async () => {
    while (true) {
      if (shouldStop()) throw new Error('Task stopped')
      if (shouldPause()) {
        await delay(slice)
        continue
      }
      if (remain <= 0) return
      const step = Math.min(slice, remain)
      await delay(step)
      remain -= step
    }
  })()
}

async function defaultLaunch() {
  try {
    return await import('playwright-core')
  } catch (error) {
    throw new Error(`无法加载 Playwright（${error.message}）。请在 backend 安装 playwright-core`)
  }
}
