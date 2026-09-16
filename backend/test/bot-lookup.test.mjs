import assert from 'node:assert/strict'
import test from 'node:test'
import { extractGithubRepos, lookupFacts, needsLookup } from '../src/runtime/bot-lookup.mjs'

test('needsLookup catches github and repo questions', () => {
  assert.equal(needsLookup('哈哈'), false)
  assert.equal(needsLookup('GitHub 上 CHIHIRO 仓库里有什么'), true)
  assert.equal(needsLookup('https://github.com/LIBERSEEK/CHIHIRO 目录发一下'), true)
})

test('extractGithubRepos reads explicit repos and 千寻', () => {
  assert.deepEqual(extractGithubRepos('看 https://github.com/LIBERSEEK/CHIHIRO'), ['LIBERSEEK/CHIHIRO'])
  assert.ok(extractGithubRepos('千寻 IM 仓库').includes('LIBERSEEK/CHIHIRO'))
})

test('lookupFacts fetches repo metadata and root files', async () => {
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(String(url))
    const path = String(url).replace('https://api.github.com', '')
    const json = (body) => ({ ok: true, json: async () => body })
    if (path === '/repos/LIBERSEEK/CHIHIRO') {
      return json({
        full_name: 'LIBERSEEK/CHIHIRO',
        html_url: 'https://github.com/LIBERSEEK/CHIHIRO',
        description: '千寻 IM workbench',
        stargazers_count: 12,
        language: 'TypeScript',
        default_branch: 'develop',
      })
    }
    if (path === '/repos/LIBERSEEK/CHIHIRO/readme') {
      return json({ encoding: 'base64', content: Buffer.from('# Chihiro\nQQ IM workbench').toString('base64') })
    }
    if (path === '/repos/LIBERSEEK/CHIHIRO/contents/') {
      return json([{ name: 'README.md' }, { name: 'frontend' }, { name: 'backend' }])
    }
    return { ok: false, json: async () => ({}) }
  }
  const facts = await lookupFacts('GitHub 上 LIBERSEEK/CHIHIRO 仓库里有什么', { fetchImpl })
  assert.match(facts, /LIBERSEEK\/CHIHIRO/)
  assert.match(facts, /千寻 IM workbench/)
  assert.match(facts, /README.md/)
  assert.match(facts, /QQ IM workbench/)
  assert.equal(calls.length, 3)
})
