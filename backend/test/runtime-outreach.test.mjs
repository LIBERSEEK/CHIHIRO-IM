import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import test from 'node:test'
import { createRuntime } from '../src/runtime/api.mjs'
import { createOutreachRuntime } from '../src/runtime/outreach/service.mjs'
import { createAccountStore } from '../src/runtime/accounts.mjs'
import { isDouyinAccountId, isOutreachAccountId, newDouyinAccountId } from '../src/runtime/outreach/accounts/ids.mjs'
import { normalizeOutreachSettings } from '../src/runtime/outreach/campaign/settings.mjs'
import { extractDouyinProfile, presentDouyinIdentity, splitDouyinIdentity } from '../src/runtime/outreach/accounts/profile.mjs'
import { analyzeVideoType, matchRuleGroups } from '../src/runtime/outreach/core/targeting.mjs'
import { bindDouyinPlaybackBlock, checkVideoActivity, collectAwemeItems, isDouyinAwemePayloadUrl, runDouyinFeedTask, shouldBlockDouyinPlayback } from '../src/runtime/outreach/platforms/douyin/index.mjs'

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return server.address().port
}

test('outreach ids and settings stay in the Douyin account namespace', () => {
  assert.equal(isDouyinAccountId('douyin:abc_1'), true)
  assert.equal(isDouyinAccountId('qq:10001'), false)
  assert.match(newDouyinAccountId(), /^douyin:[A-Za-z0-9]+$/)
  const settings = normalizeOutreachSettings({
    maxCount: 3,
    comments: '学到了\n\n说得很清楚',
    blockKeywords: ['广告'],
    minWatchMs: 2000,
    maxWatchMs: 1000,
  })
  assert.equal(settings.maxCount, 3)
  assert.deepEqual(settings.comments, ['学到了', '说得很清楚'])
  assert.deepEqual(settings.blockKeywords, ['广告'])
  assert.equal(settings.maxWatchMs >= settings.minWatchMs, true)
  const grouped = normalizeOutreachSettings({
    ruleGroups: [
      { id: 'a', name: '组A', comments: ['好'] },
      { id: 'b', name: '组B', comments: ['收藏了', '学到了'] },
    ],
  })
  assert.deepEqual(grouped.comments, ['好', '收藏了', '学到了'])
  assert.equal(grouped.ruleGroups.length, 2)
  const nested = normalizeOutreachSettings({
    watchTimeRangeSeconds: [4, 9],
    authorBlockKeywords: ['广告号'],
    simulateWatchBeforeComment: false,
    ruleGroups: [{
      id: 'p',
      name: '数码评测',
      children: [{ id: 'c', name: '手机平板', commentTexts: ['专业测评', '对比清楚'] }],
    }],
  })
  assert.deepEqual(nested.comments, ['专业测评', '对比清楚'])
  assert.equal(nested.ruleGroups[0].children[0].name, '手机平板')
  assert.deepEqual(nested.watchTimeRangeSeconds, [4, 9])
  assert.equal(nested.simulateWatchBeforeComment, false)
  assert.deepEqual(nested.authorBlockKeywords, ['广告号'])
})

test('outreach account ids include every supported social platform', () => {
  assert.equal(isOutreachAccountId('douyin:abc'), true)
  assert.equal(isOutreachAccountId('xiaohongshu:abc'), true)
  assert.equal(isOutreachAccountId('bilibili:abc'), true)
  assert.equal(isOutreachAccountId('qq:10001'), false)
})

test('splitDouyinIdentity keeps the name and Douyin id without follower counts', () => {
  assert.deepEqual(splitDouyinIdentity('自由探索LIBERSEEK关注30粉丝149获赞146抖音号：959855095'), {
    name: '自由探索LIBERSEEK',
    douyinId: '959855095',
  })
  assert.deepEqual(presentDouyinIdentity({
    nickname: '自由探索LIBERSEEK关注30粉丝149获赞146抖音号：959855095',
    label: '自由探索LIBERSEEK关注30粉丝149获赞146抖音号：959855095',
  }), {
    name: '自由探索LIBERSEEK',
    douyinId: '959855095',
  })
})

test('extractDouyinProfile walks nested localStorage and cookies', () => {
  const profile = extractDouyinProfile({
    localStorage: {
      HasUserLogin: '1',
      user_info: JSON.stringify({
        user: {
          nickname: '创作者',
          avatar_url: 'https://p3.douyinpic.com/aweme/avatar.jpeg',
          uid: '123456789',
        },
      }),
    },
    cookies: [{ name: 'uid_tt', value: 'cookie-uid' }],
    nickname: '登录',
  })
  assert.equal(profile.nickname, '创作者')
  assert.equal(profile.avatar, 'https://p3.douyinpic.com/aweme/avatar.jpeg')
  assert.equal(profile.uid, '123456789')
  const visible = extractDouyinProfile({
    nickname: '自由探索LIBERSEEK关注30粉丝149获赞146抖音号：959855095',
    localStorage: {
      user: JSON.stringify({ nickname: '其他名字', unique_id: 'from-storage', uid: '1234567890123456' }),
    },
  })
  assert.equal(visible.nickname, '自由探索LIBERSEEK')
  assert.equal(visible.douyinId, '959855095')
  assert.equal(visible.uid, '1234567890123456')
})

test('prepareNew overlays Douyin login onto the QQ snapshot without creating an account', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'chihiro-outreach-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const store = createAccountStore(path.join(root, 'data', 'accounts.json'))
  store.upsert({ id: 'qq:10001', client: 'qq', nickname: 'QQ 号', uin: '10001' })
  const outreach = createOutreachRuntime({ root, store })
  const prepared = outreach.prepareNew()
  assert.equal(prepared.loginClient, 'douyin')
  assert.equal(prepared.pendingAdd, true)
  assert.equal(prepared.phase, 'browser_setup')
  const snap = outreach.decorateSnapshot({
    phase: 'ready',
    message: '已登录 QQ 号',
    pendingAdd: false,
    accounts: { activeId: 'qq:10001', accounts: [{ id: 'qq:10001', online: true, nickname: 'QQ 号' }] },
  })
  assert.equal(snap.phase, 'browser_setup')
  assert.equal(snap.pendingAdd, true)
  assert.equal(snap.qr.exists, false)
  assert.equal(snap.accounts.accounts[0].id, 'qq:10001')
  assert.equal(snap.outreach.loginClient, 'douyin')
})

test('headed login writes storageState and marks the Douyin account online', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'chihiro-outreach-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const chrome = path.join(root, 'fake-chrome')
  fs.writeFileSync(chrome, '#!/bin/sh\n')
  fs.chmodSync(chrome, 0o755)
  const store = createAccountStore(path.join(root, 'data', 'accounts.json'))
  const outreach = createOutreachRuntime({
    root,
    store,
    loginWaiter: async () => ({
      storageState: { cookies: [{ name: 'sessionid', value: 'sess', domain: '.douyin.com' }] },
      nickname: '创作者',
      uid: 'u1',
      avatar: '',
      avatarBytes: { body: Buffer.from([0xff, 0xd8, 0xff, 0xd9]), contentType: 'image/jpeg' },
    }),
  })
  outreach.setBrowserPath(chrome)
  outreach.prepareNew()
  const result = await outreach.login({ browserPath: chrome })
  assert.equal(isDouyinAccountId(result.id), true)
  const listed = store.list().accounts.find((account) => account.id === result.id)
  assert.equal(listed.platform, 'douyin')
  assert.equal(listed.nickname, '创作者')
  const snap = outreach.decorateSnapshot({
    phase: 'idle',
    message: '',
    pendingAdd: false,
    accounts: store.list(),
  })
  const row = snap.accounts.accounts.find((account) => account.id === result.id)
  assert.equal(row.online, true)
  assert.equal(row.platform, 'douyin')
  assert.equal(row.obToken, '')
  assert.equal(outreach.hasStorage(result.id), true)
  assert.match(row.avatar, /\/api\/runtime\/outreach\/accounts\/.*\/avatar/)
  const avatar = outreach.readAvatar(result.id)
  assert.equal(avatar.contentType, 'image/jpeg')
  assert.equal(avatar.body[0], 0xff)
})

test('playback block drops video streams and keeps feed, comments, and covers', async () => {
  assert.equal(shouldBlockDouyinPlayback('https://v26-web.douyinvod.com/obj/a.mp4?mime_type=video_mp4', 'xhr'), true)
  assert.equal(shouldBlockDouyinPlayback('https://v3-web.bytevod.com/stream/index.m3u8', 'fetch'), true)
  assert.equal(shouldBlockDouyinPlayback('https://www.douyin.com/aweme/v1/play/?video_id=1', 'xhr'), true)
  assert.equal(shouldBlockDouyinPlayback('https://www.douyin.com/aweme/v1/web/tab/feed/?count=10', 'xhr'), false)
  assert.equal(shouldBlockDouyinPlayback('https://www.douyin.com/aweme/v1/web/comment/list/?cursor=0', 'xhr'), false)
  assert.equal(shouldBlockDouyinPlayback('https://p3-sign.douyinpic.com/tos-cn-i-0813/cover.jpeg', 'image'), false)
  assert.equal(shouldBlockDouyinPlayback('blob:https://www.douyin.com/8b1', 'media'), false)
  const actions = []
  const logs = []
  const page = {
    async route(_pattern, handler) { page.handler = handler },
  }
  assert.equal(await bindDouyinPlaybackBlock(page, (level, text) => logs.push([level, text])), true)
  const call = (url, resourceType) => page.handler({
    request: () => ({ url: () => url, resourceType: () => resourceType }),
    abort: async (reason) => actions.push(['abort', reason, url]),
    continue: async () => actions.push(['continue', url]),
  })
  await call('https://v26-web.douyinvod.com/a.mp4', 'xhr')
  await call('https://www.douyin.com/aweme/v1/web/tab/feed/?count=10', 'xhr')
  await call('https://www.douyin.com/aweme/v1/web/comment/list/?cursor=0', 'xhr')
  await call('https://p3-sign.douyinpic.com/cover.webp', 'image')
  assert.deepEqual(actions.map((item) => item[0]), ['abort', 'continue', 'continue', 'continue'])
  assert.equal(logs.length, 1)
  assert.match(logs[0][1], /已抑制视频流/)
})

test('search responses fill the same cache and the fullscreen player still advances with the arrow key', async () => {
  assert.equal(isDouyinAwemePayloadUrl('https://www.douyin.com/aweme/v1/web/general/search/single/?keyword=codex'), true)
  assert.equal(isDouyinAwemePayloadUrl('https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=1'), true)
  assert.equal(isDouyinAwemePayloadUrl('https://www.douyin.com/aweme/v1/web/tab/feed/?count=10'), true)
  assert.equal(isDouyinAwemePayloadUrl('https://www.douyin.com/aweme/v1/web/comment/list/?cursor=0'), false)
  assert.equal(isDouyinAwemePayloadUrl('https://v26-web.douyinvod.com/a.mp4'), false)
  const searched = collectAwemeItems({
    data: [{ aweme_info: { aweme_id: '7685681479640272180', aweme_type: 0, desc: 'codex 长任务', author: { nickname: '甲', uid: '7' }, video_tag: [{ tag_name: 'Codex' }] } }],
  })
  assert.equal(searched[0].desc, 'codex 长任务')
  assert.equal(searched[0].author.nickname, '甲')
  assert.equal(collectAwemeItems({ aweme_detail: { aweme_id: '2', desc: '另一条', author: { nickname: '乙' } } }).length, 1)
  assert.equal(collectAwemeItems({ comments: [{ cid: 'c1', aweme_id: '2', text: '哈哈', user: { nickname: '路人' } }] }).length, 0)

  const urls = []
  const logs = []
  const presses = []
  let currentId = '10'
  const page = {
    on(event, handler) {
      if (event === 'response') page._onResponse = handler
    },
    async goto(url) {
      urls.push(url)
      await page._onResponse({
        url: () => 'https://www.douyin.com/aweme/v1/web/general/search/single/?keyword=codex',
        json: async () => ({
          data: [
            { aweme_info: { aweme_id: '10', aweme_type: 0, desc: '今天天气', author: { nickname: 'a', uid: '1' } } },
            { aweme_info: { aweme_id: '11', aweme_type: 0, desc: 'Codex 跑长任务', author: { nickname: 'b', uid: '2' } } },
          ],
        }),
      })
    },
    keyboard: {
      press: async (key) => {
        presses.push(key)
        if (key === 'ArrowDown' && currentId === '10') currentId = '11'
      },
      type: async () => {},
    },
    locator() {
      const node = {
        first() { return node },
        count: async () => 1,
        click: async () => {},
        waitFor: async () => {},
        evaluate: async () => 0,
        getAttribute: async (name) => (name === 'data-e2e-vid' ? currentId : null),
      }
      return node
    },
  }
  const result = await runDouyinFeedTask({
    executablePath: '/usr/bin/google-chrome',
    storageStatePath: '/tmp/state.json',
    settings: {
      maxCount: 1,
      fast: true,
      simulateWatchBeforeComment: false,
      comments: ['学到了'],
      ruleGroups: [{
        id: 'g1',
        name: 'codex',
        type: 'manual',
        relation: 'or',
        rules: [{ field: 'videoDesc', keyword: 'Codex' }],
        comments: ['学到了'],
        children: [],
      }],
    },
    launch: {
      chromium: {
        launch: async () => ({
          newContext: async () => ({ newPage: async () => page, storageState: async () => {} }),
          close: async () => {},
        }),
      },
    },
    onLog: (level, text) => logs.push([level, text]),
  })
  assert.equal(urls[0], 'https://www.douyin.com/?recommend=1')
  assert.equal(result.commented, 1)
  assert.ok(presses.includes('ArrowDown'))
  assert.ok(logs.some((item) => item[1] === '已接上搜索结果里的视频简介'))
  assert.ok(logs.some((item) => item[1].includes('Codex 跑长任务')))
  assert.equal(logs.some((item) => item[1].includes('已打开搜索结果')), false)
})

test('active search videos fall back to the authenticated detail endpoint on a cache miss', async () => {
  const logs = []
  const page = {
    on() {},
    async goto() {},
    async evaluate(fn, id) {
      assert.equal(id, '77')
      return {
        aweme_detail: {
          aweme_id: '77',
          aweme_type: 0,
          desc: '搜索页打开的 Codex 视频',
          author: { nickname: '搜索作者', uid: '9' },
        },
      }
    },
    keyboard: { press: async () => {}, type: async () => {} },
    locator(selector) {
      const node = {
        first() { return node },
        count: async () => 1,
        click: async () => {},
        waitFor: async () => {},
        evaluate: async () => 0,
        getAttribute: async (name) => (selector === '[data-e2e="feed-active-video"]' && name === 'data-e2e-vid' ? '77' : null),
      }
      return node
    },
  }
  const result = await runDouyinFeedTask({
    executablePath: '/usr/bin/google-chrome',
    storageStatePath: '/tmp/state.json',
    settings: {
      maxCount: 1,
      fast: true,
      simulateWatchBeforeComment: false,
      comments: ['学到了'],
      ruleGroups: [{
        id: 'g1',
        name: 'codex',
        type: 'manual',
        relation: 'or',
        rules: [{ field: 'videoDesc', keyword: 'Codex' }],
        comments: ['学到了'],
        children: [],
      }],
    },
    launch: {
      chromium: {
        launch: async () => ({
          newContext: async () => ({ newPage: async () => page, storageState: async () => {} }),
          close: async () => {},
        }),
      },
    },
    onLog: (level, text) => logs.push([level, text]),
  })
  assert.equal(result.commented, 1)
  assert.ok(logs.some((item) => item[1].includes('缓存未命中，尝试通过详情接口')))
  assert.ok(logs.some((item) => item[1].includes('搜索页打开的 Codex 视频')))
})

test('feed worker comments then advances, skipping blocked videos, and attaches one random configured image', async (t) => {
  const events = []
  const reasons = []
  const presses = []
  const comments = []
  const selectors = []
  const attachedFiles = []
  const imageDir = await mkdtemp(path.join(os.tmpdir(), 'chihiro-outreach-comment-images-'))
  t.after(() => rm(imageDir, { recursive: true, force: true }))
  fs.writeFileSync(path.join(imageDir, 'first.png'), 'first')
  fs.writeFileSync(path.join(imageDir, 'second.jpg'), 'second')
  let currentId = '1'
  const page = {
    on(event, handler) {
      if (event === 'response') page._onResponse = handler
    },
    async goto() {
      await page._onResponse({
        url: () => 'https://www.douyin.com/aweme/v1/web/tab/feed/?count=10',
        json: async () => ({
          aweme_list: [
            { aweme_id: '1', aweme_type: 0, desc: '广告投放', author: { nickname: 'shop' } },
            { aweme_id: '2', aweme_type: 0, desc: '手机测评教程', author: { nickname: 'teacher' } },
            { aweme_id: '3', aweme_type: 0, desc: '今日天气真好', author: { nickname: 'unrelated' } },
          ],
        }),
      })
    },
    async waitForEvent(event) {
      assert.equal(event, 'filechooser')
      return { setFiles: async (files) => attachedFiles.push(...(Array.isArray(files) ? files : [files])) }
    },
    keyboard: {
      press: async (key) => {
        presses.push(key)
        if (key === 'ArrowDown') currentId = currentId === '1' ? '2' : '3'
      },
      type: async (text) => { comments.push(text) },
    },
    locator(selector) {
      selectors.push(selector)
      const node = {
        first() { return node },
        count: async () => (selector === '#videoSideCard' ? 0 : 1),
        click: async () => {},
        setInputFiles: async () => {},
        waitFor: async () => {},
        evaluate: async () => 0,
        getAttribute: async (name) => (selector === '[data-e2e="feed-active-video"]' && name === 'data-e2e-vid' ? currentId : null),
      }
      return node
    },
  }
  const context = {
    newPage: async () => page,
    storageState: async () => {},
  }
  let contextOptions
  const launch = {
    chromium: {
      launch: async () => ({
        newContext: async (opts) => {
          contextOptions = opts
          return context
        },
        close: async () => { events.push('closed') },
      }),
    },
  }
  const result = await runDouyinFeedTask({
    executablePath: '/usr/bin/google-chrome',
    storageStatePath: '/tmp/state.json',
    settings: {
      maxCount: 1,
      minWatchMs: 1,
      maxWatchMs: 1,
      watchTimeRangeSeconds: [0, 0],
      simulateWatchBeforeComment: false,
      comments: ['学到了'],
      blockKeywords: ['广告'],
      fast: true,
      ruleGroups: [{
        id: 'g1',
        name: '数码评测',
        type: 'manual',
        relation: 'or',
        rules: [{ field: 'videoDesc', keyword: '测评' }],
        comments: [],
        children: [{
          id: 'c1',
          name: '手机平板',
          type: 'manual',
          relation: 'or',
          rules: [{ field: 'videoDesc', keyword: '手机' }],
          comments: ['评测很专业！'],
          commentImagePath: imageDir,
          commentImageType: 'folder',
          children: [],
        }],
      }],
    },
    launch,
    onVideo: (video) => {
      events.push(video.status)
      reasons.push(video.reason)
    },
    onComment: (row) => events.push(row.text),
  })
  assert.equal(result.commented, 1)
  assert.ok(result.scanned >= 2)
  assert.ok(comments.includes('评测很专业！'))
  assert.ok(presses.includes('x'))
  assert.ok(presses.includes('Enter'))
  assert.ok(presses.includes('ArrowDown'))
  assert.ok(selectors.includes('.comment-input-inner-container'))
  assert.equal(attachedFiles.length, 1)
  assert.ok([path.join(imageDir, 'first.png'), path.join(imageDir, 'second.jpg')].includes(attachedFiles[0]))
  assert.ok(events.includes('skipped'))
  assert.ok(events.includes('评测很专业！'))
  assert.ok(reasons.includes('命中屏蔽关键词'))
  assert.equal(reasons.includes('不满足评论规则'), false)
  assert.ok(events.includes('closed'))
  assert.equal(contextOptions.storageState, '/tmp/state.json')
  assert.equal(contextOptions.viewport, undefined)
  assert.equal(contextOptions.isMobile, undefined)
})

test('campaign comments hear the comment section before asking the model', async () => {
  const listeners = new Set()
  const order = []
  let peers = null
  const page = {
    on(event, handler) {
      if (event === 'response') listeners.add(handler)
    },
    removeListener(event, handler) {
      if (event === 'response') listeners.delete(handler)
    },
    async goto() {
      for (const handler of [...listeners]) {
        await handler({
          url: () => 'https://www.douyin.com/aweme/v1/web/tab/feed/?count=10',
          json: async () => ({
            aweme_list: [{ aweme_id: '9', aweme_type: 0, desc: 'Codex 长任务经常跑断', author: { nickname: 'builder', uid: '1' } }],
          }),
        })
      }
    },
    keyboard: {
      press: async (key) => {
        order.push(key)
        if (key !== 'x') return
        for (const handler of [...listeners]) {
          await handler({
            url: () => 'https://www.douyin.com/aweme/v1/web/comment/list/?cursor=0',
            json: async () => ({
              comments: [
                { text: '这也太费 token 了吧' },
                { text: '哈哈笑死' },
                { text: '哈' },
              ],
            }),
          })
        }
      },
      type: async () => {},
    },
    locator() {
      const node = {
        first() { return node },
        count: async () => 1,
        click: async () => {},
        waitFor: async () => {},
        evaluate: async () => 0,
        getAttribute: async () => '9',
      }
      return node
    },
  }
  const launch = {
    chromium: {
      launch: async () => ({
        newContext: async () => ({ newPage: async () => page, storageState: async () => {} }),
        close: async () => {},
      }),
    },
  }
  const result = await runDouyinFeedTask({
    executablePath: '/usr/bin/google-chrome',
    storageStatePath: '/tmp/state.json',
    settings: {
      maxCount: 1,
      fast: true,
      simulateWatchBeforeComment: false,
      campaign: {
        enabled: true,
        audience: '用 Codex 的人',
        offer: '统一 API 入口',
        benefit: '少改几处配置',
        tone: '随口',
        excludes: [],
        form: 'text',
        interaction: 'comment',
      },
      ruleGroups: [{
        id: 'campaign',
        name: '投放人群',
        type: 'manual',
        relation: 'or',
        rules: [{ field: 'videoDesc', keyword: 'Codex' }],
        comments: [],
        children: [],
      }],
    },
    launch,
    writeComment: async (_settings, video) => {
      order.push('write')
      peers = video.peerComments
      return '{"comment":"长任务跑断确实烦，统一入口少改两处"}'
    },
  })
  assert.equal(result.commented, 1)
  assert.deepEqual(peers, ['这也太费 token 了吧', '哈哈笑死'])
  assert.ok(order.indexOf('x') >= 0)
  assert.ok(order.indexOf('x') < order.indexOf('write'))
})

test('rule groups only match the leaf that satisfies parent and child keywords', () => {
  const parent = {
    id: 'p',
    name: '数码评测',
    type: 'manual',
    relation: 'or',
    rules: [{ field: 'videoDesc', keyword: '评测' }],
    children: [
      {
        id: 'phone',
        name: '手机平板',
        type: 'manual',
        relation: 'or',
        rules: [{ field: 'videoDesc', keyword: '手机' }, { field: 'videoTag', keyword: '数码' }],
        comments: ['手机这条'],
        children: [],
      },
      {
        id: 'pc',
        name: '电脑配件',
        type: 'manual',
        relation: 'and',
        rules: [{ field: 'nickName', keyword: '老师' }, { field: 'videoDesc', keyword: '电脑' }],
        comments: ['电脑这条'],
        children: [],
      },
    ],
  }
  const phone = matchRuleGroups([parent], {
    desc: '最新手机评测来了',
    author: { nickname: '数码君' },
    video_tag: [{ tag_name: '数码测评' }],
  })
  assert.equal(phone?.id, 'phone')
  const tagOnly = matchRuleGroups([parent], {
    desc: '今日评测合集',
    author: { nickname: '数码君' },
    video_tag: [{ tag_name: '数码' }],
  })
  assert.equal(tagOnly?.id, 'phone')
  const pc = matchRuleGroups([parent], {
    desc: '电脑评测分享',
    author: { nickname: '硬件老师' },
    video_tag: [],
  })
  assert.equal(pc?.id, 'pc')
  const parentOnly = matchRuleGroups([parent], {
    desc: '这是一条评测，内容与品类无关',
    author: { nickname: '路人' },
    video_tag: [],
  })
  assert.equal(parentOnly, null)
  const unrelated = analyzeVideoType({
    desc: '今日天气真好',
    author: { nickname: '路人' },
    video_tag: [],
  }, { ruleGroups: [parent], simulateWatchBeforeComment: true })
  assert.equal(unrelated.shouldViewComment, false)
  assert.equal(unrelated.shouldSimulateWatch, false)
  const emptyRules = matchRuleGroups([{
    id: 'empty',
    name: '空规则',
    type: 'manual',
    relation: 'or',
    rules: [],
    comments: ['学到了'],
    children: [],
  }], { desc: '任意内容', author: { nickname: 'a' }, video_tag: [] })
  assert.equal(emptyRules, null)
  const folded = matchRuleGroups([{
    id: 'codex',
    name: '投放人群',
    type: 'manual',
    relation: 'or',
    rules: [{ field: 'videoDesc', keyword: 'Codex' }, { field: 'videoTag', keyword: 'GPT' }, { field: 'nickName', keyword: 'Teacher' }],
    comments: [],
    children: [],
  }], {
    desc: '今天聊一下 codex 的额度',
    author: { nickname: 'night teacher' },
    video_tag: [{ tag_name: 'gpt工具' }],
  })
  assert.equal(folded?.id, 'codex')
})

test('video activity skip reasons match the two-day and one-day thresholds', () => {
  const now = 1_000_000
  const active = checkVideoActivity({
    comments: [
      { create_time: now - 3600 },
      { create_time: now - 7200 },
      { create_time: now - 3 * 24 * 3600 },
      { create_time: now - 4 * 24 * 3600 },
      { create_time: now - 5 * 24 * 3600 },
    ],
  }, now)
  assert.equal(active.isActive, true)
  assert.match(active.reason, /符合活跃标准/)
  const inactive = checkVideoActivity({
    comments: [
      { create_time: now - 3 * 24 * 3600 },
      { create_time: now - 4 * 24 * 3600 },
      { create_time: now - 5 * 24 * 3600 },
      { create_time: now - 6 * 24 * 3600 },
      { create_time: now - 7 * 24 * 3600 },
    ],
  }, now)
  assert.equal(inactive.isActive, false)
  assert.match(inactive.reason, /不符合活跃标准/)
  const few = checkVideoActivity({ comments: [{ create_time: now - 10 * 24 * 3600 }] }, now)
  assert.equal(few.isActive, false)
  assert.match(few.reason, /没有评论在1天内/)
})

test('runtime API prepares Douyin login, saves Chrome path, and starts a mocked task', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'chihiro-outreach-api-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const chrome = path.join(root, 'fake-chrome')
  fs.writeFileSync(chrome, '#!/bin/sh\n')
  fs.chmodSync(chrome, 0o755)
  let runtime
  const qq = {
    snapshot: () => {
      const listed = runtime.store.list()
      return {
        phase: 'idle',
        message: '',
        pendingAdd: false,
        accounts: listed,
        qr: { exists: false, mtime: 0 },
      }
    },
    subscribe: () => () => {},
    refreshPorts: async () => {},
    touch: () => {},
  }
  runtime = createRuntime({
    root,
    cfg: {},
    services: {
      qq,
      outreachLoginWaiter: async () => ({
        storageState: { cookies: [{ name: 'sessionid', value: 'sess' }] },
        nickname: '抖音号',
        uid: '',
        avatar: '',
        avatarBytes: { body: Buffer.from([0x89, 0x50, 0x4e, 0x47]), contentType: 'image/png' },
      }),
      outreachFeedRunner: async ({ onLog, onComment }) => {
        onLog('info', '打开抖音推荐流')
        onComment({ awemeId: '1', text: '学到了', status: 'commented' })
        return { commented: 1, scanned: 1 }
      },
      astrbot: { refreshStatus: async () => ({}), stopIfOwned: async () => {} },
      bot: { wired: new Set(), sync: async () => {}, unwireBeforeRemove: async () => {} },
      chatui: { handle: () => false },
    },
  })
  const server = http.createServer(async (req, res) => {
    const handled = await runtime.handle(req, res, new URL(req.url, 'http://runtime.test'))
    if (!handled) { res.writeHead(404); res.end() }
  })
  const port = await listen(server)
  t.after(async () => {
    await runtime.shutdown()
    await new Promise((resolve) => server.close(resolve))
  })
  const base = `http://127.0.0.1:${port}`
  const start = await fetch(`${base}/api/runtime/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client: 'douyin', mode: 'new' }),
  })
  assert.equal(start.status, 200)
  const started = await start.json()
  assert.equal(started.phase, 'browser_setup')
  assert.equal(started.outreach.loginClient, 'douyin')
  const saved = await fetch(`${base}/api/runtime/outreach/browser`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: chrome }),
  })
  assert.equal(saved.status, 200)
  assert.equal((await saved.json()).detected, true)
  const login = await fetch(`${base}/api/runtime/outreach/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ browserPath: chrome }),
  })
  assert.equal(login.status, 200)
  let account
  for (let i = 0; i < 25; i += 1) {
    const state = await (await fetch(`${base}/api/runtime/state`)).json()
    account = state.accounts.accounts.find((item) => String(item.id).startsWith('douyin:'))
    if (account?.online) break
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.ok(account)
  assert.equal(account.online, true)
  assert.equal(account.nickname, '抖音号')
  const avatarRes = await fetch(`${base}${account.avatar.replace(/\?.*$/, '')}`)
  assert.equal(avatarRes.status, 200)
  assert.match(avatarRes.headers.get('content-type') || '', /image\/png/)
  const settings = await fetch(`${base}/api/runtime/outreach/accounts/${encodeURIComponent(account.id)}/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ maxCount: 1, comments: ['学到了'] }),
  })
  assert.equal(settings.status, 200)
  const task = await fetch(`${base}/api/runtime/outreach/task/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId: account.id }),
  })
  assert.equal(task.status, 200)
  let after
  for (let i = 0; i < 25; i += 1) {
    after = await (await fetch(`${base}/api/runtime/state`)).json()
    if (after.outreach?.task?.commented >= 1 && after.outreach.task.running === false) break
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.equal(after.outreach.task.commented, 1)
  const view = await (await fetch(`${base}/api/runtime/outreach/accounts/${encodeURIComponent(account.id)}`)).json()
  assert.equal(view.history.comments[0].text, '学到了')
  const taskId = view.history.tasks[0].id
  const deleted = await fetch(`${base}/api/runtime/outreach/accounts/${encodeURIComponent(account.id)}/history/${encodeURIComponent(taskId)}`, { method: 'DELETE' })
  assert.equal(deleted.status, 200)
  const afterDelete = await (await fetch(`${base}/api/runtime/outreach/accounts/${encodeURIComponent(account.id)}`)).json()
  assert.equal(afterDelete.history.tasks.length, 0)
})

test('task history delete and clear refuse a running job and keep 10 rows', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'chihiro-outreach-history-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const chrome = path.join(root, 'fake-chrome')
  fs.writeFileSync(chrome, '#!/bin/sh\n')
  fs.chmodSync(chrome, 0o755)
  const store = createAccountStore(path.join(root, 'data', 'accounts.json'))
  let release
  const outreach = createOutreachRuntime({
    root,
    store,
    loginWaiter: async () => ({
      storageState: { cookies: [{ name: 'sessionid', value: 'sess' }] },
      nickname: '创作者',
      uid: 'u1',
      avatar: '',
    }),
    feedRunner: async ({ shouldStop }) => {
      await new Promise((resolve) => { release = resolve })
      if (shouldStop()) throw new Error('Task stopped')
      return { commented: 1, scanned: 2 }
    },
  })
  outreach.setBrowserPath(chrome)
  outreach.prepareNew()
  const account = await outreach.login({ browserPath: chrome })
  await outreach.startTask(account.id, { comments: ['学到了'], maxCount: 1 })
  for (let i = 0; i < 25 && !release; i += 1) await new Promise((resolve) => setTimeout(resolve, 5))
  const runningId = outreach.snapshotOutreach().task.id
  assert.equal(outreach.snapshotOutreach().task.running, true)
  assert.throws(() => outreach.deleteTaskHistory(account.id, runningId), /正在运行，无法删除/)
  assert.throws(() => outreach.clearTaskHistory(account.id), /等待完成后操作/)
  release()
  await outreach.stopTask()
  const finished = outreach.accountView(account.id)
  assert.equal(finished.history.tasks.length, 1)
  const keptId = finished.history.tasks[0].id
  outreach.deleteTaskHistory(account.id, keptId)
  assert.equal(outreach.accountView(account.id).history.tasks.length, 0)

  const dir = path.join(root, 'data', 'outreach', 'accounts', account.id.replace(':', '_'))
  const seeded = Array.from({ length: 12 }, (_, index) => ({
    id: `t${index}`,
    status: 'stopped',
    startedAt: new Date(Date.now() - index * 1000).toISOString(),
    endedAt: new Date().toISOString(),
    commented: 0,
    scanned: 1,
    videos: [],
    comments: [],
    logs: [],
  }))
  fs.writeFileSync(path.join(dir, 'history.json'), JSON.stringify({ tasks: seeded, videos: [], comments: [] }))
  outreach.deleteTaskHistory(account.id, 't11')
  assert.equal(outreach.accountView(account.id).history.tasks.length, 10)
  outreach.clearTaskHistory(account.id)
  assert.equal(outreach.accountView(account.id).history.tasks.length, 0)
})

test('comment image upload stores a file under the Douyin account dir', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'chihiro-outreach-img-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const chrome = path.join(root, 'fake-chrome')
  fs.writeFileSync(chrome, '#!/bin/sh\n')
  fs.chmodSync(chrome, 0o755)
  const store = createAccountStore(path.join(root, 'data', 'accounts.json'))
  const outreach = createOutreachRuntime({
    root,
    store,
    loginWaiter: async () => ({
      storageState: { cookies: [{ name: 'sessionid', value: 'sess' }] },
      nickname: '创作者',
      uid: 'u1',
      avatar: '',
    }),
  })
  outreach.setBrowserPath(chrome)
  outreach.prepareNew()
  const account = await outreach.login({ browserPath: chrome })
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  const saved = outreach.saveCommentImages(account.id, 'g1', 'file', [{ name: 'dot.png', body: png.toString('base64') }])
  assert.equal(saved.type, 'file')
  assert.equal(saved.count, 1)
  assert.equal(fs.existsSync(saved.path), true)
  const grouped = normalizeOutreachSettings({
    ruleGroups: [{ id: 'g1', name: '手机平板', comments: ['好'], commentImagePath: saved.path, commentImageType: 'file', commentImageName: 'dot.png' }],
  })
  assert.equal(grouped.ruleGroups[0].commentImagePath, saved.path)
  assert.equal(grouped.ruleGroups[0].commentImageType, 'file')
})
