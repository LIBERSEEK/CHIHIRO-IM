import { runDouyinFeedTask } from './douyin/index.mjs'
import { runXiaohongshuNoteTask, waitForXiaohongshuLogin } from './xiaohongshu/index.mjs'
import { runBilibiliVideoTask, waitForBilibiliLogin } from './bilibili/index.mjs'

export const platformRegistry = new Map([
  ['douyin', {
    id: 'douyin',
    label: '抖音',
    capabilities: { search: true, comment: true, commentImages: true, like: true },
    run: runDouyinFeedTask,
  }],
  ['xiaohongshu', {
    id: 'xiaohongshu',
    label: '小红书',
    capabilities: { search: true, comment: true, commentImages: false, like: true },
    waitForLogin: waitForXiaohongshuLogin,
    run: runXiaohongshuNoteTask,
  }],
  ['bilibili', {
    id: 'bilibili',
    label: '哔哩哔哩',
    capabilities: { search: true, comment: true, commentImages: true, maxCommentImages: 9, like: true },
    waitForLogin: waitForBilibiliLogin,
    run: runBilibiliVideoTask,
  }],
])

export function getPlatformAdapter(platform) {
  return platformRegistry.get(String(platform || '').trim()) || null
}
