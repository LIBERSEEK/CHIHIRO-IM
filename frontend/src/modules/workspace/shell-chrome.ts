import type { ListTab } from './workspace'

export type WorkspaceClientMode = 'none' | 'qq' | 'douyin' | 'xiaohongshu' | 'bilibili'

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
  showOutreach: boolean
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
      showOutreach: false,
      expandWorkbench: true,
      listTab: 'workbench',
    }
  }
  if (input.platform === 'douyin' || input.platform === 'xiaohongshu' || input.platform === 'bilibili') {
    const listTab = input.listTab === 'friends' ? 'messages' : input.listTab
    return {
      mode: input.platform,
      showMessageTab: true,
      showContactsTab: true,
      contactsEnabled: false,
      showOutreach: listTab === 'messages',
      expandWorkbench: false,
      listTab,
    }
  }
  return {
    mode: 'qq',
    showMessageTab: true,
    showContactsTab: true,
    contactsEnabled: true,
    showOutreach: false,
    expandWorkbench: false,
    listTab: input.listTab,
  }
}
