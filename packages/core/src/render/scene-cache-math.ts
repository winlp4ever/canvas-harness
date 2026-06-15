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
