/**
 * Pure math for the scene-cache present path.
 *
 * The cache is a bitmap rasterized at a specific camera
 * `(cacheCamX, cacheCamY, cacheCamZ)` covering the viewport inflated
 * by `marginPx`. When the live camera's zoom matches `cacheCamZ` the
 * blit is 1:1 (the existing tier-1 "present" path); when it doesn't
 * (a zoom gesture in progress), the source rect inside the cache
 * shrinks or grows by the zoom ratio and the browser interpolates.
 * Same math drives both — the scale ratio falls out naturally.
 *
 * Kept pure (no canvas refs) so the math is easy to unit-test in the
 * node tier. The renderer wires these helpers into the cache state it
 * owns.
 */

/** The cache's frozen reference frame. */
export type CacheCamera = {
  /** World-space camera the cache was rasterized at. */
  camX: number
  camY: number
  /** Zoom the cache was rasterized at. */
  camZ: number
  /** Cache surface size in device pixels. */
  widthDevicePx: number
  heightDevicePx: number
  /** DPR the cache was rendered at (= staticSurface.dpr). */
  dpr: number
  /** Margin baked into the cache, in CSS pixels (per-side). */
  marginCssPx: number
}

/** The live viewport's reference frame. */
export type ViewCamera = {
  /** Current world-space top-left of the viewport. */
  camX: number
  camY: number
  /** Current zoom. */
  camZ: number
  /** Viewport size in CSS pixels. */
  widthCssPx: number
  heightCssPx: number
}

/** Source rect inside the cache, in cache device pixels. */
export type SourceRect = { srcX: number; srcY: number; srcW: number; srcH: number }

/**
 * Source rect inside the cache for a blit to the live viewport. The
 * math collapses to the existing 1:1 offset when `view.camZ === cache.camZ`.
 *
 * `srcX`/`srcY` are rounded to integer cache pixels so the blit and the
 * fits-in-cache test agree on the same rect; `srcW`/`srcH` are NOT
 * rounded because the browser's interpolation handles sub-pixel
 * fractional sizes correctly during the scaled blit.
 */
export const computeCacheSourceRect = (cache: CacheCamera, view: ViewCamera): SourceRect => {
  const ratio = cache.camZ / view.camZ
  const srcX = Math.round(((view.camX - cache.camX) * cache.camZ + cache.marginCssPx) * cache.dpr)
  const srcY = Math.round(((view.camY - cache.camY) * cache.camZ + cache.marginCssPx) * cache.dpr)
  const srcW = view.widthCssPx * ratio * cache.dpr
  const srcH = view.heightCssPx * ratio * cache.dpr
  return { srcX, srcY, srcW, srcH }
}

/**
 * True when `computeCacheSourceRect` lies entirely within the cache
 * canvas. Caller uses this to decide whether a (possibly scaled) blit
 * can serve the present, or whether the cache needs to be re-rendered
 * to cover the live viewport.
 */
export const cacheCoversViewport = (cache: CacheCamera, view: ViewCamera): boolean => {
  const { srcX, srcY, srcW, srcH } = computeCacheSourceRect(cache, view)
  return (
    srcX >= 0 &&
    srcY >= 0 &&
    srcX + srcW <= cache.widthDevicePx &&
    srcY + srcH <= cache.heightDevicePx
  )
}

/**
 * True when the cache's zoom is within `maxRatio` of the live zoom in
 * either direction. Beyond that the scaled blit looks unacceptably
 * blurry (huge zoom-in) or wastes pixels (extreme zoom-out); caller
 * should rebuild the cache instead.
 */
export const scaleRatioInBounds = (
  cacheCamZ: number,
  viewCamZ: number,
  maxRatio: number,
): boolean => {
  if (viewCamZ <= 0 || cacheCamZ <= 0 || maxRatio <= 0) return false
  const ratio = viewCamZ >= cacheCamZ ? viewCamZ / cacheCamZ : cacheCamZ / viewCamZ
  return ratio <= maxRatio
}

/** Rect in cache device pixels. */
type DeviceRect = { x: number; y: number; w: number; h: number }

/**
 * Layout for the scaled-extend (tier 2.7) cache reuse, mirroring the
 * existing pan-extend but for the zoom-out spatial-grow case.
 *
 * `dest` is where the existing cache pixels should be scale-blitted in
 * the NEW cache canvas (which keeps the same dimensions but represents
 * a larger world-area at the lower zoom). The four perimeter strips
 * are the regions outside `dest` — never previously rasterized at the
 * old cache, must be drawn fresh at the new zoom.
 */
export type CacheReuseLayout = {
  /** Destination rect inside the new cache canvas (device px). */
  dest: DeviceRect
  /** Perimeter strips that need fresh rasterization (device px). Any
   *  strip may have zero width or height when there's no exposure on
   *  that side (e.g. dest sits flush against an edge). */
  strips: { top: DeviceRect; bottom: DeviceRect; left: DeviceRect; right: DeviceRect }
  /** True when `dest` lies entirely inside the cache canvas — required
   *  to use this layout. False ⇒ combined zoom-out + large pan pushed
   *  the reuse rect off-canvas; caller should fall through to tier 3. */
  valid: boolean
}

/**
 * Computes the scaled-extend layout: where to scale-blit the existing
 * cache pixels and which perimeter strips to redraw at the new zoom.
 *
 * Pure (no canvas refs). The new cache implicitly recenters on the
 * live view's camera; the caller is responsible for updating
 * `cacheCamX/Y/Z` after applying the layout.
 */
export const cacheReuseLayout = (cache: CacheCamera, view: ViewCamera): CacheReuseLayout => {
  const ratio = view.camZ / cache.camZ
  const cacheW = cache.widthDevicePx
  const cacheH = cache.heightDevicePx
  const marginDev = cache.marginCssPx * cache.dpr
  // Compute the dest rect's four corners as raw floats, then round to
  // integer device pixels. Deriving `destW`/`destH` from the rounded
  // right/bottom corners (rather than rounding `destW` separately)
  // guarantees `destX + destW` matches the right strip's `x`, and
  // `destY + destH` matches the bottom strip's `y`. Sub-pixel
  // boundaries would otherwise antialias the dest-rect edge and the
  // adjacent strip-rasterization edge at slightly different offsets,
  // showing a faint visible seam in dark themes during zoom-out.
  const rawDestX = (cache.camX - view.camX) * view.camZ * cache.dpr + marginDev * (1 - ratio)
  const rawDestY = (cache.camY - view.camY) * view.camZ * cache.dpr + marginDev * (1 - ratio)
  const destX = Math.round(rawDestX)
  const destY = Math.round(rawDestY)
  const destW = Math.round(rawDestX + cacheW * ratio) - destX
  const destH = Math.round(rawDestY + cacheH * ratio) - destY
  const dest: DeviceRect = { x: destX, y: destY, w: destW, h: destH }
  const strips = {
    top: { x: 0, y: 0, w: cacheW, h: Math.max(0, destY) },
    bottom: {
      x: 0,
      y: destY + destH,
      w: cacheW,
      h: Math.max(0, cacheH - destY - destH),
    },
    left: { x: 0, y: destY, w: Math.max(0, destX), h: destH },
    right: {
      x: destX + destW,
      y: destY,
      w: Math.max(0, cacheW - destX - destW),
      h: destH,
    },
  }
  const valid = destX >= 0 && destY >= 0 && destX + destW <= cacheW && destY + destH <= cacheH
  return { dest, strips, valid }
}

/**
 * True when the zoom-out ratio fits the scaled-extend window: strictly
 * a zoom-out (ratio < 1) but not too extreme (ratio ≥ `minRatio`).
 * Below `minRatio` the perimeter is so large that a full re-render is
 * cheaper than the hybrid; the caller should fall through to tier 3.
 */
export const zoomExtendRatioInBounds = (
  cacheCamZ: number,
  viewCamZ: number,
  minRatio: number,
): boolean => {
  if (viewCamZ <= 0 || cacheCamZ <= 0 || minRatio <= 0 || minRatio >= 1) return false
  const ratio = viewCamZ / cacheCamZ
  return ratio >= minRatio && ratio < 1
}
