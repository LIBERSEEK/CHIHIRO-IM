import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const QQ_APP = '/Applications/QQ.app'
const REQUIRED_TOOLS = ['codesign', 'plutil', 'ditto', 'xattr', 'rsync', 'unzip', 'tar']
const STATUS_WEIGHT = { ready: 0, repairable: 1, user_action_required: 2, unsupported: 3 }

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

function defaultRun(command, args = [], options = {}) {
  return spawnSync(command, args, { encoding: 'utf8', ...options })
}

function successful(result) {
  return result && result.status === 0 && !result.error
}

function commandExists(command, run) {
  return successful(run('/usr/bin/which', [command]))
}

function resultVersion(command, args, run) {
  const result = run(command, args)
  if (!successful(result)) return ''
  return String(result.stdout || result.stderr || '').trim().split('\n')[0]
}

function major(version) {
  return Number(String(version).replace(/^v/, '').split('.')[0]) || 0
}

function pythonSupported(version) {
  const match = String(version).match(/(\d+)\.(\d+)/)
  return Boolean(match && (Number(match[1]) > 3 || (Number(match[1]) === 3 && Number(match[2]) >= 10)))
}

function check(id, label, status, message, options = {}) {
  return {
    id,
    label,
    status,
    message,
    blocking: options.blocking !== false,
    repairable: status === 'repairable',
    capability: options.capability || 'core',
    ...(options.detail ? { detail: options.detail } : {})
  }
}

function overallStatus(checks) {
  return checks.reduce((current, item) => (
    STATUS_WEIGHT[item.status] > STATUS_WEIGHT[current] ? item.status : current
  ), 'ready')
}

function capability(checks, name) {
  const relevant = checks.filter((item) => item.blocking && (item.capability === 'core' || item.capability === name))
  const status = overallStatus(relevant)
  return { status, ready: status === 'ready' }
}

function napcatHome(home) {
  return path.join(home, 'Library/Containers/com.tencent.qq/Data/Documents/napcat')
}

function runtimeManifest(root) {
  const manifest = readJson(path.join(root, 'config/runtime-manifest.json'))
  if (!manifest?.napcat?.sha256 || !manifest?.uv) throw new Error('运行时版本清单缺失或无效')
  return manifest
}

export function inspectEnvironment(options) {
  const {
    root,
    home = os.homedir(),
    platform = process.platform,
    arch = process.arch,
    nodeVersion = process.versions.node,
    qqApp = QQ_APP,
    run = defaultRun
  } = options
  const checks = []
  const supported = platform === 'darwin' && (arch === 'arm64' || arch === 'x64')
  checks.push(check(
    'platform', '系统与架构', supported ? 'ready' : 'unsupported',
    supported ? `macOS ${arch}` : `本机 QQ 运行时仅支持 macOS arm64/x64（检测到 ${platform} ${arch}）`,
    { capability: 'qq' }
  ))
  checks.push(check(
    'node', 'Node.js', major(nodeVersion) >= 20 ? 'ready' : 'user_action_required',
    major(nodeVersion) >= 20 ? `Node.js ${nodeVersion}` : `需要 Node.js 20 或更高版本（当前 ${nodeVersion}）`
  ))

  const missingTools = platform === 'darwin'
    ? REQUIRED_TOOLS.filter((tool) => !commandExists(tool, run))
    : REQUIRED_TOOLS
  checks.push(check(
    'macos_tools', 'macOS 系统工具', missingTools.length ? 'user_action_required' : 'ready',
    missingTools.length ? `缺少：${missingTools.join('、')}` : '签名、复制和解压工具可用',
    { capability: 'qq' }
  ))

  const qqExists = fs.existsSync(path.join(qqApp, 'Contents/MacOS/QQ'))
  checks.push(check(
    'qq', 'QQ', qqExists ? 'ready' : 'user_action_required',
    qqExists ? '已安装官方 QQ' : `请先将官方 QQ 安装到 ${qqApp}`,
    { capability: 'qq' }
  ))

  const napcatDir = napcatHome(home)
  const napcatReady = fs.existsSync(path.join(napcatDir, 'napcat.mjs'))
  checks.push(check(
    'napcat', 'NapCat', napcatReady ? 'ready' : (supported ? 'repairable' : 'unsupported'),
    napcatReady ? `运行时已安装：${napcatDir}` : '缺少 NapCat，千寻可以自动下载并校验安装',
    { capability: 'qq', detail: napcatDir }
  ))

  const submodulesReady = [
    'vendor/napcat/package.json',
    'vendor/astrbot/main.py',
    'vendor/astrbot/requirements.txt'
  ].every((rel) => fs.existsSync(path.join(root, rel)))
  checks.push(check(
    'submodules', '运行时源码', submodulesReady ? 'ready' : 'repairable',
    submodulesReady ? 'NapCat 与 AstrBot 源码已初始化' : 'Git submodule 尚未完整初始化'
  ))

  const webReady = fs.existsSync(path.join(root, 'frontend/dist/index.html'))
  checks.push(check(
    'frontend', '工作台前端', webReady ? 'ready' : 'repairable',
    webReady ? '工作台构建产物可用' : '工作台尚未构建'
  ))

  const venvPython = path.join(root, 'data/astrbot/.venv/bin/python')
  const requirements = path.join(root, 'vendor/astrbot/requirements.txt')
  const envMarker = readJson(path.join(root, 'data/astrbot/.chihiro-env.json'))
  const requirementsSha256 = fs.existsSync(requirements)
    ? createHash('sha256').update(fs.readFileSync(requirements)).digest('hex')
    : ''
  const pythonReady = fs.existsSync(venvPython)
    && pythonSupported(resultVersion(venvPython, ['--version'], run))
  const astrbotReady = pythonReady
    && (!envMarker?.requirementsSha256 || envMarker.requirementsSha256 === requirementsSha256)
  checks.push(check(
    'astrbot', 'Agent 运行环境', astrbotReady ? 'ready' : (supported ? 'repairable' : 'unsupported'),
    astrbotReady
      ? resultVersion(venvPython, ['--version'], run)
      : (pythonReady ? 'AstrBot 依赖已变化，千寻可以自动同步' : '缺少隔离的 AstrBot Python 环境，千寻可以自动创建'),
    { capability: 'agent', detail: venvPython }
  ))

  const status = overallStatus(checks.filter((item) => item.blocking))
  return {
    status,
    ready: status === 'ready',
    checkedAt: new Date().toISOString(),
    platform: { os: platform, arch },
    capabilities: {
      gateway: capability(checks, 'gateway'),
      qq: capability(checks, 'qq'),
      agent: capability(checks, 'agent')
    },
    checks
  }
}

async function downloadVerified(asset, destination, fetchImpl) {
  const response = await fetchImpl(asset.url, { redirect: 'follow', signal: AbortSignal.timeout(120000) })
  if (!response.ok) throw new Error(`下载失败：HTTP ${response.status} ${asset.url}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  const actual = createHash('sha256').update(bytes).digest('hex')
  if (actual !== asset.sha256) throw new Error(`下载校验失败：期望 ${asset.sha256}，实际 ${actual}`)
  fs.writeFileSync(destination, bytes)
}

function runChecked(run, command, args, options = {}) {
  const result = run(command, args, options)
  if (!successful(result)) {
    const detail = String(result?.stderr || result?.stdout || result?.error?.message || '').trim()
    throw new Error(`${command} 执行失败${detail ? `：${detail}` : ''}`)
  }
  return result
}

function findFile(dir, name) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const candidate = path.join(dir, entry.name)
    if (entry.isFile() && entry.name === name) return candidate
    if (entry.isDirectory()) {
      const found = findFile(candidate, name)
      if (found) return found
    }
  }
  return null
}

function uniqueSibling(target, suffix) {
  return path.join(path.dirname(target), `.${path.basename(target)}.${suffix}-${process.pid}-${Date.now()}`)
}

function atomicInstallDirectory(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const staged = uniqueSibling(target, 'installing')
  fs.cpSync(source, staged, { recursive: true, errorOnExist: true })
  let backup = null
  try {
    if (fs.existsSync(target)) {
      backup = uniqueSibling(target, 'backup')
      fs.renameSync(target, backup)
    }
    fs.renameSync(staged, target)
  } catch (error) {
    if (backup && !fs.existsSync(target) && fs.existsSync(backup)) fs.renameSync(backup, target)
    throw error
  }
  return backup
}

async function installNapcat({ root, home, manifest, run, fetchImpl }) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'chihiro-napcat-'))
  const archive = path.join(temp, 'napcat.zip')
  const extracted = path.join(temp, 'runtime')
  fs.mkdirSync(extracted)
  await downloadVerified(manifest.napcat, archive, fetchImpl)
  runChecked(run, 'unzip', ['-q', archive, '-d', extracted])
  if (!fs.existsSync(path.join(extracted, 'napcat.mjs'))) throw new Error('NapCat 压缩包内容无效：缺少 napcat.mjs')
  const target = napcatHome(home)
  const backup = atomicInstallDirectory(extracted, target)
  fs.writeFileSync(path.join(target, '.chihiro-runtime.json'), JSON.stringify({
    version: manifest.napcat.version,
    sha256: manifest.napcat.sha256,
    installedAt: new Date().toISOString(),
    source: manifest.napcat.url
  }, null, 2) + '\n')
  return { target, backup }
}

async function ensureUv({ root, platform, arch, manifest, run, fetchImpl }) {
  const target = path.join(root, '.cache/uv-bin/uv')
  if (fs.existsSync(target) && successful(run(target, ['--version']))) return target
  const asset = manifest.uv[`${platform}-${arch}`]
  if (!asset) throw new Error(`没有适用于 ${platform}-${arch} 的 uv 运行时`)
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'chihiro-uv-'))
  const archive = path.join(temp, 'uv.tar.gz')
  const extracted = path.join(temp, 'runtime')
  fs.mkdirSync(extracted)
  await downloadVerified(asset, archive, fetchImpl)
  runChecked(run, 'tar', ['-xzf', archive, '-C', extracted])
  const binary = findFile(extracted, 'uv')
  if (!binary) throw new Error('uv 压缩包内容无效：缺少 uv')
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const staged = `${target}.installing-${process.pid}`
  fs.copyFileSync(binary, staged)
  fs.chmodSync(staged, 0o755)
  fs.renameSync(staged, target)
  return target
}

async function installAstrbot({ root, platform, arch, manifest, run, fetchImpl }) {
  const requirements = path.join(root, 'vendor/astrbot/requirements.txt')
  if (!fs.existsSync(requirements)) throw new Error('AstrBot submodule 未初始化')
  const uv = await ensureUv({ root, platform, arch, manifest, run, fetchImpl })
  const dataDir = path.join(root, 'data/astrbot')
  const venv = path.join(dataDir, '.venv')
  fs.mkdirSync(dataDir, { recursive: true })
  if (!fs.existsSync(path.join(venv, 'bin/python'))) {
    runChecked(run, uv, ['venv', '--python', manifest.python, venv], { stdio: 'pipe' })
  }
  const python = path.join(venv, 'bin/python')
  runChecked(run, uv, ['pip', 'install', '--python', python, '-r', requirements], { stdio: 'pipe' })
  fs.writeFileSync(path.join(dataDir, '.chihiro-env.json'), JSON.stringify({
    python: manifest.python,
    uv: manifest.uv.version,
    requirementsSha256: createHash('sha256').update(fs.readFileSync(requirements)).digest('hex'),
    installedAt: new Date().toISOString()
  }, null, 2) + '\n')
}

export function createEnvironmentService(options) {
  const {
    root,
    home = os.homedir(),
    platform = process.platform,
    arch = process.arch,
    qqApp = QQ_APP,
    run = defaultRun,
    fetchImpl = fetch,
    onProgress = () => {}
  } = options
  let repairing = null

  const diagnose = () => inspectEnvironment({ root, home, platform, arch, qqApp, run })

  async function performRepair({ capability: requestedCapability } = {}) {
    const before = diagnose()
    const repaired = []
    const errors = []
    const ids = new Set(before.checks.filter((item) => (
      item.repairable
      && (!requestedCapability || item.capability === 'core' || item.capability === requestedCapability)
    )).map((item) => item.id))
    const manifest = runtimeManifest(root)
    const attempt = async (id, action) => {
      if (!ids.has(id)) return
      onProgress({ id, state: 'started' })
      try {
        await action()
        repaired.push(id)
        onProgress({ id, state: 'completed' })
      } catch (error) {
        errors.push({ id, message: error.message || String(error) })
        onProgress({ id, state: 'failed', message: error.message || String(error) })
      }
    }

    await attempt('submodules', async () => {
      if (!fs.existsSync(path.join(root, '.git'))) throw new Error('当前安装不含 Git 元数据，无法自动初始化 submodule')
      runChecked(run, 'git', ['submodule', 'update', '--init', 'vendor/napcat', 'vendor/astrbot'], { cwd: root })
    })
    await attempt('frontend', async () => {
      runChecked(run, 'npm', ['--prefix', 'frontend', 'run', 'build'], { cwd: root })
    })
    await attempt('napcat', () => installNapcat({ root, home, manifest, run, fetchImpl }))
    await attempt('astrbot', () => installAstrbot({ root, platform, arch, manifest, run, fetchImpl }))

    const after = diagnose()
    return { ...after, repaired, errors }
  }

  async function repair(options = {}) {
    repairing ??= performRepair(options).finally(() => { repairing = null })
    return repairing
  }

  return { diagnose, repair, get repairing() { return Boolean(repairing) } }
}

export const environmentPaths = { napcatHome }
