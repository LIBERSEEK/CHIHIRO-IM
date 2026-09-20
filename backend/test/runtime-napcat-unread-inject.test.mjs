import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  CONTACT_SEARCH_FILE,
  injectRecentContactUnread,
  RECENT_CONTACT_UNREAD_MARK,
} from '../src/runtime/chihiro-napcat-unread.mjs'

const runtimeDir = path.dirname(fileURLToPath(new URL('../src/runtime/chihiro-napcat-unread.mjs', import.meta.url)))

test('inject copies contact-search.mjs beside the wrapped plugin', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chihiro-napcat-inject-'))
  try {
    fs.writeFileSync(path.join(dir, 'index.mjs'), 'export const plugin_init = () => {}\n')
    assert.equal(injectRecentContactUnread(dir), true)
    const index = fs.readFileSync(path.join(dir, 'index.mjs'), 'utf8')
    const helper = fs.readFileSync(path.join(dir, CONTACT_SEARCH_FILE), 'utf8')
    assert.match(index, new RegExp(RECENT_CONTACT_UNREAD_MARK))
    assert.match(index, /from '\.\/contact-search\.mjs'/)
    assert.equal(helper, fs.readFileSync(path.join(runtimeDir, CONTACT_SEARCH_FILE), 'utf8'))
    assert.equal(fs.existsSync(path.join(dir, 'index.ssqq.mjs')), true)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('inject restores a missing contact-search sibling without rewriting a matching index', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chihiro-napcat-inject-'))
  try {
    const wrap = fs.readFileSync(path.join(runtimeDir, 'chihiro-napcat-unread-plugin.mjs'), 'utf8')
    fs.writeFileSync(path.join(dir, 'index.mjs'), wrap)
    fs.writeFileSync(path.join(dir, 'index.ssqq.mjs'), 'export const plugin_init = () => {}\n')
    assert.equal(injectRecentContactUnread(dir), true)
    assert.equal(
      fs.readFileSync(path.join(dir, CONTACT_SEARCH_FILE), 'utf8'),
      fs.readFileSync(path.join(runtimeDir, CONTACT_SEARCH_FILE), 'utf8'),
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('plugin_init registers join_group on ActionMap.get', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chihiro-napcat-inject-'))
  try {
    fs.writeFileSync(path.join(dir, 'index.mjs'), 'export function plugin_init() {}\nexport default { plugin_init }\n')
    assert.equal(injectRecentContactUnread(dir), true)
    const mod = await import(`${pathToFileURL(path.join(dir, 'index.mjs')).href}?t=${Date.now()}`)
    const stock = new Map()
    stock.set('get_recent_contact', { handle: async () => ({}) })
    const actions = {
      get(name) {
        return stock.get(name)
      },
    }
    const logs = []
    await mod.plugin_init({
      core: {
        apis: { UserApi: {}, GroupApi: {}, FriendApi: {} },
        context: { session: {} },
        eventWrapper: {},
      },
      actions,
      logger: {
        info: (...args) => logs.push(args.join(' ')),
        warn: () => {},
      },
    })
    assert.equal(typeof actions.get('join_group')?.websocketHandle, 'function')
    assert.equal(typeof actions.get('add_friend')?.handle, 'function')
    assert.equal(typeof actions.get('search_contact')?.handle, 'function')
    assert.match(logs.join('\n'), /contact actions registered: search_contact, add_friend, join_group/)
    const ret = await actions.get('join_group').handle({ group_id: 'abc' })
    assert.equal(ret.status, 'failed')
    assert.equal(ret.message, 'invalid_group')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('join_group calls NTQQ joinGroup with nested option and surfaces kernel codes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chihiro-napcat-inject-'))
  try {
    fs.writeFileSync(path.join(dir, 'index.mjs'), 'export function plugin_init() {}\nexport default { plugin_init }\n')
    assert.equal(injectRecentContactUnread(dir), true)
    const mod = await import(`${pathToFileURL(path.join(dir, 'index.mjs')).href}?t=${Date.now() + 1}`)
    const calls = []
    const actions = { get() { return undefined } }
    await mod.plugin_init({
      core: {
        apis: {
          UserApi: {},
          FriendApi: {},
          GroupApi: {
            getGroups: async () => [],
            searchGroup: async () => ({
              groupCode: '975206796',
              searchGroupInfo: {
                groupCode: '975206796',
                groupName: 'AstrBot 大学',
                addOption: 5,
                groupQuestion: '在哪了解到本项目的',
                joinGroupAuth: 'auth-token',
              },
            }),
          },
        },
        context: {
          session: {
            getGroupService() {
              return {
                joinGroup(arg) {
                  calls.push(arg)
                  return { result: 2 }
                },
              }
            },
          },
        },
        eventWrapper: {},
      },
      actions,
      logger: { info() {}, warn() {} },
    })
    const ret = await actions.get('join_group').handle({
      group_id: '975206796',
      answer: 'Github',
    })
    assert.equal(ret.status, 'failed')
    assert.equal(ret.message, '申请失败（错误码 2）')
    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0], {
      groupCode: '975206796',
      option: {
        joinGroupSource: 14,
        joinGroupAuth: 'auth-token',
        msg: 'Github',
        joinGroupAnswer: 'Github',
      },
    })
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
