import { describe, expect, it } from 'vitest'
import { resolveWorkspaceChrome } from './shell-chrome'

describe('workspace client chrome', () => {
  it('expands the shared workbench when no client is logged in', () => {
    expect(resolveWorkspaceChrome({ hasAccount: false, platform: null, listTab: 'messages' })).toEqual({
      mode: 'none',
      showMessageTab: false,
      showContactsTab: false,
      contactsEnabled: false,
      showGrowth: false,
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
      showGrowth: false,
      expandWorkbench: false,
      listTab: 'friends',
    })
  })

  it('shows the growth page on Douyin messages and leaves contacts disabled', () => {
    expect(resolveWorkspaceChrome({ hasAccount: true, platform: 'douyin', listTab: 'messages' })).toMatchObject({
      mode: 'douyin',
      showMessageTab: true,
      showContactsTab: true,
      contactsEnabled: false,
      showGrowth: true,
      listTab: 'messages',
    })
    expect(resolveWorkspaceChrome({ hasAccount: true, platform: 'douyin', listTab: 'friends' }).listTab).toBe('messages')
    expect(resolveWorkspaceChrome({ hasAccount: true, platform: 'douyin', listTab: 'workbench' })).toMatchObject({
      showGrowth: false,
      contactsEnabled: false,
      listTab: 'workbench',
    })
  })
})
