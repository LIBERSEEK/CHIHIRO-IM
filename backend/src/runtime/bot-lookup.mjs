const LOOKUP_TIMEOUT_MS = 8_000
const USER_AGENT = 'Chihiro-BotLookup/0.1'
const LOOKUP = /github\.com|\bgithub\b|仓库|readme|\bstars?\b|项目地址|开源(项目|仓库)?|搜(一?下)?|查(一?下)?/i

export function needsLookup(text) {
  return LOOKUP.test(String(text || ''))
}

export function extractGithubRepos(text) {
  const repos = new Set()
  const raw = String(text || '')
  for (const match of raw.matchAll(/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/gi)) {
    repos.add(match[1].replace(/\.git$/i, ''))
  }
  for (const match of raw.matchAll(/\b([A-Za-z0-9_.-]{2,}\/[A-Za-z0-9_.-]{2,})\b/g)) {
    if (/^(LIBERSEEK|AstrBotDevs)\//i.test(match[1])) repos.add(match[1].replace(/\.git$/i, ''))
  }
  if (/千寻|chihiro/i.test(raw)) repos.add('LIBERSEEK/CHIHIRO')
  return [...repos].slice(0, 3)
}

function decodeReadme(payload) {
  const encoded = typeof payload?.content === 'string' ? payload.content.replace(/\n/g, '') : ''
  if (!encoded || payload?.encoding !== 'base64') return ''
  try {
    return Buffer.from(encoded, 'base64').toString('utf8').replace(/\s+/g, ' ').trim().slice(0, 800)
  } catch {
    return ''
  }
}

export async function lookupFacts(text, { fetchImpl = fetch } = {}) {
  const query = String(text || '').trim()
  if (!needsLookup(query)) return ''
  const notes = []
  const get = async (path) => {
    const response = await fetchImpl(`https://api.github.com${path}`, {
      headers: { 'user-agent': USER_AGENT, accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    })
    if (!response.ok) return null
    return response.json().catch(() => null)
  }

  let repos = extractGithubRepos(query)
  if (!repos.length) {
    const q = /千寻/.test(query) ? '千寻 IM CHIHIRO' : query.replace(/[?？!！。]/g, ' ').slice(0, 80)
    const found = await get(`/search/repositories?q=${encodeURIComponent(q)}&per_page=3`)
    repos = (found?.items || []).map((item) => item?.full_name).filter(Boolean).slice(0, 3)
  }

  for (const fullName of repos) {
    const [info, readme, contents] = await Promise.all([
      get(`/repos/${fullName}`),
      get(`/repos/${fullName}/readme`),
      get(`/repos/${fullName}/contents/`),
    ])
    if (!info?.full_name) continue
    const files = Array.isArray(contents)
      ? contents.map((item) => item?.name).filter(Boolean).slice(0, 16).join(', ')
      : ''
    const excerpt = decodeReadme(readme)
    notes.push([
      `repo ${info.full_name} ${info.html_url || ''}`,
      info.description ? `desc ${info.description}` : '',
      `stars ${Number(info.stargazers_count) || 0} lang ${info.language || ''} default ${info.default_branch || ''}`,
      files ? `root ${files}` : '',
      excerpt ? `readme ${excerpt}` : '',
    ].filter(Boolean).join('\n'))
  }
  return notes.join('\n\n').slice(0, 2400)
}
