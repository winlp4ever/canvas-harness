/**
 * Browser-mode tests for the ink bitmap-cache decision + LRU, exercising
 * `resolveInkRender` directly (it rasterizes into a real <canvas>, so it
 * needs the browser env). Covers the invariants the LOD blit rests on:
 * color/opacity baking + keying, the bitmap-vs-vector gate, the size-cap
 * fallback, and insertion-order LRU eviction/recency.
 */
import { describe, expect, test } from 'vitest'
import {
  INK_BITMAP_CACHE_MAX,
  type InkBitmapRequest,
  clearInkBitmapCache,
  createInkGeometry,
  getInkBitmapCacheSize,
  resolveInkRender,
} from '../src/ink'

/** A committed stroke with a modest bbox — bitmap regime at low zoom. */
const smallInk = () =>
  createInkGeometry(
    [
      { x: 20, y: 40, pressure: 0.6 },
      { x: 90, y: 50, pressure: 0.6 },
    ],
    12,
  )!

const req = (
  geo: ReturnType<typeof createInkGeometry> & object,
  over: Partial<InkBitmapRequest> = {},
): InkBitmapRequest => ({
  id: 'ink-a',
  width: geo.w,
  height: geo.h,
  zoom: 0.2,
  dpr: 1,
  isMoving: false,
  screenScale: 0.2,
  ink: geo.ink,
  strokeColor: '#ff0000',
  opacity: 100,
  ...over,
})

const pixels = (canvas: HTMLCanvasElement): Uint8ClampedArray =>
  canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data

const maxAlpha = (canvas: HTMLCanvasElement): number => {
  const d = pixels(canvas)
  let m = 0
  for (let i = 3; i < d.length; i += 4) if (d[i]! > m) m = d[i]!
  return m
}

const hasColorPixel = (
  canvas: HTMLCanvasElement,
  pred: (r: number, g: number, b: number) => boolean,
): boolean => {
  const d = pixels(canvas)
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3]! > 0 && pred(d[i]!, d[i + 1]!, d[i + 2]!)) return true
  }
  return false
}

describe('ink bitmap-cache (browser)', () => {
  test('bakes strokeColor into the bitmap and keys on it (recolor never blits stale)', () => {
    clearInkBitmapCache()
    const geo = smallInk()
    const red = resolveInkRender(req(geo, { strokeColor: '#ff0000' }))
    const blue = resolveInkRender(req(geo, { strokeColor: '#0000ff' }))

    expect(red.kind).toBe('bitmap')
    expect(blue.kind).toBe('bitmap')
    // Distinct color → distinct cache entry (color is in the key).
    expect(getInkBitmapCacheSize()).toBe(2)
    if (red.kind === 'bitmap' && blue.kind === 'bitmap') {
      expect(hasColorPixel(red.entry.canvas, (r, g, b) => r > 150 && g < 100 && b < 100)).toBe(true)
      expect(hasColorPixel(blue.entry.canvas, (r, g, b) => b > 150 && r < 100 && g < 100)).toBe(
        true,
      )
    }
  })

  test('bakes opacity into the bitmap and keys on it', () => {
    clearInkBitmapCache()
    const geo = smallInk()
    const full = resolveInkRender(req(geo, { opacity: 100 }))
    const faint = resolveInkRender(req(geo, { opacity: 40 }))

    expect(getInkBitmapCacheSize()).toBe(2)
    if (full.kind === 'bitmap' && faint.kind === 'bitmap') {
      const aFull = maxAlpha(full.entry.canvas)
      const aFaint = maxAlpha(faint.entry.canvas)
      expect(aFull).toBeGreaterThan(200)
      expect(aFaint).toBeGreaterThan(0)
      // ~40% vs 100% coverage — comfortably separated.
      expect(aFaint).toBeLessThan(aFull * 0.7)
    }
  })

  test('motion forces a bitmap even zoomed-in, where idle would stay vector', () => {
    clearInkBitmapCache()
    const geo = smallInk()
    const idle = resolveInkRender(req(geo, { zoom: 8, screenScale: 8, isMoving: false }))
    const moving = resolveInkRender(req(geo, { zoom: 8, screenScale: 8, isMoving: true }))

    expect(idle.kind).toBe('vector')
    expect(moving.kind).toBe('bitmap')
  })

  test('a large stroke falls back to vector where a small one blits (size cap)', () => {
    clearInkBitmapCache()
    const small = smallInk()
    const big = createInkGeometry(
      [
        { x: 0, y: 0, pressure: 0.5 },
        { x: 3000, y: 2000, pressure: 0.5 },
      ],
      20,
    )!
    // At zoom 1 a small stroke can downscale a bitmap crisply → bitmap.
    const smallDec = resolveInkRender(req(small, { id: 'small', zoom: 1, screenScale: 1 }))
    // The big bbox pushes effectiveScale under the size cap → vector.
    const bigDec = resolveInkRender({
      id: 'big',
      width: big.w,
      height: big.h,
      zoom: 1,
      dpr: 1,
      isMoving: false,
      screenScale: 1,
      ink: big.ink,
      strokeColor: '#000000',
      opacity: 100,
    })

    expect(smallDec.kind).toBe('bitmap')
    expect(bigDec.kind).toBe('vector')
  })

  test('evicts at the cap and keeps recently-touched entries (insertion-order LRU)', () => {
    clearInkBitmapCache()
    // One shared outline (memoized in a WeakMap) → each insert only pays a
    // canvas alloc + fill, so filling the real cap stays cheap.
    const geo = smallInk()
    const cap = INK_BITMAP_CACHE_MAX

    const first = resolveInkRender(req(geo, { id: 'k-0' }))
    const second = resolveInkRender(req(geo, { id: 'k-1' }))
    for (let i = 2; i < cap; i++) resolveInkRender(req(geo, { id: `k-${i}` }))
    expect(getInkBitmapCacheSize()).toBe(cap)

    const firstCanvas = first.kind === 'bitmap' ? first.entry.canvas : null
    const secondCanvas = second.kind === 'bitmap' ? second.entry.canvas : null

    // Touch k-0 → moves it to most-recent, so k-1 is now the oldest.
    resolveInkRender(req(geo, { id: 'k-0' }))
    // One new key → evicts exactly the oldest (k-1), stays at cap.
    resolveInkRender(req(geo, { id: 'k-new' }))
    expect(getInkBitmapCacheSize()).toBe(cap)

    // k-0 survived → a hit returns the SAME canvas object.
    const k0 = resolveInkRender(req(geo, { id: 'k-0' }))
    expect(k0.kind === 'bitmap' && k0.entry.canvas === firstCanvas).toBe(true)
    // k-1 was evicted → resolving it rebuilds a NEW canvas.
    const k1 = resolveInkRender(req(geo, { id: 'k-1' }))
    expect(k1.kind === 'bitmap' && k1.entry.canvas !== secondCanvas).toBe(true)
  })
})
