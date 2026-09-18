import { inject, type InjectionKey } from 'vue'
import { useRouter, type Router, type RouteLocationRaw } from 'vue-router'

export type ExternalSettingsTarget = { title: string; src: string }

export interface AgentNavigationAdapter {
  openSession(sessionId: string): void | Promise<unknown>
  openSessionList(): void | Promise<unknown>
  openProviderWorkspace(): void | Promise<unknown>
  openKnowledgeBase(): void | Promise<unknown>
  openAstrBotSettings(): void | Promise<unknown>
  openLogin(): void | Promise<unknown>
  backToWorkspace(): void | Promise<unknown>
}

export interface AgentWorkspaceBridge {
  selectAgent(sessionId: string): void
  selectList(tab: 'workbench'): void
  closeAgent(): void
}

export const agentNavigationKey: InjectionKey<AgentNavigationAdapter> = Symbol('agent-navigation')

function dashboardBasePath(chatboxMode = false) {
  return chatboxMode ? '/chatbox' : '/chat'
}

export function routeForHostedAgent(sessionId?: string): RouteLocationRaw {
  return sessionId
    ? { path: '/im', query: { tab: 'workbench', agent: sessionId } }
    : { path: '/im', query: { tab: 'workbench' } }
}

function firstRouteString(value: unknown): string {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : ''
  return typeof value === 'string' ? value : ''
}

export function hostedAgentIdFromLocation(input: {
  routeName?: unknown
  conversationId?: unknown
  queryAgent?: unknown
  workspacePane?: string
  workspaceSessionId?: string | null
}): string {
  if (input.routeName === 'agent') return firstRouteString(input.conversationId)
  const queryAgent = firstRouteString(input.queryAgent)
  const workspaceAgent = input.workspacePane === 'agent' ? input.workspaceSessionId || '' : ''
  // Selecting a conversation updates workspace before the route leaves ?agent=models.
  if (queryAgent === 'models' && workspaceAgent && workspaceAgent !== 'models') return workspaceAgent
  return queryAgent || workspaceAgent
}

function dispatchExternalSettings(target: ExternalSettingsTarget) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('chihiro-open-external-settings', { detail: target }))
}

export function createDashboardAgentNavigation(router: Router, options: { chatboxMode?: boolean } = {}): AgentNavigationAdapter {
  const basePath = dashboardBasePath(options.chatboxMode)
  return {
    openSession(sessionId) {
      return router.push(`${basePath}/${sessionId}`)
    },
    openSessionList() {
      return router.push(basePath)
    },
    openProviderWorkspace() {
      return router.push(`${basePath}/models`)
    },
    openKnowledgeBase() {
      return router.push('/knowledge-base')
    },
    openAstrBotSettings() {
      return router.push('/settings')
    },
    openLogin() {
      return router.push('/auth/login?redirect=/chatbox')
    },
    backToWorkspace() {
      return router.push(basePath)
    },
  }
}

export function createHostedAgentNavigation(
  router: Router,
  workspace: AgentWorkspaceBridge,
  openExternalSettings: (target: ExternalSettingsTarget) => void = dispatchExternalSettings,
): AgentNavigationAdapter {
  return {
    openSession(sessionId) {
      workspace.selectAgent(sessionId)
      return router.push(routeForHostedAgent(sessionId))
    },
    openSessionList() {
      workspace.selectList('workbench')
      return router.push(routeForHostedAgent())
    },
    openProviderWorkspace() {
      workspace.selectAgent('models')
      return router.push(routeForHostedAgent('models'))
    },
    openKnowledgeBase() {
      openExternalSettings({ title: 'AstrBot 知识库', src: '/astrbot/#/knowledge-base' })
    },
    openAstrBotSettings() {
      openExternalSettings({ title: 'AstrBot 设置', src: '/astrbot/#/settings' })
    },
    openLogin() {
      openExternalSettings({ title: 'AstrBot 登录', src: '/astrbot/#/auth/login?redirect=/chatbox' })
    },
    backToWorkspace() {
      workspace.closeAgent()
      return router.push(routeForHostedAgent())
    },
  }
}

export function useAgentNavigation(options: { chatboxMode?: boolean } = {}) {
  const injected = inject(agentNavigationKey, null)
  if (injected) return injected
  return createDashboardAgentNavigation(useRouter(), options)
}
