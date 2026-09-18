import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const viewer = readFileSync(new URL('./src/components/user/UserViewerCom.vue', import.meta.url), 'utf8')

describe('image viewer overlay', () => {
  it('blurs the page behind view and edit controls', () => {
    expect(viewer).toContain('class="mask-background chihiro-image-viewer"')
    expect(viewer).toContain('backdrop-filter: blur(36px) saturate(0.8)')
    expect(viewer).toContain('-webkit-backdrop-filter: blur(36px) saturate(0.8)')
    expect(viewer).toContain('background-color: rgba(6, 6, 8, 0.66)')
    expect(viewer).toContain('background: transparent !important')
    expect(viewer).not.toContain('.viewer-tool-config-bar:has(.color, .line-width, .rect-is-fill)')
    expect(viewer).toContain('.viewer-tool-config-bar > div.line-width > div')
    expect(viewer).toContain('align-items: center')
  })
})
