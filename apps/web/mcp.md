# 千寻 QQ 手

本机工作台已打开：http://127.0.0.1:3100
用 HTTP 操作，不要编造账号或对方 QQ 号。contact（加好友/入群）可直接执行，可对多个已观察到的号码连续调用，用于获客和营销。同一账号连续提交会由服务端间隔约 6–10 秒，避免风控；已是好友/已在群里立即返回。发送走工作台闸门（ask/auto/always）。图片路径必须是已有文件。

## 看 observe
GET http://127.0.0.1:3100/api/runtime/agent/observe?kind=KIND
KIND：accounts | sessions | session | messages | drafts | friends | groups | members | requests

- accounts 不必带账号
- 其余加 &accountId=qq:QQ号
- **session / messages**：看某个私聊或群里实际聊了什么（直接桥接 QQ 历史，不依赖 Agent 是否追踪过）
  - 必加 `&peerId=对方QQ或群号&type=private|group`
  - 可选 `&count=30`（默认 30，最大 100）
  - `session` 返回元数据 + `messages`（QQ 正文）+ `agentMessages`（Agent 流水）
  - `messages` 只返回精简聊天正文列表
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

## 闸门 gate
改权限：
POST http://127.0.0.1:3100/api/runtime/agent/mode
{"accountId":"qq:我的QQ","mode":"ask"}
mode：ask=每条先问我，auto=只拦链接/图片/@全体，always=直接发。可再加 peerId、type 只改一个会话。

批准草稿：
POST http://127.0.0.1:3100/api/runtime/agent/draft/approve
{"id":"草稿id"}

丢弃草稿：
POST http://127.0.0.1:3100/api/runtime/agent/draft/discard
{"id":"草稿id"}
