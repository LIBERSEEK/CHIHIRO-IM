import { describe, expect, it } from 'vitest'
import { linkifyMessageText } from './msg-text'

const url = 'https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra'

describe('linkifyMessageText', () => {
  it('collapses [url](url) markdown into one hyperlink', () => {
    const { html, urls } = linkifyMessageText(`[${url}](${url})`)
    expect(html).toBe(`<a href="" data-link="${url}" onclick="return false">${url}</a>`)
    expect(urls).toEqual([url])
    expect(html).not.toContain('](')
  })

  it('renders [title](url) without repeating the href', () => {
    const { html, urls } = linkifyMessageText('[OpenAI](https://openai.com/blog)')
    expect(html).toBe('<a href="" data-link="https://openai.com/blog" onclick="return false">OpenAI</a>')
    expect(urls).toEqual(['https://openai.com/blog'])
    expect(html).not.toContain('https://openai.com/blog</a>)')
  })

  it('still auto-links a leftover bare URL', () => {
    const { html, urls } = linkifyMessageText(`see ${url}`)
    expect(html).toBe(`see <a href="" data-link="${url}" onclick="return false">${url}</a>`)
    expect(urls).toEqual([url])
  })

  it('allows spaces inside markdown link punctuation', () => {
    const { html } = linkifyMessageText(`[${url} ]( ${url} )`)
    expect(html).toBe(`<a href="" data-link="${url}" onclick="return false">${url}</a>`)
    expect(html).not.toContain('[')
  })
})
