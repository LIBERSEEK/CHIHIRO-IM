/** Stable identifiers shared by IM, Agent and backend modules. */
export type Brand<T, Name extends string> = T & { readonly __brand: Name }

export type AccountId = Brand<string, 'AccountId'>
export type ConversationId = Brand<string, 'ConversationId'>
export type AgentSessionId = Brand<string, 'AgentSessionId'>
export type RunId = Brand<string, 'RunId'>
export type TaskId = Brand<string, 'TaskId'>

export type ConversationKind = 'direct' | 'group' | 'system'

export interface ConversationKey {
  accountId: AccountId
  conversationId: ConversationId
  kind: ConversationKind
}

export type AccountPlatform = 'qq' | 'douyin'

export interface AccountContext {
  id: AccountId
  label: string
  avatar?: string
  instanceId?: string
  platform: AccountPlatform
  status: 'offline' | 'connecting' | 'online' | 'error'
  botEnabled?: boolean
  botWired?: boolean
  unread?: number
  douyinId?: string
}

export interface AgentSessionRef {
  id: AgentSessionId
  accountId?: AccountId
  conversationId?: ConversationId
  projectId?: string
}

export type RunEvent =
  | { type: 'run.started'; runId: RunId; session: AgentSessionRef; at: string }
  | { type: 'run.delta'; runId: RunId; text: string; at: string }
  | { type: 'run.tool'; runId: RunId; name: string; status: 'started' | 'completed' | 'failed'; at: string }
  | { type: 'run.completed'; runId: RunId; at: string }
  | { type: 'run.failed'; runId: RunId; message: string; retryable: boolean; at: string }

export type OutboundActionStatus =
  | 'planned'
  | 'pending_approval'
  | 'queued'
  | 'sending'
  | 'accepted'
  | 'failed'
  | 'unknown'
  | 'cancelled'

export interface OutboundAction {
  id: string
  accountId: AccountId
  conversation: ConversationKey
  text: string
  status: OutboundActionStatus
  createdAt: string
  updatedAt: string
  idempotencyKey: string
}

export interface ApiError {
  code: string
  message: string
  retryable?: boolean
  requestId?: string
}

export function accountId(value: string): AccountId {
  return value as AccountId
}

export function isQqAccountId(id: string): boolean {
  return /^qq:\d+$/.test(id)
}

export function isDouyinAccountId(id: string): boolean {
  return /^douyin:[A-Za-z0-9._-]+$/.test(id)
}

export function accountPlatformFromId(id: string): AccountPlatform | null {
  if (isDouyinAccountId(id)) return 'douyin'
  if (isQqAccountId(id)) return 'qq'
  return null
}

export function conversationId(value: string): ConversationId {
  return value as ConversationId
}
