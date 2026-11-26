import { configureFonts, resetFonts } from '@canvas-harness/core'
import { afterEach, describe, expect, test } from 'vitest'
import { scaledTextFontSizeForResize } from '../src/internal/use-interaction-gesture'

afterEach(() => resetFonts())

describe('standalone text resize', () => {
  test('scales preset font sizes from corner handles', () => {
    expect(
      scaledTextFontSizeForResize({
        nodeType: 'text',
        fontSize: 'M',
        originalWidth: 150,
        resizedWidth: 300,
        handle: 'se',
      }),
    ).toBe(32)
  })

  test('scales explicit numeric font sizes from corner handles', () => {
    expect(
      scaledTextFontSizeForResize({
        nodeType: 'text',
        fontSize: 72,
        originalWidth: 300,
        resizedWidth: 450,
        handle: 'nw',
      }),
    ).toBe(108)
  })

  test('rounds and clamps scaled sizes', () => {
    expect(
      scaledTextFontSizeForResize({
        nodeType: 'text',
        fontSize: 24,
        originalWidth: 100,
        resizedWidth: 97,
        handle: 'sw',
      }),
    ).toBe(23)
    expect(
      scaledTextFontSizeForResize({
        nodeType: 'text',
        fontSize: 8,
        originalWidth: 100,
        resizedWidth: 1,
        handle: 'ne',
      }),
    ).toBe(8)
    expect(
      scaledTextFontSizeForResize({
        nodeType: 'text',
        fontSize: 256,
        originalWidth: 100,
        resizedWidth: 200,
        handle: 'nw',
      }),
    ).toBe(256)
  })

  test('keeps a preset when a resize rounds to its configured pixel value', () => {
    expect(
      scaledTextFontSizeForResize({
        nodeType: 'text',
        fontSize: 'M',
        originalWidth: 100,
        resizedWidth: 101,
        handle: 'se',
      }),
    ).toBe('M')

    configureFonts({ size: { M: 18 } })
    expect(
      scaledTextFontSizeForResize({
        nodeType: 'text',
        fontSize: 'M',
        originalWidth: 100,
        resizedWidth: 101,
        handle: 'se',
      }),
    ).toBe('M')
  })

  test('rejects non-finite resize geometry', () => {
    expect(
      scaledTextFontSizeForResize({
        nodeType: 'text',
        fontSize: 'M',
        originalWidth: 100,
        resizedWidth: Number.NaN,
        handle: 'se',
      }),
    ).toBeUndefined()
  })

  test('does not scale shapes or side-handle text resizing', () => {
    expect(
      scaledTextFontSizeForResize({
        nodeType: 'rect',
        fontSize: 16,
        originalWidth: 150,
        resizedWidth: 300,
        handle: 'se',
      }),
    ).toBeUndefined()
    expect(
      scaledTextFontSizeForResize({
        nodeType: 'text',
        fontSize: 16,
        originalWidth: 150,
        resizedWidth: 300,
        handle: 'e',
      }),
    ).toBeUndefined()
  })
})
