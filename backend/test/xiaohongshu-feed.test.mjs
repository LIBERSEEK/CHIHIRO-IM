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
  collectNotes,
  isXiaohongshuLoginComplete,
  isXiaohongshuNotePayloadUrl,
  pickSearchTag,
  postNoteComment,
  runXiaohongshuNoteTask,
  XIAOHONGSHU_LOGIN_URL,
  xiaohongshuSearchUrl,
} from '../src/runtime/outreach/platforms/xiaohongshu/index.mjs'

test('xiaohongshu uses AI search for combined seed tags and keeps single search compatible', () => {
  const client = CLIENTS.find((item) => item.id === 'xiaohongshu')
  assert.equal(client.enabled, true)
  assert.equal(client.login, 'browser')
  assert.equal(
    xiaohongshuSearchUrl('全屋定制'),
    'https://www.xiaohongshu.com/search_result?keyword=%E5%85%A8%E5%B1%8B%E5%AE%9A%E5%88%B6&source=web_search_result_notes',
  )
  assert.equal(
    xiaohongshuSearchUrl('codex, claude, grok, gemini, vibe'),
    'https://www.xiaohongshu.com/search_result_ai?keyword=codex%252C%2520claude%252C%2520grok%252C%2520gemini%252C%2520vibe&source=unknown',
  )
  assert.equal(isXiaohongshuNotePayloadUrl('https://edith.xiaohongshu.com/api/sns/web/v1/search/notes?keyword=a'), true)
  assert.equal(isXiaohongshuNotePayloadUrl('https://so.xiaohongshu.com/api/sns/web/v2/search/notes'), true)
  assert.equal(isXiaohongshuNotePayloadUrl('https://edith.xiaohongshu.com/api/sns/web/v2/comment/page'), false)
})

test('xiaohongshu login stays on the main site until the user profile appears', () => {
  assert.equal(XIAOHONGSHU_LOGIN_URL, 'https://www.xiaohongshu.com')
  assert.equal(isXiaohongshuLoginComplete({
    url: 'https://www.xiaohongshu.com/',
    loginBoxVisible: true,
    hasOwnProfile: false,
  }), false)
  assert.equal(isXiaohongshuLoginComplete({
    url: 'https://www.xiaohongshu.com/explore',
    loginBoxVisible: false,
    hasOwnProfile: false,
  }), false)
  assert.equal(isXiaohongshuLoginComplete({
    url: 'https://creator.xiaohongshu.com/new/home',
    loginBoxVisible: false,
    hasOwnProfile: true,
  }), false)
  assert.equal(isXiaohongshuLoginComplete({
    url: 'https://www.xiaohongshu.com/explore',
    loginBoxVisible: false,
    hasOwnProfile: true,
  }), true)
  assert.equal(pickSearchTag({ campaign: { seedTags: ['Codex', 'Claude', 'codex', 'Grok'] } }), 'Codex, Claude, Grok')
  assert.equal(pickSearchTag({
    campaign: { seedTags: [] },
    ruleGroups: [{ rules: [{ keyword: 'Gemini' }, { keyword: 'vibe' }, { keyword: 'GEMINI' }] }],
  }), 'Gemini, vibe')
})

test('note payloads keep title, author and skip comment rows', () => {
  const notes = collectNotes({
    data: {
      items: [
        {
          id: 'note1',
          note_card: {
            display_title: 'Codex 长任务',
            desc: '怎么跑稳',
            user: { nickname: '作者', user_id: 'u1' },
          },
        },
      ],
      comments: [{ id: 'c1', content: '说得对' }],
    },
  })
  assert.equal(notes.length, 1)
  assert.equal(notes[0].id, 'note1')
  assert.equal(notes[0].title, 'Codex 长任务')
  assert.equal(notes[0].author, '作者')
  const camel = collectNotes({
    data: {
      items: [{
        id: 'note2',
        xsecToken: 'token-1',
        noteCard: { displayTitle: '页面里的标题', user: { nickName: '页面作者', userId: 'u2' } },
      }],
    },
  })
  assert.equal(camel[0].title, '页面里的标题')
  assert.equal(camel[0].author, '页面作者')
  assert.equal(camel[0].xsecToken, 'token-1')
})

test('comment posting ignores the hidden search textarea and uses the visible note composer', async () => {
  const selectors = []
  const filled = []
  const clicked = []
  const page = {
    locator(selector) {
      selectors.push(selector)
      const isSend = selector.includes('comment-submit') || selector.includes('button.submit') || selector.includes('button.send') || selector.includes('发送')
      const isActivator = selector.includes('inner-when-not-active')
      const node = {
        first() { return node },
        count: async () => 1,
        waitFor: async () => {},
        isEnabled: async () => true,
        click: async () => { clicked.push(isSend ? 'send' : (isActivator ? 'activator' : 'composer')) },
        pressSequentially: async (value) => { filled.push(value) },
        fill: async (value) => { filled.push(value) },
      }
      return node
    },
    keyboard: { press: async () => {}, type: async (value) => { filled.push(value) } },
  }
  const posted = await postNoteComment(page, '这条评论来自可见编辑框')
  assert.deepEqual(posted, { ok: true })
  assert.deepEqual(filled, ['这条评论来自可见编辑框'])
  assert.deepEqual(clicked, ['activator', 'send'])
  assert.match(selectors[0], /note-detail-mask/)
  assert.match(selectors[0], /contenteditable="true"/)
  assert.match(selectors[0], /:visible/)
  assert.doesNotMatch(selectors[0], /textarea,\s*\[contenteditable/)
  assert.match(selectors[0], /placeholder\*="搜索"/)
})

test('comment posting reports a disabled send button after filling', async () => {
  const page = {
    locator(selector) {
      const isSend = selector.includes('button.btn.submit')
      const isActivator = selector.includes('inner-when-not-active')
      const node = {
        first() { return node },
        count: async () => 1,
        waitFor: async () => {},
        isEnabled: async () => !isSend,
        click: async () => {
          if (isSend) throw new Error('disabled button must not be clicked')
          assert.equal(isActivator, true)
        },
        pressSequentially: async () => {},
        fill: async () => {},
      }
      return node
    },
    keyboard: { press: async () => {}, type: async () => {} },
  }
  assert.deepEqual(
    await postNoteComment(page, '已填写但按钮不可用'),
    { ok: false, reason: '评论已填写，但发送按钮仍不可用' },
  )
})

test('a matching note is commented once, excluded and unmatched notes are skipped', async () => {
  const logs = []
  const filled = []
  let heardPeers = []
  const page = fakePage({
    notes: [
      { id: 'note-skip', note_card: { display_title: '今天的云', desc: '风景很好', user: { nickname: '路人' } } },
      { id: 'note-block', note_card: { display_title: '广告合作', desc: 'Codex 推广', user: { nickname: '商家' } } },
      { id: 'note-keep', note_card: { display_title: 'Codex 长任务', desc: '怎么跑', user: { nickname: '作者' } } },
    ],
    comments: [{ content: '这个怎么做的' }],
    filled,
  })
  const result = await runXiaohongshuNoteTask({
    executablePath: '/usr/bin/google-chrome',
    storageStatePath: '/tmp/xhs-state.json',
    settings: campaignSettings(),
    launch: fakeLaunch(page),
    writeComment: async (_settings, video) => {
      heardPeers = video.peerComments
      return '{"comment":"这个我用过"}'
    },
    onLog: (level, text) => logs.push([level, text]),
  })
  assert.equal(result.commented, 1)
  assert.equal(result.scanned, 3)
  assert.deepEqual(filled, ['这个我用过'])
  assert.deepEqual(heardPeers, ['这个怎么做的'])
  assert.ok(logs.some((item) => item[1] === '小红书网页版评论区未提供图片上传入口，本条使用文字评论'))
  assert.ok(logs.some((item) => item[1].includes('笔记命中排除词')))
  assert.ok(logs.some((item) => item[1] === '评论：这个我用过'))
  const searches = page.visits.filter((url) => url.includes('search_result'))
  assert.deepEqual(searches, [xiaohongshuSearchUrl('Codex, Claude')])
})

test('a model failure skips the note instead of posting a fallback', async () => {
  const logs = []
  const filled = []
  const page = fakePage({
    notes: [{ id: 'note-keep', note_card: { display_title: 'Codex 长任务', desc: '怎么跑', user: { nickname: '作者' } } }],
    comments: [],
    filled,
  })
  const result = await runXiaohongshuNoteTask({
    executablePath: '/usr/bin/google-chrome',
    storageStatePath: '/tmp/xhs-state.json',
    settings: campaignSettings(),
    launch: fakeLaunch(page),
    writeComment: async () => { throw new Error('down') },
    onLog: (_level, text) => logs.push(text),
  })
  assert.equal(result.commented, 0)
  assert.deepEqual(filled, [])
  assert.ok(logs.some((text) => text.includes('模型调用失败')))
})

test('start picks a logged-in Xiaohongshu account and leaves Douyin on its own runner', async (t) => {
  const accounts = [
    { id: 'douyin:ready' },
    { id: 'xiaohongshu:ready' },
    { id: 'xiaohongshu:other' },
  ]
  const ready = new Set(['douyin:ready', 'xiaohongshu:ready'])
  assert.equal(pickOutreachAccount(accounts, 'xiaohongshu', 'xiaohongshu:other', (id) => ready.has(id)).id, 'xiaohongshu:ready')
  assert.equal(pickOutreachAccount(accounts, 'douyin', '', (id) => ready.has(id)).id, 'douyin:ready')
  assert.equal(pickOutreachAccount(accounts, 'xiaohongshu', 'douyin:ready', (id) => ready.has(id)).id, 'xiaohongshu:ready')

  const root = await mkdtemp(path.join(os.tmpdir(), 'chihiro-xhs-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const chrome = path.join(root, 'fake-chrome')
  fs.writeFileSync(chrome, '#!/bin/sh\n')
  fs.chmodSync(chrome, 0o755)
  const store = createAccountStore(path.join(root, 'data', 'accounts.json'))
  let used = ''
  const outreach = createOutreachRuntime({
    root,
    store,
    xhsLoginWaiter: async () => ({
      storageState: { cookies: [{ name: 'web_session', value: 'session-value', domain: '.xiaohongshu.com' }] },
      nickname: '小红书作者',
    }),
    feedRunner: async () => {
      used = 'douyin'
      return { commented: 0, scanned: 0 }
    },
    noteRunner: async () => {
      used = 'xiaohongshu'
      return { commented: 1, scanned: 2 }
    },
  })
  outreach.setBrowserPath(chrome)
  outreach.prepareNew('', 'xiaohongshu')
  assert.equal(outreach.snapshotOutreach().loginClient, 'xiaohongshu')
  const account = await outreach.login({ browserPath: chrome, client: 'xiaohongshu' })
  assert.match(account.id, /^xiaohongshu:/)
  assert.equal(store.list().accounts.find((item) => item.id === account.id).platform, 'xiaohongshu')
  assert.equal(outreach.accountView(account.id).id, account.id)
  assert.equal(outreach.accountView(account.id).loggedIn, true)
  assert.equal(outreach.accountView('qq:10001'), null)
  await outreach.startTask(account.id, { comments: ['学到了'], maxCount: 1, campaign: { enabled: true, platform: 'xiaohongshu', seedTags: ['Codex'] } })
  for (let i = 0; i < 20 && used !== 'xiaohongshu'; i += 1) await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(used, 'xiaohongshu')
})

function campaignSettings() {
  return {
    maxCount: 1,
    fast: true,
    blockKeywords: ['广告'],
    campaign: {
      enabled: true,
      briefId: 'b1',
      form: 'image',
      interaction: 'comment',
      seedTags: ['Codex', 'Claude'],
      excludes: [],
      platform: 'xiaohongshu',
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

function fakeLaunch(page) {
  return {
    chromium: {
      launch: async () => ({
        newContext: async () => ({
          newPage: async () => page,
          storageState: async () => {},
        }),
        close: async () => {},
      }),
    },
  }
}

function fakePage({ notes, comments, filled }) {
  const listeners = []
  const page = {
    visits: [],
    on(event, fn) {
      if (event === 'response') listeners.push(fn)
    },
    removeListener(_event, fn) {
      const index = listeners.indexOf(fn)
      if (index >= 0) listeners.splice(index, 1)
    },
    async goto(url) {
      page.visits.push(String(url))
      if (String(url).includes('search_result')) {
        await emit(listeners, 'https://edith.xiaohongshu.com/api/sns/web/v1/search/notes', { data: { items: notes } })
      }
      if (String(url).includes('/explore/')) {
        await emit(listeners, 'https://edith.xiaohongshu.com/api/sns/web/v2/comment/page', { data: { comments } })
      }
    },
    locator() {
      const node = {
        first() { return node },
        count: async () => 1,
        click: async () => {},
        fill: async (text) => { filled.push(text) },
      }
      return node
    },
    keyboard: { press: async () => {}, type: async (text) => { filled.push(text) } },
  }
  return page
}

async function emit(listeners, url, body) {
  await Promise.all(listeners.map((fn) => fn({
    url: () => url,
    json: async () => body,
  })))
}
