import { describe, expect, test } from 'vitest'
import {
  DEFAULT_STYLE,
  dashPatternFor,
  isDrawablePrimitive,
  resolveColor,
  resolveOpacity,
  resolveStrokeWidth,
} from '../src/render/shapes'
import type { Style } from '../src/types'

describe('shape style resolution', () => {
  test('resolveColor: node style wins over theme wins over default', () => {
    const style: Style = { strokeColor: '#000000' }
    expect(resolveColor(style, 'strokeColor', '#ffffff')).toBe('#000000')
    expect(resolveColor(undefined, 'strokeColor', '#ffffff')).toBe('#ffffff')
    expect(resolveColor(undefined, 'strokeColor', '#ffffff', () => '#abcdef')).toBe('#abcdef')
    expect(resolveColor(style, 'strokeColor', '#ffffff', () => '#abcdef')).toBe('#000000')
  })

  test('resolveOpacity normalizes 0..100 to 0..1', () => {
    expect(resolveOpacity({ opacity: 50 })).toBeCloseTo(0.5)
    expect(resolveOpacity({ opacity: 100 })).toBe(1)
    expect(resolveOpacity({ opacity: 0 })).toBe(0)
    expect(resolveOpacity(undefined)).toBe(DEFAULT_STYLE.opacity / 100)
  })

  test('resolveStrokeWidth falls through to default', () => {
    expect(resolveStrokeWidth({ strokeWidth: 5 })).toBe(5)
    expect(resolveStrokeWidth(undefined)).toBe(DEFAULT_STYLE.strokeWidth)
  })

  test('dashPatternFor scales with stroke width', () => {
    expect(dashPatternFor('solid', 2)).toEqual([])
    expect(dashPatternFor(undefined, 2)).toEqual([])
    expect(dashPatternFor('dashed', 2)).toEqual([10, 8])
    expect(dashPatternFor('dotted', 2)).toEqual([3, 6])
  })

  test('isDrawablePrimitive accepts the 4 built-in primitive types', () => {
    expect(isDrawablePrimitive('rect')).toBe(true)
    expect(isDrawablePrimitive('ellipse')).toBe(true)
    expect(isDrawablePrimitive('diamond')).toBe(true)
    expect(isDrawablePrimitive('capsule')).toBe(true)
    expect(isDrawablePrimitive('text')).toBe(false)
    expect(isDrawablePrimitive('chart-card')).toBe(false)
  })
})
