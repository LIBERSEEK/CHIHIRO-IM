const LOOKUP_TIMEOUT_MS = 8_000
const USER_AGENT = 'Chihiro-BotLookup/0.1'
const LOOKUP = /github\.com|\bgithub\b|仓库|readme|\bstars?\b|项目地址|开源(项目|仓库)?|搜(一?下)?|查(一?下)?|找(一?下)?/i
const PLATFORM_TOKEN = /^(github|gitlab|gitee|http|https|www|com|html|the|this|that|project)$/i
const LOOKUP_NOISE = /你去|帮我|给我|麻烦|请|简单解释|解释下|介绍下|看看|找找|找下|搜索下|搜一下|查一下|github\.com|\bgithub\b|\bgitlab\b/gi
const FILLER = /我去查|我去找|我去搜|我去\s*github|稍等我|让我查|帮你查|我先查|我去看一下|再简单描述|能再.{0,8}描述|你能提供更多|具体是指什么|方便说一下/i

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

export function extractSearchQueries(text) {
  const raw = String(text || '')
  const queries = []
  const seen = new Set()
  const add = (value) => {
    const token = String(value || '').trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    if (token.length < 2) return
    const key = token.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    queries.push(token)
  }

  for (const repo of extractGithubRepos(raw)) add(repo)
  if (queries.length) return queries.slice(0, 3)

  for (const match of raw.matchAll(/\b([A-Za-z0-9_.-]{2,}\/[A-Za-z0-9_.-]{2,})\b/g)) {
    add(match[1].replace(/\.git$/i, ''))
  }
  for (const match of raw.matchAll(/[“"']([^"'“”]{2,40})[”"']/g)) add(match[1])
  for (const match of raw.matchAll(/\b([A-Za-z][A-Za-z0-9_.-]{1,39})\b/g)) {
    if (PLATFORM_TOKEN.test(match[1])) continue
    add(match[1])
  }
  if (queries.length) return queries.slice(0, 3)

  const leftover = raw
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(LOOKUP_NOISE, ' ')
    .replace(/[?？!！。，,、]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (leftover) add(leftover.slice(0, 80))
  return queries.slice(0, 3)
}

export function isLookupFiller(text) {
  return FILLER.test(String(text || ''))
}

export function formatLookupDraft(lookup) {
  const hits = Array.isArray(lookup?.hits) ? lookup.hits : []
  if (!hits.length) return ''
  const top = hits[0]
  const desc = String(top.desc || top.excerpt || '').replace(/\s+/g, ' ').trim().slice(0, 120)
  const extra = hits.length > 1 && hits[1]?.name
    ? ` 相关还有 ${hits[1].name}${hits[1].url ? `（${hits[1].url}）` : ''}。`
    : ''
  if (desc) return `${top.name}：${top.url}，${desc}。${extra}`.trim()
  return `${top.name}：${top.url}。${extra}`.trim()
}

function emptyLookup(needed = false) {
  return { needed, queries: [], searched: [], hits: [], facts: '' }
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

function githubGet(fetchImpl) {
  return async (path) => {
    try {
      const response = await fetchImpl(`https://api.github.com${path}`, {
        headers: { 'user-agent': USER_AGENT, accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
      })
      if (!response?.ok) return null
      return await response.json().catch(() => null)
    } catch {
      return null
    }
  }
}

function hitFromRepo(fullName, repo, readme, contents) {
  const name = repo?.full_name || fullName
  if (!name) return null
  const url = repo?.html_url || `https://github.com/${name}`
  const files = Array.isArray(contents)
    ? contents.map((item) => item?.name).filter(Boolean).slice(0, 16).join(', ')
    : ''
  const excerpt = decodeReadme(readme)
  const desc = String(repo?.description || '').slice(0, 180)
  return {
    source: 'github',
    name,
    url,
    desc,
    excerpt,
    facts: [
      `repo ${name} ${url}`,
      desc ? `desc ${desc}` : '',
      repo ? `stars ${Number(repo.stargazers_count) || 0} lang ${repo.language || ''} default ${repo.default_branch || ''}` : '',
      files ? `root ${files}` : '',
      excerpt ? `readme ${excerpt}` : '',
    ].filter(Boolean).join('\n'),
  }
}

async function hydrateRepo(fullName, get, seed = null) {
  const [info, readme, contents] = await Promise.all([
    get(`/repos/${fullName}`),
    get(`/repos/${fullName}/readme`),
    get(`/repos/${fullName}/contents/`),
  ])
  const repo = info || seed
  if (!repo?.full_name && !fullName) return null
  return hitFromRepo(fullName, repo, readme, contents)
}

async function searchWeb(query, fetchImpl) {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`
  try {
    const response = await fetchImpl(url, {
      headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    })
    if (!response?.ok) return []
    const data = await response.json().catch(() => null)
    if (!data || typeof data !== 'object') return []
    const hits = []
    if (data.AbstractURL && (data.AbstractText || data.Heading)) {
      const name = String(data.Heading || query).slice(0, 80)
      const desc = String(data.AbstractText || '').slice(0, 180)
      hits.push({
        source: 'web',
        name,
        url: String(data.AbstractURL),
        desc,
        facts: `- ${name} ${data.AbstractURL}${desc ? `：${desc}` : ''}`,
      })
    }
    for (const topic of data.RelatedTopics || []) {
      const row = topic?.FirstURL ? topic : topic?.Topics?.[0]
      if (!row?.FirstURL || !row?.Text) continue
      const name = String(row.Text).split(' - ')[0].slice(0, 80)
      const desc = String(row.Text).slice(0, 180)
      hits.push({
        source: 'web',
        name,
        url: String(row.FirstURL),
        desc,
        facts: `- ${name} ${row.FirstURL}：${desc}`,
      })
      if (hits.length >= 5) break
    }
    return hits
  } catch {
    return []
  }
}

function formatFacts(hits) {
  return hits.slice(0, 5).map((hit) => hit.facts || `- ${hit.name} ${hit.url}${hit.desc ? `：${hit.desc}` : ''}`).join('\n\n').slice(0, 2400)
}

export async function runLookup(text, { fetchImpl = fetch } = {}) {
  const query = String(text || '').trim()
  if (!needsLookup(query)) return emptyLookup(false)
  const queries = extractSearchQueries(query)
  const searched = []
  const hits = []
  const seen = new Set()
  const addHit = (hit) => {
    if (!hit?.name || !hit?.url) return
    const key = String(hit.url).toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    hits.push(hit)
  }
  const get = githubGet(fetchImpl)
  const repos = queries.filter((item) => /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(item))
  const tokens = queries.filter((item) => !repos.includes(item))

  for (const fullName of repos) {
    searched.push(`github:${fullName}`)
    const hit = await hydrateRepo(fullName, get)
    if (hit) addHit(hit)
  }

  if (!hits.length) {
    for (const token of (tokens.length ? tokens : queries).slice(0, 2)) {
      searched.push(`github-search:${token}`)
      const found = await get(`/search/repositories?q=${encodeURIComponent(token)}&per_page=5`)
      const items = Array.isArray(found?.items) ? found.items : []
      if (items[0]?.full_name) {
        const hydrated = await hydrateRepo(items[0].full_name, get, items[0])
        if (hydrated) addHit(hydrated)
      }
      for (const item of items.slice(hits.length ? 1 : 0, 3)) {
        if (!item?.full_name) continue
        addHit(hitFromRepo(item.full_name, item, null, null))
      }
      if (hits.length) break
    }
  }

  if (!hits.length) {
    for (const token of (tokens.length ? tokens : queries).slice(0, 2)) {
      searched.push(`web:${token}`)
      const web = await searchWeb(token, fetchImpl)
      for (const hit of web) addHit(hit)
      if (hits.length) break
    }
  }

  return {
    needed: true,
    queries,
    searched,
    hits: hits.slice(0, 5),
    facts: formatFacts(hits),
  }
}

export async function lookupFacts(text, options = {}) {
  const result = await runLookup(text, options)
  return result.facts
}
