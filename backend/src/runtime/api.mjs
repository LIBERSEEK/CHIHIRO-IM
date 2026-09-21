import fs from 'node:fs'
import path from 'node:path'
import { CLIENTS, getClient } from './clients.mjs'
import { createAccountStore } from './accounts.mjs'
import { createQqRuntime } from './qq-napcat.mjs'
import { createGrowthRuntime } from './growth.mjs'
import { isDouyinAccountId } from './growth-ids.mjs'
import { createAstrbotRuntime } from './astrbot.mjs'
import { createBotController } from './bot.mjs'
import { createBotSuggest } from './bot-suggest.mjs'
import { createBotAuto } from './bot-auto.mjs'
import { createBotActivity } from './bot-activity.mjs'
import { createBotHistory } from './bot-history.mjs'
import { createAgentController } from './agent.mjs'
import { createChatuiProxy } from './chatui.mjs'
import { createCustomerInsights } from '../core/customer-insights.mjs'
import { createGroupIntelligence } from '../core/group-intelligence.mjs'
import { log, logError } from './log.mjs'

export function createRuntime({ root, cfg, services = {} }) {
  const dataDir = path.join(root, 'data')
  const store = createAccountStore(path.join(dataDir, 'accounts.json'))
  const qq = services.qq || createQqRuntime({
    store,
    logDir: path.join(dataDir, 'logs'),
    root
  })
  const growth = services.growth || createGrowthRuntime({
    root,
    store,
    emit: () => qq.touch?.(),
    loginWaiter: services.growthLoginWaiter,
    feedRunner: services.growthFeedRunner,
  })
  const astrbot = services.astrbot || createAstrbotRuntime({ root, cfg })
  const agent = createAgentController({ root, store, qq, astrbot, cfg })
  const customers = services.customers || createCustomerInsights({ root })
  const groupIntelligence = services.groupIntelligence || createGroupIntelligence({ root })
  const bot = services.bot || createBotController({ store, qq, astrbot, cfg })
  const botActivity = services.botActivity || createBotActivity({ touch: () => qq.touch?.() })
  const botHistory = services.botHistory || createBotHistory({ filePath: path.join(dataDir, 'bot-history.json') })
  const botSuggest = services.botSuggest || createBotSuggest({
    store, qq, astrbot, activity: botActivity, history: botHistory,
  })
  const botAuto = services.botAuto || createBotAuto({
    store,
    qq,
    botSuggest,
    history: botHistory,
    activity: botActivity,
    sendToPeer: (accountId, body) => agent.sendToPeer(accountId, body),
    fetchHistory: async (accountId, type, peerId) => {
      const observed = await agent.observe({ kind: 'messages', accountId, type, peerId, count: 24 })
      return observed.messages || []
    },
  })
  const chatui = services.chatui || createChatuiProxy({ astrbot })

  async function snapshot() {
    const snap = growth.decorateSnapshot(qq.snapshot())
    snap.astrbot = await astrbot.refreshStatus()
    const wired = bot.wired
    for (const acc of snap.accounts?.accounts || []) {
      acc.botWired = wired.has(acc.id)
    }
    snap.agent = {
      pendingByAccount: agent.pendingCounts()
    }
    snap.botActivity = botActivity.snapshot()
    return snap
  }

  async function handle(req, res, url) {
    const method = req.method || 'GET'
    const p = url.pathname

    if (p === '/api/runtime/clients' && method === 'GET') {
      return json(res, { clients: CLIENTS })
    }

    if (p === '/api/runtime/state' && method === 'GET') {
      await qq.refreshPorts()
      return json(res, await snapshot())
    }

    if (p === '/api/runtime/accounts' && method === 'GET') {
      return json(res, store.list())
    }

    if (p === '/api/runtime/accounts/active' && method === 'POST') {
      const body = await readJson(req)
      try {
        store.setActive(body.id)
        log('api', `active ${body.id}`)
        qq.setActiveAccount(body.id)
        if (String(body.id).startsWith('qq:')) {
          qq.startOrQuick(body.id).catch((e) => logError('api', 'startOrQuick', e))
        }
        return json(res, await snapshot())
      } catch (e) {
        return json(res, { error: e.message }, 400)
      }
    }

    if (p === '/api/runtime/accounts/remove' && method === 'POST') {
      const body = await readJson(req)
      if (!body.id) return json(res, { error: 'missing_id' }, 400)
      if (isDouyinAccountId(body.id)) {
        await growth.cleanup(body.id).catch((e) => logError('api', 'growth.cleanup', e))
        store.remove(body.id)
        return json(res, await snapshot())
      }
      await bot.unwireBeforeRemove(body.id).catch((e) => logError('api', 'unwire', e))
      const snap = await qq.removeAccount(body.id)
      snap.astrbot = await astrbot.refreshStatus()
      return json(res, snap)
    }

    if (p.startsWith('/api/runtime/agent')) {
      const handled = await agent.handleHttp(req, res, url)
      if (handled) return true
    }

    if (p === '/api/runtime/customers' && method === 'GET') {
      try {
        const accountId = req.headers['x-chihiro-account'] || url.searchParams.get('accountId')
        return json(res, customers.list({
          accountId,
          channel: url.searchParams.get('channel') || '',
          q: url.searchParams.get('q') || '',
          limit: url.searchParams.get('limit') || '',
          offset: url.searchParams.get('offset') || ''
        }))
      } catch (e) {
        return customerError(res, e)
      }
    }
    const customerMatch = p.match(/^\/api\/runtime\/customers\/([^/]+)$/)
    if (customerMatch && method === 'GET') {
      try {
        const accountId = req.headers['x-chihiro-account'] || url.searchParams.get('accountId')
        if (!accountId) throw new Error('missing_account')
        return json(res, customers.get(decodePathPart(customerMatch[1]), { accountId }))
      } catch (e) {
        return customerError(res, e)
      }
    }
    if (customerMatch && method === 'PATCH') {
      try {
        const accountId = req.headers['x-chihiro-account'] || url.searchParams.get('accountId')
        if (!accountId) throw new Error('missing_account')
        const body = await readJson(req)
        return json(res, customers.update(decodePathPart(customerMatch[1]), body, { accountId }))
      } catch (e) {
        return customerError(res, e)
      }
    }
    if (p === '/api/runtime/customers/ingest' && method === 'POST') {
      try {
        const body = await readJson(req)
        const headerAccount = req.headers['x-chihiro-account']
        if (headerAccount && body.accountId && String(headerAccount) !== String(body.accountId)) throw new Error('account_mismatch')
        if (headerAccount && !body.accountId) body.accountId = String(headerAccount)
        return json(res, customers.ingest(body))
      } catch (e) {
        return customerError(res, e)
      }
    }

    if (p === '/api/runtime/group-intelligence/messages/ingest' && method === 'POST') {
      try {
        const body = await readJson(req)
        const accountId = req.headers['x-chihiro-account']
        if (accountId && body.accountId && String(accountId) !== String(body.accountId)) throw new Error('account_mismatch')
        if (accountId && !body.accountId) body.accountId = String(accountId)
        return json(res, groupIntelligence.ingest(body))
      } catch (e) {
        return groupIntelligenceError(res, e)
      }
    }
    if (p === '/api/runtime/group-intelligence/reports' && method === 'GET') {
      try {
        const accountId = req.headers['x-chihiro-account'] || url.searchParams.get('accountId')
        return json(res, groupIntelligence.listReports({ accountId }))
      } catch (e) {
        return groupIntelligenceError(res, e)
      }
    }
    if (p === '/api/runtime/group-intelligence/reports' && method === 'POST') {
      try {
        const accountId = req.headers['x-chihiro-account']
        if (!accountId) throw new Error('missing_account')
        return json(res, groupIntelligence.createReport(await readJson(req), { accountId: String(accountId) }))
      } catch (e) {
        return groupIntelligenceError(res, e)
      }
    }
    const reportMatch = p.match(/^\/api\/runtime\/group-intelligence\/reports\/([^/]+)$/)
    if (reportMatch && method === 'GET') {
      try {
        const accountId = req.headers['x-chihiro-account'] || url.searchParams.get('accountId')
        return json(res, groupIntelligence.getReport(decodePathPart(reportMatch[1]), { accountId }))
      } catch (e) {
        return groupIntelligenceError(res, e)
      }
    }

    // Unified frontend IM read boundary. Responses are normalized from the
    // existing Agent/QQ observer so the product UI does not depend on the
    // legacy iframe protocol.
    if (p === '/api/runtime/im/conversations' && method === 'GET') {
      const accountId = req.headers['x-chihiro-account'] || url.searchParams.get('accountId')
      if (!accountId) return json(res, { error: 'missing_account' }, 400)
      try {
        const observed = await agent.observe({ kind: 'recent-conversations', accountId })
        return json(res, (observed.sessions || []).map((session) => ({
        id: session.key,
        title: session.title || session.peerId,
        kind: session.type === 'group' ? 'group' : 'direct',
        lastText: session.lastText,
        lastAt: session.lastAt,
        })))
      } catch (e) {
        return imError(res, e)
      }
    }
    const messageMatch = p.match(/^\/api\/runtime\/im\/conversations\/([^/]+)\/messages$/)
    if (messageMatch && method === 'GET') {
      const accountId = req.headers['x-chihiro-account'] || url.searchParams.get('accountId')
      if (!accountId) return json(res, { error: 'missing_account' }, 400)
      try {
        let key
        try { key = decodeURIComponent(messageMatch[1]) } catch { return json(res, { error: 'invalid_conversation' }, 400) }
        const observed = await agent.observe({ kind: 'messages', accountId, key, count: 100 })
        return json(res, (observed.messages || []).map((message, index) => ({
        id: String(message.id ?? `${key}:${index}`),
        text: String(message.text ?? message.content ?? ''),
        sender: String(message.sender ?? message.user_id ?? ''),
        at: message.time,
        outgoing: String(message.user_id) === String(accountId).slice(3),
        })))
      } catch (e) {
        return imError(res, e)
      }
    }
    if (p === '/api/runtime/im/send' && method === 'POST') {
      const accountId = req.headers['x-chihiro-account']
      const body = await readJson(req)
      if (typeof accountId !== 'string' || typeof body.conversationId !== 'string' || typeof body.text !== 'string' || !body.text.trim()) return json(res, { error: 'missing_message_fields' }, 400)
      try {
        return json(res, await agent.sendToConversation(accountId, body.conversationId, body.text))
      } catch (e) {
        return imError(res, e)
      }
    }

    if (p === '/api/runtime/bot/enable' && method === 'POST') {
      const body = await readJson(req)
      if (!body.id) return json(res, { error: 'missing_id' }, 400)
      try {
        await bot.setEnabled(body.id, body.enabled !== false)
        return json(res, await snapshot())
      } catch (e) {
        logError('api', 'bot.enable', e)
        return json(res, { error: e.message, message: e.message, ...(await snapshot()) }, 400)
      }
    }

    if (p === '/api/runtime/bot/session' && method === 'POST') {
      const body = await readJson(req)
      if (!body.id || body.peerId == null) return json(res, { error: 'missing_id' }, 400)
      try {
        await bot.setSession(body.id, body.type, body.peerId, {
          enabled: body.enabled,
          mode: body.mode,
          configId: body.configId ?? body.config_id,
        })
        botAuto.sync()
        return json(res, await snapshot())
      } catch (e) {
        logError('api', 'bot.session', e)
        return json(res, { error: e.message, message: e.message, ...(await snapshot()) }, 400)
      }
    }

    if (p === '/api/runtime/bot/presence' && method === 'POST') {
      const body = await readJson(req)
      return json(res, botAuto.notePresence({
        accountId: body.accountId || body.id,
        type: body.type,
        peerId: body.peerId,
        focused: body.focused,
        busy: body.busy,
      }))
    }

    if (p === '/api/runtime/bot/claim' && method === 'POST') {
      const body = await readJson(req)
      return json(res, botAuto.claim({
        accountId: body.accountId || body.id,
        type: body.type,
        peerId: body.peerId,
        lastMessageId: body.lastMessageId,
      }))
    }

    if (p === '/api/runtime/bot/nudge' && method === 'POST') {
      const body = await readJson(req)
      return json(res, botAuto.nudge({
        accountId: body.accountId || body.id,
        type: body.type,
        peerId: body.peerId,
      }))
    }

    if (p === '/api/runtime/bot/suggest' && method === 'POST') {
      const body = await readJson(req)
      try {
        return json(res, await botSuggest.suggest(body))
      } catch (e) {
        logError('api', 'bot.suggest', e)
        return json(res, { lastMessageId: String(body?.lastMessageId || ''), replies: [] })
      }
    }

    if (p === '/api/runtime/bot/history' && method === 'GET') {
      const accountId = url.searchParams.get('accountId') || ''
      const type = url.searchParams.get('type') === 'group' ? 'group' : 'private'
      const peerId = url.searchParams.get('peerId') || ''
      if (!accountId || !peerId) return json(res, { error: 'missing_id' }, 400)
      return json(res, { items: botHistory.list(accountId, type, peerId) })
    }

    if (p === '/api/runtime/bot/configs' && method === 'GET') {
      try {
        return json(res, await botSuggest.listConfigs())
      } catch (e) {
        logError('api', 'bot.configs', e)
        return json(res, { configs: [], needsSetup: true })
      }
    }

    if (p === '/api/runtime/bot/ensure' && method === 'POST') {
      try {
        await astrbot.ensure()
        return json(res, await snapshot())
      } catch (e) {
        logError('api', 'bot.ensure', e)
        return json(res, { error: e.message, message: e.message, ...(await snapshot()) }, 400)
      }
    }

    if (p === '/api/runtime/login/cancel' && method === 'POST') {
      try {
        const current = growth.snapshotGrowth()
        if (current.loginClient === 'douyin' && (current.pendingAdd || current.phase === 'logging_in' || current.phase === 'browser_setup')) {
          await growth.cancelLogin()
          return json(res, await snapshot())
        }
        const snap = await qq.cancelLogin()
        snap.astrbot = await astrbot.refreshStatus()
        return json(res, snap)
      } catch (e) {
        logError('api', 'login.cancel', e)
        return json(res, { error: e.message, message: e.message, ...(await snapshot()) }, 500)
      }
    }

    if (p === '/api/runtime/start' && method === 'POST') {
      const body = await readJson(req)
      const clientId = body.client || 'qq'
      const client = getClient(clientId)
      if (!client) return json(res, { error: 'unknown_client' }, 400)
      if (!client.enabled) {
        return json(res, {
          error: 'client_not_enabled',
          message: `${client.name} 将在后续版本接入，第一版先跑通 QQ`,
          client
        }, 501)
      }
      log('api', `start client=${clientId} mode=${body.mode || '-'} uin=${body.uin || '-'}`)
      if (clientId === 'douyin') {
        const accountId = isDouyinAccountId(body.id)
          ? body.id
          : (body.uin ? `douyin:${body.uin}` : '')
        growth.prepareNew(accountId)
        return json(res, await snapshot())
      }
      const snap = await qq.start({
        uin: body.uin,
        forceNew: body.mode === 'new' || body.forceNew === true,
        refreshQr: body.refreshQr === true
      })
      snap.astrbot = await astrbot.refreshStatus()
      return json(res, snap)
    }

    if (p === '/api/runtime/growth/browser' && method === 'POST') {
      const body = await readJson(req)
      try {
        const detected = growth.setBrowserPath(body.path || '')
        return json(res, { ...detected, ...(await snapshot()) })
      } catch (e) {
        return json(res, { error: e.message, message: e.message }, 400)
      }
    }

    if (p === '/api/runtime/growth/login' && method === 'POST') {
      const body = await readJson(req)
      try {
        const browserPath = body.browserPath || body.path || ''
        if (browserPath) growth.setBrowserPath(browserPath)
        const browser = growth.browserState()
        if (!browser.detected) {
          return json(res, { error: 'chrome_not_found', message: `找不到 Chrome：${browser.path || '未设置路径'}`, ...(await snapshot()) }, 400)
        }
        growth.login({
          accountId: body.id || body.accountId || '',
          browserPath,
        }).catch((e) => logError('api', 'growth.login', e))
        return json(res, await snapshot())
      } catch (e) {
        return json(res, { error: e.message, message: e.message, ...(await snapshot()) }, 400)
      }
    }

    const growthAvatarMatch = p.match(/^\/api\/runtime\/growth\/accounts\/([^/]+)\/avatar$/)
    if (growthAvatarMatch && method === 'GET') {
      const id = decodePathPart(growthAvatarMatch[1])
      const file = growth.readAvatar(id)
      if (!file) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ error: 'avatar_not_found' }))
        return true
      }
      res.writeHead(200, {
        'Content-Type': file.contentType || 'image/jpeg',
        'Cache-Control': 'private, max-age=120',
      })
      res.end(file.body)
      return true
    }

    const growthImagesMatch = p.match(/^\/api\/runtime\/growth\/accounts\/([^/]+)\/comment-images$/)
    if (growthImagesMatch && method === 'POST') {
      const id = decodePathPart(growthImagesMatch[1])
      try {
        const body = await readJson(req)
        const saved = growth.saveCommentImages(id, body.groupId || body.id, body.type, body.files)
        return json(res, { ...saved, ...(await snapshot()) })
      } catch (e) {
        return json(res, { error: e.message, message: e.message, ...(await snapshot()) }, 400)
      }
    }

    const growthHistoryMatch = p.match(/^\/api\/runtime\/growth\/accounts\/([^/]+)\/history(?:\/([^/]+))?$/)
    if (growthHistoryMatch && method === 'DELETE') {
      const id = decodePathPart(growthHistoryMatch[1])
      const taskId = growthHistoryMatch[2] ? decodePathPart(growthHistoryMatch[2]) : ''
      try {
        const account = taskId
          ? growth.deleteTaskHistory(id, taskId)
          : growth.clearTaskHistory(id)
        return json(res, { account, ...(await snapshot()) })
      } catch (e) {
        return json(res, { error: e.message, message: e.message, ...(await snapshot()) }, 400)
      }
    }

    if (p.startsWith('/api/runtime/growth/accounts/') && method === 'GET') {
      const rest = p.slice('/api/runtime/growth/accounts/'.length)
      if (rest.includes('/')) return json(res, { error: 'account_not_found' }, 404)
      const id = decodePathPart(rest)
      const view = growth.accountView(id)
      if (!view) return json(res, { error: 'account_not_found' }, 404)
      return json(res, view)
    }

    if (p.match(/^\/api\/runtime\/growth\/accounts\/[^/]+\/settings$/) && method === 'POST') {
      const id = decodePathPart(p.split('/')[5])
      try {
        const settings = growth.writeSettings(id, await readJson(req))
        return json(res, { settings, ...(await snapshot()) })
      } catch (e) {
        return json(res, { error: e.message, message: e.message }, 400)
      }
    }

    if (p === '/api/runtime/growth/task/start' && method === 'POST') {
      const body = await readJson(req)
      try {
        await growth.startTask(body.accountId || body.id, body.settings || {})
        return json(res, await snapshot())
      } catch (e) {
        return json(res, { error: e.message, message: e.message, ...(await snapshot()) }, 400)
      }
    }

    if (p === '/api/runtime/growth/task/stop' && method === 'POST') {
      await growth.stopTask()
      return json(res, await snapshot())
    }

    if (p === '/api/runtime/growth/task/pause' && method === 'POST') {
      const body = await readJson(req)
      try {
        await growth.setPaused(body.paused === true)
        return json(res, await snapshot())
      } catch (e) {
        return json(res, { error: e.message, message: e.message, ...(await snapshot()) }, 400)
      }
    }

    if (p === '/api/runtime/growth/preview/mode' && method === 'POST') {
      const body = await readJson(req)
      try {
        await growth.setPreviewMode(body.mode)
        return json(res, await snapshot())
      } catch (e) {
        return json(res, { error: e.message, message: e.message, ...(await snapshot()) }, 400)
      }
    }

    if (p === '/api/runtime/growth/preview/mute' && method === 'POST') {
      const body = await readJson(req)
      try {
        await growth.setPreviewMuted(body.muted !== false)
        return json(res, await snapshot())
      } catch (e) {
        return json(res, { error: e.message, message: e.message, ...(await snapshot()) }, 400)
      }
    }

    if (p === '/api/runtime/growth/preview.jpg' && method === 'GET') {
      const jpeg = growth.previewFrame()
      if (!jpeg) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ error: 'no_preview' }))
        return true
      }
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' })
      res.end(Buffer.from(jpeg, 'base64'))
      return true
    }

    if (p === '/api/runtime/growth/preview/stream' && method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      })
      const send = () => {
        try {
          const jpeg = growth.previewFrame()
          const preview = growth.snapshotGrowth().preview || {}
          res.write(`data: ${JSON.stringify({
            jpeg,
            mode: preview.mode || 'window',
            available: Boolean(jpeg),
            muted: preview.muted !== false,
          })}\n\n`)
        } catch { /* closed */ }
      }
      send()
      const unsub = growth.subscribePreview(send)
      req.on('close', unsub)
      return true
    }

    if (p === '/api/runtime/qq/qr' && method === 'GET') {
      const snap = qq.snapshot()
      const qr = snap.qr
      if (snap.phase !== 'qr' || !qr.exists) {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'qr_not_ready' }))
        return true
      }
      const buf = fs.readFileSync(qr.path)
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-store'
      })
      res.end(buf)
      return true
    }

    if (p === '/api/runtime/image-proxy' && method === 'GET') {
      return proxyImage(res, url.searchParams.get('url') || '')
    }

    if (p.startsWith('/api/runtime/chatui')) {
      return chatui.handle(req, res, url)
    }

    if (p === '/api/runtime/stream' && method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      })
      const send = async () => {
        try {
          res.write(`data: ${JSON.stringify(await snapshot())}\n\n`)
        } catch { /* closed */ }
      }
      send()
      const unsubQq = qq.subscribe(() => { send() })
      const unsubGrowth = growth.subscribe(() => { send() })
      const timer = setInterval(() => {
        qq.refreshPorts()
          .then(() => {
            bot.sync()
            botAuto.sync()
          })
          .catch(() => {})
      }, 1500)
      req.on('close', () => {
        unsubQq()
        unsubGrowth()
        clearInterval(timer)
      })
      return true
    }

    return false
  }

  async function shutdown() {
    botAuto.shutdown()
    await astrbot.stopIfOwned().catch((e) => logError('api', 'astrbot stop', e))
  }

  return { handle, qq, store, astrbot, bot, botSuggest, botAuto, agent, customers, groupIntelligence, growth, snapshot, shutdown }
}

function json(res, obj, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(obj))
  return true
}

function imError(res, error) {
  const code = error?.message || 'im_failed'
  const status = code === 'account_not_found' ? 404 : 400
  return json(res, { error: code, message: code }, status)
}

function customerError(res, error) {
  const code = error?.message || 'customer_insights_failed'
  const status = code === 'customer_not_found' ? 404 : 400
  return json(res, { error: code, message: code }, status)
}

function groupIntelligenceError(res, error) {
  const code = error?.message || 'group_intelligence_failed'
  return json(res, { error: code }, code === 'report_not_found' ? 404 : 400)
}

function decodePathPart(part) {
  try {
    return decodeURIComponent(part)
  } catch {
    throw new Error('invalid_path')
  }
}

function isQqMediaHost(host) {
  const name = String(host || '').toLowerCase()
  return (
    name === 'multimedia.nt.qq.com.cn' ||
    name.endsWith('.qq.com') ||
    name.endsWith('.qq.com.cn') ||
    name.endsWith('.qpic.cn') ||
    name.endsWith('.qlogo.cn') ||
    name.endsWith('.gtimg.cn')
  )
}

async function proxyImage(res, raw) {
  let target
  try {
    target = new URL(raw)
  } catch {
    return json(res, { error: 'bad_url' }, 400)
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return json(res, { error: 'bad_url' }, 400)
  }
  if (!isQqMediaHost(target.hostname)) {
    return json(res, { error: 'forbidden_host' }, 403)
  }
  try {
    const upstream = await fetch(target.href, {
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(20000)
    })
    if (!upstream.ok) {
      return json(res, { error: 'fetch_failed', status: upstream.status }, 502)
    }
    const buf = Buffer.from(await upstream.arrayBuffer())
    if (buf.length > 20 * 1024 * 1024) {
      return json(res, { error: 'too_large' }, 413)
    }
    const contentType = (upstream.headers.get('content-type') || 'image/jpeg')
      .split(';')[0]
      .trim()
    res.writeHead(200, {
      'Content-Type': contentType.startsWith('image/') ? contentType : 'image/jpeg',
      'Cache-Control': 'private, max-age=120'
    })
    res.end(buf)
    return true
  } catch (e) {
    logError('api', 'image-proxy', e?.message || e)
    return json(res, { error: 'fetch_failed' }, 502)
  }
}

function readJson(req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}'))
      } catch {
        resolve({})
      }
    })
  })
}
