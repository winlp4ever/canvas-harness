import { describe, expect, test } from 'vitest'
import { scaledTextFontSizeForResize } from '../src/internal/use-interaction-gesture'


describe('standalone text resize', () => {
  test('scales preset font sizes from corner handles', () => {
    expect(scaledTextFontSizeForResize({
      nodeType: 'text',
      fontSize: 'M',
      originalWidth: 150,
      resizedWidth: 300,
      handle: 'se',
    })).toBe(32)
  })

  test('scales explicit numeric font sizes from corner handles', () => {
    expect(scaledTextFontSizeForResize({
      nodeType: 'text',
      fontSize: 72,
      originalWidth: 300,
      resizedWidth: 450,
      handle: 'nw',
    })).toBe(108)
  })

  test('does not scale shapes or side-handle text resizing', () => {
    expect(scaledTextFontSizeForResize({
      nodeType: 'rect',
      fontSize: 16,
      originalWidth: 150,
      resizedWidth: 300,
      handle: 'se',
    })).toBeUndefined()
    expect(scaledTextFontSizeForResize({
      nodeType: 'text',
      fontSize: 16,
      originalWidth: 150,
      resizedWidth: 300,
      handle: 'e',
    })).toBeUndefined()
  })
})
