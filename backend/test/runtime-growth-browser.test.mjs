import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import test from 'node:test'
import {
  chromeCandidates,
  detectChromePath,
  readBrowserConfig,
  writeBrowserConfig,
} from '../src/runtime/growth-browser.mjs'

test('chrome candidates follow the host platform', () => {
  const mac = chromeCandidates('darwin')
  assert.equal(mac[0], '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
  const linux = chromeCandidates('linux')
  assert.ok(linux.includes('/usr/bin/google-chrome'))
  const win = chromeCandidates('win32', {
    PROGRAMFILES: 'C:\\Program Files',
    'PROGRAMFILES(X86)': 'C:\\Program Files (x86)',
    LOCALAPPDATA: 'C:\\Users\\chihiro\\AppData\\Local',
  })
  assert.ok(win.some((item) => item.endsWith('chrome.exe')))
})

test('detectChromePath prefers an existing override then falls back to candidates', () => {
  const files = new Set([
    '/opt/custom/chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ])
  const statSync = (filePath) => {
    if (!files.has(filePath)) throw new Error('missing')
    return { isFile: () => true }
  }
  const override = detectChromePath({ platform: 'darwin', statSync, override: '/opt/custom/chrome' })
  assert.deepEqual(override, { path: '/opt/custom/chrome', detected: true, source: 'override' })
  const detected = detectChromePath({ platform: 'darwin', statSync, override: '' })
  assert.equal(detected.source, 'detect')
  assert.equal(detected.path, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
  const missing = detectChromePath({
    platform: 'darwin',
    statSync: () => { throw new Error('missing') },
    override: '',
  })
  assert.equal(missing.detected, false)
  assert.equal(missing.source, 'hint')
})

test('browser config round-trips the executable path', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'chihiro-growth-browser-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const filePath = path.join(dir, 'browser.json')
  assert.equal(readBrowserConfig(filePath), '')
  writeBrowserConfig(filePath, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
  assert.equal(readBrowserConfig(filePath), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
  await writeFile(filePath, '{not json')
  assert.equal(readBrowserConfig(filePath), '')
})
