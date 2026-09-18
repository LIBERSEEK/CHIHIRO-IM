import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const msgBody = readFileSync(new URL('./src/components/user/UserMsgBody.vue', import.meta.url), 'utf8')

describe('message markdown links', () => {
  it('linkifies markdown [text](url) instead of wrapping both sides as bare URLs', () => {
    expect(msgBody).toContain('linkifyMessageText')
    expect(msgBody).toContain('@chihiro/im-native/msg-text')
    expect(msgBody).not.toContain('text = text.replaceAll(reg, \'<a href="" data-link="$&" onclick="return false">$&</a>\')')
  })
})
