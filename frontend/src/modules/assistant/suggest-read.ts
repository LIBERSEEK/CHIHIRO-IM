export const INTENT_IDS = ['inquire', 'request', 'complaint', 'confirm', 'smalltalk', 'other'] as const
export const ACTION_IDS = ['brief', 'follow_up', 'lookup', 'escalate', 'hold'] as const
export const SPEAK_NOW_MIN = 0.55

export type IntentId = (typeof INTENT_IDS)[number]
export type ActionId = (typeof ACTION_IDS)[number]
export type ReadOption<T extends string> = { id: T; p: number }

export type SuggestRead = {
  intent: { id: IntentId; options: ReadOption<IntentId>[] }
  speakNow: { yes: number; no: number }
  action: { id: ActionId; options: ReadOption<ActionId>[] }
  urgency: number
  note: string
}

export const INTENT_LABELS: Record<IntentId, string> = {
  inquire: '询价',
  request: '办事',
  complaint: '不满',
  confirm: '确认',
  smalltalk: '闲聊',
  other: '其他',
}

export const ACTION_LABELS: Record<ActionId, string> = {
  brief: '简答',
  follow_up: '补问',
  lookup: '查资料',
  escalate: '转人工',
  hold: '先别回',
}

export function clamp01(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}

export function pct(value: number): string {
  return `${Math.round(clamp01(value) * 100)}%`
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function parseOptions<T extends string>(raw: unknown, allowed: readonly T[]): ReadOption<T>[] {
  const allowedSet = new Set(allowed)
  const map = new Map<string, number>()
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === 'string') {
        if (allowedSet.has(item as T)) map.set(item, map.get(item) ?? 0)
        continue
      }
      const record = asRecord(item)
      if (!record) continue
      const id = String(record.id ?? record.key ?? '')
      if (!allowedSet.has(id as T)) continue
      map.set(id, clamp01(record.p ?? record.prob ?? record.probability))
    }
  } else {
    const record = asRecord(raw)
    if (record) {
      for (const [id, value] of Object.entries(record)) {
        if (!allowedSet.has(id as T)) continue
        const nested = asRecord(value)
        map.set(id, clamp01(nested ? nested.p ?? nested.prob : value))
      }
    }
  }
  const options = allowed.map((id) => ({ id, p: map.get(id) ?? 0 }))
  const sum = options.reduce((total, item) => total + item.p, 0)
  if (sum <= 0) return options
  return options.map((item) => ({ id: item.id, p: Math.round((item.p / sum) * 1000) / 1000 }))
}

function parseChoice<T extends string>(raw: unknown, allowed: readonly T[]): { id: T; options: ReadOption<T>[] } {
  let preferred = ''
  if (typeof raw === 'string') preferred = raw
  else {
    const record = asRecord(raw)
    if (record && typeof record.id === 'string') preferred = record.id
  }
  const source = asRecord(raw)
  const options = parseOptions(source?.options ?? source?.probabilities ?? raw, allowed)
  const known = allowed.includes(preferred as T)
  if (known && options.every((item) => item.p === 0)) {
    return {
      id: preferred as T,
      options: allowed.map((id) => ({ id, p: id === preferred ? 1 : 0 })),
    }
  }
  const winner = options.reduce((best, item) => item.p > best.p ? item : best, options[0])
  return { id: known ? preferred as T : winner.id, options }
}

function parseSpeakNow(raw: unknown): { yes: number; no: number } {
  if (typeof raw === 'number' || typeof raw === 'string') {
    const yes = clamp01(raw)
    return { yes, no: Math.round((1 - yes) * 1000) / 1000 }
  }
  const record = asRecord(raw)
  if (!record) return { yes: 0, no: 1 }
  let yes = clamp01(record.yes ?? record.noul ?? record.p)
  let no = clamp01(record.no)
  if (yes === 0 && no === 0 && record.true != null) yes = clamp01(record.true)
  const sum = yes + no
  if (sum <= 0) return { yes: 0, no: 1 }
  yes = Math.round((yes / sum) * 1000) / 1000
  return { yes, no: Math.round((1 - yes) * 1000) / 1000 }
}

function parseUrgency(raw: unknown): number {
  if (typeof raw === 'string') {
    const match = raw.match(/(\d+(?:\.\d+)?)/)
    raw = match ? match[1] : raw
  }
  const n = Number(raw)
  if (!Number.isFinite(n)) return 0
  if (n > 0 && n <= 1) return Math.round(n * 10)
  return Math.min(10, Math.max(0, Math.round(n)))
}

export function parseSuggestRead(value: unknown): SuggestRead | null {
  const root = asRecord(value)
  const raw = asRecord(root?.read) || asRecord(root?.judgment) || asRecord(root?.eval)
  if (!raw) return null
  const intent = parseChoice(raw.intent, INTENT_IDS)
  const action = parseChoice(raw.action, ACTION_IDS)
  const speakNow = parseSpeakNow(raw.speakNow ?? raw.speak)
  const note = typeof raw.note === 'string' ? raw.note.trim().slice(0, 80) : ''
  const urgency = parseUrgency(raw.urgency)
  const peaked = intent.options.some((item) => item.p > 0) || action.options.some((item) => item.p > 0) || speakNow.yes > 0 || urgency > 0 || Boolean(note)
  if (!peaked && !raw.intent && !raw.action) return null
  return { intent, speakNow, action, urgency, note }
}

export function shouldHoldRead(read: SuggestRead | null | undefined): boolean {
  if (!read) return false
  if (read.action.id === 'hold' || read.action.id === 'escalate') return true
  return read.speakNow.yes < SPEAK_NOW_MIN
}

export function visibleOptions<T extends string>(choice: { id: T; options: ReadOption<T>[] }): ReadOption<T>[] {
  const ranked = [...choice.options].sort((a, b) => b.p - a.p)
  const shown = ranked.filter((item) => item.p >= 0.04 || item.id === choice.id)
  return shown.length ? shown : ranked.slice(0, 1)
}

export function formatReadLine(read: SuggestRead): string {
  const intent = `${INTENT_LABELS[read.intent.id]} ${pct(read.intent.options.find((item) => item.id === read.intent.id)?.p ?? 0)}`
  if (read.action.id === 'hold') return `先别回 · ${intent}`
  if (read.action.id === 'escalate') return `转人工 · ${intent}`
  return `${intent} · 建议${ACTION_LABELS[read.action.id]} · 紧急 ${read.urgency}/10`
}
