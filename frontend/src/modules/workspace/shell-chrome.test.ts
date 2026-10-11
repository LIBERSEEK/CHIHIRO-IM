import { describe, expect, it } from 'vitest'
import { resolveWorkspaceChrome } from './shell-chrome'

describe('workspace client chrome', () => {
  it('expands the shared workbench when no client is logged in', () => {
    expect(resolveWorkspaceChrome({ hasAccount: false, platform: null, listTab: 'messages' })).toEqual({
      mode: 'none',
      showMessageTab: false,
      showContactsTab: false,
      contactsEnabled: false,
      expandWorkbench: true,
      listTab: 'workbench',
    })
  })

  it('keeps QQ messages, contacts, and workbench', () => {
    expect(resolveWorkspaceChrome({ hasAccount: true, platform: 'qq', listTab: 'friends' })).toMatchObject({
      mode: 'qq',
      showMessageTab: true,
      showContactsTab: true,
      contactsEnabled: true,
      expandWorkbench: false,
      listTab: 'friends',
    })
  })

})
