import { stdin as defaultStdin, stdout as defaultStdout } from 'node:process'

const SUPPORTED_PROTOCOL_VERSIONS = new Set(['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'])

export function createMcpHandler({ serverInfo, instructions, tools, callTool }) {
  return async function onMessage(raw) {
    let msg
    try {
      msg = JSON.parse(raw)
    } catch {
      return { jsonrpc: '2.0', error: { code: -32700, message: 'parse error' }, id: null }
    }
    const { id, method, params } = msg
    if (method === 'initialize') {
      const requested = params?.protocolVersion
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.has(requested) ? requested : '2025-03-26',
          capabilities: { tools: { listChanged: false } },
          instructions,
          serverInfo,
        },
      }
    }
    if (typeof method === 'string' && method.startsWith('notifications/')) return null
    if (method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools } }
    if (method === 'tools/call') {
      try {
        const result = await callTool(params?.name, params?.arguments || {})
        return {
          jsonrpc: '2.0',
          id,
          result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] },
        }
      } catch (error) {
        return {
          jsonrpc: '2.0',
          id,
          result: { isError: true, content: [{ type: 'text', text: error.message || String(error) }] },
        }
      }
    }
    if (method === 'ping') return { jsonrpc: '2.0', id, result: {} }
    return { jsonrpc: '2.0', id, error: { code: -32601, message: `unknown method ${method}` } }
  }
}

// AstrBot speaks newline JSON-RPC. Codex and Claude speak Content-Length. Answer in the framing the client opened with.
export function serveMcp(onMessage, { stdin = defaultStdin, stdout = defaultStdout } = {}) {
  let buf = Buffer.alloc(0)
  let mode = null
  let idle = Promise.resolve()

  function write(msg) {
    const json = JSON.stringify(msg)
    if (mode === 'line') {
      stdout.write(`${json}\n`)
      return
    }
    const body = Buffer.from(json, 'utf8')
    stdout.write(`Content-Length: ${body.length}\r\n\r\n`)
    stdout.write(body)
  }

  function dispatch(raw) {
    idle = idle.then(async () => {
      try {
        const response = await onMessage(raw)
        if (response) write(response)
      } catch (error) {
        write({ jsonrpc: '2.0', error: { code: -32603, message: error.message || String(error) }, id: null })
      }
    })
  }

  function pump() {
    while (buf.length) {
      const detected = mode || detectFraming(buf)
      if (!detected) return
      if (!mode) mode = detected
      if (mode === 'line') {
        const nl = buf.indexOf(0x0a)
        if (nl < 0) return
        const line = buf.slice(0, nl).toString('utf8').replace(/\r$/, '')
        buf = buf.slice(nl + 1)
        if (!line.trim()) continue
        dispatch(line)
        continue
      }
      const headerEnd = buf.indexOf('\r\n\r\n')
      if (headerEnd < 0) return
      const header = buf.slice(0, headerEnd).toString('utf8')
      const match = header.match(/Content-Length:\s*(\d+)/i)
      if (!match) {
        buf = buf.slice(headerEnd + 4)
        continue
      }
      const len = Number(match[1])
      const start = headerEnd + 4
      if (buf.length < start + len) return
      const body = buf.slice(start, start + len).toString('utf8')
      buf = buf.slice(start + len)
      dispatch(body)
    }
  }

  stdin.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk])
    pump()
  })
  stdin.on('end', () => {
    idle.finally(() => {
      stdout.end()
    })
  })
  stdin.resume()
}

function detectFraming(buf) {
  let index = 0
  while (index < buf.length && (buf[index] === 0x20 || buf[index] === 0x09 || buf[index] === 0x0d || buf[index] === 0x0a)) index += 1
  if (index >= buf.length) return null
  if (buf[index] === 0x7b) return 'line'
  const head = buf.slice(index, Math.min(buf.length, index + 32)).toString('utf8').toLowerCase()
  if (head.startsWith('content-length:')) return 'lsp'
  if (head.length < 15 && !head.includes('\n')) return null
  return 'line'
}
