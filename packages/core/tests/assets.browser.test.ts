/**
 * Browser-mode tests for asset utilities that depend on DOMParser /
 * createImageBitmap / OffscreenCanvas / FileReader — i.e. anything the
 * node tier can't exercise.
 */
import { describe, expect, test } from 'vitest'
import {
  applySvgColor,
  blobToDataUri,
  downscaleImageBlob,
  extractSvgDimensions,
  sanitizeSvg,
} from '../src/assets'
import { createCanvasStore } from '../src/store'

const TINY_PNG_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

/** Generate a real PNG blob of `size`×`size` via OffscreenCanvas. */
const makePngBlob = async (size: number): Promise<Blob> => {
  const canvas = new OffscreenCanvas(size, size)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ff0000'
  ctx.fillRect(0, 0, size, size)
  return canvas.convertToBlob({ type: 'image/png' })
}

describe('sanitizeSvg', () => {
  test('strips <script> tags entirely', () => {
    const dirty = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect/></svg>'
    const clean = sanitizeSvg(dirty)
    expect(clean).not.toContain('<script')
    expect(clean).not.toContain('alert')
    expect(clean).toContain('<rect')
  })

  test('strips <foreignObject> entirely', () => {
    const dirty =
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div>evil</div></foreignObject></svg>'
    const clean = sanitizeSvg(dirty)
    expect(clean.toLowerCase()).not.toContain('foreignobject')
    expect(clean).not.toContain('<div')
  })

  test('strips on* event handlers from any element', () => {
    const dirty =
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect onclick="bad()"/></svg>'
    const clean = sanitizeSvg(dirty)
    expect(clean).not.toContain('onload')
    expect(clean).not.toContain('onclick')
  })

  test('strips javascript: hrefs', () => {
    const dirty =
      '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:evil()"><rect/></a></svg>'
    const clean = sanitizeSvg(dirty)
    expect(clean).not.toContain('javascript:')
  })

  test('preserves benign markup unchanged', () => {
    const safe =
      '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#ff0000" stroke="#000"/></svg>'
    const clean = sanitizeSvg(safe)
    expect(clean).toContain('rect')
    expect(clean).toContain('fill="#ff0000"')
    expect(clean).toContain('stroke="#000"')
  })

  test('rejects malformed SVG via parser error', () => {
    expect(() => sanitizeSvg('<svg><unclosed')).toThrow(/malformed/)
  })
})

describe('extractSvgDimensions', () => {
  test('reads explicit width + height attributes', () => {
    const markup = '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="32"></svg>'
    expect(extractSvgDimensions(markup)).toEqual({ w: 48, h: 32 })
  })

  test('strips units from width / height', () => {
    const markup = '<svg xmlns="http://www.w3.org/2000/svg" width="48px" height="32px"></svg>'
    expect(extractSvgDimensions(markup)).toEqual({ w: 48, h: 32 })
  })

  test('falls back to viewBox when width/height missing', () => {
    const markup = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"></svg>'
    expect(extractSvgDimensions(markup)).toEqual({ w: 100, h: 50 })
  })

  test('falls back to 24x24 when nothing usable is present', () => {
    const markup = '<svg xmlns="http://www.w3.org/2000/svg"></svg>'
    expect(extractSvgDimensions(markup)).toEqual({ w: 24, h: 24 })
  })
})

describe('blobToDataUri', () => {
  test('round-trips a blob through base64', async () => {
    const blob = new Blob(['hello'], { type: 'text/plain' })
    const uri = await blobToDataUri(blob)
    expect(uri.startsWith('data:text/plain;base64,')).toBe(true)
    // base64-decode the payload back to "hello"
    const decoded = atob(uri.slice('data:text/plain;base64,'.length))
    expect(decoded).toBe('hello')
  })
})

describe('downscaleImageBlob', () => {
  test('returns the original blob unchanged when within maxDim', async () => {
    const blob = await makePngBlob(64)
    const { blob: out, naturalW, naturalH } = await downscaleImageBlob(blob, 128)
    expect(naturalW).toBe(64)
    expect(naturalH).toBe(64)
    expect(out).toBe(blob) // same reference — no downscale happened
  })

  test('downscales when the longer side exceeds maxDim', async () => {
    const blob = await makePngBlob(256)
    const { naturalW, naturalH } = await downscaleImageBlob(blob, 64)
    expect(naturalW).toBe(64)
    expect(naturalH).toBe(64)
  })

  test('disables downscale when maxDim <= 0', async () => {
    const blob = await makePngBlob(128)
    const { blob: out, naturalW, naturalH } = await downscaleImageBlob(blob, 0)
    expect(naturalW).toBe(128)
    expect(naturalH).toBe(128)
    expect(out).toBe(blob)
  })
})

describe('store.addImage', () => {
  test('adds an image node with natural dimensions', async () => {
    const store = createCanvasStore()
    const id = await store.addImage({ src: TINY_PNG_DATA_URI, x: 10, y: 20, alt: 'tiny' })
    const node = store.getNode(id)
    expect(node).toBeDefined()
    expect(node?.type).toBe('image')
    expect(node?.x).toBe(10)
    expect(node?.y).toBe(20)
    // 1×1 image stays 1×1 (well under the 400px default clamp)
    expect(node?.w).toBe(1)
    expect(node?.h).toBe(1)
    const data = node?.data as { src: string; naturalW: number; naturalH: number; alt?: string }
    expect(data.src.startsWith('data:image/png')).toBe(true)
    expect(data.naturalW).toBe(1)
    expect(data.naturalH).toBe(1)
    expect(data.alt).toBe('tiny')
  })

  test('rejects external URLs synchronously', async () => {
    const store = createCanvasStore()
    await expect(
      store.addImage({ src: 'https://example.com/cat.png', x: 0, y: 0 }),
    ).rejects.toThrow(/external URL/)
  })

  test('rejects unsupported MIME synchronously', async () => {
    const store = createCanvasStore()
    await expect(
      store.addImage({ src: 'data:image/gif;base64,R0lGODlh', x: 0, y: 0 }),
    ).rejects.toThrow(/unsupported MIME/)
  })

  test('downscales when the image is larger than maxDimension', async () => {
    const store = createCanvasStore()
    const blob = await new Promise<Blob>((resolve, reject) => {
      const canvas = new OffscreenCanvas(512, 256)
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#00ff00'
      ctx.fillRect(0, 0, 512, 256)
      canvas.convertToBlob({ type: 'image/png' }).then(resolve).catch(reject)
    })
    const id = await store.addImage({ src: blob, x: 0, y: 0, maxDimension: 128 })
    const node = store.getNode(id)
    const data = node?.data as { naturalW: number; naturalH: number }
    expect(data.naturalW).toBe(128)
    expect(data.naturalH).toBe(64)
  })

  test('honors explicit w + h when provided', async () => {
    const store = createCanvasStore()
    const id = await store.addImage({ src: TINY_PNG_DATA_URI, x: 0, y: 0, w: 80, h: 60 })
    const node = store.getNode(id)
    expect(node?.w).toBe(80)
    expect(node?.h).toBe(60)
  })
})

describe('store.addSvg', () => {
  const ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="32"><rect/></svg>'

  test('adds an icon node sized from the SVG dimensions', async () => {
    const store = createCanvasStore()
    const id = await store.addSvg({ src: ICON, x: 5, y: 7, alt: 'icon' })
    const node = store.getNode(id)
    expect(node?.type).toBe('icon')
    expect(node?.x).toBe(5)
    expect(node?.y).toBe(7)
    expect(node?.w).toBe(48)
    expect(node?.h).toBe(32)
    const data = node?.data as { src: string; alt?: string }
    expect(data.src).toContain('<rect')
    expect(data.alt).toBe('icon')
  })

  test('writes color into style.iconColor', async () => {
    const store = createCanvasStore()
    const id = await store.addSvg({ src: ICON, x: 0, y: 0, color: '#ff00ff' })
    const node = store.getNode(id)
    expect(node?.style?.iconColor).toBe('#ff00ff')
  })

  test('sanitizes the stored markup', async () => {
    const store = createCanvasStore()
    const dirty =
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><script>alert(1)</script><rect onclick="evil()"/></svg>'
    const id = await store.addSvg({ src: dirty, x: 0, y: 0 })
    const node = store.getNode(id)
    const data = node?.data as { src: string }
    expect(data.src).not.toContain('<script')
    expect(data.src).not.toContain('onclick')
  })

  test('rejects non-SVG input', async () => {
    const store = createCanvasStore()
    await expect(store.addSvg({ src: '<div>nope</div>', x: 0, y: 0 })).rejects.toThrow(/<svg> tag/)
  })

  test('applySvgColor + iconColor agree on substitution', async () => {
    // Defense in depth: the renderer uses applySvgColor with
    // style.iconColor; verify the same pipeline produces the expected
    // markup when we substitute manually.
    const markupWithCurrentColor =
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" stroke="currentColor"/>'
    const store = createCanvasStore()
    const id = await store.addSvg({ src: markupWithCurrentColor, x: 0, y: 0, color: '#abc' })
    const node = store.getNode(id)
    const data = node?.data as { src: string }
    // Stored markup is sanitized but NOT pre-colored — color lives on style.
    expect(data.src).toContain('currentColor')
    expect(node?.style?.iconColor).toBe('#abc')
    // Manual substitution (what the renderer does) yields the tinted markup.
    expect(applySvgColor(data.src, '#abc')).toContain('stroke="#abc"')
  })
})
