import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const growthServer = fileURLToPath(new URL('../src/mcp/growth-server.mjs', import.meta.url))
const qqServer = fileURLToPath(new URL('../src/mcp/server.mjs', import.meta.url))

function spawnServer(script) {
  return spawn(process.execPath, [script], { stdio: ['pipe', 'pipe', 'pipe'] })
}

function lineReader(stream) {
  let buf = ''
  const waiters = []
  stream.setEncoding('utf8')
  stream.on('data', (chunk) => {
    buf += chunk
    pump()
  })
  function pump() {
    while (waiters.length && buf.includes('\n')) {
      const index = buf.indexOf('\n')
      const line = buf.slice(0, index).replace(/\r$/, '')
      buf = buf.slice(index + 1)
      const waiter = waiters.shift()
      clearTimeout(waiter.timer)
      waiter.resolve(line)
    }
  }
  return () => new Promise((resolve, reject) => {
    if (buf.includes('\n')) {
      const index = buf.indexOf('\n')
      const line = buf.slice(0, index).replace(/\r$/, '')
      buf = buf.slice(index + 1)
      resolve(line)
      return
    }
    const timer = setTimeout(() => reject(new Error(`timed out waiting for a JSON line: ${buf.slice(0, 180)}`)), 4000)
    waiters.push({ resolve, timer })
  })
}

function frame(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8')
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body])
}

function contentReader(stream) {
  let buf = Buffer.alloc(0)
  const waiters = []
  stream.on('data', (chunk) => {
    buf = Buffer.concat([buf, Buffer.from(chunk)])
    pump()
  })
  function take() {
    const headerEnd = buf.indexOf('\r\n\r\n')
    if (headerEnd < 0) return null
    const match = buf.slice(0, headerEnd).toString('utf8').match(/Content-Length:\s*(\d+)/i)
    if (!match) return null
    const length = Number(match[1])
    const start = headerEnd + 4
    if (buf.length < start + length) return null
    const body = buf.slice(start, start + length).toString('utf8')
    buf = buf.slice(start + length)
    return body
  }
  function pump() {
    while (waiters.length) {
      const body = take()
      if (body == null) return
      const waiter = waiters.shift()
      clearTimeout(waiter.timer)
      waiter.resolve(body)
    }
  }
  return () => new Promise((resolve, reject) => {
    const ready = take()
    if (ready != null) {
      resolve(ready)
      return
    }
    const timer = setTimeout(() => reject(new Error('timed out waiting for a Content-Length frame')), 4000)
    waiters.push({ resolve, timer })
  })
}

async function stop(child) {
  child.kill('SIGTERM')
  await new Promise((resolve) => {
    child.once('exit', resolve)
    setTimeout(resolve, 1000)
  })
}

test('growth server answers newline JSON-RPC with only the three growth tools', async () => {
  const child = spawnServer(growthServer)
  const read = lineReader(child.stdout)
  try {
    child.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '0' } },
    })}\n`)
    const init = JSON.parse(await read())
    assert.equal(init.result.protocolVersion, '2025-11-25')
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`)
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`)
    const listed = JSON.parse(await read())
    assert.deepEqual(listed.result.tools.map((tool) => tool.name), ['growth_schema', 'growth_draft', 'growth_get'])
    child.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'growth_schema', arguments: {} },
    })}\n`)
    const called = JSON.parse(await read())
    const payload = JSON.parse(called.result.content[0].text)
    assert.equal(payload.kind, 'chihiro.card')
    assert.equal(payload.schema.fields.some((field) => field.key === 'audience'), true)
  } finally {
    await stop(child)
  }
})

test('qq server still answers Content-Length and lists underscore growth tools', async () => {
  const child = spawnServer(qqServer)
  const read = contentReader(child.stdout)
  try {
    child.stdin.write(frame({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05' },
    }))
    const init = JSON.parse(await read())
    assert.equal(init.result.protocolVersion, '2024-11-05')
    assert.match(init.result.instructions, /growth_schema/)
    child.stdin.write(frame({ jsonrpc: '2.0', id: 2, method: 'tools/list' }))
    const names = JSON.parse(await read()).result.tools.map((tool) => tool.name)
    assert.equal(names.includes('observe'), true)
    assert.equal(names.includes('growth_schema'), true)
    assert.equal(names.includes('growth.schema'), false)
    assert.equal(names.includes('growth_start'), false)
  } finally {
    await stop(child)
  }
})
