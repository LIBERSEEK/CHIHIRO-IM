import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import test from 'node:test'

import { createGroupIntelligence } from '../../src/core/group-intelligence.mjs'

test('group intelligence creates account-scoped reports with source coverage', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'chihiro-group-intelligence-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const store = createGroupIntelligence({ root })
  const base = { accountId: 'qq:100', channel: 'qq', groupId: '300', groupName: '运营群', conversationId: 'qq:100:group:300', senderId: '200', senderName: '小林' }
  const first = store.ingest({ ...base, messageId: '1', text: '用户关注价格和交付时间', messageAt: 100 })
  assert.equal(store.ingest({ ...base, messageId: '1', text: '用户关注价格和交付时间', messageAt: 100 }).id, first.id)
  store.ingest({ ...base, groupId: '301', groupName: '客户群', conversationId: 'qq:100:group:301', messageId: '2', text: '客户希望下周安排演示', messageAt: 200 })
  store.ingest({ ...base, accountId: 'qq:101', messageId: '3', text: '另一账号消息', messageAt: 300 })

  const report = store.createReport({ title: '本周客户咨询', groupIds: ['300', '301'], from: 50, to: 250 }, { accountId: 'qq:100' })
  assert.equal(report.status, 'ready')
  assert.equal(report.coverage.sourceCount, 2)
  assert.deepEqual(report.coverage.coveredGroupIds, ['300', '301'])
  assert.equal(report.sources.length, 2)
  assert.match(report.summary, /价格和交付时间/)
  assert.equal(store.listReports({ accountId: 'qq:101' }).reports.length, 0)
  assert.throws(() => store.getReport(report.id, { accountId: 'qq:101' }), /report_not_found/)
})

test('empty report records requested scope explicitly', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'chihiro-group-intelligence-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const store = createGroupIntelligence({ root })
  const report = store.createReport({ title: '空范围', groupIds: ['404'] }, { accountId: 'qq:100' })
  assert.equal(report.status, 'draft')
  assert.deepEqual(report.coverage.requestedGroupIds, ['404'])
  assert.deepEqual(report.coverage.coveredGroupIds, [])
  assert.equal(report.coverage.sourceCount, 0)
  assert.match(report.summary, /没有已采集/)
})

test('reports retain all original evidence while filtering and linking duplicates in analysis', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'chihiro-group-filter-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const store = createGroupIntelligence({ root })
  const base = { accountId: 'qq:100', groupId: '300', conversationId: 'qq:100:group:300', senderId: '200' }
  const texts = ['我们预算三万，想月底前上线', '收到', '[图片]', '这个能私有化部署吗？', '三万', '我们预算三万，想月底前上线']
  const originals = texts.map((text, index) => store.ingest({ ...base, text, messageId: String(index), messageAt: index * 1000 }))
  const before = structuredClone(store.load().messages)
  const report = store.createReport({ title: '客户群分析' }, { accountId: 'qq:100' })
  assert.equal(report.coverage.sourceCount, 6)
  assert.equal(report.sources.length, 6)
  assert.equal(report.filter.stats.excludedCount, 2)
  assert.equal(report.filter.stats.duplicateCount, 1)
  assert.equal(report.analysisSources.length, 3)
  assert.equal(report.sources[4].filter.label, 'signal')
  assert.equal(report.sources[5].filter.duplicateOf, originals[0].id)
  assert.match(report.summary, /预算三万/)
  assert.doesNotMatch(report.summary, /收到|\[图片\]/)
  assert.deepEqual(store.load().messages, before)
  const reloaded = createGroupIntelligence({ root }).getReport(report.id, { accountId: 'qq:100' })
  assert.deepEqual(reloaded, report)
  assert.equal(store.listReports({ accountId: 'qq:100' }).reports[0].filter.decisions, undefined)
  const notice = store.createReport({ title: '只看通知', filter: { profile: 'notice' } }, { accountId: 'qq:100' })
  assert.equal(notice.status, 'ready')
  assert.equal(notice.analysisSources.length, 0)
  assert.match(notice.summary, /原始消息仍可查看/)
  assert.equal(notice.sources.length, 6)
  assert.deepEqual(store.getReport(report.id, { accountId: 'qq:100' }), report)
})

test('report context cannot leak across account, group or requested time scope', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'chihiro-group-scope-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const store = createGroupIntelligence({ root })
  const base = { accountId: 'qq:100', groupId: '300', conversationId: 'qq:100:group:300' }
  store.ingest({ ...base, messageId: 'q', text: '请确认方案可以吗？', messageAt: 0 })
  store.ingest({ ...base, messageId: 'a', text: '收到', messageAt: 1000 })
  const restricted = store.createReport({ title: '后续', from: 1000 }, { accountId: 'qq:100' })
  assert.equal(restricted.analysisSources.length, 0)
  const zero = store.createReport({ title: '起点', from: 0, to: 0 }, { accountId: 'qq:100' })
  assert.equal(zero.coverage.sourceCount, 1)
  assert.equal(zero.coverage.to, 0)
  store.ingest({ ...base, accountId: 'qq:101', messageId: 'other', text: '收到', messageAt: 1000 })
  assert.equal(store.createReport({ title: '另一个账号' }, { accountId: 'qq:101' }).analysisSources.length, 0)
  assert.throws(() => store.createReport({ title: '无效', from: 10, to: 0 }, { accountId: 'qq:100' }), /invalid_time_range/)
})

test('existing reports without filter snapshots remain readable', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'chihiro-group-legacy-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const filePath = path.join(root, 'legacy.json')
  const source = { id: 'old_message', accountId: 'qq:100', text: '原始消息' }
  const oldReport = { id: 'old_report', accountId: 'qq:100', status: 'ready', sourceIds: [source.id], summary: '原摘要' }
  await writeFile(filePath, JSON.stringify({ messages: { [source.id]: source }, reports: { [oldReport.id]: oldReport } }))
  const report = createGroupIntelligence({ filePath }).getReport(oldReport.id, { accountId: 'qq:100' })
  assert.deepEqual(report.sources, [source])
  assert.deepEqual(report.analysisSources, [source])
  assert.equal(report.summary, '原摘要')
})
