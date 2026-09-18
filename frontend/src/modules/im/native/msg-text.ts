/** Same URL matcher historically used by UserMsgBody.parseText. */
export const BARE_URL_RE =
  /(https?:\/\/[\w\-_]+(?:\.[\w\-_]+)+(?:[\w\-.,@?^=%&:/~+#]*[\w\-@?^=%&/~+#])?)/gi

const MD_LINK_RE = /\[([^\]]*?)\]\(\s*<?((?:https?:\/\/)[^)\s>]+)>?\s*\)/gi

function escapeAttr(value: string) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

function sameUrl(a: string, b: string) {
  const norm = (value: string) => value.trim().replace(/\/+$/, '').toLowerCase()
  return norm(a) === norm(b)
}

function linkLabel(label: string, href: string) {
  const trimmed = String(label ?? '').trim()
  if (!trimmed) return href
  if (sameUrl(trimmed, href)) return href
  return trimmed
}

function anchor(href: string, label: string) {
  return `<a href="" data-link="${escapeAttr(href)}" onclick="return false">${label}</a>`
}

/** Turn markdown `[text](url)` and leftover bare URLs into a single set of `<a data-link>` tags. */
export function linkifyMessageText(text: string): { html: string, urls: string[] } {
  const source = String(text ?? '')
  if (!source) return { html: '', urls: [] }
  const urls: string[] = []
  const slots: string[] = []
  const token = (index: number) => `\u0000L${index}\u0000`

  let html = source.replace(MD_LINK_RE, (_all, label: string, href: string) => {
    const url = String(href).trim()
    urls.push(url)
    slots.push(anchor(url, linkLabel(label, url)))
    return token(slots.length - 1)
  })

  html = html.replace(BARE_URL_RE, (url: string) => {
    urls.push(url)
    slots.push(anchor(url, url))
    return token(slots.length - 1)
  })

  html = html.replace(/\u0000L(\d+)\u0000/g, (_all, index: string) => slots[Number(index)] ?? '')
  return { html, urls }
}
