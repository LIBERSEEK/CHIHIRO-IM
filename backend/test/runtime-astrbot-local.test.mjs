import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createAstrbotRuntime } from '../src/runtime/astrbot.mjs'

test('local mode reports a missing AstrBot executable without crashing the gateway', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chihiro-astrbot-local-'))
  const previous = process.env.ASTRBOT_BIN
  const missing = path.join(root, 'missing-astrbot')
  process.env.ASTRBOT_BIN = missing
  t.after(() => {
    if (previous === undefined) delete process.env.ASTRBOT_BIN
    else process.env.ASTRBOT_BIN = previous
    fs.rmSync(root, { recursive: true, force: true })
  })

  const runtime = createAstrbotRuntime({
    root,
    cfg: { astrbot: { dataDir: 'data/astrbot', port: 6198 } }
  })

  await assert.rejects(runtime.ensure(), new RegExp(`AstrBot 启动命令不存在：${missing}`))
  assert.equal(runtime.status().running, false)
  assert.equal(runtime.status().owned, false)
  assert.match(runtime.status().error, /AstrBot 启动命令不存在/)
})
