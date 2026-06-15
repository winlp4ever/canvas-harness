import { describe, expect, test } from 'vitest'
import {
  type CacheCamera,
  type ViewCamera,
  cacheCoversViewport,
  computeCacheSourceRect,
  scaleRatioInBounds,
} from '../src/render/scene-cache-math'

/**
 * Default cache fixture: 800×600 CSS viewport, 128px margin per side,
 * DPR=1 for arithmetic clarity. Cache surface device size = (800 + 256) ×
 * (600 + 256) = 1056 × 856.
 */
const makeCache = (overrides: Partial<CacheCamera> = {}): CacheCamera => ({
  camX: 0,
  camY: 0,
  camZ: 1,
  widthDevicePx: 1056,
  heightDevicePx: 856,
  dpr: 1,
  marginCssPx: 128,
  ...overrides,
})

const makeView = (overrides: Partial<ViewCamera> = {}): ViewCamera => ({
  camX: 0,
  camY: 0,
  camZ: 1,
  widthCssPx: 800,
  heightCssPx: 600,
  ...overrides,
})

describe('computeCacheSourceRect', () => {
  test('identity (same camera) → source rect = viewport offset by margin', () => {
    const r = computeCacheSourceRect(makeCache(), makeView())
    // Source starts at the margin offset on both axes.
    expect(r.srcX).toBe(128)
    expect(r.srcY).toBe(128)
    // Source size = viewport size at 1:1 zoom + DPR.
    expect(r.srcW).toBe(800)
    expect(r.srcH).toBe(600)
  })

  test('pan-only at same zoom shifts the source rect by the pan delta', () => {
    // Pan 50 world-units right, 30 down. cache.camZ = 1 → cache pixels.
    const r = computeCacheSourceRect(makeCache(), makeView({ camX: 50, camY: 30 }))
    expect(r.srcX).toBe(128 + 50)
    expect(r.srcY).toBe(128 + 30)
    // Size unchanged when zoom ratio is 1:1.
    expect(r.srcW).toBe(800)
    expect(r.srcH).toBe(600)
  })

  test('zoom-in (view.camZ > cache.camZ) shrinks the source rect', () => {
    // cache at z=1, view at z=2 → ratio = 0.5 → src spans half the
    // cached area to fill the viewport at higher zoom.
    const r = computeCacheSourceRect(makeCache(), makeView({ camZ: 2 }))
    expect(r.srcW).toBe(400)
    expect(r.srcH).toBe(300)
    // Source origin unaffected by zoom in the identity-pan case.
    expect(r.srcX).toBe(128)
    expect(r.srcY).toBe(128)
  })

  test('zoom-out (view.camZ < cache.camZ) grows the source rect', () => {
    // cache at z=1, view at z=0.5 → ratio = 2 → src spans twice the
    // cached area to fill the viewport at lower zoom.
    const r = computeCacheSourceRect(makeCache(), makeView({ camZ: 0.5 }))
    expect(r.srcW).toBe(1600)
    expect(r.srcH).toBe(1200)
  })

  test('combined zoom + pan stacks correctly', () => {
    // cache at (0,0,1), view at (50, 30, 2) → pan in cache pixels is
    // (50, 30) since camZ=1, src size halves due to zoom ratio 0.5.
    const r = computeCacheSourceRect(makeCache(), makeView({ camX: 50, camY: 30, camZ: 2 }))
    expect(r.srcX).toBe(128 + 50)
    expect(r.srcY).toBe(128 + 30)
    expect(r.srcW).toBe(400)
    expect(r.srcH).toBe(300)
  })

  test('DPR scales the cache-space output', () => {
    // 2x DPR doubles the cache pixel counts on both axes.
    const r = computeCacheSourceRect(makeCache({ dpr: 2 }), makeView())
    expect(r.srcX).toBe(256)
    expect(r.srcY).toBe(256)
    expect(r.srcW).toBe(1600)
    expect(r.srcH).toBe(1200)
  })

  test('cache zoom != 1 maps pan into cache pixels by camZ', () => {
    // Cache rendered at z=2 → 1 world unit = 2 cache pixels.
    const r = computeCacheSourceRect(makeCache({ camZ: 2 }), makeView({ camZ: 2, camX: 10 }))
    // pan 10 world * camZ 2 = 20 cache pixels right.
    expect(r.srcX).toBe(128 + 20)
    // Identity zoom ratio (view also at z=2) → srcW = viewport width.
    expect(r.srcW).toBe(800)
  })
})

describe('cacheCoversViewport', () => {
  test('identity case: viewport at cache center fits', () => {
    expect(cacheCoversViewport(makeCache(), makeView())).toBe(true)
  })

  test('pan within margin still fits', () => {
    // Margin = 128, panning 100 right stays inside.
    expect(cacheCoversViewport(makeCache(), makeView({ camX: 100 }))).toBe(true)
  })

  test('pan past margin no longer fits', () => {
    // Margin = 128, panning 200 right — viewport's right edge falls
    // outside cache.
    expect(cacheCoversViewport(makeCache(), makeView({ camX: 200 }))).toBe(false)
  })

  test('negative pan past margin no longer fits', () => {
    // Margin = 128, panning -200 left puts source srcX negative.
    expect(cacheCoversViewport(makeCache(), makeView({ camX: -200 }))).toBe(false)
  })

  test('zoom-in fits because source rect shrinks', () => {
    // Zooming in halves srcW/srcH, more room to spare inside the cache.
    expect(cacheCoversViewport(makeCache(), makeView({ camZ: 2 }))).toBe(true)
  })

  test('zoom-out past the cache margin exposes uncached pixels', () => {
    // Zoom 0.5 doubles srcW to 1600, but cache width is 1056 →
    // source rect overruns the cache → blank pixels.
    expect(cacheCoversViewport(makeCache(), makeView({ camZ: 0.5 }))).toBe(false)
  })
})

describe('scaleRatioInBounds', () => {
  test('identity zoom is always in bounds', () => {
    expect(scaleRatioInBounds(1, 1, 1)).toBe(true)
    expect(scaleRatioInBounds(2.5, 2.5, 4)).toBe(true)
  })

  test('within bounds either direction', () => {
    expect(scaleRatioInBounds(1, 2, 4)).toBe(true) // zoom-in 2x
    expect(scaleRatioInBounds(1, 0.5, 4)).toBe(true) // zoom-out 2x
    expect(scaleRatioInBounds(1, 4, 4)).toBe(true) // boundary
    expect(scaleRatioInBounds(1, 0.25, 4)).toBe(true) // boundary
  })

  test('beyond bounds either direction', () => {
    expect(scaleRatioInBounds(1, 5, 4)).toBe(false)
    expect(scaleRatioInBounds(1, 0.2, 4)).toBe(false)
  })

  test('rejects nonpositive inputs', () => {
    expect(scaleRatioInBounds(0, 1, 4)).toBe(false)
    expect(scaleRatioInBounds(1, 0, 4)).toBe(false)
    expect(scaleRatioInBounds(1, 1, 0)).toBe(false)
    expect(scaleRatioInBounds(-1, 1, 4)).toBe(false)
  })
})
