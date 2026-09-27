/** Client types shown in the add-account dropdown. QQ and Douyin are live. */

export const CLIENTS = [
  {
    id: 'qq',
    name: 'QQ',
    badge: 'QQ',
    enabled: true,
    login: 'qr',
    hint: '使用 QQ 副本登录，可多号同时在线，不占用你自己打开的原生 QQ'
  },
  {
    id: 'douyin',
    name: '抖音',
    badge: '抖',
    enabled: true,
    login: 'browser',
    hint: '选择本机 Chrome，登录后在工作台浏览推荐流并评论'
  },
  {
    id: 'xiaohongshu',
    name: '小红书',
    badge: '红',
    enabled: true,
    login: 'browser',
    hint: '选择本机 Chrome，登录后按任务卡上的标签搜索笔记并评论'
  },
  {
    id: 'bilibili',
    name: '哔哩哔哩',
    badge: 'B',
    enabled: true,
    login: 'browser',
    hint: '选择本机 Chrome，登录后按任务卡上的关键词搜索视频并评论'
  },
  { id: 'telegram', name: 'Telegram', badge: 'TG', enabled: false, login: 'token' },
  { id: 'lark', name: '飞书', badge: '飞', enabled: false, login: 'oauth' },
  { id: 'dingtalk', name: '钉钉', badge: '钉', enabled: false, login: 'oauth' },
  { id: 'wecom', name: '企业微信', badge: '微', enabled: false, login: 'oauth' },
  { id: 'official-account', name: '微信公众号', badge: '公', enabled: false, login: 'token' },
  { id: 'discord', name: 'Discord', badge: 'DC', enabled: false, login: 'token' },
  { id: 'slack', name: 'Slack', badge: 'SL', enabled: false, login: 'token' },
  { id: 'line', name: 'LINE', badge: 'LN', enabled: false, login: 'token' },
  { id: 'kook', name: 'KOOK', badge: 'KK', enabled: false, login: 'token' }
]

export function getClient(id) {
  return CLIENTS.find((c) => c.id === id) || null
}
