import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createEnvironmentService, inspectEnvironment } from '../src/runtime/environment.mjs'

function createFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chihiro-environment-'))
  const home = path.join(root, 'home')
  fs.mkdirSync(home, { recursive: true })
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return { root, home }
}

function readyRun(command, args) {
  if (command === '/usr/bin/which') return { status: 0, stdout: `/usr/bin/${args[0]}\n`, stderr: '' }
  if (args?.[0] === '--version') return { status: 0, stdout: 'Python 3.12.4\n', stderr: '' }
  return { status: 0, stdout: '', stderr: '' }
}

test('fresh installation reports repairable runtime dependencies', (t) => {
  const { root, home } = createFixture(t)
  const report = inspectEnvironment({ root, home, qqApp: path.join(root, 'QQ.app'), platform: 'darwin', arch: 'arm64', nodeVersion: '20.18.0', run: readyRun })

  assert.equal(report.status, 'user_action_required')
  assert.equal(report.checks.find((item) => item.id === 'qq').status, 'user_action_required')
  assert.equal(report.checks.find((item) => item.id === 'napcat').status, 'repairable')
  assert.equal(report.checks.find((item) => item.id === 'astrbot').status, 'repairable')
  assert.equal(report.capabilities.qq.ready, false)
  assert.equal(report.capabilities.agent.ready, false)
})

test('prepared project-owned dependencies report ready', (t) => {
  const { root, home } = createFixture(t)
  for (const rel of [
    'frontend/dist/index.html',
    'vendor/napcat/package.json',
    'vendor/astrbot/main.py',
    'vendor/astrbot/requirements.txt',
    'data/astrbot/.venv/bin/python'
  ]) {
    const file = path.join(root, rel)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, '')
  }
  const napcat = path.join(home, 'Library/Containers/com.tencent.qq/Data/Documents/napcat/napcat.mjs')
  fs.mkdirSync(path.dirname(napcat), { recursive: true })
  fs.writeFileSync(napcat, '')
  const qqApp = path.join(root, 'QQ.app')
  fs.mkdirSync(path.join(qqApp, 'Contents/MacOS'), { recursive: true })
  fs.writeFileSync(path.join(qqApp, 'Contents/MacOS/QQ'), '')

  const report = inspectEnvironment({ root, home, qqApp, platform: 'darwin', arch: 'arm64', nodeVersion: '22.0.0', run: readyRun })
  assert.equal(report.checks.find((item) => item.id === 'frontend').status, 'ready')
  assert.equal(report.checks.find((item) => item.id === 'submodules').status, 'ready')
  assert.equal(report.checks.find((item) => item.id === 'napcat').status, 'ready')
  assert.equal(report.checks.find((item) => item.id === 'astrbot').status, 'ready')
})

test('unsupported platforms do not offer runtime repair', (t) => {
  const { root, home } = createFixture(t)
  const report = inspectEnvironment({ root, home, qqApp: path.join(root, 'QQ.app'), platform: 'linux', arch: 'x64', nodeVersion: '22.0.0', run: readyRun })
  assert.equal(report.status, 'unsupported')
  assert.equal(report.checks.find((item) => item.id === 'napcat').repairable, false)
  assert.equal(report.checks.find((item) => item.id === 'astrbot').status, 'unsupported')
})

test('repair provisions pinned runtimes in a clean home with mocked downloads', async (t) => {
  const { root, home } = createFixture(t)
  for (const rel of [
    'frontend/dist/index.html',
    'vendor/napcat/package.json',
    'vendor/astrbot/main.py',
    'vendor/astrbot/requirements.txt'
  ]) {
    const file = path.join(root, rel)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, rel.endsWith('requirements.txt') ? 'example==1.0\n' : '')
  }
  const qqApp = path.join(root, 'QQ.app')
  fs.mkdirSync(path.join(qqApp, 'Contents/MacOS'), { recursive: true })
  fs.writeFileSync(path.join(qqApp, 'Contents/MacOS/QQ'), '')

  const archives = path.join(root, 'archives')
  const napcatSource = path.join(archives, 'napcat-source')
  fs.mkdirSync(napcatSource, { recursive: true })
  fs.writeFileSync(path.join(napcatSource, 'napcat.mjs'), 'export default {}\n')
  const napcatArchive = path.join(archives, 'napcat.zip')
  assert.equal(spawnSync('zip', ['-q', napcatArchive, 'napcat.mjs'], { cwd: napcatSource }).status, 0)

  const uvSource = path.join(archives, 'uv-aarch64-apple-darwin')
  fs.mkdirSync(uvSource, { recursive: true })
  fs.writeFileSync(path.join(uvSource, 'uv'), '#!/bin/sh\n')
  const uvArchive = path.join(archives, 'uv.tar.gz')
  assert.equal(spawnSync('tar', ['-czf', uvArchive, '-C', archives, path.basename(uvSource)]).status, 0)

  const digest = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  fs.mkdirSync(path.join(root, 'config'), { recursive: true })
  fs.writeFileSync(path.join(root, 'config/runtime-manifest.json'), JSON.stringify({
    napcat: { version: 'test', url: 'https://example.test/napcat.zip', sha256: digest(napcatArchive), archive: 'zip' },
    uv: {
      version: 'test',
      'darwin-arm64': { url: 'https://example.test/uv.tar.gz', sha256: digest(uvArchive), archive: 'tar.gz' }
    },
    python: '3.12'
  }))

  const downloads = new Map([
    ['https://example.test/napcat.zip', fs.readFileSync(napcatArchive)],
    ['https://example.test/uv.tar.gz', fs.readFileSync(uvArchive)]
  ])
  const fetchImpl = async (url) => new Response(downloads.get(String(url)), { status: downloads.has(String(url)) ? 200 : 404 })
  const run = (command, args = [], options = {}) => {
    if (command === '/usr/bin/which') return { status: 0, stdout: `/usr/bin/${args[0]}\n`, stderr: '' }
    if (command === 'unzip' || command === 'tar') return spawnSync(command, args, { encoding: 'utf8', ...options })
    if (command.endsWith('/uv') && args[0] === '--version') return { status: 0, stdout: 'uv test\n', stderr: '' }
    if (command.endsWith('/uv') && args[0] === 'venv') {
      const venv = args.at(-1)
      fs.mkdirSync(path.join(venv, 'bin'), { recursive: true })
      fs.writeFileSync(path.join(venv, 'bin/python'), '#!/bin/sh\n')
      return { status: 0, stdout: '', stderr: '' }
    }
    if (command.endsWith('/uv') && args[0] === 'pip') return { status: 0, stdout: '', stderr: '' }
    if (command.endsWith('/python') && args[0] === '--version') return { status: 0, stdout: 'Python 3.12.4\n', stderr: '' }
    return { status: 0, stdout: '', stderr: '' }
  }

  const service = createEnvironmentService({ root, home, qqApp, platform: 'darwin', arch: 'arm64', run, fetchImpl })
  const report = await service.repair()
  assert.deepEqual(report.repaired.sort(), ['astrbot', 'napcat'])
  assert.deepEqual(report.errors, [])
  assert.equal(report.ready, true)
  assert.equal(fs.existsSync(path.join(home, 'Library/Containers/com.tencent.qq/Data/Documents/napcat/napcat.mjs')), true)
  assert.equal(fs.existsSync(path.join(root, 'data/astrbot/.venv/bin/python')), true)
})
