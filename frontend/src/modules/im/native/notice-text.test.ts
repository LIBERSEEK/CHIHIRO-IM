import { describe, expect, it } from 'vitest'
import { decodeNoticeHtml, noticePreviewText, noticeRawText } from './notice-text'

describe('notice text', () => {
  it('decodes &nbsp; and &#10; used in QQ group notices', () => {
    expect(decodeNoticeHtml('&nbsp;BOFT&nbsp;CLI&nbsp;&nbsp;Grok')).toBe(' BOFT CLI  Grok')
    expect(decodeNoticeHtml('使用建议&#10;&#10;关于两处修改')).toBe('使用建议\n\n关于两处修改')
    expect(decodeNoticeHtml('&amp;nbsp;A&#160;B')).toBe(' A B')
  })

  it('builds a single-line rail preview from notice payloads', () => {
    expect(noticePreviewText({
      content: ['&nbsp;BOFT&nbsp;CLI&nbsp;&nbsp;Grok&#10;使用建议'],
    })).toBe('BOFT CLI Grok 使用建议')
    expect(noticeRawText({ content: ['hello'] })).toBe('hello')
    expect(noticePreviewText(null)).toBe('')
  })
})
