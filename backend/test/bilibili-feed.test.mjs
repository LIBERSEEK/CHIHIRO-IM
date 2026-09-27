import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { createAccountStore } from '../src/runtime/accounts.mjs'
import { createOutreachRuntime } from '../src/runtime/outreach/service.mjs'
import { pickOutreachAccount } from '../src/runtime/outreach/accounts/ids.mjs'
import { CLIENTS } from '../src/runtime/clients.mjs'
import {
  bilibiliSearchUrl,
  bilibiliToVideo,
  bilibiliVideoUrl,
  collectBilibiliVideos,
  isBilibiliLoginComplete,
  postBilibiliComment,
  runBilibiliVideoTask,
  uploadBilibiliCommentImages,
} from '../src/runtime/outreach/platforms/bilibili/index.mjs'

test('bilibili client, URLs and login cookies use the platform contract', () => {
  const client = CLIENTS.find((item) => item.id === 'bilibili')
  assert.equal(client.enabled, true)
  assert.equal(client.login, 'browser')
  assert.equal(
    bilibiliSearchUrl('Codex 教程', 2),
    'https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=Codex+%E6%95%99%E7%A8%8B&page=2',
  )
  assert.equal(bilibiliVideoUrl('BV1abc123'), 'https://www.bilibili.com/video/BV1abc123/')
  assert.equal(isBilibiliLoginComplete([{ name: 'SESSDATA', value: 'session' }]), false)
  assert.equal(isBilibiliLoginComplete([{ name: 'bili_jct', value: 'csrf' }]), false)
  assert.equal(isBilibiliLoginComplete([
    { name: 'SESSDATA', value: 'session' },
    { name: 'bili_jct', value: 'csrf' },
  ]), true)
})

test('search rows remove highlight HTML and convert into shared video records', () => {
  const rows = collectBilibiliVideos({
    data: {
      result: [
        {
          bvid: 'BV1abc123',
          aid: 42,
          title: '<em class="keyword">Codex</em> &amp; Claude',
          description: '省 token &lt;80%&gt;',
          author: 'UP主',
          mid: 99,
          tag: 'AI,编程',
          play: 120,
          review: 3,
        },
        { bvid: 'not-a-bvid', title: '忽略' },
      ],
    },
  })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].title, 'Codex & Claude')
  assert.equal(rows[0].desc, '省 token <80%>')
  assert.deepEqual(rows[0].tags, ['AI', '编程'])
  assert.deepEqual(bilibiliToVideo(rows[0]), {
    aweme_id: 'BV1abc123',
    aid: 42,
    desc: 'Codex & Claude\n省 token <80%>',
    author: { nickname: 'UP主', uid: '99' },
    video_tag: [{ tag_name: 'AI' }, { tag_name: '编程' }],
    share_url: 'https://www.bilibili.com/video/BV1abc123/',
  })
})

test('multiple seed terms are searched, duplicate BV rows are removed, and one matching video is commented', async () => {
  const logs = []
  const posted = []
  let heardPeers = []
  const fixture = fakeBilibili({
    searches: {
      Codex: [searchItem('BV1match', 101, 'Codex 长任务'), searchItem('BV1skip', 102, '无关内容')],
      Claude: [searchItem('BV1match', 101, 'Codex 长任务')],
    },
    details: {
      BV1match: detailItem(101, 'Codex 长任务', '怎么跑稳'),
      BV1skip: detailItem(102, '今天的云', '风景很好'),
    },
    comments: { 101: ['这个怎么配置'] },
    posted,
  })
  const result = await runBilibiliVideoTask({
    executablePath: '/usr/bin/google-chrome',
    storageStatePath: '/tmp/bilibili-state.json',
    settings: campaignSettings(),
    launch: fakeLaunch(fixture),
    writeComment: async (_settings, video) => {
      heardPeers = video.peerComments
      return '{"comment":"这个思路挺实用，我们的聚合 API 也能帮忙控成本。"}'
    },
    onLog: (level, message) => logs.push([level, message]),
  })
  assert.deepEqual(result, { commented: 1, scanned: 1 })
  assert.deepEqual(heardPeers, ['这个怎么配置'])
  assert.deepEqual(posted, [{ oid: 101, message: '这个思路挺实用，我们的聚合 API 也能帮忙控成本。' }])
  assert.equal(fixture.searches.length, 2)
  assert.ok(logs.some(([, message]) => message === '搜索完成，去重后 2 个视频'))
  assert.ok(logs.some(([, message]) => message.includes('命中条件: videoDesc:Codex')))
  assert.ok(logs.some(([, message]) => message.includes('评论ID: 9001')))
})

test('model failures skip posting and comment success requires an rpid receipt', async () => {
  const posted = []
  const fixture = fakeBilibili({
    searches: { Codex: [searchItem('BV1match', 101, 'Codex 长任务')] },
    details: { BV1match: detailItem(101, 'Codex 长任务', '怎么跑稳') },
    comments: { 101: [] },
    posted,
  })
  const logs = []
  const result = await runBilibiliVideoTask({
    executablePath: '/usr/bin/google-chrome',
    storageStatePath: '/tmp/bilibili-state.json',
    settings: campaignSettings({ seedTags: ['Codex'] }),
    launch: fakeLaunch(fixture),
    writeComment: async () => { throw new Error('provider down') },
    onLog: (_level, message) => logs.push(message),
  })
  assert.equal(result.commented, 0)
  assert.deepEqual(posted, [])
  assert.ok(logs.some((message) => message.includes('模型调用失败')))

  const missingReceipt = await postBilibiliComment({
    evaluate: async () => ({ ok: false, reason: '评论接口未返回评论ID' }),
  }, 101, '测试')
  assert.deepEqual(missingReceipt, { ok: false, reason: '评论接口未返回评论ID' })
})

test('image comments upload each local picture and send the returned picture metadata', async (t) => {
  const imageDir = await mkdtemp(path.join(os.tmpdir(), 'chihiro-bilibili-images-'))
  t.after(() => rm(imageDir, { recursive: true, force: true }))
  const imagePath = path.join(imageDir, 'card.png')
  fs.writeFileSync(imagePath, Buffer.from('png-body'))
  const calls = []
  const page = {
    async evaluate(_fn, arg) {
      calls.push(arg)
      if (arg && typeof arg === 'object' && 'base64' in arg) {
        return {
          ok: true,
          picture: {
            img_src: 'https://i0.hdslb.com/bfs/new_dyn/card.png',
            img_width: 1280,
            img_height: 1410,
            img_size: 2.1,
          },
        }
      }
      return { ok: true, rpid: '9002' }
    },
  }
  const uploaded = await uploadBilibiliCommentImages(page, [imagePath])
  assert.equal(uploaded.ok, true)
  assert.equal(uploaded.pictures[0].img_src, 'https://i0.hdslb.com/bfs/new_dyn/card.png')
  const sent = await postBilibiliComment(page, 101, '带图评论', uploaded.pictures)
  assert.deepEqual(sent, { ok: true, rpid: '9002' })
  assert.equal(calls[0].name, 'card.png')
  assert.equal(calls[0].type, 'image/png')
  assert.deepEqual(calls[1].pictures, uploaded.pictures)
})

test('image campaign uploads its configured image before posting', async (t) => {
  const imageDir = await mkdtemp(path.join(os.tmpdir(), 'chihiro-bilibili-campaign-'))
  t.after(() => rm(imageDir, { recursive: true, force: true }))
  fs.writeFileSync(path.join(imageDir, 'card.png'), Buffer.from('png-body'))
  const posted = []
  const fixture = fakeBilibili({
    searches: { Codex: [searchItem('BV1match', 101, 'Codex 长任务')] },
    details: { BV1match: detailItem(101, 'Codex 长任务', '怎么跑稳') },
    comments: { 101: [] },
    posted,
  })
  fixture.page.evaluate = async (_fn, arg) => {
    if (arg && typeof arg === 'object' && 'base64' in arg) {
      return {
        ok: true,
        picture: { img_src: 'https://i0.hdslb.com/bfs/new_dyn/card.png', img_width: 1280, img_height: 1410, img_size: 2.1 },
      }
    }
    if (arg && typeof arg === 'object' && 'oid' in arg) {
      posted.push(arg)
      return { ok: true, rpid: '9003' }
    }
    if (typeof arg === 'number') return true
    throw new Error('unexpected page.evaluate call')
  }
  const settings = campaignSettings({ seedTags: ['Codex'], form: 'image' })
  settings.ruleGroups[0].commentImagePath = imageDir
  settings.ruleGroups[0].commentImageType = 'folder'
  const result = await runBilibiliVideoTask({
    executablePath: '/usr/bin/google-chrome',
    storageStatePath: '/tmp/bilibili-state.json',
    settings,
    launch: fakeLaunch(fixture),
    writeComment: async () => '{"comment":"带图评论"}',
  })
  assert.equal(result.commented, 1)
  assert.equal(posted[0].pictures.length, 1)
  assert.equal(posted[0].pictures[0].img_width, 1280)
})

test('runtime selects a logged-in Bilibili account and dispatches its runner', async (t) => {
  const accounts = [{ id: 'douyin:ready' }, { id: 'bilibili:ready' }, { id: 'bilibili:other' }]
  const ready = new Set(['douyin:ready', 'bilibili:ready'])
  assert.equal(pickOutreachAccount(accounts, 'bilibili', 'bilibili:other', (id) => ready.has(id)).id, 'bilibili:ready')
  assert.equal(pickOutreachAccount(accounts, 'bilibili', 'douyin:ready', (id) => ready.has(id)).id, 'bilibili:ready')

  const root = await mkdtemp(path.join(os.tmpdir(), 'chihiro-bilibili-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const chrome = path.join(root, 'fake-chrome')
  fs.writeFileSync(chrome, '#!/bin/sh\n')
  fs.chmodSync(chrome, 0o755)
  const store = createAccountStore(path.join(root, 'data', 'accounts.json'))
  let used = ''
  const outreach = createOutreachRuntime({
    root,
    store,
    bilibiliLoginWaiter: async () => ({
      storageState: { cookies: [
        { name: 'SESSDATA', value: 'session', domain: '.bilibili.com' },
        { name: 'bili_jct', value: 'csrf', domain: '.bilibili.com' },
      ] },
      nickname: 'B站作者',
      uid: '123',
    }),
    bilibiliRunner: async () => {
      used = 'bilibili'
      return { commented: 1, scanned: 1 }
    },
  })
  outreach.setBrowserPath(chrome)
  outreach.prepareNew('', 'bilibili')
  assert.equal(outreach.snapshotOutreach().loginClient, 'bilibili')
  const account = await outreach.login({ browserPath: chrome, client: 'bilibili' })
  assert.match(account.id, /^bilibili:/)
  assert.equal(store.list().accounts.find((item) => item.id === account.id).platform, 'bilibili')
  assert.equal(outreach.accountView(account.id).loggedIn, true)
  await outreach.startTask(account.id, campaignSettings())
  for (let i = 0; i < 20 && used !== 'bilibili'; i += 1) await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(used, 'bilibili')
})

function campaignSettings(overrides = {}) {
  return {
    maxCount: 1,
    fast: true,
    blockKeywords: [],
    campaign: {
      enabled: true,
      briefId: 'b1',
      form: 'text',
      interaction: 'comment',
      seedTags: ['Codex', 'Claude'],
      excludes: [],
      platform: 'bilibili',
      ...(overrides || {}),
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
  }
}

function searchItem(bvid, aid, title) {
  return { bvid, aid, title, description: '', author: 'UP主', mid: '9', tag: 'AI,编程' }
}

function detailItem(aid, title, desc) {
  return { aid, title, desc, owner: { name: 'UP主', mid: 9 }, stat: { reply: 1 } }
}

function fakeLaunch(fixture) {
  return {
    chromium: {
      launch: async () => ({
        newContext: async () => fixture.context,
        close: async () => {},
      }),
    },
  }
}

function fakeBilibili({ searches, details, comments, posted }) {
  const visits = []
  const searchVisits = []
  const context = {
    request: {
      async get(url) {
        const target = new URL(url)
        if (target.pathname.includes('/search/type')) {
          const keyword = target.searchParams.get('keyword') || ''
          searchVisits.push(keyword)
          return jsonResponse({ code: 0, data: { result: searches[keyword] || [] } })
        }
        if (target.pathname.includes('/web-interface/view')) {
          const bvid = target.searchParams.get('bvid') || ''
          return jsonResponse({ code: 0, data: details[bvid] })
        }
        if (target.pathname.includes('/reply/main')) {
          const aid = Number(target.searchParams.get('oid'))
          return jsonResponse({ code: 0, data: { replies: (comments[aid] || []).map((message) => ({ content: { message } })) } })
        }
        throw new Error(`unexpected GET ${url}`)
      },
    },
    newPage: async () => page,
    storageState: async () => {},
  }
  const page = {
    async goto(url) { visits.push(String(url)) },
    async evaluate(_fn, arg) {
      if (arg && typeof arg === 'object' && 'oid' in arg && 'message' in arg) {
        posted.push({ oid: arg.oid, message: arg.message })
        return { ok: true, rpid: '9001' }
      }
      if (typeof arg === 'number') return true
      throw new Error('unexpected page.evaluate call')
    },
  }
  return { context, page, visits, searches: searchVisits }
}

function jsonResponse(body) {
  return { json: async () => body }
}
