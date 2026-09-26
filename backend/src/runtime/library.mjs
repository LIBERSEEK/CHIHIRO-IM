import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const MAX_BYTES = 20 * 1024 * 1024
const ID_RE = /^[a-z0-9]{12}$/

const MIME_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
}

export function createLibrary(dir) {
  const manifestPath = path.join(dir, 'manifest.json')
  const filesDir = path.join(dir, 'files')

  function read() {
    try {
      const data = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
      return Array.isArray(data.items) ? data.items : []
    } catch {
      return []
    }
  }

  function write(items) {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(manifestPath, JSON.stringify({ items }, null, 2) + '\n')
  }

  function list() {
    return read().map(publicItem)
  }

  function add({ name, mime, dataBase64 }) {
    const kind = kindOf(mime)
    if (!kind) throw new Error('只接受图片或视频')
    const bytes = Buffer.from(String(dataBase64 || ''), 'base64')
    if (bytes.length < 8 || bytes.length > MAX_BYTES) throw new Error('文件不能超过 20MB')
    const id = crypto.randomBytes(6).toString('hex')
    const ext = MIME_EXT[mime] || (kind === 'video' ? '.mp4' : '.jpg')
    fs.mkdirSync(filesDir, { recursive: true })
    fs.writeFileSync(path.join(filesDir, id + ext), bytes)
    const item = {
      id,
      name: cleanName(name, ext),
      mime,
      kind,
      ext,
      bytes: bytes.length,
      createdAt: new Date().toISOString(),
    }
    const items = read()
    items.unshift(item)
    write(items.slice(0, 200))
    return publicItem(item)
  }

  function file(id) {
    if (!ID_RE.test(String(id || ''))) return null
    const item = read().find((entry) => entry.id === id)
    if (!item) return null
    const filePath = path.join(filesDir, id + item.ext)
    if (!fs.existsSync(filePath)) return null
    return { item: publicItem(item), path: filePath, kind: item.kind, ext: item.ext }
  }

  function remove(id) {
    if (!ID_RE.test(String(id || ''))) return false
    const items = read()
    const item = items.find((entry) => entry.id === id)
    if (!item) return false
    fs.rmSync(path.join(filesDir, id + item.ext), { force: true })
    write(items.filter((entry) => entry.id !== id))
    return true
  }

  return { list, add, file, remove }
}

function publicItem(item) {
  return {
    id: item.id,
    name: item.name,
    mime: item.mime,
    kind: item.kind,
    bytes: item.bytes,
    createdAt: item.createdAt,
  }
}

function kindOf(mime) {
  const value = String(mime || '').toLowerCase()
  if (value.startsWith('image/') && MIME_EXT[value]) return 'image'
  if (value.startsWith('video/') && MIME_EXT[value]) return 'video'
  return ''
}

function cleanName(name, ext) {
  const base = path.basename(String(name || '未命名')).replace(/[^\w.\u4e00-\u9fff-]+/g, '_').slice(0, 80)
  return base || `未命名${ext}`
}
