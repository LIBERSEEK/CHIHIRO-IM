import type { ListTab } from './workspace'

export type WorkspaceClientMode = 'none' | 'qq' | 'douyin'

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
  showGrowth: boolean
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
      showGrowth: false,
      expandWorkbench: true,
      listTab: 'workbench',
    }
  }
  if (input.platform === 'douyin') {
    const listTab = input.listTab === 'friends' ? 'messages' : input.listTab
    return {
      mode: 'douyin',
      showMessageTab: true,
      showContactsTab: true,
      contactsEnabled: false,
      showGrowth: listTab === 'messages',
      expandWorkbench: false,
      listTab,
    }
  }
  return {
    mode: 'qq',
    showMessageTab: true,
    showContactsTab: true,
    contactsEnabled: true,
    showGrowth: false,
    expandWorkbench: false,
    listTab: input.listTab,
  }
}
