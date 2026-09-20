import assert from 'node:assert/strict'
import test from 'node:test'

import {
  joinGroupCall,
  joinGroupResultMessage,
  kernelJoinArgs,
  mapSearchGroup,
  mapSearchUser,
} from '../src/runtime/contact-search.mjs'

test('mapSearchUser keeps age and birthday for search tags', () => {
  assert.deepEqual(mapSearchUser({
    uin: '732085886',
    nick: '老婆666',
    age: 36,
    sex: 1,
    birthday_month: 12,
    birthday_day: 28,
  }, false), {
    user_id: '732085886',
    nickname: '老婆666',
    remark: '',
    age: 36,
    sex: 'male',
    birthday_month: 12,
    birthday_day: 28,
    already: false,
  })
})

test('mapSearchGroup unwraps searchGroupInfo and flags mute / already joined', () => {
  const group = mapSearchGroup({
    groupCode: '1103916100',
    searchGroupInfo: {
      groupCode: '1103916100',
      groupName: '奥特曼Ai中转站下游公告2群',
      memberNum: 136,
      maxMemberNum: 200,
      groupOption: 1,
      groupQuestion: '',
      shutUpAllTimestamp: 1,
      joinGroupAuth: 'auth-token',
    },
  }, true)
  assert.equal(group.group_id, '1103916100')
  assert.equal(group.name, '奥特曼Ai中转站下游公告2群')
  assert.equal(group.member_num, 136)
  assert.equal(group.already, true)
  assert.equal(group.muted, true)
  assert.equal(group.option, 1)
  assert.equal(group.joinGroupAuth, 'auth-token')
})

test('mapSearchGroup keeps a custom join question', () => {
  const group = mapSearchGroup({
    groupCode: '106',
    groupName: '凌云AI中转',
    memberNum: 515,
    maxMemberNum: 1000,
    addOption: 5,
    groupQuestion: '加群的目的是干嘛?',
  }, false)
  assert.equal(group.option, 5)
  assert.equal(group.question, '加群的目的是干嘛?')
})

test('joinGroupCall sends verification as msg and the question answer separately', () => {
  const call = joinGroupCall({
    groupCode: '123',
    joinGroupAuth: 'tok',
    addOption: 5,
    groupQuestion: '加群的目的是干嘛?',
  }, { comment: '你好', answer: '学习交流' })
  assert.deepEqual(call, {
    groupCode: '123',
    joinGroupAuth: 'tok',
    msg: '你好',
    joinGroupAnswer: '学习交流',
    option: 5,
    question: '加群的目的是干嘛?',
  })
})

test('joinGroupCall reuses the comment as the answer when none is given', () => {
  const call = joinGroupCall({ groupCode: '1', groupOption: 2 }, { message: '申请加入' })
  assert.equal(call.msg, '申请加入')
  assert.equal(call.joinGroupAnswer, '申请加入')
})

test('joinGroupCall copies the question answer into msg when comment is empty', () => {
  const call = joinGroupCall({
    groupCode: '975206796',
    addOption: 5,
    groupQuestion: '在哪了解到本项目的',
    joinGroupAuth: 'tok',
  }, { answer: 'Github' })
  assert.equal(call.msg, 'Github')
  assert.equal(call.joinGroupAnswer, 'Github')
  assert.equal(call.joinGroupAuth, 'tok')
})

test('mapSearchGroup keeps joinGroupAuth from the outer search hit or penetrate', () => {
  const fromOuter = mapSearchGroup({
    groupCode: '975206796',
    joinGroupAuth: 'outer-auth',
    searchGroupInfo: {
      groupCode: '975206796',
      groupName: 'AstrBot 大学',
    },
  }, false)
  assert.equal(fromOuter.joinGroupAuth, 'outer-auth')
  const fromPenetrate = mapSearchGroup({
    groupCode: '975206796',
    groupName: 'AstrBot 大学',
    penetrate: 'search-token',
  }, false)
  assert.equal(fromPenetrate.joinGroupAuth, 'search-token')
})

test('kernelJoinArgs nests source, auth, msg and answer for NTQQ joinGroup', () => {
  assert.deepEqual(kernelJoinArgs({
    groupCode: '975206796',
    joinGroupAuth: 'tok',
    msg: 'Github',
    joinGroupAnswer: 'Github',
  }), {
    groupCode: '975206796',
    option: {
      joinGroupSource: 14,
      joinGroupAuth: 'tok',
      msg: 'Github',
      joinGroupAnswer: 'Github',
    },
  })
})

test('joinGroupResultMessage keeps kernel errMsg and otherwise shows the result code', () => {
  assert.equal(joinGroupResultMessage({ result: 0, errMsg: '' }), '')
  assert.equal(joinGroupResultMessage({ result: 2, errMsg: '已在群中' }), '已在群中')
  assert.equal(joinGroupResultMessage({ result: 2 }), '申请失败（错误码 2）')
})
