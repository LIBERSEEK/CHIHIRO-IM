import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyMessage, classifyBatch, dedupeMessages, explainDecision, normalizeMessage, FILTER_VERSION } from '../../src/core/message-filter.mjs'

const message = (text, overrides = {}) => ({
  id: 'm1', accountId: 'qq:100', channel: 'qq', groupId: '300',
  conversationId: 'qq:100:group:300', senderId: '200', messageAt: 1000, text, ...overrides,
})

test('analysis preserves customer needs, questions, feedback and uncertain information', () => {
  const evidence = [
    '这个能私有化部署吗？', '我们预算三万，想月底前上线',
    '刚测了新版，长上下文准确率明显下降', '价格太高了，我们先不用了',
    '请问你们支持批量导出吗？', '不支持', '三万', '确认',
    '我用另一套工具处理长文本，效果还不错', 'AI工具推荐：https://example.com',
    '今天天气不错', '👍',
  ]
  for (const text of evidence) {
    const decision = classifyMessage(message(text))
    assert.equal(decision.included, true, text)
    assert.ok(['signal', 'review'].includes(decision.label), text)
    assert.equal(decision.ruleVersion, FILTER_VERSION)
  }
  const weather = classifyMessage(message('今天天气不错'))
  assert.equal(weather.label, 'review')
  assert.equal(weather.score, 0)
  assert.equal(weather.features.hasTimeExpression, true)
})

test('only full acknowledgements and empty media placeholders are excluded', () => {
  for (const text of ['收到！', '哈哈哈哈', '好的', '谢谢', '+1', 'ＯＫ！', '早安']) {
    const result = classifyMessage(message(text))
    assert.equal(result.label, 'chatter', text)
    assert.equal(result.included, false, text)
  }
  for (const text of ['[图片]', '[表情] [表情]', '小林撤回了一条消息', '']) {
    assert.equal(classifyMessage(message(text)).label, 'noise', text)
  }
  for (const text of ['收到，但价格太高了', '[文件] 采购预算表.xlsx', '[图片] 产品反馈截图']) {
    assert.equal(classifyMessage(message(text)).included, true, text)
  }
  assert.match(explainDecision(classifyMessage(message('收到'))), /确认或客套语/)
})

test('short answers use recent same-conversation context without retaining social chatter', () => {
  const context = [message('大家确认这个方案吗？', { id: 'question', messageAt: 500 })]
  for (const text of ['确认', '收到', '三万', '不支持']) {
    const result = classifyMessage(message(text), { context })
    assert.equal(result.label, 'signal', text)
    assert.ok(result.reasons.includes('contextual_reply'), text)
  }
  assert.equal(classifyMessage(message('哈哈哈哈'), { context }).included, false)
  for (const overrides of [
    { accountId: 'qq:101' }, { groupId: '301' }, { channel: 'wechat' }, { conversationId: 'other' },
    { messageAt: 301001 }, { messageAt: 499 },
  ]) {
    assert.equal(classifyMessage(message('收到', overrides), { context }).included, false, JSON.stringify(overrides))
  }
  assert.equal(classifyMessage(message('收到'), { context: [message('继续讨论', { messageAt: 500 })] }).included, false)
  assert.equal(classifyMessage(message(''), { context }).label, 'noise')
  assert.equal(classifyMessage(message('需求部成员退出了群聊'), { context }).label, 'noise')
})

test('notice mode requires notices, directives or configured keywords', () => {
  for (const text of ['请各位今天18:00前提交报名表', '通知：明天停课', '发布公告']) {
    assert.equal(classifyMessage(message(text), { profile: 'notice' }).included, true, text)
  }
  for (const text of ['今天天气不错', '请问你们支持批量导出吗？', '价格太高了', '收到']) {
    assert.equal(classifyMessage(message(text), { profile: 'notice' }).included, false, text)
  }
  assert.equal(classifyMessage(message('项目进展怎么样？'), {
    profile: 'notice', groupPolicy: { keywords: ['项目'] },
  }).included, true)
  assert.equal(classifyMessage(message('发布通知', { senderName: '管理员' })).features.isAuthority, false)
  assert.equal(classifyMessage(message('发布通知'), { groupPolicy: { senderRoles: { 200: 'admin' } } }).features.isAuthority, true)
  assert.equal(classifyMessage(message('发布通知'), { profile: 'notice', groupPolicy: { minScore: 8 } }).included, false)
  assert.equal(classifyMessage(message('项目进展？'), { profile: 'notice', groupPolicy: { minScore: 20, keywords: ['项目'] } }).included, true)
})

test('batch sorts input and scopes context and group keyword overrides', () => {
  const messages = [
    message('收到', { id: 'answer', messageAt: 2000 }),
    message('收到', { id: 'other', groupId: '301', messageAt: 2100 }),
    message('项目进展？', { id: 'question', messageAt: 1000 }),
    message('项目进展？', { id: 'another', groupId: '302', messageAt: 2200 }),
  ]
  const original = structuredClone(messages)
  const result = classifyBatch(messages, { profile: 'notice', groupPolicies: { 300: { keywords: ['项目'] } } })
  assert.deepEqual(messages, original)
  assert.deepEqual(result.messages.map(item => item.id), ['question'])
  assert.equal(result.decisions.find(item => item.sourceId === 'answer').label, 'signal')
  assert.equal(result.decisions.find(item => item.sourceId === 'other').label, 'chatter')
  assert.equal(result.decisions.find(item => item.sourceId === 'another').included, false)
})

test('deduplication links cross-group evidence but protects numbers, negations and account boundaries', () => {
  const text = '请各位在10月12日18:00前提交项目材料，务必确认预算为3万元，请保留完整的数据分析和产品反馈记录。'
  const messages = [
    message(text, { id: 'first' }),
    message(text, { id: 'copy', groupId: '301', messageAt: 2000 }),
    message(text.replace('，务必', '。务必'), { id: 'punctuation', messageAt: 3000 }),
    message(text.replace('3万元', '5万元'), { id: 'budget', messageAt: 4000 }),
    message(text.replace('请保留', '请不要保留'), { id: 'negative', messageAt: 5000 }),
    message(text, { id: 'account', accountId: 'qq:101' }),
    message(text, { id: 'channel', channel: 'wechat' }),
    message(text, { id: 'tomorrow', messageAt: 86402000 }),
  ]
  const original = structuredClone(messages)
  const result = dedupeMessages(messages)
  assert.deepEqual(result.messages.map(item => item.id), ['first', 'account', 'channel', 'budget', 'negative', 'tomorrow'])
  assert.deepEqual(result.messages[0].duplicateIds, ['copy', 'punctuation'])
  assert.deepEqual(messages, original)
  const batch = classifyBatch(messages)
  assert.equal(batch.stats.duplicateCount, 2)
  assert.equal(batch.decisions.find(item => item.sourceId === 'copy').duplicateOf, 'first')
  assert.equal(batch.stats.sourceCount, batch.stats.excludedCount + batch.stats.duplicateCount + batch.stats.analysisCount)
  assert.equal(classifyBatch(messages, { dedupe: false }).stats.analysisCount, 8)
})

test('near duplicate matching preserves substantive changes and only merges very similar long texts', () => {
  const text = '请各位认真整理项目讨论中的需求与反馈，并在提交之前核对每一条原始消息的来源，确保预算和产品评价均能回到真实证据。还需要检查消息覆盖范围是否完整，记录未采集到的时间段，并按不同群分别整理讨论意见，保留每一条反馈的原始出处，避免在综合报告中遗漏参与人员提出的需求和产品建议。'
  const result = dedupeMessages([
    message(text, { id: 'first' }),
    message(text.replace('认真整理', '细心整理'), { id: 'similar', messageAt: 2000 }),
    message(text.replace('确保预算和产品评价均能回到真实证据', '把预算和产品评价删掉，不再保留任何真实证据'), { id: 'different', messageAt: 3000 }),
  ])
  assert.ok(result.messages.some(item => item.id === 'different'))
  assert.deepEqual(result.duplicates.map(item => item.sourceId), ['similar'])
  assert.equal(dedupeMessages([
    message(`明天${text}`, { id: 'today' }),
    message(`后天${text}`, { id: 'later', messageAt: 2000 }),
  ]).duplicates.length, 0)
  const answers = classifyBatch([
    message('你们预算多少？', { id: 'q' }),
    message('三万', { id: 'a', messageAt: 2000, senderId: '201' }),
    message('三万', { id: 'b', messageAt: 3000, senderId: '202' }),
  ])
  assert.equal(answers.stats.duplicateCount, 0)
  assert.equal(answers.stats.analysisCount, 3)
})

test('labeled mixed-chat fixture retains all useful evidence and excludes clear noise', () => {
  const useful = ['这个能私有化部署吗？', '我们预算三万，想月底前上线', '价格太高了，我们先不用了', '刚测了新版，长上下文准确率明显下降', '分享一下处理长文本的实践：先分段再对齐原文', '三万']
  const noise = ['早安', '哈哈哈哈', '[表情]', '晚安', '谢谢', '[图片]']
  const fixture = [...useful, ...noise].map((text, index) => message(text, { id: `m${index}`, messageAt: index * 1000 }))
  const result = classifyBatch(fixture)
  assert.equal(result.stats.analysisCount, useful.length)
  assert.equal(result.stats.excludedCount, noise.length)
  assert.deepEqual(result.messages.map(item => item.text), useful.map(text => normalizeMessage(message(text)).text))
})

test('invalid policies fail explicitly rather than silently changing filtering', () => {
  for (const options of [null, { profile: 'aggressive' }, { dedupe: 'yes' }, { groupPolicy: { keywords: '预算' } }, { groupPolicies: [] }, { groupPolicy: { minScore: -1 } }, { groupPolicy: { senderRoles: { 1: 'teacher' } } }]) {
    assert.throws(() => classifyBatch([], options), /invalid_filter/)
  }
  for (const messages of [null, [message('预算', { id: '' })], [message('预算', { messageAt: '1000' })], [message('预算'), message('第二条')]]) {
    assert.throws(() => classifyBatch(messages), /invalid_filter/)
  }
})
