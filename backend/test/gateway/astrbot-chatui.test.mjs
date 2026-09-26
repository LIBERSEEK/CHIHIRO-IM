import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import httpProxy from 'http-proxy'
import { WebSocket, WebSocketServer } from 'ws'
import { serveAstrbotChatui, authorizeAstrbotRequest } from '../../src/gateway/astrbot-chatui.mjs'
import { ensureAstrbotReady, forwardAstrbotDashboard, rewriteAstrbotLocation, rewriteAstrbotMount } from '../../src/gateway/astrbot-proxy.mjs'

const listen = (server) => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)))
test('ChatUI assets are local, missing/encoded escaping assets never fall through to Python', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chihiro-assets-'))
  fs.writeFileSync(path.join(dir, 'chihiro-chatui.js'), 'window.ChihiroChatUI = {}')
  const server = http.createServer((req, res) => {
    if (!serveAstrbotChatui(dir, new URL(req.url, 'http://local').pathname, res)) { res.writeHead(418); res.end() }
  })
  const url = await listen(server)
  t.after(() => { server.closeAllConnections(); server.close(); fs.rmSync(dir, { recursive: true, force: true }) })
  const asset = await fetch(`${url}/astrbot/chihiro/chihiro-chatui.js`)
  assert.equal(asset.status, 200)
  assert.match(asset.headers.get('content-type'), /javascript/)
  assert.equal(asset.headers.get('cache-control'), 'no-store')
  assert.match(await asset.text(), /ChihiroChatUI/)
  for (const name of ['missing.js', '%2e%2e%2foutside.js']) assert.equal((await fetch(`${url}/astrbot/chihiro/${name}`)).status, 404)
  assert.equal((await fetch(`${url}/astrbot/chihiro-other/file.js`)).status, 418)
})

test('hosted API preserves POST streaming and authenticates HTTP and WebSocket independently of NapCat', async (t) => {
  const upstream = http.createServer((req, res) => {
    assert.equal(req.headers.authorization, 'Bearer test-astrbot-token')
    assert.equal(req.url, '/api/v1/chat/send')
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      assert.equal(body, '{"message":"test"}')
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write('data: first\n\n')
      setTimeout(() => res.end('data: last\n\n'), 30)
    })
  })
  const wsServer = new WebSocketServer({ server: upstream })
  wsServer.on('connection', (socket, req) => {
    assert.equal(req.headers.authorization, 'Bearer test-astrbot-token')
    assert.equal(new URL(req.url, 'http://local').searchParams.get('token'), 'test-astrbot-token')
    socket.send('connected')
  })
  const target = await listen(upstream)
  const proxy = httpProxy.createProxyServer({ target, ws: true })
  const astrbot = { mintDashboardToken: () => 'test-astrbot-token' }
  const gateway = http.createServer((req, res) => {
    authorizeAstrbotRequest(req, new URL(req.url, 'http://local'), astrbot)
    proxy.web(req, res)
  })
  gateway.on('upgrade', (req, socket, head) => {
    authorizeAstrbotRequest(req, new URL(req.url, 'http://local'), astrbot, { websocket: true })
    proxy.ws(req, socket, head)
  })
  const url = await listen(gateway)
  t.after(() => { proxy.close(); gateway.closeAllConnections(); gateway.close(); wsServer.close(); upstream.closeAllConnections(); upstream.close() })
  const response = await fetch(`${url}/astrbot/api/v1/chat/send`, { method: 'POST', headers: { authorization: 'Bearer unrelated-napcat-token' }, body: '{"message":"test"}' })
  assert.equal(await response.text(), 'data: first\n\ndata: last\n\n')
  const socket = new WebSocket(`${url.replace('http:', 'ws:')}/astrbot/api/v1/unified-chat/ws?token=unrelated`)
  const message = await new Promise((resolve, reject) => { socket.once('message', data => resolve(data.toString())); socket.once('error', reject) })
  assert.equal(message, 'connected')
  socket.terminate()
})

test('AstrBot proxy boundary starts AstrBot before forwarding requests', async () => {
  const order = []
  const astrbot = {
    ensure: async () => { order.push('ensure') }
  }
  const res = {
    headersSent: false,
    writeHead: () => {},
    end: () => {}
  }
  assert.equal(await ensureAstrbotReady({ astrbot, res }), true)
  order.push('proxy')
  assert.deepEqual(order, ['ensure', 'proxy'])
})

test('AstrBot proxy boundary returns a readable 503 when startup fails', async () => {
  let response
  const astrbot = {
    ensure: async () => { throw new Error('connection refused') }
  }
  const res = {
    headersSent: false,
    writeHead: (status, headers) => { response = { status, headers } },
    end: (body) => { response.body = JSON.parse(body) }
  }
  assert.equal(await ensureAstrbotReady({ astrbot, res }), false)
  assert.equal(response.status, 503)
  assert.equal(response.body.error, 'astrbot_unavailable')
  assert.match(response.body.detail, /connection refused/)
})

test('AstrBot dashboard mount rewrites root asset and API paths', () => {
  const html = rewriteAstrbotMount(`<!doctype html><html><head>
    <link rel="icon" href="/favicon.svg" />
    <script type="module" src="/assets/index.js"></script>
    <link rel="stylesheet" href="/assets/index.css">
    <style>@font-face{src:url(/assets/font.woff2)}</style>
    </head><body></body></html>`, 'text/html')
  assert.match(html, /href="\/astrbot\/favicon.svg"/)
  assert.match(html, /src="\/astrbot\/assets\/index.js"/)
  assert.match(html, /href="\/astrbot\/assets\/index.css"/)
  assert.match(html, /url\(\/astrbot\/assets\/font.woff2\)/)
  assert.match(html, /localStorage.setItem\("token","chihiro"\)/)
  assert.equal(rewriteAstrbotMount(html, 'text/html'), html)

  const js = rewriteAstrbotMount([
    'baseURL:"/api/v1"',
    'return`/api/v1/chat`',
    '`}//${host}/api/v1/live-chat/ws`',
    'new Worker("/assets/editor.worker.js")',
    'Bee=function(i){return"/"+i}',
    'dashscope.aliyuncs.com/api/v1',
  ].join('\n'), 'text/javascript')
  assert.match(js, /baseURL:"\/astrbot\/api\/v1"/)
  assert.match(js, /return`\/astrbot\/api\/v1\/chat`/)
  assert.match(js, /\$\{host\}\/astrbot\/api\/v1\/live-chat\/ws/)
  assert.match(js, /Worker\("\/astrbot\/assets\/editor.worker.js"\)/)
  assert.match(js, /return"\/astrbot\/"\+i/)
  assert.match(js, /dashscope.aliyuncs.com\/api\/v1/)
  assert.equal(rewriteAstrbotLocation('/auth/login'), '/astrbot/auth/login')
  assert.equal(rewriteAstrbotLocation('http://127.0.0.1:6185/assets/app.js'), '/astrbot/assets/app.js')
})

test('AstrBot dashboard proxy serves settings assets under /astrbot', async (t) => {
  const upstream = http.createServer((req, res) => {
    if (req.url === '/assets/app.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' })
      res.end('fetch("/api/v1/configs")')
      return
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end('<html><head><script type="module" src="/assets/app.js"></script></head><body>settings</body></html>')
  })
  const target = await listen(upstream)
  const gateway = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://local')
    if (url.pathname === '/astrbot' || url.pathname.startsWith('/astrbot/')) {
      req.url = url.pathname + url.search
      void forwardAstrbotDashboard(req, res, target)
      return
    }
    res.writeHead(404)
    res.end()
  })
  const url = await listen(gateway)
  t.after(() => { gateway.closeAllConnections(); gateway.close(); upstream.closeAllConnections(); upstream.close() })
  const page = await fetch(`${url}/astrbot/`)
  const html = await page.text()
  assert.equal(page.status, 200)
  assert.match(html, /src="\/astrbot\/assets\/app.js"/)
  const script = await fetch(`${url}/astrbot/assets/app.js`)
  assert.equal(script.status, 200)
  assert.equal(await script.text(), 'fetch("/astrbot/api/v1/configs")')
})

test('AstrBot WebSocket proxy boundary closes the socket when startup fails', async () => {
  let destroyed = false
  const astrbot = {
    ensure: async () => { throw new Error('connection refused') }
  }
  const socket = { destroyed: false, destroy: () => { destroyed = true } }
  assert.equal(await ensureAstrbotReady({ astrbot, socket }), false)
  assert.equal(destroyed, true)
})
