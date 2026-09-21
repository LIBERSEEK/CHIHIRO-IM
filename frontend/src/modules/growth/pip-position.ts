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

export function parsePipCorner(value: unknown): PipCorner {
  return value === 'tl' || value === 'tr' || value === 'bl' || value === 'br' ? value : 'br'
}

export function pipLayoutInsets(chrome: { railRight?: number; siderRight?: number } = {}): PipInsets {
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

export function readPipChrome() {
  if (typeof document === 'undefined') return {}
  const rail = document.querySelector('.account-rail')
  const sider = document.querySelector('.lz-sider')
  return {
    railRight: rail instanceof HTMLElement ? rail.getBoundingClientRect().right : undefined,
    siderRight: sider instanceof HTMLElement ? sider.getBoundingClientRect().right : undefined,
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
