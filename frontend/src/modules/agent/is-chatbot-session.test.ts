import { expect, it } from 'vitest'
import { isChatBotSession, withoutChatBotSessions } from './is-chatbot-session'

it('filters ChatBot Chat API sessions out of the workbench list', () => {
  expect(isChatBotSession('suggest:qq:1:group:2')).toBe(true)
  expect(isChatBotSession('suggest:qq:1:group:2:m1')).toBe(true)
  expect(isChatBotSession({ session_id: 'web:abc', creator: 'chihiro-suggest:qq:1' })).toBe(true)
  expect(isChatBotSession({ session_id: 'web:abc', creator: 'operator' })).toBe(false)
  expect(isChatBotSession('outreach-campaign:brief1')).toBe(false)
  expect(isChatBotSession('outreach-campaign:brief1:7689303818681880241')).toBe(false)
  expect(withoutChatBotSessions([
    { session_id: 'web:keep', creator: 'me' },
    { session_id: 'suggest:qq:1:private:2:m', creator: 'chihiro-suggest:qq:1' },
    { session_id: 'other', creator: 'chihiro-suggest:qq:9' },
  ]).map((item) => item.session_id)).toEqual(['web:keep'])
})
