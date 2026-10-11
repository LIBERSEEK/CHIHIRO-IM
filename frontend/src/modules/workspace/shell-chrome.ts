import type { ListTab } from './workspace'

export type WorkspaceClientMode = 'none' | 'qq'

export interface WorkspaceChromeInput {
  hasAccount: boolean
  platform?: string | null
  listTab: ListTab
}

export interface WorkspaceChrome {
  mode: WorkspaceClientMode
  showMessageTab: boolean
  showContactsTab: boolean
  contactsEnabled: boolean
  expandWorkbench: boolean
  listTab: ListTab
}

/** Shared client chrome: one workbench, client tabs only when an account is open. */
export function resolveWorkspaceChrome(input: WorkspaceChromeInput): WorkspaceChrome {
  if (!input.hasAccount) {
    return {
      mode: 'none',
      showMessageTab: false,
      showContactsTab: false,
      contactsEnabled: false,
      expandWorkbench: true,
      listTab: 'workbench',
    }
  }
  return {
    mode: 'qq',
    showMessageTab: true,
    showContactsTab: true,
    contactsEnabled: true,
    expandWorkbench: false,
    listTab: input.listTab,
  }
}
