export interface SchemaField {
  key: string
  label: string
  type: 'text' | 'words' | 'enum' | 'number'
  required?: boolean
  placeholder?: string
  min?: number
  max?: number
  options?: { value: string; label: string }[]
}

export interface SchemaCardAction {
  id: string
  label: string
  method: string
  path: string
}

export interface SchemaCard {
  kind: 'chihiro.card'
  draftId: string
  title: string
  status?: string
  schema: { title?: string; fields: SchemaField[] }
  value: Record<string, unknown>
  actions: SchemaCardAction[]
}

export interface CardImageSource {
  url: string
  name: string
}

export const COMMENT_IMAGE_COPY = {
  title: '评论配图',
  hint: '这些图会和评论一起发出去。可以再加，也可以拿掉某一张。',
  empty: '还没有配图。添加后就会出现在这张卡片上。',
  adding: '正在把你上传的图片放上卡片。',
  add: '添加图片',
  remove: '拿掉这张图',
  needOne: '图文还需要一张配图。',
}

const LIBRARY_ID = /^[a-z0-9]{12}$/

export function libraryImageIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((item) => String(item || '').trim()).filter((id) => LIBRARY_ID.test(id)))]
}

export interface CommentModelOption {
  provider: string
  model: string
  label: string
}

function modelId(value: unknown) {
  const text = String(value || '').trim()
  if (!text || text.length > 120 || /[\u0000-\u001f\u007f]/.test(text)) return ''
  return text
}

export function commentModelOptions(payload: unknown): CommentModelOption[] {
  const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : null
  const data = record?.data && typeof record.data === 'object' ? record.data as Record<string, unknown> : record
  const list = Array.isArray(data?.providers) ? data.providers : []
  return list.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const row = item as Record<string, unknown>
    if (row.enable === false) return []
    const provider = modelId(row.id)
    const model = modelId(row.model)
    if (!provider || !model) return []
    return [{ provider, model, label: model }]
  })
}

export function shouldAdoptChatImages(input: {
  form: string
  ids: string[]
  locked: boolean
  remembered: boolean
  sourceCount: number
}) {
  return input.form === 'image' && !input.locked && !input.remembered && input.ids.length === 0 && input.sourceCount > 0
}

export function parseChihiroCard(value: unknown): SchemaCard | null {
  const parsed = unwrap(value)
  if (!parsed || parsed.kind !== 'chihiro.card' || !parsed.draftId) return null
  if (!parsed.schema || !Array.isArray(parsed.schema.fields)) return null
  return parsed
}

function unwrap(value: unknown): SchemaCard | null {
  if (!value) return null
  if (typeof value === 'string') {
    try {
      return unwrap(JSON.parse(value))
    } catch {
      return null
    }
  }
  if (typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (record.kind === 'chihiro.card') return record as unknown as SchemaCard
  const content = record.content
  if (Array.isArray(content)) {
    for (const part of content) {
      if (part && typeof part === 'object' && 'text' in part) {
        const card = unwrap((part as { text?: unknown }).text)
        if (card) return card
      }
    }
  }
  if (typeof record.text === 'string') return unwrap(record.text)
  if (typeof record.result === 'string' || (record.result && typeof record.result === 'object')) return unwrap(record.result)
  return null
}
