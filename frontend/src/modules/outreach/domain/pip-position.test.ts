import { afterEach, describe, expect, it, vi } from 'vitest'
import { PIP_CORNERS, parsePipCorner, pipCornerPositions, pipLayoutInsets, readPipChrome } from './pip-position'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('outreach pip position', () => {
  it('places the four corners inset from the viewport', () => {
    const spots = pipCornerPositions(1000, 800, 360, 240)
    expect(spots.tl).toEqual({ x: 16, y: 16 })
    expect(spots.tr).toEqual({ x: 624, y: 16 })
    expect(spots.bl).toEqual({ x: 16, y: 544 })
    expect(spots.br).toEqual({ x: 624, y: 544 })
  })

  it('keeps left corners clear of the account rail and outreach sider', () => {
    expect(pipLayoutInsets().left).toBe(72)
    expect(pipLayoutInsets({ railRight: 56 }).left).toBe(72)
    expect(pipLayoutInsets({ railRight: 56, siderRight: 296 }).left).toBe(312)
    const spots = pipCornerPositions(1200, 800, 360, 240, pipLayoutInsets({ railRight: 56, siderRight: 296 }))
    expect(spots.tl.x).toBe(312)
    expect(spots.bl.x).toBe(312)
    expect(spots.tr.x).toBe(824)
    expect(spots.br.x).toBe(824)
  })

  it('reads the visible chat list as left-side chrome', () => {
    const rail = fakeElement({ left: 0, right: 56, width: 56, height: 800 })
    const chatSidebar = fakeElement({ left: 56, right: 336, width: 280, height: 800 })
    const hiddenSidebar = fakeElement({ left: 56, right: 456, width: 400, height: 800 }, { display: 'none' })
    stubDocument({
      '.account-rail': [rail],
      '.lz-sider': [],
      '.chat-sidebar': [chatSidebar, hiddenSidebar],
      '.agent-sidebar': [],
    })

    expect(readPipChrome()).toEqual({ railRight: 56, siderRight: 336 })
    expect(pipLayoutInsets(readPipChrome()).left).toBe(352)
  })

  it('ignores sidebars that do not occupy the viewport left edge', () => {
    const centeredPanel = fakeElement({ left: 400, right: 680, width: 280, height: 800 })
    stubDocument({
      '.account-rail': [],
      '.lz-sider': [],
      '.chat-sidebar': [centeredPanel],
      '.agent-sidebar': [],
    })

    expect(readPipChrome()).toEqual({ railRight: undefined, siderRight: undefined })
  })

  it('lists selectable corners with labels', () => {
    expect(PIP_CORNERS.map(item => item.id)).toEqual(['tl', 'tr', 'bl', 'br'])
    expect(PIP_CORNERS.map(item => item.label)).toEqual(['左上', '右上', '左下', '右下'])
  })

  it('falls back to the bottom-right corner', () => {
    expect(parsePipCorner('tl')).toBe('tl')
    expect(parsePipCorner('nope')).toBe('br')
  })
})

function fakeElement(rect: Partial<DOMRect>, style: Partial<CSSStyleDeclaration> = {}) {
  return {
    getBoundingClientRect: () => ({ left: 0, right: 0, width: 0, height: 0, ...rect }),
    style: { display: 'block', visibility: 'visible', opacity: '1', ...style },
  }
}

function stubDocument(matches: Record<string, unknown[]>) {
  class FakeHTMLElement {}
  vi.stubGlobal('HTMLElement', FakeHTMLElement)
  for (const elements of Object.values(matches)) {
    Object.setPrototypeOf(elements[0] || {}, FakeHTMLElement.prototype)
    elements.slice(1).forEach(element => Object.setPrototypeOf(element, FakeHTMLElement.prototype))
  }
  vi.stubGlobal('document', {
    querySelectorAll: (selector: string) => matches[selector] || [],
  })
  vi.stubGlobal('window', {
    getComputedStyle: (element: { style: CSSStyleDeclaration }) => element.style,
  })
}
