#!/usr/bin/env node
/**
 * Outreach-only MCP for the workbench agent.
 * Three tools: outreach_schema, outreach_draft, outreach_get. None of them start a task.
 */
import { callOutreachTool, outreachToolDefinitions, outreachToolName } from './outreach-card.mjs'
import { createMcpHandler, serveMcp } from './stdio.mjs'
import { createWorkbenchApi } from './workbench-api.mjs'

const api = createWorkbenchApi()
const tools = outreachToolDefinitions()

async function callTool(name, args = {}) {
  if (!outreachToolName(name)) throw new Error(`unknown tool ${name}`)
  return callOutreachTool(name, args, api)
}

serveMcp(createMcpHandler({
  serverInfo: { name: 'chihiro-outreach', version: '0.2.0' },
  instructions:
    '抖音评论投放的手。outreach_schema、outreach_draft、outreach_get 只准备任务卡，不会启动投放。' +
    '营销获客对话里，用户这句话就是投放人群。',
  tools,
  callTool,
}))
