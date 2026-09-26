import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'config/chihiro.default.json'), 'utf8'))
const localPath = path.join(root, 'config/chihiro.local.json')
if (fs.existsSync(localPath)) {
  const local = JSON.parse(fs.readFileSync(localPath, 'utf8'))
  Object.assign(cfg.napcat, local.napcat || {})
  Object.assign(cfg.astrbot, local.astrbot || {})
}

let failed = false

async function check(name, url, options = {}) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 2000)
  try {
    const response = await fetch(url, { headers: options.headers || {}, signal: ctrl.signal, redirect: 'manual' })
    let body = null
    try { body = await response.clone().json() } catch { /* not JSON */ }
    const validStatus = options.statuses?.includes(response.status) ?? response.ok
    const validBody = options.validate ? options.validate(body, response) : true
    if (!validStatus || !validBody) {
      failed = true
      console.log(`${name.padEnd(16)} FAIL ${response.status}  ${url}`)
      return { ok: false, status: response.status, body }
    }
    console.log(`${name.padEnd(16)} OK   ${response.status}  ${url}`)
    return { ok: true, status: response.status, body }
  } catch (error) {
    if (options.optional) {
      console.log(`${name.padEnd(16)} IDLE ${url}`)
      return { ok: true, idle: true }
    }
    failed = true
    console.log(`${name.padEnd(16)} DOWN ${url}  (${error.message})`)
    return { ok: false, error }
  } finally {
    clearTimeout(timer)
  }
}

const gateway = await check('gateway-live', `http://${cfg.gateway.host}:${cfg.gateway.port}/api/status`, {
  statuses: [200],
  validate: (body) => body?.service === 'chihiro'
})
await check('gateway-ready', `http://${cfg.gateway.host}:${cfg.gateway.port}/api/ready`, {
  statuses: [200],
  validate: (body) => body?.ready === true
})
const online = gateway?.body?.runtime?.accounts?.accounts?.find((account) => account.online)
const webui = online?.ports?.webui ? `http://127.0.0.1:${online.ports.webui}` : cfg.napcat.webui
await check('napcat-webui', `${webui}/webui/`, { optional: true, statuses: [200, 302] })
if (online?.ports?.http) {
  const token = process.env.CHIHIRO_ONEBOT_HTTP_TOKEN || online.tokens?.http || cfg.napcat.onebotHttpToken
  await check('onebot-http', `http://127.0.0.1:${online.ports.http}/get_login_info`, {
    statuses: [200],
    headers: token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' },
    validate: (body) => body?.status === 'ok' || body?.retcode === 0 || body?.data?.user_id
  })
} else {
  console.log(`${'onebot-http'.padEnd(16)} IDLE no online QQ account`)
}
await check('astrbot', cfg.astrbot.url, { optional: true, statuses: [200, 302, 307] })

if (failed) process.exitCode = 1
