import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const RECENT_CONTACT_UNREAD_MARK = 'chihiro-recent-contact-unread'
export const CONTACT_SEARCH_FILE = 'contact-search.mjs'

const WRAP_SOURCE = fs.readFileSync(
  fileURLToPath(new URL('./chihiro-napcat-unread-plugin.mjs', import.meta.url)),
  'utf8',
)
const CONTACT_SEARCH_SOURCE = fs.readFileSync(
  fileURLToPath(new URL('./contact-search.mjs', import.meta.url)),
  'utf8',
)

function writeIfChanged(filePath, source) {
  if (fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8') === source) return
  fs.writeFileSync(filePath, source)
}

export function injectRecentContactUnread(pluginDir) {
  if (!pluginDir || !fs.existsSync(pluginDir)) return false
  const indexPath = path.join(pluginDir, 'index.mjs')
  const originalPath = path.join(pluginDir, 'index.ssqq.mjs')
  if (!fs.existsSync(indexPath)) return false

  const current = fs.readFileSync(indexPath, 'utf8')
  const alreadyWrapped = current.includes(RECENT_CONTACT_UNREAD_MARK)
  if (!alreadyWrapped) {
    fs.copyFileSync(indexPath, originalPath)
  } else if (!fs.existsSync(originalPath)) {
    return false
  }

  // The plugin imports ./contact-search.mjs. Copy it first so a NapCat
  // reload of index.mjs does not skip the whole plugin on a missing sibling.
  writeIfChanged(path.join(pluginDir, CONTACT_SEARCH_FILE), CONTACT_SEARCH_SOURCE)
  writeIfChanged(indexPath, WRAP_SOURCE)
  return true
}
