import assert from 'node:assert/strict'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import test from 'node:test'
import { createRuntime } from '../src/runtime/api.mjs'
import { createBotController, normalizeBotSession } from '../src/runtime/bot.mjs'
import { parseSuggestReplies, parseSuggestRead, collectSsePlain, pickAutoText, shouldHoldRead, applyLookupToSuggest, reduceChatStream, draftsFromAgentRun, shouldFallbackLookup, buildChatRequestFlags, buildChatMessageParts, buildPrompt, suggestSessionId, parseDigestPoints, buildDigestPrompt, digestSessionId, clipDigestMessages, DIGEST_MAX_MESSAGES } from '../src/runtime/bot-suggest.mjs'

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return server.address().port
}

test('legacy boolean sessions normalize without enabling the adapter', () => {
  assert.deepEqual(normalizeBotSession(true), { enabled: true, mode: 'assist', configId: null })
  assert.deepEqual(normalizeBotSession(false), { enabled: false, mode: 'assist', configId: null })
  assert.deepEqual(normalizeBotSession({ enabled: true, mode: 'auto', configId: 'sales' }), {
    enabled: true, mode: 'auto', configId: 'sales',
  })
})

test('one IM session maps to one ChatBot conversation id and incremental later turns', () => {
  assert.equal(suggestSessionId('qq:10001', 'private', '20002'), 'suggest:qq:10001:private:20002:task')
  const first = buildChatMessageParts([
    { role: 'me', text: '上一句已经回复过' },
    { role: 'them', text: '在吗', name: 'Raven' },
  ], 'private')[0].text
  assert.match(first, /必须先调用工具/)
  assert.match(first, /客户说：/)
  assert.match(first, /them\(Raven\): 在吗/)
  assert.match(first, /不要写「我去查一下」/)
  assert.doesNotMatch(first, /上一句已经回复过/)
  assert.doesNotMatch(first, /只输出 JSON/)
  assert.doesNotMatch(first, /"read":/)
  assert.doesNotMatch(first, /查不到就直说没查到/)
  assert.deepEqual(buildChatRequestFlags(true), {
    enable_inline_genui: true,
    enable_default_system_prompt: true,
    enable_streaming: true,
  })
  assert.equal(buildChatMessageParts([{ role: 'them', text: '在吗', name: 'Raven' }], 'private')[0].type, 'plain')
  const next = buildChatMessageParts([{ role: 'them', text: '买吗', name: 'Raven' }], 'private', true)[0].text
  assert.match(next, /这是同一场私聊的下一轮/)
  assert.match(next, /客户说：/)
  assert.match(next, /该用工具就用工具/)
  assert.doesNotMatch(next, /仍输出含 read 的 JSON/)
  assert.match(buildPrompt([{ role: 'them', text: '在吗', name: 'Raven' }], 'private'), /当成一次说话来回/)
})

test('digest points keep only known message ids', () => {
  assert.equal(digestSessionId('qq:1', 'group', '9'), 'suggest:qq:1:group:9:digest')
  assert.equal(DIGEST_MAX_MESSAGES, 200)
  const many = Array.from({ length: 90 }, (_, i) => ({ id: `m${i}`, role: 'them', text: `第${i}条`, name: '小默' }))
  assert.equal(clipDigestMessages(many).length, 90)
  assert.equal(clipDigestMessages(many, 60).length, 60)
  assert.equal(clipDigestMessages(many, 999).length, 90)
  assert.equal(clipDigestMessages(many, 60)[0].id, 'm30')
  const truncated = buildDigestPrompt(many, 60)
  assert.match(truncated, /未读共 90 条，以下为最近 60 条/)
  assert.match(buildDigestPrompt([{ id: 'm1', role: 'them', text: '5.6不降智了?', name: '小默' }]), /\[id=m1\]/)
  const parsed = parseDigestPoints(JSON.stringify({
    summary: '群里在问模型',
    points: [
      { text: '小默问 5.6 不降智了', messageId: 'm1' },
      { text: '编造的一条', messageId: 'nope' },
    ],
  }), [{ id: 'm1', role: 'them', text: '5.6不降智了?', name: '小默' }])
  assert.equal(parsed.summary, '群里在问模型')
  assert.equal(parsed.points[0].messageId, 'm1')
  assert.equal(parsed.points[1].messageId, '')
})

test('pickAutoText prefers summary then highest score', () => {
  assert.equal(pickAutoText({ summary: '完整回复', replies: [{ text: '短', score: 1 }] }), '完整回复')
  assert.equal(pickAutoText({ replies: [{ text: '低', score: 0.2 }, { text: '高', score: 0.9 }] }), '高')
  assert.equal(pickAutoText({ replies: [] }), '')
})

test('read block is parsed and gates auto send', () => {
  const parsed = parseSuggestReplies(JSON.stringify({
    read: {
      intent: { id: 'inquire', options: [{ id: 'inquire', p: 0.8 }, { id: 'smalltalk', p: 0.2 }] },
      speakNow: { yes: 0.9, no: 0.1 },
      action: { id: 'follow_up', options: [{ id: 'follow_up', p: 0.7 }, { id: 'brief', p: 0.3 }] },
      urgency: 6,
      note: '先问预算',
    },
    replies: [{ id: '1', text: '预算大概多少', score: 0.9 }],
    summary: '预算大概多少？',
  }), 'm1')
  assert.equal(parsed.read.intent.id, 'inquire')
  assert.equal(parsed.read.action.id, 'follow_up')
  assert.equal(parsed.read.urgency, 6)
  assert.equal(pickAutoText(parsed), '预算大概多少？')
  const hold = parseSuggestRead({
    read: { intent: 'smalltalk', speakNow: { yes: 0.2, no: 0.8 }, action: 'hold', urgency: 1 },
  })
  assert.equal(shouldHoldRead(hold), true)
  assert.equal(pickAutoText({
    read: hold,
    summary: '哈哈哈哈',
    replies: [{ text: '哈哈', score: 1 }],
  }), '')
})

test('parseSuggestReplies keeps 1-3 scored texts and reads SSE plain events', () => {
  const parsed = parseSuggestReplies('```json\n{"replies":[{"id":"1","text":"好的，我买","score":0.82},{"text":"买几头？","score":0.61}],"summary":"好的，我买。"}\n```', 'm1')
  assert.equal(parsed.lastMessageId, 'm1')
  assert.equal(parsed.replies.length, 2)
  assert.equal(parsed.replies[0].text, '好的，我买')
  assert.equal(parsed.summary, '好的，我买。')
  const plain = collectSsePlain('data: {"type":"session_id","session_id":"s"}\n\ndata: {"type":"plain","data":"{\\"replies\\":[{\\"id\\":\\"1\\",\\"text\\":\\"嗯\\",\\"score\\":1}]}"}\n\n')
  assert.equal(parseSuggestReplies(plain).replies[0].text, '嗯')
})

test('setSession stores structured config and does not wire NapCat reverse', async () => {
  const account = { id: 'qq:10001', botEnabled: false, botSessions: { 'private:1': true } }
  const store = {
    list: () => ({ accounts: [account] }),
    patch(id, fields) { Object.assign(account, fields) },
  }
  let wired = 0
  const bot = createBotController({
    store,
    qq: { snapshot: () => ({ accounts: { accounts: [account] } }), touch() {}, getInstanceForAccount: () => ({ phase: 'ready' }) },
    astrbot: { ensureAdapter: async () => { wired += 1 }, ensure: async () => {}, stopIfOwned: async () => {} },
    cfg: {},
  })
  const snap = await bot.setSession('qq:10001', 'private', '20002', { enabled: true, mode: 'auto', configId: 'p' })
  assert.equal(wired, 0)
  assert.deepEqual(account.botSessions['private:20002'], { enabled: true, mode: 'auto', configId: 'p' })
  assert.deepEqual(normalizeBotSession(account.botSessions['private:1']), { enabled: true, mode: 'assist', configId: null })
  assert.equal(account.botEnabled, false)
  assert.ok(snap.accounts)
})

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'chihiro-bot-suggest-'))
  const astrbotRequests = []
  let astrbotReply = { status: 200, body: 'data: {"type":"plain","data":"{\\"replies\\":[{\\"id\\":\\"1\\",\\"text\\":\\"好的，我买\\",\\"score\\":0.82}]}"}\n\n' }
  let astrbotByPath = {}
  const astrbotServer = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const path = String(req.url || '').split('?')[0]
      astrbotRequests.push({
        method: req.method,
        path,
        auth: req.headers.authorization,
        body: Buffer.concat(chunks).toString(),
      })
      const reply = astrbotByPath[path] || astrbotReply
      res.writeHead(reply.status, { 'content-type': 'text/event-stream' })
      res.end(reply.body)
    })
  })
  const astrbotPort = await listen(astrbotServer)
  const box = { store: null }
  const qq = {
    snapshot: () => ({ accounts: box.store.list(), phase: 'ready' }),
    subscribe: () => () => {},
    refreshPorts: async () => {},
    getInstanceForAccount: (id) => id === 'qq:10001' ? { phase: 'ready', uin: '10001', ports: {}, tokens: {} } : null,
    touch() {},
  }
  const astrbot = {
    url: `http://127.0.0.1:${astrbotPort}`,
    ensure: async () => {},
    mintDashboardToken: () => 'dash-token',
    refreshStatus: async () => ({ running: true }),
    stopIfOwned: async () => {},
  }
  const runtime = createRuntime({
    root,
    cfg: {},
    services: { qq, astrbot, chatui: { handle: () => false } },
  })
  box.store = runtime.store
  runtime.store.upsert({ id: 'qq:10001', client: 'qq', uin: '10001' })
  const server = http.createServer(async (req, res) => {
    const handled = await runtime.handle(req, res, new URL(req.url, 'http://runtime.test'))
    if (!handled) { res.writeHead(404); res.end() }
  })
  const port = await listen(server)
  t.after(async () => {
    await runtime.shutdown()
    await Promise.all([
      new Promise((resolve) => server.close(resolve)),
      new Promise((resolve) => astrbotServer.close(resolve)),
    ])
    await rm(root, { recursive: true, force: true })
  })
  return {
    base: `http://127.0.0.1:${port}`,
    store: runtime.store,
    astrbotRequests,
    setAstrbotReply(value) { astrbotReply = value },
    setAstrbotPath(path, value) { astrbotByPath = { ...astrbotByPath, [path]: value } },
  }
}

test('auto suggest requires an enabled session; menu trigger does not', async (t) => {
  const f = await fixture(t)
  const send = (body) => fetch(`${f.base}/api/runtime/bot/suggest`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const payload = {
    accountId: 'qq:10001', type: 'private', peerId: '20002', lastMessageId: 'm1',
    messages: [{ role: 'them', text: '在吗', name: 'Raven' }],
  }
  const autoOff = await send({ ...payload, trigger: 'auto' })
  assert.equal(autoOff.status, 200)
  assert.deepEqual(await autoOff.json(), { lastMessageId: 'm1', replies: [], summary: '', read: null })
  assert.equal(f.astrbotRequests.length, 0)

  const menu = await send({ ...payload, trigger: 'menu' })
  assert.equal(menu.status, 200)
  const menuBody = await menu.json()
  assert.equal(menuBody.replies[0].text, '好的，我买')
  assert.equal(f.astrbotRequests[0].path, '/api/v1/chat')
  assert.equal(f.astrbotRequests[0].auth, 'Bearer dash-token')
  const chatBody = JSON.parse(f.astrbotRequests[0].body)
  assert.equal(chatBody.username, 'chihiro-suggest:qq:10001')
  assert.equal(chatBody.session_id, 'suggest:qq:10001:private:20002:task')
  assert.equal(chatBody.enable_streaming, undefined)
  assert.deepEqual(chatBody.flags, {
    enable_inline_genui: true,
    enable_default_system_prompt: true,
    enable_streaming: true,
  })
  assert.equal(chatBody.config_id, undefined)
  assert.equal(chatBody.message[0].type, 'plain')
  assert.match(chatBody.message[0].text, /them\(Raven\): 在吗/)
  assert.match(chatBody.message[0].text, /必须先调用工具/)
  assert.match(chatBody.message[0].text, /客户说：/)
  assert.doesNotMatch(chatBody.message[0].text, /只输出 JSON/)
  assert.doesNotMatch(chatBody.message[0].text, /检索依据（内部/)
  assert.doesNotMatch(chatBody.message[0].text, /这是同一场私聊的下一轮/)

  await fetch(`${f.base}/api/runtime/bot/session`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'qq:10001', type: 'private', peerId: '20002', enabled: true, mode: 'assist', configId: 'sales' }),
  })
  assert.deepEqual(f.store.list().accounts[0].botSessions['private:20002'], { enabled: true, mode: 'assist', configId: 'sales' })

  const autoOn = await send({ ...payload, lastMessageId: 'm2', trigger: 'auto' })
  assert.equal((await autoOn.json()).replies[0].text, '好的，我买')
  const autoChat = JSON.parse(f.astrbotRequests.at(-1).body)
  assert.equal(autoChat.config_id, 'sales')
  assert.equal(autoChat.session_id, 'suggest:qq:10001:private:20002:task')
  assert.match(autoChat.message[0].text, /这是同一场私聊的下一轮/)
  assert.doesNotMatch(autoChat.message[0].text, /只输出 JSON/)

  const history = await fetch(`${f.base}/api/runtime/bot/history?accountId=qq:10001&type=private&peerId=20002`)
  assert.equal(history.status, 200)
  const items = (await history.json()).items
  assert.equal(items[0].replies[0].text, '好的，我买')
  assert.equal(items[0].inProgress, false)
  assert.ok(items[0].steps.some((step) => step.title === '手动生成建议' || step.title === '开始处理本轮' || step.title.includes('建议')))
  const state = await (await fetch(`${f.base}/api/runtime/state`)).json()
  assert.deepEqual(state.botActivity, {})
})

test('digest trigger summarizes unread without enabling ChatBot', async (t) => {
  const f = await fixture(t)
  f.setAstrbotReply({
    status: 200,
    body: 'data: {"type":"plain","data":"{\\"summary\\":\\"群里在问降智\\",\\"points\\":[{\\"text\\":\\"小默问5.6不降智了\\",\\"messageId\\":\\"m9\\"}]}"}\n\n',
  })
  const response = await fetch(`${f.base}/api/runtime/bot/suggest`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      accountId: 'qq:10001', type: 'group', peerId: '2159', lastMessageId: 'm9', trigger: 'digest',
      messages: [{ id: 'm9', role: 'them', text: '5.6不降智了?', name: '小默' }],
    }),
  })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.summary, '群里在问降智')
  assert.equal(body.points[0].messageId, 'm9')
  assert.equal(body.replies.length, 0)
  const chat = JSON.parse(f.astrbotRequests.at(-1).body)
  assert.equal(chat.session_id, 'suggest:qq:10001:group:2159:digest')
  assert.match(chat.message, /事件要点/)
  assert.doesNotMatch(chat.message, /当成一次说话来回/)
  const history = await fetch(`${f.base}/api/runtime/bot/history?accountId=qq:10001&type=group&peerId=2159`)
  const items = (await history.json()).items
  assert.equal(items[0].trigger, 'digest')
  assert.equal(items[0].points[0].messageId, 'm9')
  assert.ok(items[0].steps.some((step) => step.title.includes('要点') || step.title.includes('未读')))
})

test('suggest failures return an empty list and configs proxy AstrBot', async (t) => {
  const f = await fixture(t)
  f.setAstrbotReply({ status: 500, body: 'nope' })
  const failed = await fetch(`${f.base}/api/runtime/bot/suggest`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId: 'qq:10001', type: 'private', peerId: '1', lastMessageId: 'x', trigger: 'menu', messages: [{ role: 'them', text: '在吗' }] }),
  })
  assert.equal(failed.status, 200)
  assert.deepEqual(await failed.json(), { lastMessageId: 'x', replies: [], summary: '', read: null })

  f.setAstrbotReply({ status: 200, body: 'data: {"type":"plain","data":"{\\"replies\\":[{\\"id\\":\\"1\\",\\"text\\":\\"好的，我买\\",\\"score\\":0.82}]}"}\n\n' })
  const recovered = await fetch(`${f.base}/api/runtime/bot/suggest`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId: 'qq:10001', type: 'private', peerId: '1', lastMessageId: 'y', trigger: 'menu', messages: [{ role: 'them', text: '在吗' }] }),
  })
  assert.equal(recovered.status, 200)
  const recoveredChat = JSON.parse(f.astrbotRequests.at(-1).body)
  assert.match(recoveredChat.message[0].text, /必须先调用工具/)
  assert.doesNotMatch(recoveredChat.message[0].text, /这是同一场私聊的下一轮/)

  f.setAstrbotPath('/api/v1/configs', {
    status: 200,
    body: JSON.stringify({ status: 'ok', data: { configs: [{ id: 'default', name: '默认', path: 'a', is_default: true }] } }),
  })
  f.setAstrbotPath('/api/v1/provider-sources', {
    status: 200,
    body: JSON.stringify({ status: 'ok', data: { provider_sources: [{ id: 'openai' }] } }),
  })
  const configs = await fetch(`${f.base}/api/runtime/bot/configs`)
  assert.equal(configs.status, 200)
  assert.deepEqual(await configs.json(), {
    configs: [{ id: 'default', name: '默认', isDefault: true }],
    needsSetup: false,
  })

  f.setAstrbotPath('/api/v1/provider-sources', {
    status: 200,
    body: JSON.stringify({ status: 'ok', data: { provider_sources: [] } }),
  })
  const unconfigured = await fetch(`${f.base}/api/runtime/bot/configs`)
  assert.equal(unconfigured.status, 200)
  assert.deepEqual(await unconfigured.json(), {
    configs: [{ id: 'default', name: '默认', isDefault: true }],
    needsSetup: true,
  })
})

test('reduceChatStream keeps tool events out of the customer draft text', () => {
  const stream = reduceChatStream([
    'data: {"type":"plain","chain_type":"tool_call","data":"{\\"id\\":\\"t1\\",\\"name\\":\\"web_search\\",\\"arguments\\":{\\"q\\":\\"codexhost\\"}}"}',
    'data: {"type":"plain","chain_type":"tool_call_result","data":"{\\"id\\":\\"t1\\",\\"result\\":\\"https://github.com/acme/codexhost\\"}"}',
    'data: {"type":"plain","data":"{\\"replies\\":[{\\"id\\":\\"1\\",\\"text\\":\\"CodexHost：https://github.com/acme/codexhost\\",\\"score\\":0.9}],\\"summary\\":\\"CodexHost：https://github.com/acme/codexhost\\"}"}',
    '',
  ].join('\n\n'))
  assert.equal(stream.tools[0].name, 'web_search')
  assert.equal(stream.steps[0].title, '调用 web_search')
  assert.equal(stream.steps[1].title, '完成 web_search')
  assert.match(stream.text, /acme\/codexhost/)
  assert.doesNotMatch(stream.text, /web_search/)
  const drafted = draftsFromAgentRun(stream, 'm9')
  assert.equal(drafted.read.intent.id, 'request')
  assert.equal(drafted.read.action.id, 'brief')
  assert.match(drafted.replies[0].text, /https:\/\/github.com\/acme\/codexhost/)
})

test('lookup turns without tools fall back instead of escalating empty', () => {
  const parsed = draftsFromAgentRun({
    text: JSON.stringify({
      read: { intent: 'request', action: 'escalate', speakNow: { yes: 0.88, no: 0.12 }, urgency: 6, note: '无 CodexHost 信息, 转人工' },
      replies: [],
      summary: '',
    }),
    tools: [],
    steps: [],
  }, 'm1')
  assert.equal(parsed.read.action.id, 'escalate')
  assert.equal(shouldFallbackLookup('你去 github 上找下 codexhost 这个项目, 简单解释下', { tools: [] }, parsed), true)
  assert.equal(shouldFallbackLookup('在吗', { tools: [] }, parsed), false)
  assert.equal(shouldFallbackLookup('你去 github 上找下 codexhost', { tools: [{ name: 'web_search' }] }, parsed), false)
  const missed = draftsFromAgentRun({
    text: '今天美股的情况我这边没查到。这个项目我这边也没查到。',
    tools: [],
    steps: [],
  }, 'm3')
  assert.equal(shouldFallbackLookup('帮我查下今天美股的情况如何\nhttps://github.com/jev-chat/jev-chat-windows', { tools: [] }, missed), true)
  const hit = applyLookupToSuggest(parsed, {
    needed: true,
    queries: ['codexhost'],
    hits: [{ name: 'acme/codexhost', url: 'https://github.com/acme/codexhost', desc: 'hosted coding agent' }],
    facts: 'repo acme/codexhost https://github.com/acme/codexhost',
  }, 'm1')
  assert.match(hit.replies[0].text, /acme\/codexhost/)
  assert.equal(hit.read.action.id, 'brief')
})

test('agent prose without JSON becomes a single cited draft', () => {
  const drafted = draftsFromAgentRun({
    text: 'CodexHost 是托管编程助手：https://github.com/acme/codexhost',
    steps: [],
    tools: [{ name: 'web_search' }],
  }, 'm2')
  assert.match(drafted.replies[0].text, /acme\/codexhost/)
  assert.equal(drafted.read.action.id, 'brief')
  assert.equal(applyLookupToSuggest(drafted, { needed: false }).replies[0].text, drafted.replies[0].text)
})

test('ChatBot send uses the same ChatUI flags as a new workspace conversation and records tool steps', async (t) => {
  const f = await fixture(t)
  f.setAstrbotReply({
    status: 200,
    body: [
      'data: {"type":"plain","chain_type":"tool_call","data":"{\\"id\\":\\"t1\\",\\"name\\":\\"web_search\\",\\"arguments\\":{\\"q\\":\\"codexhost\\"}}"}',
      'data: {"type":"plain","chain_type":"tool_call_result","data":"{\\"id\\":\\"t1\\",\\"result\\":\\"https://github.com/acme/codexhost hosted coding agent\\"}"}',
      'data: {"type":"plain","data":"{\\"read\\":{\\"intent\\":{\\"id\\":\\"request\\"},\\"speakNow\\":{\\"yes\\":0.8,\\"no\\":0.2},\\"action\\":{\\"id\\":\\"brief\\"},\\"urgency\\":5,\\"note\\":\\"已查到\\"},\\"replies\\":[{\\"id\\":\\"1\\",\\"text\\":\\"CodexHost：https://github.com/acme/codexhost，托管编程助手。\\",\\"score\\":0.9}],\\"summary\\":\\"CodexHost：https://github.com/acme/codexhost，托管编程助手。\\"}"}',
      '',
    ].join('\n\n'),
  })
  const response = await fetch(`${f.base}/api/runtime/bot/suggest`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      accountId: 'qq:10001', type: 'private', peerId: '20002', lastMessageId: 'm9', trigger: 'menu',
      messages: [{ role: 'them', text: '你去 github 上找下 codexhost 这个项目, 简单解释下', name: 'Raven' }],
    }),
  })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.match(body.replies[0].text, /acme\/codexhost/)
  assert.doesNotMatch(body.replies.map((item) => item.text).join('\n'), /我去 GitHub 上找找/)
  const chat = JSON.parse(f.astrbotRequests.at(-1).body)
  assert.deepEqual(chat.flags, buildChatRequestFlags(true))
  assert.equal(chat.message[0].type, 'plain')
  assert.match(chat.message[0].text, /必须先调用工具/)
  const history = await fetch(`${f.base}/api/runtime/bot/history?accountId=qq:10001&type=private&peerId=20002`)
  const items = (await history.json()).items
  assert.ok(items[0].steps.some((step) => step.title === '调用 web_search'))
  assert.ok(items[0].steps.some((step) => step.title === '完成 web_search'))
})
