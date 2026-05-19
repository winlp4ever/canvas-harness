/**
 * Zoom + DPR quantization and moving-vs-idle render scale — ported
 * verbatim from canvas-lite-markdown.tsx.
 *
 * Bitmap-cache keys include `zoomBucket` and `dprBucket` instead of raw
 * camera.z and devicePixelRatio. Without quantization, tiny floating-
 * point drift on each wheel event would explode the cache. With it, a
 * zoom from 1.00 → 1.04 hits the same bucket and reuses the same bitmap.
 *
 * `resolveRenderScale` is the LOD selector: lower-quality rasterization
 * during pan/zoom motion, full quality on idle. Saves up to 60% of the
 * sample bitmap pixels when nothing's changing for the user anyway.
 */
const MIN_RENDER_SCALE = 0.15
const MAX_RENDER_SCALE = 1.5
const MAX_RENDER_WIDTH = 2000
const MAX_RENDER_HEIGHT = 1200

/**
 * Buckets zoom to avoid cache churn from sub-1%-zoom changes.
 */
export const quantizeZoom = (value: number): number => {
  if (!Number.isFinite(value)) return 1
  return Math.max(0.1, Math.round(value * 10) / 10)
}

/**
 * Buckets DPR to keep cache keys stable across tiny devicePixelRatio
 * variance (e.g. when a window crosses a mixed-DPR monitor boundary).
 */
export const quantizeDpr = (value: number): number => {
  if (!Number.isFinite(value)) return 1
  const clamped = Math.max(1, Math.min(3, value))
  return Math.round(clamped * 4) / 4
}

/**
 * Chooses a render scale from a base scale, the current zoom bucket,
 * and whether the camera (or shape) is in motion. While moving, drop
 * quality for throughput; on idle, snap back to full quality.
 */
export const resolveRenderScale = (baseScale: number, zoom: number, isMoving: boolean): number => {
  const clampedBase = Math.max(MIN_RENDER_SCALE, Math.min(MAX_RENDER_SCALE, baseScale))
  let idleScale = clampedBase
  if (zoom <= 0.4) {
    idleScale = 0.45
  } else if (zoom <= 0.7) {
    idleScale = 0.85
  } else if (zoom <= 1) {
    idleScale = 1.15
  } else if (zoom <= 1.8) {
    idleScale = 1.35
  } else {
    idleScale = 1 + (zoom - 1.8) * 0.2
  }

  idleScale = Math.max(MIN_RENDER_SCALE, Math.min(MAX_RENDER_SCALE, idleScale))

  if (isMoving) {
    let movingScale = idleScale * (zoom >= 0.4 ? 0.72 : 0.6)
    if (zoom < 0.4) {
      movingScale = Math.min(movingScale, 0.22)
    } else if (zoom <= 0.7) {
      movingScale = Math.min(movingScale, 0.4)
    }
    return Math.max(MIN_RENDER_SCALE, Math.min(0.65, movingScale))
  }

  return idleScale
}

/**
 * Applies the absolute backing-store size cap so very-wide / very-tall
 * shapes don't blow up memory at high zoom.
 */
export const clampEffectiveScale = (baseScale: number, width: number, height: number): number => {
  const limiter = Math.min(
    1,
    MAX_RENDER_WIDTH / Math.max(1, width * baseScale),
    MAX_RENDER_HEIGHT / Math.max(1, height * baseScale),
  )
  return baseScale * limiter
}
