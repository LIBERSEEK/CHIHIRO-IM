import { describe, expect, it } from 'vitest'
import { PIP_CORNERS, parsePipCorner, pipCornerPositions, pipLayoutInsets } from './pip-position'

describe('growth pip position', () => {
  it('places the four corners inset from the viewport', () => {
    const spots = pipCornerPositions(1000, 800, 360, 240)
    expect(spots.tl).toEqual({ x: 16, y: 16 })
    expect(spots.tr).toEqual({ x: 624, y: 16 })
    expect(spots.bl).toEqual({ x: 16, y: 544 })
    expect(spots.br).toEqual({ x: 624, y: 544 })
  })

  it('keeps left corners clear of the account rail and growth sider', () => {
    expect(pipLayoutInsets().left).toBe(72)
    expect(pipLayoutInsets({ railRight: 56 }).left).toBe(72)
    expect(pipLayoutInsets({ railRight: 56, siderRight: 296 }).left).toBe(312)
    const spots = pipCornerPositions(1200, 800, 360, 240, pipLayoutInsets({ railRight: 56, siderRight: 296 }))
    expect(spots.tl.x).toBe(312)
    expect(spots.bl.x).toBe(312)
    expect(spots.tr.x).toBe(824)
    expect(spots.br.x).toBe(824)
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
