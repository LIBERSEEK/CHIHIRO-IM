# 群聊分析过滤组件

`backend/src/core/message-filter.mjs` 是本地纯函数组件，不调用模型、不写库。现已接入群情报报告 API，默认启用 `analysis` 模式。现有报告摘要仍是最近 8 条入选素材的摘录；本次没有增加 LLM 总结、自动采集、话题聚类或 UI 面板。

## 行为

- `analysis`：保留问题、需求、预算、反馈、异议、链接和行动要求。未命中规则的内容标记为 `review`，继续保留；时间词本身不加分。
- `notice`：只纳入达到本群分值门槛的通知、明确要求及群关键词命中的内容。问题仍可被关键词保留，不沿用上游的疑问句硬拒绝。
- `chatter`：整条都是确认、客套或问候，默认排除。最近 5 分钟、同账号/渠道/群/会话、最多前 12 条内有问题时，短回答（含“收到”“好的”）标记为 `signal`；笑声、问候和纯感谢不会因此保留。
- `noise`：空文本、系统消息及纯媒体占位符。`[图片] 产品反馈截图` 等带说明的消息不作为纯占位符；表情符号保留为待判断。组件不理解图片内容，原媒体占位符与其证据仍保留，后续 OCR/转写应作为新的分析输入。
- 管理员身份只认显式 `senderRoles`，不根据昵称推断。
- 去重限定同账号、同渠道、24 小时内。完整保留原始证据，用 `duplicateOf` 关联代表消息；预算数字、日期、URL、否定词不同不合并。去掉标点后不足 12 字的短回复不合并，保留不同参与者的独立证据。长文本采用非常严格的三字片段相似度；最多比较该账号/渠道最近 200 条代表消息。对有细微语义差别的长文本，规则仍可能误合并，可设置 `dedupe: false`。

`confidence` 是规则启发值，不是校准后的正确概率。`review` 表示规则不足以判断，不表示内容质量低。

## 报告 API

通过 Gateway 调用 `POST /api/runtime/group-intelligence/reports`，设置 `x-chihiro-account`。兼容原来的请求，不传 `filter` 时默认分析模式与去重。

```json
{
  "title": "客户群需求分析",
  "groupIds": ["300", "301"],
  "filter": {
    "profile": "analysis",
    "dedupe": true,
    "groupPolicy": { "keywords": ["采购", "私有化"] },
    "groupPolicies": {
      "300": {
        "keywords": ["预算", "部署"],
        "minScore": 3,
        "senderRoles": { "200": "admin" }
      }
    }
  }
}
```

群策略按群 ID 覆盖整个默认策略；不按群名匹配，不接受任意正则。`senderRoles` 可选 `admin`、`owner`、`member`。每组最多 100 个关键词，每个最多 128 字符，最多配置 200 个群。

`minScore` 默认 3，可取 0–20 的整数，仅用于通知模式；群关键词命中可直接保留。分析模式不按低分排除未知内容。规则权重：问题 +2、业务线索 +3、链接 +1、通知措辞 +3、明确行动要求 +4、通知时间线索 +2、配置的管理员通知 +2、短回复上下文 +2、群关键词 +4；纯客套语为 -6。

响应字段：

| 字段 | 含义 |
| --- | --- |
| `coverage.sourceCount` / `sourceIds` / `sources` | 当前账号、群、时间范围内全部原始证据，过滤不改变覆盖数 |
| `analysisSourceIds` / `analysisSources` | 筛选和去重后用于摘要的代表消息 |
| `sources[].filter` | 本次报告的标签、分值、启发置信度、规则命中、解释、是否入选与重复引用 |
| `filter.options` / `filter.ruleVersion` | 报告生成时的配置和规则版本快照 |
| `filter.decisions` | 每条原始消息的判定快照；列表 API 省略此字段，详情 API 返回 |
| `filter.stats` | 原始数量、各标签数量、排除数量、入选原文数量、合并数量与分析数量 |

统计恒等式：`sourceCount = excludedCount + duplicateCount + analysisCount`。`includedSourceCount` 含重复来源；`included: true` 的消息仍可能通过 `duplicateOf` 合并到代表消息。重复来源的发送者、群和时间可通过完整 `sources` 找回。

先按账号、群、时间范围选证据，再计算上下文与过滤，避免越界引用。判定按报告保存，不修改原始消息。重建报告可换策略，旧报告保持原判定；旧版未带过滤快照的报告仍可读取。有消息但全部被筛除的报告仍为 `ready`，明确显示“当前过滤策略下没有可分析的信息”，避免将其误写成未采集。

## 组件调用

```js
import { classifyBatch, classifyMessage, explainDecision } from '../core/message-filter.mjs'

const decision = classifyMessage(message, { profile: 'analysis', context: previousMessages })
const explanation = explainDecision(decision)
const { messages: analysisMessages, decisions, stats } = classifyBatch(messages, {
  profile: 'analysis',
  dedupe: true,
})
```

批处理输入须有稳定的 `id`、`accountId`、`channel`、`groupId`、`conversationId`、`text` 和以毫秒为单位的 `messageAt`。批处理按消息时间排序；传入数组与原消息不被修改。`normalizeMessage`、`extractFeatures`、`dedupeMessages` 也可单独调用。

## 验证与来源

回归覆盖上游规则误删的私有化询问、预算、反馈、异议，短回复上下文，账号/群/时间范围，纯客套和媒体占位符，去重数字/否定保护，存储重载，旧报告兼容与 HTTP 接口。小型标注用例是回归样本，不代表真实群聊召回率或过滤率；上线调参前需要用脱敏真实群聊评估。

```sh
node --test backend/test/core/message-filter.test.mjs backend/test/core/group-intelligence.test.mjs backend/test/runtime-group-intelligence-api.test.mjs
```

设计参考 [wc985732-lang/qq-live-digest](https://github.com/wc985732-lang/qq-live-digest/tree/a36b538e5a5760b6381beec3196eebc59a7e4d4e) 的规则、按群配置与判定轨迹。千寻组件用 JavaScript 独立实现，重设了分析模式和上下文策略，不引入其 Python 服务、校园词表、截止日期解析、待办和推送系统。上游 MIT 许可及版权声明见 [ACKNOWLEDGMENTS.md](ACKNOWLEDGMENTS.md)。
