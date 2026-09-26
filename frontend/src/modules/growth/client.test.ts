import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  parseGrowthAccountView,
  parseGrowthSettings,
  fetchGrowthAccount,
  startGrowthTask,
  deleteGrowthTask,
  clearGrowthHistory,
  uploadGrowthCommentImages,
  setGrowthPreviewMode,
  setGrowthPreviewMuted,
  pauseGrowthTask,
  groupHasCommentConfig,
  leavesHaveCommentConfig,
} from './client'

afterEach(() => vi.unstubAllGlobals())

describe('growth client', () => {
  it('normalizes settings and account history', () => {
    const settings = parseGrowthSettings({ maxCount: 3, comments: ['学到了', ''], blockKeywords: ['广告'] })
    expect(settings.maxCount).toBe(3)
    expect(settings.comments).toEqual(['学到了'])
    expect(settings.blockKeywords).toEqual(['广告'])
    expect(settings.ruleGroups[0].comments).toEqual(['学到了'])
    expect(settings.ruleGroups[0].children).toEqual([])
    expect(settings.simulateWatchBeforeComment).toBe(true)
    expect(settings.authorBlockKeywords).toEqual([])
    expect(settings.presets).toEqual([])
    expect(settings.campaign).toBeNull()
    const modelled = parseGrowthSettings({
      campaign: { enabled: true, briefId: 'b1', form: 'text', tone: '像路过的同行', seedTags: ['全屋定制'], excludes: ['中介'] },
      ruleGroups: [{ id: 'campaign', name: '投放人群', comments: [], commentSource: 'model', rules: [{ field: 'videoDesc', keyword: '全屋定制' }] }],
    })
    expect(modelled.campaign?.seedTags).toEqual(['全屋定制'])
    expect(modelled.ruleGroups[0].commentSource).toBe('model')
    expect(leavesHaveCommentConfig(modelled.ruleGroups)).toBe(true)
    const nested = parseGrowthSettings({
      ruleGroups: [{
        id: 'p',
        name: '数码评测',
        children: [{
          id: 'c',
          name: '手机平板',
          commentTexts: ['专业测评', '对比清楚'],
          commentImagePath: '/tmp/photos',
          commentImageType: 'folder',
          commentImageName: 'photos',
        }],
      }],
      watchTimeRangeSeconds: [4, 9],
      authorBlockKeywords: ['广告号'],
    })
    expect(nested.comments).toEqual(['专业测评', '对比清楚'])
    expect(nested.ruleGroups[0].children[0].name).toBe('手机平板')
    expect(nested.ruleGroups[0].children[0].commentImagePath).toBe('/tmp/photos')
    expect(nested.ruleGroups[0].children[0].commentImageType).toBe('folder')
    expect(nested.watchTimeRangeSeconds).toEqual([4, 9])
    expect(nested.authorBlockKeywords).toEqual(['广告号'])
    const view = parseGrowthAccountView({
      id: 'douyin:abc',
      loggedIn: true,
      settings: { maxCount: 2, comments: ['好'] },
      history: {
        tasks: [{
          id: 't1',
          status: 'stopped',
          commentCount: 2,
          startTime: Date.parse('2026-09-20T21:31:41+08:00'),
          endTime: Date.parse('2026-09-20T21:32:27+08:00'),
          videoRecords: [{
            videoId: 'v1',
            authorName: '创作者',
            videoDesc: '教程',
            videoTags: ['测评'],
            isCommented: true,
            commentText: '学到了',
            watchDuration: 4500,
            shareUrl: 'https://www.douyin.com/video/v1',
          }],
        }],
        videos: [{ awemeId: '1' }],
        comments: [{ text: '好' }],
      },
    })
    expect(view.loggedIn).toBe(true)
    expect(view.history.comments[0].text).toBe('好')
    expect(view.history.tasks[0].commented).toBe(2)
    expect(view.history.tasks[0].videos?.[0].nickname).toBe('创作者')
    expect(view.history.tasks[0].videos?.[0].isCommented).toBe(true)
    expect(view.history.tasks[0].videos?.[0].text).toBe('学到了')
  })

  it('loads an account and starts a task through runtime endpoints', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'douyin:abc', loggedIn: true, settings: { comments: ['学到了'] }, history: { tasks: [], videos: [], comments: [] } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ growth: { task: { running: true } } }) })
    vi.stubGlobal('fetch', fetcher)
    const view = await fetchGrowthAccount('douyin:abc')
    expect(view.id).toBe('douyin:abc')
    expect(fetcher).toHaveBeenCalledWith('/api/runtime/growth/accounts/douyin%3Aabc', { cache: 'no-store' })
    await startGrowthTask('douyin:abc', parseGrowthSettings({ comments: ['学到了'] }))
    expect(fetcher.mock.calls[1][0]).toBe('/api/runtime/growth/task/start')
    fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
    await deleteGrowthTask('douyin:abc', 't1')
    expect(fetcher.mock.calls[2][0]).toBe('/api/runtime/growth/accounts/douyin%3Aabc/history/t1')
    expect(fetcher.mock.calls[2][1]).toMatchObject({ method: 'DELETE' })
    fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
    await clearGrowthHistory('douyin:abc')
    expect(fetcher.mock.calls[3][0]).toBe('/api/runtime/growth/accounts/douyin%3Aabc/history')
    fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({ path: '/data/img', type: 'file', count: 1 }) })
    await uploadGrowthCommentImages('douyin:abc', 'g1', 'file', [{ name: 'a.png', body: 'aaaa' }])
    expect(fetcher.mock.calls[4][0]).toBe('/api/runtime/growth/accounts/douyin%3Aabc/comment-images')
    fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
    await setGrowthPreviewMode('pip')
    expect(fetcher.mock.calls[5][0]).toBe('/api/runtime/growth/preview/mode')
    expect(fetcher.mock.calls[5][1]).toMatchObject({ method: 'POST' })
    fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
    await pauseGrowthTask(true)
    expect(fetcher.mock.calls[6][0]).toBe('/api/runtime/growth/task/pause')
    expect(fetcher.mock.calls[6][1]).toMatchObject({ method: 'POST' })
    fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
    await setGrowthPreviewMuted(false)
    expect(fetcher.mock.calls[7][0]).toBe('/api/runtime/growth/preview/mute')
    expect(fetcher.mock.calls[7][1]).toMatchObject({ method: 'POST' })
  })

  it('treats text or image as configured comment content on leaves only', () => {
    const leaf = nestedLeaf({ comments: ['评测很专业！'], commentImagePath: '' })
    const imageOnly = nestedLeaf({ comments: [], commentImagePath: '/tmp/a.png' })
    const empty = nestedLeaf({ comments: ['  '], commentImagePath: '' })
    const parent = parseGrowthSettings({
      ruleGroups: [{
        id: 'p',
        name: '数码评测',
        children: [
          { id: 'c1', name: '手机平板', comments: ['好'] },
          { id: 'c2', name: '电脑配件', commentImagePath: '/tmp/img' },
        ],
      }],
    }).ruleGroups[0]
    expect(groupHasCommentConfig(leaf)).toBe(true)
    expect(groupHasCommentConfig(imageOnly)).toBe(true)
    expect(groupHasCommentConfig(empty)).toBe(false)
    expect(groupHasCommentConfig(parent)).toBe(false)
    expect(leavesHaveCommentConfig([parent])).toBe(true)
    expect(leavesHaveCommentConfig([{ ...parent, children: [empty] }])).toBe(false)
  })
})

function nestedLeaf(partial: { comments: string[]; commentImagePath: string }) {
  return parseGrowthSettings({
    ruleGroups: [{ id: 'g', name: 'leaf', comments: partial.comments, commentImagePath: partial.commentImagePath }],
  }).ruleGroups[0]
}
