/**
 * Pure-function tests for the assets module. DOMParser-dependent
 * functions (sanitizeSvg, extractSvgDimensions) and end-to-end async
 * paths (downscaleImageBlob, blobToDataUri) live in
 * assets.browser.test.ts since they need browser globals.
 */
import { describe, expect, test } from 'vitest'
import {
  MAX_IMAGE_BYTES,
  MAX_SVG_BYTES,
  applySvgColor,
  validateImageInput,
  validateSvgMarkup,
} from '../src/assets'

// 1x1 transparent PNG — smallest valid PNG. Used in lots of tests.
const TINY_PNG_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

describe('validateImageInput (data URI form)', () => {
  test('accepts a valid image/png data URI', () => {
    expect(() => validateImageInput(TINY_PNG_DATA_URI)).not.toThrow()
  })

  test('accepts image/jpeg data URI', () => {
    expect(() => validateImageInput('data:image/jpeg;base64,/9j/2wBDAA==')).not.toThrow()
  })

  test('rejects external URL strings', () => {
    expect(() => validateImageInput('https://example.com/cat.png')).toThrow(/external URL/)
  })

  test('rejects unsupported MIME types in data URIs', () => {
    expect(() => validateImageInput('data:image/gif;base64,R0lGOD==')).toThrow(/unsupported MIME/)
  })

  test('rejects malformed data URIs (no comma)', () => {
    expect(() => validateImageInput('data:image/png;base64')).toThrow(/malformed/)
  })

  test('rejects data URIs that exceed the 2 MB cap', () => {
    // 4 bytes of base64 → 3 bytes decoded. To exceed 2 MB we need ~2.67 MB of base64.
    const padding = 'A'.repeat(MAX_IMAGE_BYTES * 2)
    const oversized = `data:image/png;base64,${padding}`
    expect(() => validateImageInput(oversized)).toThrow(/exceeds the 2 MB limit/)
  })
})

describe('validateImageInput (File/Blob form)', () => {
  test('accepts a PNG blob within the cap', () => {
    const blob = new Blob([new Uint8Array(1024)], { type: 'image/png' })
    expect(() => validateImageInput(blob)).not.toThrow()
  })

  test('accepts a JPEG blob within the cap', () => {
    const blob = new Blob([new Uint8Array(1024)], { type: 'image/jpeg' })
    expect(() => validateImageInput(blob)).not.toThrow()
  })

  test('rejects an unsupported MIME blob', () => {
    const blob = new Blob([new Uint8Array(1024)], { type: 'image/gif' })
    expect(() => validateImageInput(blob)).toThrow(/unsupported file type/)
  })

  test('rejects an oversized blob', () => {
    const blob = new Blob([new Uint8Array(MAX_IMAGE_BYTES + 1)], { type: 'image/png' })
    expect(() => validateImageInput(blob)).toThrow(/exceeds the 2 MB limit/)
  })
})

describe('validateSvgMarkup', () => {
  test('accepts plausible SVG markup', () => {
    expect(() =>
      validateSvgMarkup('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'),
    ).not.toThrow()
  })

  test('accepts SVG with attributes before the closing >', () => {
    expect(() => validateSvgMarkup('<svg width="24" height="24"></svg>')).not.toThrow()
  })

  test('rejects non-SVG markup', () => {
    expect(() => validateSvgMarkup('<div>not an svg</div>')).toThrow(/no <svg> tag/)
  })

  test('rejects empty input', () => {
    expect(() => validateSvgMarkup('')).toThrow(/no <svg> tag/)
  })

  test('rejects markup exceeding the size cap', () => {
    // Build a >2 MB string: 2 MB of filler inside a valid svg wrapper.
    const filler = 'a'.repeat(MAX_SVG_BYTES + 100)
    expect(() => validateSvgMarkup(`<svg>${filler}</svg>`)).toThrow(/exceeds the 2 MB limit/)
  })
})

describe('applySvgColor', () => {
  test('replaces all currentColor occurrences case-insensitively', () => {
    const markup =
      '<svg stroke="currentColor" fill="CURRENTCOLOR"><path stroke="currentcolor"/></svg>'
    expect(applySvgColor(markup, '#ff0000')).toBe(
      '<svg stroke="#ff0000" fill="#ff0000"><path stroke="#ff0000"/></svg>',
    )
  })

  test('returns markup unchanged when no currentColor is present', () => {
    const markup = '<svg stroke="#000"><path fill="#fff"/></svg>'
    expect(applySvgColor(markup, '#ff0000')).toBe(markup)
  })

  test('accepts any color literal (named, hex, rgb)', () => {
    expect(applySvgColor('<svg fill="currentColor"/>', 'red')).toContain('fill="red"')
    expect(applySvgColor('<svg fill="currentColor"/>', 'rgb(0,0,0)')).toContain('fill="rgb(0,0,0)"')
  })
})
