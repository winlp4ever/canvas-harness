/**
 * DPR + size management for canvas elements.
 *
 * The backing-store size is `cssSize × dpr`, where `dpr` is clamped by
 * `maxDpr`. At native device-pixel-ratio on hi-DPI displays (Mac Retina
 * ≈ 2, Windows 4K @ 175% ≈ 1.75), the backing buffer can hit 8-25 MP —
 * every paint pays a proportional GPU-upload cost that often dominates
 * the frame budget.
 *
 * Default behavior when `maxDpr` is omitted: pick a cap from the
 * canvas's CSS-pixel area so the backing buffer stays in a healthy
 * 3-8 MP zone regardless of monitor / OS scaling. Tiered:
 *
 *   - CSS canvas ≥ 2.5 MP (4K-ish, e.g. 4K Mac native, 4K Win @ 175%)
 *     → cap at 1   (crispness sacrificed for perf, high-density makes
 *                   the softness less visible anyway)
 *   - CSS canvas ≥ 1.5 MP (1440p / 2K-ish)
 *     → cap at 1.5
 *   - CSS canvas <  1.5 MP (1080p Retina laptops, embedded canvases)
 *     → cap at 2   (DPR=2 is free at this size — keep crispness)
 *
 * Explicit `maxDpr={n}` always overrides the tier default. Text
 * remains crisp regardless of canvas DPR — the text bitmap cache
 * rasterizes glyphs at its own DPR-aware scale and blits.
 */
const HARD_MAX_DPR = 3 // anything above this just burns memory

/**
 * Picks a sensible default `maxDpr` for the given CSS-pixel canvas
 * size. Targets ~3-8 MP backing buffer across the realistic hardware
 * spectrum. See module-level doc for the tier breakpoints.
 */
export const defaultMaxDprForSize = (cssW: number, cssH: number): number => {
  const cssPx = cssW * cssH
  if (cssPx >= 2_500_000) return 1
  if (cssPx >= 1_500_000) return 1.5
  return 2
}

export type CanvasSurface = {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  /** Logical CSS pixels (the size you set in JS / read with getBoundingClientRect). */
  cssWidth: number
  cssHeight: number
  /** Device pixels — backing-store size. */
  dpr: number
}

/**
 * Resolved DPR for the canvas backing store. Clamped by `maxDpr`
 * (consumer-supplied) and the absolute `HARD_MAX_DPR` ceiling. When
 * `maxDpr` is omitted, the tier-based default (see
 * `defaultMaxDprForSize`) is used — pass `cssW`/`cssH` to enable it.
 */
export const getDpr = (maxDpr?: number, cssW = 0, cssH = 0): number => {
  if (typeof window === 'undefined') return 1
  const raw = window.devicePixelRatio || 1
  const resolvedMax =
    maxDpr === undefined && cssW > 0 && cssH > 0 ? defaultMaxDprForSize(cssW, cssH) : (maxDpr ?? 1)
  const cap = Math.max(1, Math.min(HARD_MAX_DPR, resolvedMax))
  return Math.max(1, Math.min(cap, raw))
}

/**
 * Builds a managed canvas surface. Caller pins the canvas element; we size
 * it and reset the 2d context's transform to logical-pixel space.
 *
 * Subsequent calls to `setSize` re-allocate the backing store if the new
 * `cssW × cssH × DPR` differs from the current.
 */
// `maxDpr` is accepted but not yet used here — the actual DPR is
// resolved in `sizeSurface` once we have the canvas dimensions for
// the tier-default lookup. Kept on the signature for API symmetry.
export const setupSurface = (canvas: HTMLCanvasElement, _maxDpr?: number): CanvasSurface => {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2d context unavailable')
  return {
    canvas,
    ctx,
    cssWidth: 0,
    cssHeight: 0,
    dpr: 1, // placeholder; `sizeSurface` writes the real value
  }
}

/**
 * Resizes the surface to a new CSS-pixel size, picking up the current DPR.
 * Returns true if anything changed (caller should redraw).
 */
export const sizeSurface = (
  surface: CanvasSurface,
  cssW: number,
  cssH: number,
  maxDpr?: number,
): boolean => {
  const dpr = getDpr(maxDpr, cssW, cssH)
  if (surface.cssWidth === cssW && surface.cssHeight === cssH && surface.dpr === dpr) {
    return false
  }
  surface.cssWidth = cssW
  surface.cssHeight = cssH
  surface.dpr = dpr
  surface.canvas.width = Math.max(1, Math.round(cssW * dpr))
  surface.canvas.height = Math.max(1, Math.round(cssH * dpr))
  surface.canvas.style.width = `${cssW}px`
  surface.canvas.style.height = `${cssH}px`
  return true
}

/**
 * Clears the entire backing store. Call before setting the camera transform.
 */
export const clearSurface = (surface: CanvasSurface): void => {
  surface.ctx.setTransform(1, 0, 0, 1, 0, 0)
  surface.ctx.clearRect(0, 0, surface.canvas.width, surface.canvas.height)
}
