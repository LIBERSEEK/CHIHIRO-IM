#!/usr/bin/env node
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createEnvironmentService } from '../backend/src/runtime/environment.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const command = process.argv[2] || 'doctor'
const labels = {
  submodules: '初始化运行时源码',
  frontend: '构建工作台前端',
  napcat: '安装 NapCat',
  astrbot: '创建 Agent Python 环境'
}
const service = createEnvironmentService({
  root,
  onProgress(event) {
    const label = labels[event.id] || event.id
    if (event.state === 'started') console.log(`开始：${label}`)
    if (event.state === 'completed') console.log(`完成：${label}`)
    if (event.state === 'failed') console.error(`失败：${label}（${event.message}）`)
  }
})

function symbol(status) {
  return ({
    ready: 'OK',
    repairable: 'FIX',
    user_action_required: 'USER',
    unsupported: 'NO'
  })[status] || '?'
}

function print(report) {
  console.log(`千寻环境状态：${report.status}`)
  for (const item of report.checks) {
    console.log(`${symbol(item.status).padEnd(4)} ${item.label.padEnd(16)} ${item.message}`)
  }
  if (report.repaired?.length) console.log(`已修复：${report.repaired.join('、')}`)
  for (const error of report.errors || []) console.error(`修复失败 [${error.id}]：${error.message}`)
}

if (!['doctor', 'repair', 'setup'].includes(command)) {
  console.error(`未知命令：${command}`)
  process.exitCode = 2
} else {
  const report = command === 'doctor' ? service.diagnose() : await service.repair()
  print(report)
  if (!report.ready || report.errors?.length) process.exitCode = 1
}
