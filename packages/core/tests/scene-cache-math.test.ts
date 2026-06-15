import { describe, expect, test } from 'vitest'
import {
  type CacheCamera,
  type ViewCamera,
  cacheCoversViewport,
  cacheReuseLayout,
  computeCacheSourceRect,
  scaleRatioInBounds,
  zoomExtendRatioInBounds,
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

describe('cacheReuseLayout', () => {
  // The fixture: cache canvas 1056×856 device px = (800 + 256) × (600 + 256)
  // at DPR=1. Cache rasterized at zoom 1.0 centered on world (0, 0).
  test('identity (ratio = 1, no pan): dest fills cache, strips empty', () => {
    const r = cacheReuseLayout(makeCache(), makeView())
    expect(r.valid).toBe(true)
    expect(r.dest.x).toBe(0)
    expect(r.dest.y).toBe(0)
    expect(r.dest.w).toBe(1056)
    expect(r.dest.h).toBe(856)
    // All perimeter strips are zero-area.
    expect(r.strips.top.h).toBe(0)
    expect(r.strips.bottom.h).toBe(0)
    expect(r.strips.left.w).toBe(0)
    expect(r.strips.right.w).toBe(0)
  })

  test('pure zoom-out (ratio = 0.5, no pan): dest shrinks, strips appear', () => {
    // Cache at z=1, view at z=0.5 → ratio = 0.5 → dest is 50% of cache.
    const r = cacheReuseLayout(makeCache(), makeView({ camZ: 0.5 }))
    expect(r.valid).toBe(true)
    // destW = 1056 * 0.5 = 528, destH = 856 * 0.5 = 428.
    expect(r.dest.w).toBe(528)
    expect(r.dest.h).toBe(428)
    // destX = marginCssPx * dpr * (1 - ratio) = 128 * 1 * 0.5 = 64.
    expect(r.dest.x).toBe(64)
    expect(r.dest.y).toBe(64)
    // Strips: top = full-width × 64 tall; left = 64 wide × destH tall.
    expect(r.strips.top).toEqual({ x: 0, y: 0, w: 1056, h: 64 })
    expect(r.strips.left).toEqual({ x: 0, y: 64, w: 64, h: 428 })
    // Right strip starts at destX + destW = 592; width = 1056 - 592 = 464.
    expect(r.strips.right).toEqual({ x: 592, y: 64, w: 464, h: 428 })
    // Bottom strip starts at destY + destH = 492; height = 856 - 492 = 364.
    expect(r.strips.bottom).toEqual({ x: 0, y: 492, w: 1056, h: 364 })
  })

  test('mild zoom-out (ratio = 0.8): dest mostly fills cache, all corners rounded', () => {
    const r = cacheReuseLayout(makeCache(), makeView({ camZ: 0.8 }))
    expect(r.valid).toBe(true)
    // Pixel-align fix: dest corners round to integers so the perimeter
    // strips abut at exact pixel boundaries (no half-pixel seam).
    //   raw destX = (1 - 0.8) * 128 = 25.6        → round → 26
    //   raw destR = 25.6 + 1056 * 0.8 = 870.4      → round → 870
    //   destW = 870 - 26 = 844
    expect(r.dest.x).toBe(26)
    expect(r.dest.w).toBe(844)
    expect(r.dest.x + r.dest.w).toBe(870) // matches the right strip's `x`
  })

  test('zoom-out with pan offsets dest by the pan delta', () => {
    // View panned 50 world units right at new zoom 0.5: pan delta in
    // device px = (cache.camX - view.camX) * view.camZ * dpr =
    // (0 - 50) * 0.5 * 1 = -25. Pure-zoom-out base destX is 64,
    // so destX = 64 - 25 = 39.
    const r = cacheReuseLayout(makeCache(), makeView({ camX: 50, camZ: 0.5 }))
    expect(r.valid).toBe(true)
    expect(r.dest.x).toBeCloseTo(39)
    expect(r.dest.y).toBe(64) // unchanged on Y (no pan on Y)
  })

  test('zoom-out with large pan can push dest off-cache → valid=false', () => {
    // Pan 1000 world units right at z=0.5 → destX = 128 - 500 = -372.
    // dest's left edge falls outside cache → valid=false.
    const r = cacheReuseLayout(makeCache(), makeView({ camX: 1000, camZ: 0.5 }))
    expect(r.valid).toBe(false)
  })

  test('zoom-in (ratio > 1): dest overflows cache → valid=false', () => {
    const r = cacheReuseLayout(makeCache(), makeView({ camZ: 2 }))
    expect(r.valid).toBe(false)
    // dest would be 2× cache size — definitely doesn't fit.
    expect(r.dest.w).toBe(2112)
    expect(r.dest.h).toBe(1712)
  })

  test('DPR=2: dest scales with device pixels', () => {
    const r = cacheReuseLayout(
      makeCache({ dpr: 2, widthDevicePx: 2112, heightDevicePx: 1712 }),
      makeView({ camZ: 0.5 }),
    )
    expect(r.valid).toBe(true)
    expect(r.dest.w).toBe(1056)
    expect(r.dest.h).toBe(856)
    // marginCssPx=128, dpr=2 → marginDev=256, factor (1-0.5)=0.5 → destX=128 wait no
    // destX = (cache.camX - view.camX) * view.camZ * dpr + marginDev * (1 - ratio)
    //       = 0 + 128 * 2 * 0.5 = 128.
    expect(r.dest.x).toBe(128)
  })

  test('perimeter strips abut the dest rect at exact integer pixel boundaries', () => {
    // Regression: at non-integer destX/Y/W/H values, the dest rect's
    // antialiased blit edge and the perimeter strip's antialiased
    // rasterization edge land at slightly different subpixel offsets,
    // creating a visible 1-pixel seam (most notable on dark themes).
    // The fix rounds the corners; this test pins both halves of the
    // invariant — corners are integers AND strips meet the dest rect
    // at those exact integers.
    const r = cacheReuseLayout(makeCache(), makeView({ camZ: 0.73 }))
    expect(r.valid).toBe(true)
    expect(Number.isInteger(r.dest.x)).toBe(true)
    expect(Number.isInteger(r.dest.y)).toBe(true)
    expect(Number.isInteger(r.dest.w)).toBe(true)
    expect(Number.isInteger(r.dest.h)).toBe(true)
    // Right-strip starts where dest ends (no gap, no overlap).
    expect(r.strips.right.x).toBe(r.dest.x + r.dest.w)
    // Bottom-strip starts where dest ends on y.
    expect(r.strips.bottom.y).toBe(r.dest.y + r.dest.h)
    // Left-strip ends exactly at dest.x.
    expect(r.strips.left.x + r.strips.left.w).toBe(r.dest.x)
    // Top-strip ends exactly at dest.y.
    expect(r.strips.top.y + r.strips.top.h).toBe(r.dest.y)
  })

  test('non-1 cache zoom: pan delta still maps correctly', () => {
    // Cache at z=2 (rendered at higher zoom), view zoom-out to z=1.
    const r = cacheReuseLayout(makeCache({ camZ: 2 }), makeView({ camZ: 1, camX: 10 }))
    expect(r.valid).toBe(true)
    // ratio = 1 / 2 = 0.5.
    expect(r.dest.w).toBe(528)
    // Pan delta: (0 - 10) * 1 * 1 = -10. Margin shrink: 128 * (1 - 0.5) = 64.
    // destX = -10 + 64 = 54.
    expect(r.dest.x).toBe(54)
  })
})

describe('zoomExtendRatioInBounds', () => {
  test('moderate zoom-out is in bounds', () => {
    expect(zoomExtendRatioInBounds(1, 0.8, 0.5)).toBe(true)
    expect(zoomExtendRatioInBounds(1, 0.5, 0.5)).toBe(true) // boundary
    expect(zoomExtendRatioInBounds(2, 1.2, 0.5)).toBe(true) // ratio 0.6
  })

  test('extreme zoom-out below the minimum ratio is out of bounds', () => {
    expect(zoomExtendRatioInBounds(1, 0.4, 0.5)).toBe(false)
    expect(zoomExtendRatioInBounds(1, 0.1, 0.5)).toBe(false)
  })

  test('identity (ratio = 1) is OUT of bounds — tier 2 / 2.5 handles it', () => {
    expect(zoomExtendRatioInBounds(1, 1, 0.5)).toBe(false)
  })

  test('zoom-in (ratio > 1) is out of bounds — tier 2.5 handles it', () => {
    expect(zoomExtendRatioInBounds(1, 1.5, 0.5)).toBe(false)
    expect(zoomExtendRatioInBounds(1, 4, 0.5)).toBe(false)
  })

  test('rejects nonpositive inputs', () => {
    expect(zoomExtendRatioInBounds(0, 1, 0.5)).toBe(false)
    expect(zoomExtendRatioInBounds(1, 0, 0.5)).toBe(false)
    expect(zoomExtendRatioInBounds(1, 1, 0)).toBe(false)
    expect(zoomExtendRatioInBounds(1, 1, 1)).toBe(false)
    expect(zoomExtendRatioInBounds(-1, 1, 0.5)).toBe(false)
  })
})
