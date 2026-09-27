import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const READY_LINE = '这些可以启动了。任务卡上每一项都能改，确认后点启动。'
const LEARNING_THRESHOLD = 3
const MAX_LEARNED_TAGS = 12
const MAX_LEARNING_CANDIDATES = 24
const GENERIC_TOPICS = new Set(['分享', '教程', '学习', '日常', '生活', '工作', '记录', '推荐', '干货', '技巧', '经验', '知识', '科技', '互联网', '视频', '抖音', '热门'])

export function emptyBrief(id = newId()) {
  return {
    id,
    status: 'collecting',
    form: 'text',
    audience: '',
    offer: '',
    benefit: '',
    goal: '',
    tags: [],
    excludes: [],
    excludesAsked: false,
    tone: '',
    interaction: 'comment',
    maxCount: 10,
    commentImageIds: [],
    referenceIds: [],
    commentProvider: '',
    commentModel: '',
    platform: 'douyin',
    messages: [],
    accountId: '',
    updatedAt: new Date().toISOString(),
  }
}

export function createBriefStore(file) {
  function load() {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'))
      return Array.isArray(data.briefs) ? data.briefs : []
    } catch {
      return []
    }
  }

  function save(briefs) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify({ briefs: briefs.slice(0, 20) }, null, 2) + '\n')
  }

  function ensure() {
    const briefs = load()
    const open = briefs.find((item) => item && item.status !== 'started')
    if (open) return normalizeBrief(open)
    const created = emptyBrief()
    save([created, ...briefs])
    return created
  }

  function put(brief) {
    const next = normalizeBrief(brief)
    const briefs = load().filter((item) => item?.id !== next.id)
    save([next, ...briefs])
    return next
  }

  function get(id) {
    const found = load().find((item) => item?.id === id)
    return found ? normalizeBrief(found) : null
  }

  return { ensure, put, get }
}

export function briefPrompt(brief, userText, referenceNames = []) {
  return `你在帮用户准备一次短视频/内容平台评论投放。用户知道自己想找什么人，不熟悉后台配置。
只输出 JSON，不要 Markdown。
{"reply":"一句自然中文，只问最重要的一个缺项","audience":"","offer":"","benefit":"","goal":"","tags":[],"excludes":[],"tone":"","maxCount":10,"interaction":"comment"}
先理解人群在什么场景遇到什么问题，再确认用户推广的产品/服务及其真实价值。tags 是用于匹配视频的短词，必须与人群和产品价值都相关；excludes 里的词不能出现在 tags。不要编造产品能力、客户证据或用户偏好。一次只追问一个缺项，优先问产品/服务，再问其具体价值。
interaction 只能是 comment 或 comment_like。
已有方案：${JSON.stringify({
    audience: brief.audience,
    offer: brief.offer,
    benefit: brief.benefit,
    goal: brief.goal,
    tags: brief.tags,
    excludes: brief.excludes,
    tone: brief.tone,
    maxCount: brief.maxCount,
    interaction: brief.interaction,
  })}
参考素材：${referenceNames.join('、') || '无'}
用户刚说：${userText}`
}

export function turnBrief(brief, userText, modelText = '') {
  const current = normalizeBrief(brief)
  const heard = extractBriefPatch(userText, current)
  const modelled = applyModelBrief(modelText, userText, current)
  let next = mergeBrief(current, modelled || {})
  next = mergeBrief(next, heard)
  next.tags = next.tags.filter((tag) => !hitsExclude(tag, next.excludes))
  const question = nextQuestion(next)
  next.status = question ? 'collecting' : 'ready'
  const reply = question || cleanReply(modelled?.reply) || READY_LINE
  next.messages = [...current.messages, { role: 'user', text: String(userText || '').trim() }, { role: 'assistant', text: reply }].slice(-40)
  next.updatedAt = new Date().toISOString()
  return normalizeBrief(next)
}

export function settingsFromBrief(brief, imageDir = '') {
  const source = normalizeBrief(brief)
  const tags = source.tags.filter((tag) => !hitsExclude(tag, source.excludes)).slice(0, 12)
  return {
    maxCount: source.maxCount,
    blockKeywords: source.excludes,
    authorBlockKeywords: [],
    comments: [],
    campaign: {
      enabled: true,
      briefId: source.id,
      form: source.form,
      audience: source.audience,
      offer: source.offer,
      benefit: source.benefit,
      goal: source.goal,
      tone: source.tone,
      interaction: source.interaction,
      seedTags: tags,
      learnedTags: [],
      learningCandidates: [],
      excludes: source.excludes,
      commentProvider: commentModelChoice(source.commentProvider),
      commentModel: commentModelChoice(source.commentModel),
      platform: source.platform,
    },
    ruleGroups: [{
      id: 'campaign',
      name: '投放人群',
      type: 'manual',
      comments: [],
      children: [],
      relation: 'or',
      rules: tags.map((keyword) => ({ field: 'videoDesc', keyword })),
      commentSource: 'model',
      commentImagePath: source.form === 'image' ? imageDir : '',
      commentImageType: 'folder',
      commentImageName: source.form === 'image' ? '评论配图' : '',
    }],
  }
}

export function absorbMatchedTags(settings, video) {
  const campaign = settings?.campaign
  if (!campaign?.enabled) return { settings, added: [] }
  const names = (video?.video_tag || []).map((tag) => String(tag?.tag_name || tag || '').trim()).filter(Boolean)
  const learned = [...(campaign.learnedTags || [])]
  const seeds = new Set(campaign.seedTags || [])
  const added = []
  for (const name of names) {
    if (seeds.has(name) || learned.includes(name)) continue
    if (hitsExclude(name, [...(campaign.excludes || []), ...(settings.blockKeywords || [])])) continue
    if (learned.length >= 12) break
    learned.push(name)
    added.push(name)
  }
  if (!added.length) return { settings, added }
  return {
    settings: {
      ...settings,
      campaign: { ...campaign, learnedTags: learned },
    },
    added,
  }
}

export function learnMatchedVideo(settings, video) {
  const campaign = settings?.campaign
  if (!campaign?.enabled) return { settings, candidates: [], promoted: [] }
  const names = extractLearningCandidates(video)
  const blocked = [...(campaign.seedTags || []), ...(campaign.learnedTags || []), ...(campaign.excludes || []), ...(settings.blockKeywords || [])]
  const candidates = Array.isArray(campaign.learningCandidates)
    ? campaign.learningCandidates.map((item) => ({
      keyword: String(item?.keyword || '').trim(),
      count: Number(item?.count) || 1,
      videoIds: Array.isArray(item?.videoIds) ? item.videoIds.map((id) => String(id || '').trim()).filter(Boolean).slice(-3) : [],
    })).filter((item) => item.keyword)
    : []
  const learned = [...(campaign.learnedTags || [])]
  const progress = []
  const promoted = []
  const videoId = String(video?.aweme_id || video?.awemeId || '').trim()
  for (const name of names) {
    if (hitsExclude(name, blocked) || learned.some((item) => fold(item) === fold(name))) continue
    let entry = candidates.find((item) => fold(item.keyword) === fold(name))
    if (!entry) {
      if (candidates.length >= MAX_LEARNING_CANDIDATES) continue
      entry = { keyword: name, count: 0, videoIds: [] }
      candidates.push(entry)
    }
    if (videoId && entry.videoIds.includes(videoId)) continue
    if (videoId) entry.videoIds.push(videoId)
    entry.count = Math.min(LEARNING_THRESHOLD, entry.count + 1)
    if (entry.count >= LEARNING_THRESHOLD && learned.length < MAX_LEARNED_TAGS) {
      learned.push(name)
      promoted.push(name)
      candidates.splice(candidates.indexOf(entry), 1)
    } else {
      progress.push({ keyword: name, count: entry.count })
    }
  }
  if (!progress.length && !promoted.length) return { settings, candidates: [], promoted: [] }
  const next = {
    ...settings,
    campaign: { ...campaign, learnedTags: learned, learningCandidates: candidates },
  }
  if (promoted.length) {
    next.ruleGroups = (settings.ruleGroups || []).map((group) => {
      if (group?.id !== 'campaign') return group
      const rules = [...(group.rules || [])]
      const existing = new Set(rules.map((rule) => `${rule.field}:${fold(rule.keyword)}`))
      for (const keyword of promoted) {
        const key = `videoDesc:${fold(keyword)}`
        if (!existing.has(key)) rules.push({ field: 'videoDesc', keyword })
      }
      return { ...group, rules: rules.slice(0, 40) }
    })
  }
  return { settings: next, candidates: progress, promoted }
}

function extractLearningCandidates(video) {
  const desc = String(video?.desc || '')
  const topics = [...desc.matchAll(/#([^\s#]+)/g)]
    .map((match) => match[1].replace(/[，。！？、,.!?；;:：]+$/g, '').trim())
  const latin = desc.match(/\b[A-Za-z][A-Za-z0-9.+-]{1,30}\b/g)
  const names = [...topics, ...(latin || [])]
  return unique(names.map((item) => String(item).trim()).filter((item) => (
    item.length >= 2 && item.length <= 40 && !GENERIC_TOPICS.has(item.toLowerCase()) && !/^[\d._+-]+$/.test(item)
  )))
}

export function peerCommentLines(body) {
  const list = Array.isArray(body?.comments) ? body.comments : Array.isArray(body) ? body : []
  const lines = []
  const seen = new Set()
  for (const item of list) {
    const source = typeof item === 'string' ? item : (item?.text || item?.content || '')
    const text = String(source).replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
    if (text.length < 2 || seen.has(text)) continue
    if (!/[\u4e00-\u9fffA-Za-z0-9]/.test(text)) continue
    seen.add(text)
    lines.push(text)
    if (lines.length >= 5) break
  }
  return lines
}

function peerVoice(lines) {
  if (!lines.length) return '评论区：无'
  const quoted = lines.map((line, index) => `${index + 1}. 「${line.replace(/[「」]/g, '')}」`).join('\n')
  return `评论区：\n${quoted}`
}

export function commentModelChoice(value) {
  const text = String(value || '').trim()
  if (!text || text.length > 120 || /[\u0000-\u001f\u007f]/.test(text)) return ''
  return text
}

export const COMMENT_VOICE = '说话像嘴里说出来的。句子按逗号切成短单位，十几字换一次气。情绪到了，从呢、吧、哈、嘛、啊里用一个。自己碰到的事用「我」，接评论区里那个人用「你」。分享时露出一点自己的边界。念一遍，像刚在评论区跟一个人说话。'

const SPOKEN_FRAMES = ['我用过的', '这个', '我用的', '真心推荐这个']

export function spokenFrames(video) {
  const key = String(video?.aweme_id || video?.awemeId || '')
  const shift = [...key].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % SPOKEN_FRAMES.length
  return SPOKEN_FRAMES.slice(shift).concat(SPOKEN_FRAMES.slice(0, shift))
}

export function spokenNoun(offer) {
  const text = String(offer || '').trim()
  if (!text) return '无'
  if (/api|中转|接口/i.test(text) || /站$/.test(text)) return '站'
  return text
}

function factRule(campaign) {
  const source = `${campaign?.offer || ''}\n${campaign?.benefit || ''}`
  if (/费用过高|账号被封|模型降智/.test(source)) {
    return '视频或评论区已经在问这些事时，用自己碰到的经历说完整：费用过高就是调用费用高，账号被封就是账号被封或调用被限制，模型降智就是模型回答变差。'
  }
  return '视频或评论区已经在问这些事时，能说的事实用那一行的原话，说完整。'
}

export function commentSessionId(briefId, video) {
  const brief = String(briefId || 'default').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 40) || 'default'
  const videoKey = String(video?.aweme_id || video?.awemeId || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 24)
  return videoKey ? `outreach-campaign:${brief}:${videoKey}` : `outreach-campaign:${brief}`
}

export function commentPrompt(campaign, video) {
  const tags = (video?.video_tag || []).map((tag) => String(tag?.tag_name || '').trim()).filter(Boolean).join('、')
  const peers = peerCommentLines(video?.peerComments)
  const excludes = (campaign?.excludes || []).filter(Boolean).join('、') || '无'
  const offer = spokenNoun(campaign?.offer)
  const frames = spokenFrames(video).join('、')
  return `只输出 JSON：{"comment":"..."}。

规则：
- 像看完这条视频、也扫过评论区的人，留下自己的一句感受。接住正在说的那一件具体事，带一点情绪，长短和口气靠近评论区。
- 这一句把那件事说完。有人在问这条视频怎么做的、用的哪套，就接他们问的那套。有人在问怎么做、贵不贵、稳不稳、会不会出问题、自己怎么弄，就用自己的经历答这一问。短称呼套上「这一句的口语」里排在最前面的那个，像聊天时随口说自己用过的地方。一句只套一个。排到真心推荐这个，就把这股热乎劲说出来。
- 大家在讲画面、剧情、笑点或步骤时，感受就落在那个画面、剧情、笑点或步骤上。
- ${factRule(campaign)}
- 句子在这件事上收住。评论区的原话用来听长短和口气，自己的话顺着这个口气往下说。一句说完，50 字以内。描述或评论区里有字，comment 里就留下这一句。描述和评论区都空着，输出 {"comment":""}。

${COMMENT_VOICE}

要推的东西：${offer}
这一句的口语：${frames}
能说的事实：${campaign?.benefit || '无'}
语气：${campaign?.tone || '无'}
这些词换一种说法：${excludes}

视频作者：${video?.author?.nickname || ''}
视频描述：${video?.desc || ''}
视频标签：${tags || '无'}
${peerVoice(peers)}`
}

export function parseModelComment(text, excludes = []) {
  return parseModelCommentResult(text, excludes).text
}

export function parseModelCommentResult(text, excludes = []) {
  const raw = String(text || '').trim()
  if (!raw) return { text: '', reason: 'empty_response' }
  const json = extractJson(text)
  if (!json && raw.includes('{')) return { text: '', reason: 'invalid_json' }
  const picked = json ? (json.comment || json.text || '') : text
  let line = String(picked || '').trim().split('\n').map((item) => item.trim()).filter(Boolean)[0] || ''
  line = line.replace(/^["“]|["”]$/g, '').trim()
  if (!line) return { text: '', reason: 'missing_comment' }
  if (line.length > 50) return { text: '', reason: 'too_long' }
  if (/[{}]/.test(line)) return { text: '', reason: 'invalid_comment' }
  if (/^(抱歉|无法|我不能|作为AI|作为 AI)/.test(line)) return { text: '', reason: 'refusal' }
  if ((excludes || []).some((word) => word && line.includes(word))) return { text: '', reason: 'excluded_word' }
  return { text: line, reason: '' }
}

export function stageCommentImages(dir, ids, resolveFile) {
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  let count = 0
  for (const id of ids || []) {
    const file = resolveFile(id)
    if (!file || file.kind !== 'image' || !file.path) continue
    fs.copyFileSync(file.path, path.join(dir, `${file.item?.id || id}${file.ext || ''}`))
    count += 1
  }
  return count
}

const INLINE_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
}

export function stageInlineImages(dir, files) {
  fs.mkdirSync(dir, { recursive: true })
  let count = 0
  for (const file of files || []) {
    const mime = String(file?.mime || '').toLowerCase()
    const ext = INLINE_EXT[mime]
    if (!ext) continue
    const bytes = Buffer.from(String(file.dataBase64 || ''), 'base64')
    if (bytes.length < 8 || bytes.length > 20 * 1024 * 1024) continue
    const id = crypto.randomBytes(6).toString('hex')
    fs.writeFileSync(path.join(dir, id + ext), bytes)
    count += 1
  }
  return count
}

function normalizeBrief(value) {
  const source = value && typeof value === 'object' ? value : {}
  const form = source.form === 'image' ? 'image' : 'text'
  const interaction = source.interaction === 'comment_like' ? 'comment_like' : 'comment'
  const messages = Array.isArray(source.messages)
    ? source.messages.flatMap((item) => {
      if (!item || (item.role !== 'user' && item.role !== 'assistant')) return []
      const text = String(item.text || '').trim()
      return text ? [{ role: item.role, text: text.slice(0, 500) }] : []
    }).slice(-40)
    : []
  const status = source.status === 'started' || source.status === 'ready' ? source.status : 'collecting'
  return {
    id: String(source.id || newId()).slice(0, 40),
    status,
    form,
    audience: String(source.audience || '').trim().slice(0, 80),
    offer: String(source.offer || '').trim().slice(0, 120),
    benefit: String(source.benefit || '').trim().slice(0, 240),
    goal: String(source.goal || '').trim().slice(0, 120),
    tags: wordList(source.tags).slice(0, 12),
    excludes: wordList(source.excludes).slice(0, 20),
    excludesAsked: source.excludesAsked === true,
    tone: String(source.tone || '').trim().slice(0, 40),
    interaction,
    maxCount: clampCount(source.maxCount),
    commentImageIds: idList(source.commentImageIds),
    referenceIds: idList(source.referenceIds),
    commentProvider: commentModelChoice(source.commentProvider),
    commentModel: commentModelChoice(source.commentModel),
    platform: source.platform === 'xiaohongshu' || source.platform === 'bilibili' ? source.platform : 'douyin',
    messages,
    accountId: String(source.accountId || '').slice(0, 80),
    updatedAt: String(source.updatedAt || new Date().toISOString()),
  }
}

function extractBriefPatch(userText, brief) {
  const raw = String(userText || '').replace(/\s+/g, ' ').trim()
  const patch = {}
  if (!raw) return patch
  if (lastAssistant(brief).includes('产品') && !brief.offer) patch.offer = raw.slice(0, 120)
  else if ((lastAssistant(brief).includes('价值') || lastAssistant(brief).includes('帮助') || lastAssistant(brief).includes('具体问题')) && !brief.benefit) patch.benefit = raw.slice(0, 240)
  const excludeMatch = raw.match(/(?:不要|别|排除|避开|不想要)([^。！？]{1,40})/)
  if (excludeMatch) patch.excludes = wordList(excludeMatch[1])
  const askedExcludes = lastAssistant(brief).includes('避开')
  if (askedExcludes && /没有|不用|无|不需要/.test(raw)) patch.excludesAsked = true
  const toneMatch = raw.match(/(?:语气|风格)(?:是|像|为|用)?([^，,。！？]{1,40})/)
  if (toneMatch) patch.tone = toneMatch[1].replace(/^[是为像：:\s]+/, '').trim().slice(0, 40)
  else if (lastAssistant(brief).includes('语气')) patch.tone = raw.slice(0, 40)
  const countMatch = raw.match(/(\d{1,3})\s*条/)
  if (countMatch) patch.maxCount = clampCount(countMatch[1])
  if (/点赞/.test(raw) && /评论/.test(raw)) patch.interaction = 'comment_like'
  else if (/只评论|不要点赞|别点赞/.test(raw)) patch.interaction = 'comment'
  const tagMatch = raw.match(/(?:标签|关键词|说法)[:：\s]*([^。！？]{1,80})/)
  if (tagMatch) patch.tags = wordList(tagMatch[1])
  else if (lastAssistant(brief).includes('说法') || lastAssistant(brief).includes('匹配')) patch.tags = wordList(raw)
  const audienceMatch = raw.match(/(?:想找|投放给|面向|人群是|想触达)([^，,。！？]{2,40})/)
  if (audienceMatch) patch.audience = audienceMatch[1].trim().slice(0, 80)
  else if (!brief.audience && !brief.tags?.length && !patch.tags && raw.length >= 4 && raw.length <= 80) patch.audience = raw
  const more = raw.match(/(?:再加上|加上|还有)([^。！？]{1,40})/)
  if (more) patch.tags = [...(patch.tags || []), ...wordList(more[1])]
  return patch
}

function applyModelBrief(modelText, userText = '', brief = {}) {
  const json = extractJson(modelText)
  if (!json) return null
  const said = `${userText}\n${brief.audience || ''}\n${(brief.tags || []).join('\n')}`
  const patch = {}
  const saidNow = String(userText || '')
  if (typeof json.offer === 'string' && saidNow.includes(json.offer.trim())) patch.offer = json.offer.trim().slice(0, 120)
  if (typeof json.benefit === 'string' && saidNow.includes(json.benefit.trim())) patch.benefit = json.benefit.trim().slice(0, 240)
  if (typeof json.goal === 'string' && saidNow.includes(json.goal.trim())) patch.goal = json.goal.trim().slice(0, 120)
  if (typeof json.audience === 'string' && saidNow.includes(json.audience.trim())) patch.audience = json.audience.trim().slice(0, 80)
  if (Array.isArray(json.tags)) patch.tags = wordList(json.tags).filter((tag) => said.includes(tag))
  if (Array.isArray(json.excludes)) patch.excludes = wordList(json.excludes).filter((word) => saidNow.includes(word))
  if (typeof json.tone === 'string' && saidNow.includes(json.tone.trim())) patch.tone = json.tone.trim().slice(0, 40)
  if (json.maxCount) patch.maxCount = clampCount(json.maxCount)
  if (json.interaction === 'comment' || json.interaction === 'comment_like') patch.interaction = json.interaction
  if (typeof json.reply === 'string' && json.reply.trim()) patch.reply = json.reply.trim().slice(0, 200)
  if (!patch.audience && !patch.tags && !patch.excludes && !patch.tone && !patch.reply) return null
  return patch
}

function mergeBrief(brief, patch) {
  const next = { ...brief }
  if (patch.audience) next.audience = patch.audience
  if (patch.offer) next.offer = patch.offer
  if (patch.benefit) next.benefit = patch.benefit
  if (patch.goal) next.goal = patch.goal
  if (patch.tone) next.tone = patch.tone
  if (patch.tags?.length) next.tags = unique([...(next.tags || []), ...patch.tags]).slice(0, 12)
  if (patch.excludes?.length) next.excludes = unique([...(next.excludes || []), ...patch.excludes]).slice(0, 20)
  if (patch.excludesAsked) next.excludesAsked = true
  if (patch.maxCount) next.maxCount = patch.maxCount
  if (patch.interaction) next.interaction = patch.interaction
  if (patch.form === 'text' || patch.form === 'image') next.form = patch.form
  return next
}

function nextQuestion(brief) {
  if (!brief.audience && !brief.tags.length) return '你想投放给什么样的人？用你自己的话说就行。'
  if (!brief.offer) return '你要推广什么产品或服务？'
  if (!brief.benefit) return '它能为这类人解决什么具体问题，或带来什么实际帮助？'
  if (!brief.tags.length) return '我先按这个人群来。你希望优先匹配哪些说法？'
  if (!brief.tone) return '评论想用什么语气？例如像路过的同行。'
  if (!brief.excludes.length && !brief.excludesAsked) return '有没有一定要避开的词？没有的话回我「没有」。'
  return ''
}

function fold(value) {
  return String(value || '').toLowerCase()
}

function hitsExclude(tag, excludes) {
  const name = fold(tag).trim()
  if (!name) return false
  return (excludes || []).some((word) => {
    const blocked = fold(word).trim()
    return blocked && (name.includes(blocked) || blocked.includes(name))
  })
}

function lastAssistant(brief) {
  const messages = Array.isArray(brief?.messages) ? brief.messages : []
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'assistant') return String(messages[i].text || '')
  }
  return ''
}

function cleanReply(text) {
  const line = String(text || '').trim()
  if (!line || /[{}]/.test(line)) return ''
  return line
}

function extractJson(text) {
  const raw = String(text || '').trim()
  if (!raw) return null
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced ? fenced[1] : raw
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(body.slice(start, end + 1))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function wordList(value) {
  const list = Array.isArray(value) ? value : String(value || '').split(/[，,、/|\s]+/)
  return unique(list.map((item) => String(item || '').trim()).filter((item) => item.length >= 2 && item.length <= 16))
}

function idList(value) {
  if (!Array.isArray(value)) return []
  return unique(value.map((item) => String(item || '').trim()).filter((item) => /^[a-z0-9]{12}$/.test(item))).slice(0, 24)
}

function unique(list) {
  return [...new Set(list)]
}

function clampCount(value) {
  const count = Math.floor(Number(value))
  if (!Number.isFinite(count)) return 10
  return Math.min(999, Math.max(1, count))
}

function newId() {
  return `b${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`
}
