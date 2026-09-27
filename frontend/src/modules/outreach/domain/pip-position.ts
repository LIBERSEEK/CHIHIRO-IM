export const PIP_MARGIN = 16
export const PIP_RAIL_FALLBACK = 56
export type PipCorner = 'tl' | 'tr' | 'bl' | 'br'

export const PIP_CORNERS: { id: PipCorner; label: string }[] = [
  { id: 'tl', label: '左上' },
  { id: 'tr', label: '右上' },
  { id: 'bl', label: '左下' },
  { id: 'br', label: '右下' },
]

export interface PipInsets {
  left: number
  right: number
  top: number
  bottom: number
}

export interface PipChromeBounds {
  railRight?: number
  siderRight?: number
}

export function parsePipCorner(value: unknown): PipCorner {
  return value === 'tl' || value === 'tr' || value === 'bl' || value === 'br' ? value : 'br'
}

export function pipLayoutInsets(chrome: PipChromeBounds = {}): PipInsets {
  const leftChrome = Math.max(
    PIP_RAIL_FALLBACK,
    Number(chrome.railRight) || 0,
    Number(chrome.siderRight) || 0,
  )
  return {
    left: leftChrome + PIP_MARGIN,
    right: PIP_MARGIN,
    top: PIP_MARGIN,
    bottom: PIP_MARGIN,
  }
}

function visibleLeftChromeRight(selectors: string[], maxLeft = PIP_MARGIN): number | undefined {
  let right = 0
  for (const selector of selectors) {
    document.querySelectorAll(selector).forEach((element) => {
      if (!(element instanceof HTMLElement)) return
      const rect = element.getBoundingClientRect()
      const style = window.getComputedStyle(element)
      if (
        style.display === 'none'
        || style.visibility === 'hidden'
        || Number(style.opacity) === 0
        || rect.width <= 0
        || rect.height <= 0
        || rect.right <= 0
        || rect.left > maxLeft
      ) return
      right = Math.max(right, rect.right)
    })
  }
  return right || undefined
}

export function readPipChrome(): PipChromeBounds {
  if (typeof document === 'undefined') return {}
  const railRight = visibleLeftChromeRight(['.account-rail'])
  return {
    railRight,
    siderRight: visibleLeftChromeRight(
      ['.lz-sider', '.chat-sidebar', '.agent-sidebar'],
      Math.max(PIP_RAIL_FALLBACK, railRight || 0) + PIP_MARGIN,
    ),
  }
}

export function pipCornerPositions(
  viewW: number,
  viewH: number,
  width: number,
  height: number,
  insets: Partial<PipInsets> = {},
) {
  const left = Number.isFinite(insets.left) ? Number(insets.left) : PIP_MARGIN
  const right = Number.isFinite(insets.right) ? Number(insets.right) : PIP_MARGIN
  const top = Number.isFinite(insets.top) ? Number(insets.top) : PIP_MARGIN
  const bottom = Number.isFinite(insets.bottom) ? Number(insets.bottom) : PIP_MARGIN
  const xRight = Math.max(left, viewW - width - right)
  const yBottom = Math.max(top, viewH - height - bottom)
  return {
    tl: { x: left, y: top },
    tr: { x: xRight, y: top },
    bl: { x: left, y: yBottom },
    br: { x: xRight, y: yBottom },
  }
}
