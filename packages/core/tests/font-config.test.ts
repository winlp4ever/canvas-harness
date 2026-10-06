import { afterEach, describe, expect, test } from 'vitest'
import {
  DEFAULT_FONT_STACKS,
  DEFAULT_NUMERIC_LINE_HEIGHT_RATIO,
  MAX_FONT_SIZE_PX,
  MIN_FONT_SIZE_PX,
  configureFonts,
  getCanvasFont,
  getFontEpoch,
  getFontSizePresetForPx,
  getFontSizePx,
  getFontStack,
  getLineHeightPx,
  resetFonts,
} from '../src'

// Registry is module-global — restore defaults after every test so one
// test's overrides can't leak into the next.
afterEach(() => resetFonts())

describe('font defaults', () => {
  test('the sans-serif token defaults to Atkinson Hyperlegible Next', () => {
    expect(getFontStack('sans-serif')).toContain('Atkinson Hyperlegible Next')
    expect(DEFAULT_FONT_STACKS['sans-serif']).toContain('Atkinson Hyperlegible Next')
  })

  test('getters return the built-in sizes / line heights', () => {
    expect(getFontSizePx('M')).toBe(16)
    expect(getLineHeightPx('M')).toBe(24)
  })

  test('numeric sizes resolve directly with a proportional line height', () => {
    expect(getFontSizePx(72)).toBe(72)
    expect(getLineHeightPx(72)).toBe(90)
  })

  test('numeric sizes clamp to the supported range', () => {
    expect(getFontSizePx(1)).toBe(MIN_FONT_SIZE_PX)
    expect(getFontSizePx(500)).toBe(MAX_FONT_SIZE_PX)
  })

  test('invalid values fall back to the medium preset', () => {
    const resolveUnknown = getFontSizePx as (size: unknown) => number
    expect(resolveUnknown(Number.NaN)).toBe(16)
    expect(resolveUnknown(Number.POSITIVE_INFINITY)).toBe(16)
    expect(resolveUnknown('XXL')).toBe(16)
    expect(getLineHeightPx(Number.NaN)).toBe(24)
  })

  test('numeric sizes matching a preset preserve its line height', () => {
    expect(getFontSizePresetForPx(36)).toBe('XL')
    expect(getLineHeightPx(36)).toBe(40)
  })
})

describe('configureFonts', () => {
  test('overrides one family token and leaves the rest at defaults', () => {
    const serifBefore = getFontStack('serif')
    configureFonts({ family: { 'sans-serif': '"Custom Sans", sans-serif' } })
    expect(getFontStack('sans-serif')).toBe('"Custom Sans", sans-serif')
    expect(getFontStack('serif')).toBe(serifBefore) // untouched
  })

  test('the override flows into the resolved canvas font string', () => {
    configureFonts({ family: { 'sans-serif': '"Custom Sans", sans-serif' } })
    const font = getCanvasFont({
      type: 'text',
      fontFamily: 'sans-serif',
      fontSize: 'M',
      textStyle: 'normal',
    })
    expect(font).toContain('"Custom Sans"')
    expect(font).toContain('16px')
  })

  test('size + line-height overrides merge independently', () => {
    configureFonts({ size: { L: 26 }, lineHeight: { L: 34 } })
    expect(getFontSizePx('L')).toBe(26)
    expect(getLineHeightPx('L')).toBe(34)
    expect(getFontSizePx('M')).toBe(16) // unspecified size untouched
  })

  test('configures and resets the numeric line-height ratio', () => {
    configureFonts({ numericLineHeightRatio: 1.5 })
    expect(getLineHeightPx(72)).toBe(108)
    resetFonts()
    expect(getLineHeightPx(72)).toBe(72 * DEFAULT_NUMERIC_LINE_HEIGHT_RATIO)
  })

  test('preset matching follows configured font sizes', () => {
    configureFonts({ size: { XL: 42 }, lineHeight: { XL: 48 } })
    expect(getFontSizePresetForPx(42)).toBe('XL')
    expect(getLineHeightPx(42)).toBe(48)
  })

  test('ignores explicit-undefined override values (no registry poisoning)', () => {
    // A caller building config dynamically can pass undefined; it must not
    // overwrite a real default (which would yield NaN geometry downstream).
    configureFonts({ size: { M: undefined }, family: { 'sans-serif': undefined } })
    expect(getFontSizePx('M')).toBe(16)
    expect(getFontStack('sans-serif')).toContain('Atkinson Hyperlegible Next')
  })

  test('bumps the font epoch so caches invalidate + canvases repaint', () => {
    const before = getFontEpoch()
    configureFonts({ family: { serif: '"Whatever", serif' } })
    expect(getFontEpoch()).toBe(before + 1)
  })

  test('resetFonts restores the built-in defaults', () => {
    configureFonts({ family: { 'sans-serif': '"Custom Sans", sans-serif' }, size: { M: 99 } })
    resetFonts()
    expect(getFontStack('sans-serif')).toBe(DEFAULT_FONT_STACKS['sans-serif'])
    expect(getFontSizePx('M')).toBe(16)
  })
})
