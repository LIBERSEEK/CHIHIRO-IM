#!/usr/bin/env node
/**
 * Growth-only MCP for the workbench agent.
 * Three tools: growth_schema, growth_draft, growth_get. None of them start a task.
 */
import { callGrowthTool, growthToolDefinitions, growthToolName } from './growth-card.mjs'
import { createMcpHandler, serveMcp } from './stdio.mjs'
import { createWorkbenchApi } from './workbench-api.mjs'

const api = createWorkbenchApi()
const tools = growthToolDefinitions()

async function callTool(name, args = {}) {
  if (!growthToolName(name)) throw new Error(`unknown tool ${name}`)
  return callGrowthTool(name, args, api)
}

serveMcp(createMcpHandler({
  serverInfo: { name: 'chihiro-growth', version: '0.2.0' },
  instructions:
    '抖音评论投放的手。growth_schema、growth_draft、growth_get 只准备任务卡，不会启动投放。' +
    '营销获客对话里，用户这句话就是投放人群。',
  tools,
  callTool,
}))
