import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const MAC_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
]

const LINUX_CANDIDATES = [
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
]

export function chromeCandidates(platform = process.platform, env = process.env) {
  if (platform === 'darwin') return [...MAC_CANDIDATES]
  if (platform === 'linux') return [...LINUX_CANDIDATES]
  if (platform === 'win32') {
    const pf = env.PROGRAMFILES || 'C:\\Program Files'
    const pf86 = env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)'
    const local = env.LOCALAPPDATA || ''
    return [
      path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      local ? path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe') : '',
      path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ].filter(Boolean)
  }
  return []
}

export function isExecutableFile(filePath, statSync = fs.statSync) {
  if (!filePath) return false
  try {
    const st = statSync(filePath)
    return Boolean(st && st.isFile())
  } catch {
    return false
  }
}

export function detectChromePath({
  platform = process.platform,
  env = process.env,
  statSync = fs.statSync,
  override = '',
} = {}) {
  const preferred = String(override || '').trim()
  if (preferred && isExecutableFile(preferred, statSync)) {
    return { path: preferred, detected: true, source: 'override' }
  }
  for (const candidate of chromeCandidates(platform, env)) {
    if (isExecutableFile(candidate, statSync)) {
      return { path: candidate, detected: true, source: 'detect' }
    }
  }
  return {
    path: preferred || defaultHint(platform),
    detected: false,
    source: preferred ? 'override' : 'hint',
  }
}

function defaultHint(platform) {
  if (platform === 'darwin') return MAC_CANDIDATES[0]
  if (platform === 'linux') return LINUX_CANDIDATES[0]
  if (platform === 'win32') return path.join('C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe')
  return ''
}

export function readBrowserConfig(filePath) {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    return typeof data?.path === 'string' ? data.path : ''
  } catch {
    return ''
  }
}

export function writeBrowserConfig(filePath, browserPath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify({
    path: String(browserPath || ''),
    host: os.hostname(),
    updatedAt: new Date().toISOString(),
  }, null, 2) + '\n')
}
