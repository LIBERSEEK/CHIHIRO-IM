import http from 'node:http'
import { logError } from '../runtime/log.mjs'

const SESSION_BOOT = '<script>try{if(!localStorage.getItem("token"))localStorage.setItem("token","chihiro");if(!localStorage.getItem("user"))localStorage.setItem("user","astrbot")}catch(e){}</script>'

export function shouldRewriteAstrbot(contentType = '') {
  return /text\/html|text\/css|javascript|ecmascript/i.test(String(contentType))
}

export function rewriteAstrbotLocation(value) {
  const raw = String(value || '')
  if (!raw || raw.startsWith('/astrbot/') || raw === '/astrbot') return raw
  if (raw.startsWith('/')) return `/astrbot${raw}`
  try {
    const url = new URL(raw)
    if (url.pathname.startsWith('/astrbot/') || url.pathname === '/astrbot') return raw
    return `/astrbot${url.pathname}${url.search}${url.hash}`
  } catch {
    return raw
  }
}

export function rewriteAstrbotMount(body, contentType = '') {
  const type = String(contentType).toLowerCase()
  const html = type.includes('text/html')
  const css = type.includes('text/css')
  const js = type.includes('javascript') || type.includes('ecmascript')
  let out = String(body ?? '')
  if (html || css) {
    out = out
      .replaceAll('url(/assets/', 'url(/astrbot/assets/')
      .replaceAll('url("/assets/', 'url("/astrbot/assets/')
      .replaceAll("url('/assets/", "url('/astrbot/assets/")
      .replaceAll('href="/assets/', 'href="/astrbot/assets/')
      .replaceAll('src="/assets/', 'src="/astrbot/assets/')
      .replaceAll('href="/favicon', 'href="/astrbot/favicon')
  }
  if (html || js) {
    out = out
      .replaceAll('"/api/', '"/astrbot/api/')
      .replaceAll('`/api/', '`/astrbot/api/')
      .replaceAll(/\$\{[A-Za-z_$][\w$]*\}\/api\//g, (match) => match.replace('/api/', '/astrbot/api/'))
      .replaceAll('"/assets/', '"/astrbot/assets/')
      .replaceAll('return"/"+', 'return"/astrbot/"+')
  }
  if (html && out.includes('<head>') && !out.includes('localStorage.setItem("token","chihiro")')) {
    out = out.replace('<head>', `<head>${SESSION_BOOT}`)
  }
  return out
}

function dashboardHeaders(upstreamRes, extra = {}) {
  const headers = { ...upstreamRes.headers, ...extra }
  delete headers['transfer-encoding']
  delete headers.connection
  delete headers['keep-alive']
  delete headers['content-encoding']
  return headers
}

function upstreamRequest(target, req) {
  const incoming = new URL(req.url || '/', 'http://gateway.local')
  const path = (incoming.pathname.replace(/^\/astrbot(?=\/|$)/, '') || '/') + incoming.search
  const base = new URL(target)
  const headers = { ...req.headers, host: base.host }
  delete headers['accept-encoding']
  return {
    path,
    request: http.request({
      protocol: base.protocol,
      hostname: base.hostname,
      port: base.port,
      method: req.method,
      path,
      headers,
    }),
  }
}

export function forwardAstrbotDashboard(req, res, target) {
  return new Promise((resolve) => {
    let upstreamReq
    try {
      upstreamReq = upstreamRequest(target, req).request
    } catch (error) {
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ error: 'bad_gateway', message: error.message }))
      }
      resolve()
      return
    }
    upstreamReq.on('error', (error) => {
      logError('gw', 'astrbot dashboard', error.message)
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ error: 'bad_gateway', message: error.message }))
      } else {
        res.destroy()
      }
      resolve()
    })
    upstreamReq.on('response', (upstreamRes) => {
      const type = String(upstreamRes.headers['content-type'] || '')
      if (upstreamRes.headers.location) {
        upstreamRes.headers.location = rewriteAstrbotLocation(upstreamRes.headers.location)
      }
      if (!shouldRewriteAstrbot(type)) {
        res.writeHead(upstreamRes.statusCode || 502, dashboardHeaders(upstreamRes))
        upstreamRes.pipe(res)
        upstreamRes.on('end', resolve)
        return
      }
      const chunks = []
      upstreamRes.on('data', (chunk) => chunks.push(chunk))
      upstreamRes.on('end', () => {
        const rewritten = rewriteAstrbotMount(Buffer.concat(chunks).toString('utf8'), type)
        const body = Buffer.from(rewritten)
        const headers = dashboardHeaders(upstreamRes, { 'content-length': body.length, 'cache-control': 'no-store' })
        res.writeHead(upstreamRes.statusCode || 200, headers)
        res.end(body)
        resolve()
      })
    })
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'DELETE') upstreamReq.end()
    else req.pipe(upstreamReq)
  })
}

function unavailableMessage(error) {
  return error?.message || 'AstrBot 当前不可用'
}

export async function ensureAstrbotReady({ astrbot, res, socket } = {}) {
  try {
    await astrbot.ensure()
    return true
  } catch (error) {
    const message = unavailableMessage(error)
    logError('gw', 'astrbot ensure', message)

    if (res && !res.headersSent) {
      res.writeHead(503, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      })
      res.end(JSON.stringify({
        error: 'astrbot_unavailable',
        message: 'AstrBot 当前不可用，请稍后重试',
        detail: message
      }))
    }

    if (socket && !socket.destroyed) socket.destroy()
    return false
  }
}
