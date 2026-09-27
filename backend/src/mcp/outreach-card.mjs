import crypto from 'node:crypto'

export const CARD_KIND = 'chihiro.card'

const START_ACTION = {
  id: 'start',
  label: '启动',
  method: 'POST',
  path: '/api/runtime/outreach/brief/start',
}

export function cardSchema() {
  return {
    title: '任务卡',
    fields: [
      {
        key: 'platform',
        label: '平台',
        type: 'enum',
        options: [
          { value: 'douyin', label: '抖音' },
          { value: 'xiaohongshu', label: '小红书' },
          { value: 'bilibili', label: '哔哩哔哩' },
        ],
      },
      { key: 'audience', label: '人群', type: 'text', required: true },
      { key: 'offer', label: '产品 / 服务', type: 'text', required: true },
      { key: 'benefit', label: '能提供的价值', type: 'text', required: true },
      { key: 'tags', label: '种子标签', type: 'words', required: true },
      { key: 'excludes', label: '排除词', type: 'words', placeholder: '没有就留空' },
      { key: 'tone', label: '语气', type: 'text', required: true },
      {
        key: 'interaction',
        label: '互动',
        type: 'enum',
        options: [
          { value: 'comment', label: '只评论' },
          { value: 'comment_like', label: '评论并点赞' },
        ],
      },
      { key: 'maxCount', label: '评论次数', type: 'number', min: 1, max: 999 },
      {
        key: 'form',
        label: '评论形式',
        type: 'enum',
        options: [
          { value: 'text', label: '纯文字' },
          { value: 'image', label: '图文' },
        ],
      },
    ],
  }
}

const OUTREACH_TOOL_NAMES = {
  outreach_schema: 'outreach_schema',
  outreach_draft: 'outreach_draft',
  outreach_get: 'outreach_get',
}

export function outreachToolName(name) {
  return OUTREACH_TOOL_NAMES[String(name || '')] || ''
}

export function outreachToolDefinitions() {
  const fieldProps = {
    draftId: { type: 'string', description: '已有草稿 id。不传就新建。' },
    audience: { type: 'string', description: '用户说过的投放人群。' },
    offer: { type: 'string', description: '用户推广的产品或服务。' },
    benefit: { type: 'string', description: '该产品或服务对目标人群能提供的真实价值。' },
    goal: { type: 'string', description: '用户希望评论开启的后续交流；可选，不要写成强推销 CTA。' },
    tags: { type: 'array', items: { type: 'string' }, description: '匹配内容的短标签，必须来自用户或这轮对话。' },
    excludes: { type: 'array', items: { type: 'string' }, description: '要避开的词。用户说没有时传空数组。' },
    tone: { type: 'string', description: '用户选定的评论语气。' },
    interaction: { type: 'string', enum: ['comment', 'comment_like'] },
    maxCount: { type: 'number' },
    form: { type: 'string', enum: ['text', 'image'] },
    platform: { type: 'string', enum: ['douyin', 'xiaohongshu', 'bilibili'], description: '投放平台。哔哩哔哩传 bilibili，小红书传 xiaohongshu，抖音传 douyin。' },
    commentImageIds: { type: 'array', items: { type: 'string' } },
    referenceIds: { type: 'array', items: { type: 'string' } },
  }
  return [
    {
      name: 'outreach_schema',
      description: '读取评论投放任务卡的字段结构。营销获客覆盖抖音、小红书和哔哩哔哩，平台写在任务卡上。用户这句话就是投放人群，先调用本工具再谈缺的字段。不启动任务。',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'outreach_draft',
      description: '按任务卡结构提交或更新一份草稿。必填没齐会拒绝，不会出卡。不能启动投放。账号由服务端决定，传入的账号会被忽略。',
      inputSchema: { type: 'object', properties: fieldProps },
    },
    {
      name: 'outreach_get',
      description: '按草稿 id 读取已经保存的任务卡。',
      inputSchema: {
        type: 'object',
        properties: { draftId: { type: 'string' } },
        required: ['draftId'],
      },
    },
  ]
}

export function missingCardFields(args = {}) {
  const missing = []
  if (!String(args.audience || '').trim()) missing.push('人群')
  if (!String(args.offer || '').trim()) missing.push('产品 / 服务')
  if (!String(args.benefit || '').trim()) missing.push('能提供的价值')
  if (!wordList(args.tags).length) missing.push('种子标签')
  if (!String(args.tone || '').trim()) missing.push('语气')
  const excludesGiven = Array.isArray(args.excludes) || typeof args.excludes === 'string' || args.excludesAsked === true
  if (!excludesGiven) missing.push('排除词')
  return missing
}

export function buildOutreachDraft(args = {}, existing = null) {
  const missing = missingCardFields(args)
  if (missing.length) return { ok: false, missing }
  const tags = wordList(args.tags).slice(0, 12)
  const excludes = wordList(args.excludes).slice(0, 20)
  const brief = {
    id: String(existing?.id || args.draftId || newId()).slice(0, 40),
    status: 'ready',
    form: args.form === 'image' ? 'image' : 'text',
    audience: String(args.audience || '').trim().slice(0, 80),
    offer: String(args.offer || '').trim().slice(0, 120),
    benefit: String(args.benefit || '').trim().slice(0, 240),
    goal: String(args.goal || '').trim().slice(0, 120),
    tags: tags.filter((tag) => !excludes.some((word) => word && (tag.includes(word) || word.includes(tag)))),
    excludes,
    excludesAsked: true,
    tone: String(args.tone || '').trim().slice(0, 40),
    interaction: args.interaction === 'comment_like' ? 'comment_like' : 'comment',
    maxCount: clampCount(args.maxCount),
    commentImageIds: idList(args.commentImageIds),
    referenceIds: idList(args.referenceIds),
    commentProvider: String(args.commentProvider || existing?.commentProvider || '').trim().slice(0, 120),
    commentModel: String(args.commentModel || existing?.commentModel || '').trim().slice(0, 120),
    platform: args.platform === 'xiaohongshu' || args.platform === 'bilibili' || args.platform === 'douyin'
      ? args.platform
      : (existing?.platform === 'xiaohongshu' || existing?.platform === 'bilibili' ? existing.platform : 'douyin'),
    messages: Array.isArray(existing?.messages) ? existing.messages : [],
    accountId: '',
    updatedAt: new Date().toISOString(),
  }
  if (!brief.tags.length) return { ok: false, missing: ['种子标签'] }
  return { ok: true, brief, card: toCard(brief) }
}

export function toCard(brief) {
  const source = brief && typeof brief === 'object' ? brief : {}
  return {
    kind: CARD_KIND,
    draftId: String(source.id || ''),
    title: '任务卡',
    status: source.status === 'started' ? 'started' : 'ready',
    schema: cardSchema(),
    value: {
      audience: String(source.audience || ''),
      offer: String(source.offer || ''),
      benefit: String(source.benefit || ''),
      goal: String(source.goal || ''),
      tags: wordList(source.tags),
      excludes: wordList(source.excludes),
      tone: String(source.tone || ''),
      interaction: source.interaction === 'comment_like' ? 'comment_like' : 'comment',
      maxCount: clampCount(source.maxCount),
      form: source.form === 'image' ? 'image' : 'text',
      commentImageIds: idList(source.commentImageIds),
      referenceIds: idList(source.referenceIds),
      commentProvider: String(source.commentProvider || ''),
      commentModel: String(source.commentModel || ''),
      platform: source.platform === 'xiaohongshu' || source.platform === 'bilibili' ? source.platform : 'douyin',
    },
    actions: source.status === 'started' ? [] : [START_ACTION],
  }
}

export async function callOutreachTool(name, args = {}, api) {
  const tool = outreachToolName(name)
  if (tool === 'outreach_schema') {
    return { kind: CARD_KIND, schema: cardSchema() }
  }
  if (tool === 'outreach_draft') {
    const existing = await readExisting(api, args.draftId)
    const judged = buildOutreachDraft(args, existing)
    if (!judged.ok) throw new Error(`还缺这些才能出任务卡：${judged.missing.join('、')}`)
    const saved = await api('POST', '/api/runtime/outreach/brief', { brief: judged.brief })
    const brief = saved?.brief
    if (!brief?.id) throw new Error('草稿没有保存')
    return toCard(brief)
  }
  if (tool === 'outreach_get') {
    const id = String(args.draftId || '').trim()
    if (!id) throw new Error('需要草稿 id')
    const brief = await readExisting(api, id)
    if (!brief) throw new Error('没有这张任务卡')
    return toCard(brief)
  }
  throw new Error(`unknown tool ${name}`)
}

async function readExisting(api, id) {
  const draftId = String(id || '').trim()
  if (!draftId) return null
  try {
    const saved = await api('GET', `/api/runtime/outreach/brief?id=${encodeURIComponent(draftId)}`)
    if (saved?.brief?.id === draftId) return saved.brief
  } catch {
    return null
  }
  return null
}

function wordList(value) {
  const list = Array.isArray(value) ? value : String(value || '').split(/[，,、/|\s]+/)
  return [...new Set(list.map((item) => String(item || '').trim()).filter((item) => item.length >= 2 && item.length <= 16))]
}

function idList(value) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((item) => String(item || '').trim()).filter((item) => /^[a-z0-9]{12}$/.test(item)))].slice(0, 24)
}

function clampCount(value) {
  const count = Math.floor(Number(value))
  if (!Number.isFinite(count)) return 10
  return Math.min(999, Math.max(1, count))
}

function newId() {
  return `b${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`
}
