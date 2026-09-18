const NAMED: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

function fromCodePoint(code: number, fallback: string) {
  if (code === 10) return '\n'
  if (code === 13) return '\r'
  if (code === 160) return ' '
  if (code > 0 && code < 0x110000) return String.fromCodePoint(code)
  return fallback
}

/** Decode HTML entities used in QQ group notices (`&nbsp;`, `&#10;`, `&amp;nbsp;`, …). */
export function decodeNoticeHtml(input: string): string {
  if (!input) return ''
  let text = String(input)
  for (let i = 0; i < 3; i++) {
    const next = text
      .replace(/&amp;/gi, '&')
      .replace(/&nbsp;|&#0*160;|&#x0*a0;/gi, ' ')
      .replace(/&#10;|&#x0*a;/gi, '\n')
      .replace(/&#13;|&#x0*d;/gi, '\r')
      .replace(/&#(\d+);/g, (match, digits) => fromCodePoint(Number(digits), match))
      .replace(/&#x([0-9a-f]+);/gi, (match, hex) => fromCodePoint(parseInt(hex, 16), match))
      .replace(/&([a-z]+);/gi, (match, name) => NAMED[String(name).toLowerCase()] ?? match)
    if (next === text) break
    text = next
  }
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

export function noticeRawText(item: unknown): string {
  if (item == null) return ''
  if (typeof item === 'string') return item
  const rec = item as Record<string, any>
  const content = rec.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === 'string') return part
      if (part && typeof part === 'object') return String(part.text || '')
      return ''
    }).join('')
  }
  if (content && typeof content === 'object') return String(content.text || '')
  return String(rec.message?.text || rec.text || '')
}

export function noticePreviewText(item: unknown): string {
  return decodeNoticeHtml(noticeRawText(item)).replace(/\s+/g, ' ').trim()
}
