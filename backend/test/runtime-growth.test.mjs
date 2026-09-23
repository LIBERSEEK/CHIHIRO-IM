import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import test from 'node:test'
import { createRuntime } from '../src/runtime/api.mjs'
import { createGrowthRuntime } from '../src/runtime/growth.mjs'
import { createAccountStore } from '../src/runtime/accounts.mjs'
import { isDouyinAccountId, newDouyinAccountId } from '../src/runtime/growth-ids.mjs'
import { normalizeGrowthSettings } from '../src/runtime/growth-settings.mjs'
import { extractDouyinProfile, presentDouyinIdentity, splitDouyinIdentity } from '../src/runtime/growth-profile.mjs'
import { analyzeVideoType, checkVideoActivity, matchRuleGroups, runDouyinFeedTask } from '../src/runtime/douyin-feed.mjs'

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return server.address().port
}

test('growth ids and settings stay in the Douyin account namespace', () => {
  assert.equal(isDouyinAccountId('douyin:abc_1'), true)
  assert.equal(isDouyinAccountId('qq:10001'), false)
  assert.match(newDouyinAccountId(), /^douyin:[A-Za-z0-9]+$/)
  const settings = normalizeGrowthSettings({
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
  const grouped = normalizeGrowthSettings({
    ruleGroups: [
      { id: 'a', name: '组A', comments: ['好'] },
      { id: 'b', name: '组B', comments: ['收藏了', '学到了'] },
    ],
  })
  assert.deepEqual(grouped.comments, ['好', '收藏了', '学到了'])
  assert.equal(grouped.ruleGroups.length, 2)
  const nested = normalizeGrowthSettings({
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
  const root = await mkdtemp(path.join(os.tmpdir(), 'chihiro-growth-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const store = createAccountStore(path.join(root, 'data', 'accounts.json'))
  store.upsert({ id: 'qq:10001', client: 'qq', nickname: 'QQ 号', uin: '10001' })
  const growth = createGrowthRuntime({ root, store })
  const prepared = growth.prepareNew()
  assert.equal(prepared.loginClient, 'douyin')
  assert.equal(prepared.pendingAdd, true)
  assert.equal(prepared.phase, 'browser_setup')
  const snap = growth.decorateSnapshot({
    phase: 'ready',
    message: '已登录 QQ 号',
    pendingAdd: false,
    accounts: { activeId: 'qq:10001', accounts: [{ id: 'qq:10001', online: true, nickname: 'QQ 号' }] },
  })
  assert.equal(snap.phase, 'browser_setup')
  assert.equal(snap.pendingAdd, true)
  assert.equal(snap.qr.exists, false)
  assert.equal(snap.accounts.accounts[0].id, 'qq:10001')
  assert.equal(snap.growth.loginClient, 'douyin')
})

test('headed login writes storageState and marks the Douyin account online', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'chihiro-growth-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const chrome = path.join(root, 'fake-chrome')
  fs.writeFileSync(chrome, '#!/bin/sh\n')
  fs.chmodSync(chrome, 0o755)
  const store = createAccountStore(path.join(root, 'data', 'accounts.json'))
  const growth = createGrowthRuntime({
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
  growth.setBrowserPath(chrome)
  growth.prepareNew()
  const result = await growth.login({ browserPath: chrome })
  assert.equal(isDouyinAccountId(result.id), true)
  const listed = store.list().accounts.find((account) => account.id === result.id)
  assert.equal(listed.platform, 'douyin')
  assert.equal(listed.nickname, '创作者')
  const snap = growth.decorateSnapshot({
    phase: 'idle',
    message: '',
    pendingAdd: false,
    accounts: store.list(),
  })
  const row = snap.accounts.accounts.find((account) => account.id === result.id)
  assert.equal(row.online, true)
  assert.equal(row.platform, 'douyin')
  assert.equal(row.obToken, '')
  assert.equal(growth.hasStorage(result.id), true)
  assert.match(row.avatar, /\/api\/runtime\/growth\/accounts\/.*\/avatar/)
  const avatar = growth.readAvatar(result.id)
  assert.equal(avatar.contentType, 'image/jpeg')
  assert.equal(avatar.body[0], 0xff)
})

test('feed worker comments then advances, skipping blocked videos', async () => {
  const events = []
  const reasons = []
  const presses = []
  const comments = []
  const selectors = []
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
  assert.ok(events.includes('skipped'))
  assert.ok(events.includes('评测很专业！'))
  assert.ok(reasons.includes('命中屏蔽关键词'))
  assert.equal(reasons.includes('不满足评论规则'), false)
  assert.ok(events.includes('closed'))
  assert.equal(contextOptions.storageState, '/tmp/state.json')
  assert.equal(contextOptions.viewport, undefined)
  assert.equal(contextOptions.isMobile, undefined)
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
  const root = await mkdtemp(path.join(os.tmpdir(), 'chihiro-growth-api-'))
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
      growthLoginWaiter: async () => ({
        storageState: { cookies: [{ name: 'sessionid', value: 'sess' }] },
        nickname: '抖音号',
        uid: '',
        avatar: '',
        avatarBytes: { body: Buffer.from([0x89, 0x50, 0x4e, 0x47]), contentType: 'image/png' },
      }),
      growthFeedRunner: async ({ onLog, onComment }) => {
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
  assert.equal(started.growth.loginClient, 'douyin')
  const saved = await fetch(`${base}/api/runtime/growth/browser`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: chrome }),
  })
  assert.equal(saved.status, 200)
  assert.equal((await saved.json()).detected, true)
  const login = await fetch(`${base}/api/runtime/growth/login`, {
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
  const settings = await fetch(`${base}/api/runtime/growth/accounts/${encodeURIComponent(account.id)}/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ maxCount: 1, comments: ['学到了'] }),
  })
  assert.equal(settings.status, 200)
  const task = await fetch(`${base}/api/runtime/growth/task/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId: account.id }),
  })
  assert.equal(task.status, 200)
  let after
  for (let i = 0; i < 25; i += 1) {
    after = await (await fetch(`${base}/api/runtime/state`)).json()
    if (after.growth?.task?.commented >= 1 && after.growth.task.running === false) break
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.equal(after.growth.task.commented, 1)
  const view = await (await fetch(`${base}/api/runtime/growth/accounts/${encodeURIComponent(account.id)}`)).json()
  assert.equal(view.history.comments[0].text, '学到了')
  const taskId = view.history.tasks[0].id
  const deleted = await fetch(`${base}/api/runtime/growth/accounts/${encodeURIComponent(account.id)}/history/${encodeURIComponent(taskId)}`, { method: 'DELETE' })
  assert.equal(deleted.status, 200)
  const afterDelete = await (await fetch(`${base}/api/runtime/growth/accounts/${encodeURIComponent(account.id)}`)).json()
  assert.equal(afterDelete.history.tasks.length, 0)
})

test('task history delete and clear refuse a running job and keep 10 rows', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'chihiro-growth-history-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const chrome = path.join(root, 'fake-chrome')
  fs.writeFileSync(chrome, '#!/bin/sh\n')
  fs.chmodSync(chrome, 0o755)
  const store = createAccountStore(path.join(root, 'data', 'accounts.json'))
  let release
  const growth = createGrowthRuntime({
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
  growth.setBrowserPath(chrome)
  growth.prepareNew()
  const account = await growth.login({ browserPath: chrome })
  await growth.startTask(account.id, { comments: ['学到了'], maxCount: 1 })
  for (let i = 0; i < 25 && !release; i += 1) await new Promise((resolve) => setTimeout(resolve, 5))
  const runningId = growth.snapshotGrowth().task.id
  assert.equal(growth.snapshotGrowth().task.running, true)
  assert.throws(() => growth.deleteTaskHistory(account.id, runningId), /正在运行，无法删除/)
  assert.throws(() => growth.clearTaskHistory(account.id), /等待完成后操作/)
  release()
  await growth.stopTask()
  const finished = growth.accountView(account.id)
  assert.equal(finished.history.tasks.length, 1)
  const keptId = finished.history.tasks[0].id
  growth.deleteTaskHistory(account.id, keptId)
  assert.equal(growth.accountView(account.id).history.tasks.length, 0)

  const dir = path.join(root, 'data', 'growth', 'accounts', account.id.replace(':', '_'))
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
  growth.deleteTaskHistory(account.id, 't11')
  assert.equal(growth.accountView(account.id).history.tasks.length, 10)
  growth.clearTaskHistory(account.id)
  assert.equal(growth.accountView(account.id).history.tasks.length, 0)
})

test('comment image upload stores a file under the Douyin account dir', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'chihiro-growth-img-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const chrome = path.join(root, 'fake-chrome')
  fs.writeFileSync(chrome, '#!/bin/sh\n')
  fs.chmodSync(chrome, 0o755)
  const store = createAccountStore(path.join(root, 'data', 'accounts.json'))
  const growth = createGrowthRuntime({
    root,
    store,
    loginWaiter: async () => ({
      storageState: { cookies: [{ name: 'sessionid', value: 'sess' }] },
      nickname: '创作者',
      uid: 'u1',
      avatar: '',
    }),
  })
  growth.setBrowserPath(chrome)
  growth.prepareNew()
  const account = await growth.login({ browserPath: chrome })
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  const saved = growth.saveCommentImages(account.id, 'g1', 'file', [{ name: 'dot.png', body: png.toString('base64') }])
  assert.equal(saved.type, 'file')
  assert.equal(saved.count, 1)
  assert.equal(fs.existsSync(saved.path), true)
  const grouped = normalizeGrowthSettings({
    ruleGroups: [{ id: 'g1', name: '手机平板', comments: ['好'], commentImagePath: saved.path, commentImageType: 'file', commentImageName: 'dot.png' }],
  })
  assert.equal(grouped.ruleGroups[0].commentImagePath, saved.path)
  assert.equal(grouped.ruleGroups[0].commentImageType, 'file')
})
