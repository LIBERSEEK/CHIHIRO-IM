import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { classifyBatch, normalizeFilterOptions } from './message-filter.mjs'

const REPORT_STATUSES = new Set(['draft', 'ready'])

export function createGroupIntelligence({ root, filePath } = {}) {
  const stateFile = filePath || path.join(root, 'data/core/group-intelligence.json')

  function load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
      return { messages: parsed.messages || {}, reports: parsed.reports || {} }
    } catch {
      return { messages: {}, reports: {} }
    }
  }

  function save(state) {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true })
    const temporary = `${stateFile}.${process.pid}.${Date.now()}.tmp`
    fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`)
    fs.renameSync(temporary, stateFile)
  }

  function ingest(raw) {
    const input = normalizeMessage(raw)
    const state = load()
    const id = evidenceId(input)
    const existing = state.messages[id]
    state.messages[id] = existing || { ...input, id, ingestedAt: Date.now() }
    if (!existing) save(state)
    return state.messages[id]
  }

  function createReport(raw, { accountId } = {}) {
    if (!accountId) throw new Error('missing_account')
    const request = normalizeReport(raw)
    const state = load()
    const allowedGroups = request.groupIds.length ? new Set(request.groupIds) : null
    const sources = Object.values(state.messages)
      .filter((item) => item.accountId === accountId)
      .filter((item) => !allowedGroups || allowedGroups.has(item.groupId))
      .filter((item) => request.from == null || item.messageAt >= request.from)
      .filter((item) => request.to == null || item.messageAt <= request.to)
      .sort((left, right) => left.messageAt - right.messageAt)
    const filtered = classifyBatch(sources, request.filter)
    const analysisSources = filtered.messages.map((item) => state.messages[item.id])
    const coverage = {
      requestedGroupIds: request.groupIds,
      coveredGroupIds: Array.from(new Set(sources.map((item) => item.groupId))).sort(),
      sourceCount: sources.length,
      from: request.from ?? (sources[0]?.messageAt ?? null),
      to: request.to ?? (sources.at(-1)?.messageAt ?? null),
    }
    const report = {
      id: `report_${randomUUID()}`,
      accountId,
      title: request.title,
      prompt: request.prompt,
      status: sources.length ? 'ready' : 'draft',
      coverage,
      sourceIds: sources.map((item) => item.id),
      analysisSourceIds: analysisSources.map((item) => item.id),
      filter: {
        options: filtered.options,
        ruleVersion: filtered.ruleVersion,
        stats: filtered.stats,
        decisions: filtered.decisions,
      },
      summary: summarize(analysisSources, coverage, filtered.stats),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    state.reports[report.id] = report
    save(state)
    return detail(state, report)
  }

  function listReports({ accountId } = {}) {
    if (!accountId) throw new Error('missing_account')
    const state = load()
    const reports = Object.values(state.reports)
      .filter((report) => report.accountId === accountId)
      .sort((left, right) => right.createdAt - left.createdAt)
      .map((report) => ({ ...report, filter: report.filter ? { ...report.filter, decisions: undefined } : undefined, sources: undefined }))
    return { reports }
  }

  function getReport(id, { accountId } = {}) {
    if (!accountId) throw new Error('missing_account')
    const state = load()
    const report = state.reports[id]
    if (!report || report.accountId !== accountId) throw new Error('report_not_found')
    return detail(state, report)
  }

  return { ingest, createReport, listReports, getReport, load, filePath: stateFile }
}

function normalizeMessage(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid_body')
  const accountId = required(raw.accountId, 'accountId', 128)
  const groupId = required(raw.groupId, 'groupId', 128)
  const conversationId = required(raw.conversationId, 'conversationId', 256)
  const messageId = required(raw.messageId, 'messageId', 256)
  const text = required(raw.text, 'text', 20000)
  const messageAt = integer(raw.messageAt, 'messageAt')
  return {
    accountId,
    channel: optional(raw.channel, 32) || 'qq',
    groupId,
    groupName: optional(raw.groupName, 160),
    conversationId,
    messageId,
    senderId: optional(raw.senderId, 128),
    senderName: optional(raw.senderName, 160),
    text,
    messageAt,
  }
}

function normalizeReport(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid_body')
  const groupIds = Array.isArray(raw.groupIds)
    ? Array.from(new Set(raw.groupIds.map((value) => required(value, 'groupId', 128))))
    : []
  const from = raw.from == null ? null : integer(raw.from, 'from')
  const to = raw.to == null ? null : integer(raw.to, 'to')
  if (from != null && to != null && from > to) throw new Error('invalid_time_range')
  return {
    title: required(raw.title, 'title', 160),
    prompt: optional(raw.prompt, 2000),
    groupIds,
    from,
    to,
    filter: normalizeFilterOptions(raw.filter),
  }
}

function evidenceId(input) {
  return `groupmsg_${createHash('sha256').update(`${input.accountId}\u001f${input.conversationId}\u001f${input.messageId}`).digest('hex').slice(0, 24)}`
}

function summarize(sources, coverage, stats) {
  if (!coverage.sourceCount) return '当前范围内没有已采集的信息。'
  const scope = `覆盖 ${coverage.coveredGroupIds.length} 个群聊、${coverage.sourceCount} 条消息。`
  const filtering = `保留 ${stats.analysisCount} 条分析素材，排除 ${stats.excludedCount} 条，合并 ${stats.duplicateCount} 条重复消息。`
  if (!sources.length) return `${scope}\n${filtering}\n当前过滤策略下没有可分析的信息，原始消息仍可查看。`
  const excerpts = sources.slice(-8).map((item) => `${item.groupName || item.groupId}：${item.text}`).join('\n')
  return `${scope}\n${filtering}\n${excerpts}`
}

function detail(state, report) {
  if (!REPORT_STATUSES.has(report.status)) throw new Error('invalid_report_status')
  const decisions = new Map((report.filter?.decisions || []).map((item) => [item.sourceId, item]))
  const sources = report.sourceIds.map((id) => state.messages[id]).filter(Boolean)
    .map((item) => decisions.has(item.id) ? { ...item, filter: decisions.get(item.id) } : item)
  const byId = new Map(sources.map((item) => [item.id, item]))
  return {
    ...report,
    sources,
    analysisSources: (report.analysisSourceIds || report.sourceIds).map((id) => byId.get(id)).filter(Boolean),
  }
}

function required(value, name, max) {
  const cleaned = optional(value, max)
  if (!cleaned) throw new Error(`missing_${name}`)
  return cleaned
}

function optional(value, max) {
  if (value == null) return ''
  if (typeof value !== 'string') throw new Error('invalid_string')
  const cleaned = value.trim()
  if (cleaned.length > max) throw new Error('value_too_long')
  return cleaned
}

function integer(value, name) {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(`invalid_${name}`)
  return number
}
