# 千寻给 Agent 的手

不用配 MCP JSON。工作台开着时，把这段交给任意能发 HTTP 的 Agent：

**链接：** http://127.0.0.1:3100/mcp

或直接粘贴：

```
# 千寻 QQ 手

本机工作台已打开：http://127.0.0.1:3100
用 HTTP 操作，不要编造账号或对方 QQ 号。contact（加好友/入群）可直接执行，可对多个已观察到的号码连续调用，用于获客和营销。同一账号连续提交会由服务端间隔约 6–10 秒，避免风控；已是好友/已在群里立即返回。发送走工作台闸门（ask/auto/always）。图片路径必须是已有文件。

## 看 observe
GET http://127.0.0.1:3100/api/runtime/agent/observe?kind=KIND
KIND：accounts | sessions | session | messages | drafts | friends | groups | members | requests

- accounts 不必带账号
- 其余加 &accountId=qq:QQ号
- **session / messages**：看某个私聊或群里实际聊了什么（直接桥接 QQ 历史）
  - 必加 &peerId=对方QQ或群号&type=private|group
  - 可选 &count=30（默认 30，最大 100）
  - session 带元数据 + messages（QQ 正文）+ agentMessages
  - messages 只返回聊天正文
- members 再加 &groupId=群号
- **requests**：看别人发来的好友申请、入群邀请/申请（不是主动加）

## 发 send
POST http://127.0.0.1:3100/api/runtime/agent/send
Content-Type: application/json

{"accountId":"qq:我的QQ","peerId":"对方QQ","type":"private","text":"正文"}
群聊 type 用 group。可选 "image": "本地路径或URL"（图由你自己生成）。

## 关系 contact
POST http://127.0.0.1:3100/api/runtime/agent/contact
Content-Type: application/json

加好友：
{"accountId":"qq:我的QQ","action":"add_friend","userId":"对方QQ","message":"可选验证信息"}
已是好友会返回 already=true，不会再发申请。可连续对多个 userId 调用；真正提交时服务端会排队并间隔约 6–10 秒。

入群：
{"accountId":"qq:我的QQ","action":"join_group","groupId":"群号","comment":"可选验证信息"}
已在群里会返回 already=true。群需可搜索。可连续对多个 groupId 调用；真正提交同样按账号间隔。该 QQ 实例需已加载加好友/入群动作（未加载时会提示重启账号）。

## 闸门
改权限：POST /api/runtime/agent/mode
{"accountId":"qq:我的QQ","mode":"ask"}
mode：ask / auto / always。可再加 peerId、type。

批准：POST /api/runtime/agent/draft/approve  {"id":"草稿id"}
丢弃：POST /api/runtime/agent/draft/discard  {"id":"草稿id"}
```

## 试用

先重启网关，登录 QQ，再把上面整段（或链接里的全文）丢给 Agent。

摸手：只 observe accounts、groups、friends，不要发消息，中文汇报几个号/群/好友。

读群：observe kind=session（或 messages）+ peerId=群号 + type=group，用返回的 messages 汇报最近聊了什么。

入站：observe drafts，有草稿先念给我，等我点头再 approve。

获客：observe groups → members，对已观察到的 userId 直接 contact add_friend；对目标群号直接 join_group。可连续调用，不必先问。服务端会对同一账号的真正提交间隔约 6–10 秒。

触达：send 走闸门。mode=always 时可直接发；mode=ask 时先出草稿。间隔约 8 秒，避免平台频控。

stdio MCP（`npm run mcp`）仍可用，不是默认用法。
