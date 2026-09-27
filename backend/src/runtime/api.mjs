import fs from 'node:fs'
import path from 'node:path'
import { CLIENTS, getClient } from './clients.mjs'
import { createAccountStore } from './accounts.mjs'
import { createQqRuntime } from './qq-napcat.mjs'
import { createOutreachRuntime } from './outreach/service.mjs'
import { isBilibiliAccountId, isDouyinAccountId, isOutreachAccountId, isXiaohongshuAccountId, pickOutreachAccount } from './outreach/accounts/ids.mjs'
import { createLibrary } from './library.mjs'
import { briefPrompt, createBriefStore, settingsFromBrief, stageCommentImages, stageInlineImages, turnBrief } from './outreach/campaign/brief.mjs'
import { completeWithAstrbot } from './outreach/campaign/model.mjs'
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
import { createEnvironmentService } from './environment.mjs'
import { log, logError } from './log.mjs'

export function createRuntime({ root, cfg, services = {} }) {
  const managesLocalQq = !services.qq
  const managesLocalAstrbot = !services.astrbot
  const dataDir = path.join(root, 'data')
  const store = createAccountStore(path.join(dataDir, 'accounts.json'))
  const qq = services.qq || createQqRuntime({
    store,
    logDir: path.join(dataDir, 'logs'),
    root
  })
  const astrbot = services.astrbot || createAstrbotRuntime({ root, cfg })
  const library = services.library || createLibrary(path.join(dataDir, 'library'))
  const briefs = services.briefs || createBriefStore(path.join(dataDir, 'outreach-briefs.json'))
  const outreach = services.outreach || createOutreachRuntime({
    root,
    store,
    emit: () => qq.touch?.(),
    loginWaiter: services.outreachLoginWaiter,
    feedRunner: services.outreachFeedRunner,
    complete: (prompt, sessionId, options) => services.complete
      ? services.complete(prompt, sessionId, options)
      : completeWithAstrbot(astrbot, prompt, { sessionId, provider: options?.provider, model: options?.model }),
  })
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
  const environment = services.environment || createEnvironmentService({ root })

  async function prepareEnvironment(capability) {
    let report = environment.diagnose()
    if (report.capabilities[capability]?.status === 'repairable') {
      report = await environment.repair({ capability })
    }
    return report
  }

  async function snapshot() {
    const snap = outreach.decorateSnapshot(qq.snapshot())
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

    if (p === '/api/runtime/doctor' && method === 'GET') {
      return json(res, environment.diagnose())
    }

    if (p === '/api/runtime/repair' && method === 'POST') {
      try {
        const body = await readJson(req)
        const capability = body.capability === 'qq' || body.capability === 'agent' ? body.capability : undefined
        const report = await environment.repair({ capability })
        return json(res, report, report.errors?.length ? 500 : 200)
      } catch (error) {
        logError('api', 'environment.repair', error)
        return json(res, { error: 'repair_failed', message: error.message || String(error) }, 500)
      }
    }

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
      if (isOutreachAccountId(body.id)) {
        await outreach.cleanup(body.id).catch((e) => logError('api', 'outreach.cleanup', e))
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
        if (managesLocalAstrbot) await prepareEnvironment('agent')
        await astrbot.ensure()
        return json(res, await snapshot())
      } catch (e) {
        logError('api', 'bot.ensure', e)
        return json(res, { error: e.message, message: e.message, ...(await snapshot()) }, 400)
      }
    }

    if (p === '/api/runtime/login/cancel' && method === 'POST') {
      try {
        const current = outreach.snapshotOutreach()
        if (['douyin', 'xiaohongshu', 'bilibili'].includes(current.loginClient) && (current.pendingAdd || current.phase === 'logging_in' || current.phase === 'browser_setup')) {
          await outreach.cancelLogin()
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
      if (clientId === 'douyin' || clientId === 'xiaohongshu' || clientId === 'bilibili') {
        const valid = clientId === 'xiaohongshu'
          ? isXiaohongshuAccountId(body.id)
          : clientId === 'bilibili' ? isBilibiliAccountId(body.id) : isDouyinAccountId(body.id)
        const accountId = valid ? body.id : ''
        outreach.prepareNew(accountId, clientId)
        return json(res, await snapshot())
      }
      if (managesLocalQq) await prepareEnvironment('qq')
      const snap = await qq.start({
        uin: body.uin,
        forceNew: body.mode === 'new' || body.forceNew === true,
        refreshQr: body.refreshQr === true
      })
      snap.astrbot = await astrbot.refreshStatus()
      return json(res, snap)
    }

    if (p === '/api/runtime/library' && method === 'GET') {
      return json(res, { items: library.list() })
    }

    if (p === '/api/runtime/library' && method === 'POST') {
      try {
        return json(res, { item: library.add(await readJson(req)) })
      } catch (e) {
        return json(res, { error: e.message, message: e.message }, 400)
      }
    }

    const libraryFile = p.match(/^\/api\/runtime\/library\/([^/]+)\/file$/)
    if (libraryFile && method === 'GET') {
      const file = library.file(decodePathPart(libraryFile[1]))
      if (!file) return json(res, { error: 'not_found' }, 404)
      res.writeHead(200, { 'Content-Type': file.item.mime, 'Cache-Control': 'private, max-age=86400' })
      res.end(fs.readFileSync(file.path))
      return true
    }

    const libraryItem = p.match(/^\/api\/runtime\/library\/([^/]+)$/)
    if (libraryItem && method === 'DELETE') {
      library.remove(decodePathPart(libraryItem[1]))
      return json(res, { items: library.list() })
    }

    if (p === '/api/runtime/outreach/brief' && method === 'GET') {
      const id = String(url.searchParams.get('id') || '').trim()
      if (id) {
        const brief = briefs.get(id)
        if (!brief) return json(res, { error: 'not_found', message: '没有这张任务卡' }, 404)
        return json(res, { brief, items: library.list() })
      }
      return json(res, { brief: briefs.ensure(), items: library.list() })
    }

    if (p === '/api/runtime/outreach/brief' && method === 'POST') {
      const body = await readJson(req)
      return json(res, { brief: briefs.put(body.brief || body) })
    }

    if (p === '/api/runtime/outreach/brief/turn' && method === 'POST') {
      try {
        const body = await readJson(req)
        const text = String(body.text || '').trim()
        if (!text) return json(res, { error: '请先说说想投放的人群', message: '请先说说想投放的人群' }, 400)
        const current = briefs.get(body.id) || briefs.ensure()
        const draft = briefs.put({
          ...current,
          form: body.form === 'image' ? 'image' : (body.form === 'text' ? 'text' : current.form),
          commentImageIds: Array.isArray(body.commentImageIds) ? body.commentImageIds : current.commentImageIds,
          referenceIds: Array.isArray(body.referenceIds) ? body.referenceIds : current.referenceIds,
        })
        const names = [...draft.commentImageIds, ...draft.referenceIds]
          .map((id) => library.file(id)?.item?.name)
          .filter(Boolean)
        const modelText = await completeWithAstrbot(astrbot, briefPrompt(draft, text, names), { sessionId: `outreach-brief:${draft.id}` })
        return json(res, { brief: briefs.put(turnBrief(draft, text, modelText)) })
      } catch (e) {
        return json(res, { error: e.message, message: e.message }, 400)
      }
    }

    if (p === '/api/runtime/outreach/brief/start' && method === 'POST') {
      try {
        const body = await readJson(req)
        const current = briefs.get(body.id) || briefs.ensure()
        const savedBase = briefs.put({
          ...current,
          ...(body.form === 'image' || body.form === 'text' ? { form: body.form } : {}),
          ...(typeof body.audience === 'string' ? { audience: body.audience } : {}),
          ...(typeof body.offer === 'string' ? { offer: body.offer } : {}),
          ...(typeof body.benefit === 'string' ? { benefit: body.benefit } : {}),
          ...(typeof body.goal === 'string' ? { goal: body.goal } : {}),
          ...(typeof body.tone === 'string' ? { tone: body.tone } : {}),
          ...(Array.isArray(body.tags) ? { tags: body.tags } : {}),
          ...(Array.isArray(body.excludes) ? { excludes: body.excludes } : {}),
          ...(body.interaction === 'comment' || body.interaction === 'comment_like' ? { interaction: body.interaction } : {}),
          ...(body.maxCount ? { maxCount: body.maxCount } : {}),
          ...(Array.isArray(body.commentImageIds) ? { commentImageIds: body.commentImageIds } : {}),
          ...(Array.isArray(body.referenceIds) ? { referenceIds: body.referenceIds } : {}),
          ...(typeof body.commentProvider === 'string' ? { commentProvider: body.commentProvider } : {}),
          ...(typeof body.commentModel === 'string' ? { commentModel: body.commentModel } : {}),
          ...(body.platform === 'xiaohongshu' || body.platform === 'bilibili' || body.platform === 'douyin' ? { platform: body.platform } : {}),
          excludesAsked: true,
        })
        const saved = savedBase
        if (!saved.tags.length || !saved.tone || !saved.offer || !saved.benefit) {
          return json(res, { error: '资料还没齐', message: '资料还没齐', brief: saved }, 400)
        }
        const preferred = pickOutreachAccount(
          store.list().accounts || [],
          saved.platform,
          body.accountId || saved.accountId,
          (id) => outreach.hasStorage(id),
        )
        if (!preferred || !outreach.hasStorage(preferred.id)) {
          return json(res, { needsLogin: true, accountId: preferred?.id || '', brief: saved })
        }
        let imageDir = ''
        const inlineImages = Array.isArray(body.commentImageFiles) ? body.commentImageFiles : []
        if (saved.form === 'image' || inlineImages.length) {
          imageDir = outreach.commentImageDirectory(preferred.id, saved.id)
          const count = stageCommentImages(imageDir, saved.commentImageIds, (id) => library.file(id))
            + stageInlineImages(imageDir, inlineImages)
          if (!count) return json(res, { error: '请先选择评论配图', message: '请先选择评论配图', brief: saved }, 400)
        }
        await outreach.startTask(preferred.id, settingsFromBrief(saved, imageDir))
        const started = briefs.put({ ...saved, status: 'started', accountId: preferred.id })
        return json(res, { started: true, accountId: preferred.id, brief: started, ...(await snapshot()) })
      } catch (e) {
        return json(res, { error: e.message, message: e.message, ...(await snapshot()) }, 400)
      }
    }

    if (p === '/api/runtime/outreach/browser' && method === 'POST') {
      const body = await readJson(req)
      try {
        const detected = outreach.setBrowserPath(body.path || '')
        return json(res, { ...detected, ...(await snapshot()) })
      } catch (e) {
        return json(res, { error: e.message, message: e.message }, 400)
      }
    }

    if (p === '/api/runtime/outreach/login' && method === 'POST') {
      const body = await readJson(req)
      try {
        const browserPath = body.browserPath || body.path || ''
        if (browserPath) outreach.setBrowserPath(browserPath)
        const browser = outreach.browserState()
        if (!browser.detected) {
          return json(res, { error: 'chrome_not_found', message: `找不到 Chrome：${browser.path || '未设置路径'}`, ...(await snapshot()) }, 400)
        }
        outreach.login({
          accountId: body.id || body.accountId || '',
          browserPath,
          client: body.client || '',
        }).catch((e) => logError('api', 'outreach.login', e))
        return json(res, await snapshot())
      } catch (e) {
        return json(res, { error: e.message, message: e.message, ...(await snapshot()) }, 400)
      }
    }

    const outreachAvatarMatch = p.match(/^\/api\/runtime\/outreach\/accounts\/([^/]+)\/avatar$/)
    if (outreachAvatarMatch && method === 'GET') {
      const id = decodePathPart(outreachAvatarMatch[1])
      const file = outreach.readAvatar(id)
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

    const outreachImagesMatch = p.match(/^\/api\/runtime\/outreach\/accounts\/([^/]+)\/comment-images$/)
    if (outreachImagesMatch && method === 'POST') {
      const id = decodePathPart(outreachImagesMatch[1])
      try {
        const body = await readJson(req)
        const saved = outreach.saveCommentImages(id, body.groupId || body.id, body.type, body.files)
        return json(res, { ...saved, ...(await snapshot()) })
      } catch (e) {
        return json(res, { error: e.message, message: e.message, ...(await snapshot()) }, 400)
      }
    }

    const outreachHistoryMatch = p.match(/^\/api\/runtime\/outreach\/accounts\/([^/]+)\/history(?:\/([^/]+))?$/)
    if (outreachHistoryMatch && method === 'DELETE') {
      const id = decodePathPart(outreachHistoryMatch[1])
      const taskId = outreachHistoryMatch[2] ? decodePathPart(outreachHistoryMatch[2]) : ''
      try {
        const account = taskId
          ? outreach.deleteTaskHistory(id, taskId)
          : outreach.clearTaskHistory(id)
        return json(res, { account, ...(await snapshot()) })
      } catch (e) {
        return json(res, { error: e.message, message: e.message, ...(await snapshot()) }, 400)
      }
    }

    if (p.startsWith('/api/runtime/outreach/accounts/') && method === 'GET') {
      const rest = p.slice('/api/runtime/outreach/accounts/'.length)
      if (rest.includes('/')) return json(res, { error: 'account_not_found' }, 404)
      const id = decodePathPart(rest)
      const view = outreach.accountView(id)
      if (!view) return json(res, { error: 'account_not_found' }, 404)
      return json(res, view)
    }

    if (p.match(/^\/api\/runtime\/outreach\/accounts\/[^/]+\/settings$/) && method === 'POST') {
      const id = decodePathPart(p.split('/')[5])
      try {
        const settings = outreach.writeSettings(id, await readJson(req))
        return json(res, { settings, ...(await snapshot()) })
      } catch (e) {
        return json(res, { error: e.message, message: e.message }, 400)
      }
    }

    if (p === '/api/runtime/outreach/task/start' && method === 'POST') {
      const body = await readJson(req)
      try {
        await outreach.startTask(body.accountId || body.id, body.settings || {})
        return json(res, await snapshot())
      } catch (e) {
        return json(res, { error: e.message, message: e.message, ...(await snapshot()) }, 400)
      }
    }

    if (p === '/api/runtime/outreach/task/stop' && method === 'POST') {
      await outreach.stopTask()
      return json(res, await snapshot())
    }

    if (p === '/api/runtime/outreach/task/pause' && method === 'POST') {
      const body = await readJson(req)
      try {
        await outreach.setPaused(body.paused === true)
        return json(res, await snapshot())
      } catch (e) {
        return json(res, { error: e.message, message: e.message, ...(await snapshot()) }, 400)
      }
    }

    if (p === '/api/runtime/outreach/preview/mode' && method === 'POST') {
      const body = await readJson(req)
      try {
        await outreach.setPreviewMode(body.mode)
        return json(res, await snapshot())
      } catch (e) {
        return json(res, { error: e.message, message: e.message, ...(await snapshot()) }, 400)
      }
    }

    if (p === '/api/runtime/outreach/preview/mute' && method === 'POST') {
      const body = await readJson(req)
      try {
        await outreach.setPreviewMuted(body.muted !== false)
        return json(res, await snapshot())
      } catch (e) {
        return json(res, { error: e.message, message: e.message, ...(await snapshot()) }, 400)
      }
    }

    if (p === '/api/runtime/outreach/preview.jpg' && method === 'GET') {
      const jpeg = outreach.previewFrame()
      if (!jpeg) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ error: 'no_preview' }))
        return true
      }
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' })
      res.end(Buffer.from(jpeg, 'base64'))
      return true
    }

    if (p === '/api/runtime/outreach/preview/stream' && method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      })
      const send = () => {
        try {
          const jpeg = outreach.previewFrame()
          const preview = outreach.snapshotOutreach().preview || {}
          res.write(`data: ${JSON.stringify({
            jpeg,
            mode: preview.mode || 'window',
            available: Boolean(jpeg),
            muted: preview.muted !== false,
          })}\n\n`)
        } catch { /* closed */ }
      }
      send()
      const unsub = outreach.subscribePreview(send)
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
      const unsubOutreach = outreach.subscribe(() => { send() })
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
        unsubOutreach()
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

  return { handle, qq, store, astrbot, bot, botSuggest, botAuto, agent, customers, groupIntelligence, outreach, environment, prepareEnvironment, snapshot, shutdown }
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
