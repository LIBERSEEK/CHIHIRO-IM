import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import test from 'node:test'
import { createAccountStore } from '../src/runtime/accounts.mjs'
import { createGrowthRuntime } from '../src/runtime/growth.mjs'
import { createGrowthPreview } from '../src/runtime/growth-preview.mjs'

function fakePage() {
  const sent = []
  let frameHandler
  const cdp = {
    sent,
    on(event, fn) {
      if (event === 'Page.screencastFrame') frameHandler = fn
    },
    async send(method, params) {
      sent.push({ method, params })
      if (method === 'Browser.getWindowForTarget') return { windowId: 9 }
      return {}
    },
    async detach() {
      sent.push({ method: 'detach' })
    },
    emitFrame(data) {
      return frameHandler?.({ data, sessionId: 1 })
    },
  }
  return {
    cdp,
    page: {
      evaluated: [],
      context() {
        return { newCDPSession: async () => cdp }
      },
      async evaluate(fn, arg) {
        this.evaluated.push(arg)
        if (typeof fn === 'function') {
          const video = { muted: false, pause() { this.paused = true }, paused: false }
          globalThis.document = { querySelectorAll: () => [video] }
          globalThis.HTMLMediaElement = { prototype: { play() { return Promise.resolve() } } }
          globalThis.MutationObserver = class { observe() {} }
          fn(arg)
        }
      },
    },
  }
}

test('growth preview stores screencast frames and toggles the Chrome window', async () => {
  const preview = createGrowthPreview()
  const { page, cdp } = fakePage()
  preview.subscribe(() => {})
  await preview.attach(page)
  assert.equal(preview.snapshot().mode, 'window')
  assert.equal(preview.snapshot().available, false)
  assert.ok(cdp.sent.some((item) => item.method === 'Page.startScreencast'))
  assert.equal(preview.snapshot().muted, true)
  assert.ok(cdp.sent.some((item) => item.method === 'Page.setAudioMuted' && item.params.muted === true))
  await preview.setMuted(false)
  assert.equal(preview.snapshot().muted, false)
  const unmuted = cdp.sent.filter((item) => item.method === 'Page.setAudioMuted').at(-1)
  assert.equal(unmuted.params.muted, false)
  await preview.setPlayback('paused')
  assert.equal(preview.snapshot().paused, true)
  await cdp.emitFrame(Buffer.from('jpeg-bytes').toString('base64'))
  assert.equal(preview.snapshot().available, true)
  assert.equal(preview.frame(), Buffer.from('jpeg-bytes').toString('base64'))
  assert.ok(cdp.sent.some((item) => item.method === 'Page.screencastFrameAck'))
  await preview.setMode('pip')
  assert.equal(preview.snapshot().mode, 'pip')
  const hidden = cdp.sent.find((item) => item.method === 'Browser.setWindowBounds')
  assert.equal(hidden.params.windowId, 9)
  assert.equal(hidden.params.bounds.windowState, 'minimized')
  await preview.setMode('window')
  const shown = cdp.sent.filter((item) => item.method === 'Browser.setWindowBounds').at(-1)
  assert.equal(shown.params.bounds.windowState, 'normal')
  assert.equal(shown.params.bounds.left, 80)
  await preview.detach()
  assert.equal(preview.snapshot().available, false)
  assert.equal(preview.snapshot().mode, 'window')
  assert.equal(preview.frame(), '')
  assert.ok(cdp.sent.some((item) => item.method === 'Page.stopScreencast'))
})

test('growth runtime attaches the preview when a feed task is ready', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'chihiro-growth-preview-runtime-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const chrome = path.join(root, 'fake-chrome')
  fs.writeFileSync(chrome, '#!/bin/sh\n')
  fs.chmodSync(chrome, 0o755)
  const { page, cdp } = fakePage()
  let release
  const growth = createGrowthRuntime({
    root,
    store: createAccountStore(path.join(root, 'data', 'accounts.json')),
    loginWaiter: async () => ({
      storageState: { cookies: [{ name: 'sessionid', value: 'sess' }] },
      nickname: '创作者',
      uid: 'u1',
      avatar: '',
    }),
    feedRunner: async ({ onReady, shouldStop, shouldPause }) => {
      await onReady({ page })
      await cdp.emitFrame(Buffer.from('task-frame').toString('base64'))
      while (shouldPause()) {
        if (shouldStop()) throw new Error('Task stopped')
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      await new Promise((resolve) => { release = resolve })
      if (shouldStop()) throw new Error('Task stopped')
      return { commented: 0, scanned: 1 }
    },
  })
  growth.setBrowserPath(chrome)
  growth.prepareNew()
  const account = await growth.login({ browserPath: chrome })
  await growth.startTask(account.id, { comments: ['学到了'], maxCount: 1 })
  for (let i = 0; i < 40 && !growth.snapshotGrowth().preview.available; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.equal(growth.snapshotGrowth().preview.available, true)
  assert.equal(growth.snapshotGrowth().preview.mode, 'window')
  assert.equal(growth.snapshotGrowth().preview.muted, true)
  assert.equal(growth.previewFrame(), Buffer.from('task-frame').toString('base64'))
  await growth.setPaused(true)
  assert.equal(growth.snapshotGrowth().task.paused, true)
  assert.equal(growth.snapshotGrowth().task.status, 'paused')
  await growth.setPaused(false)
  assert.equal(growth.snapshotGrowth().task.paused, false)
  assert.equal(growth.snapshotGrowth().task.status, 'running')
  await growth.setPreviewMuted(false)
  assert.equal(growth.snapshotGrowth().preview.muted, false)
  await growth.setPreviewMode('pip')
  assert.equal(growth.snapshotGrowth().preview.mode, 'pip')
  const hidden = cdp.sent.find((item) => item.method === 'Browser.setWindowBounds')
  assert.equal(hidden.params.bounds.windowState, 'minimized')
  release()
  await growth.stopTask()
  assert.equal(growth.snapshotGrowth().preview.available, false)
})
