/**
 * DPR + size management for canvas elements.
 *
 * The backing-store size must be `cssSize × devicePixelRatio` for crisp
 * rendering on hi-dpi. We re-size on viewport changes and DPR changes.
 */
const MAX_DPR = 3 // anything above this just burns memory

export type CanvasSurface = {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  /** Logical CSS pixels (the size you set in JS / read with getBoundingClientRect). */
  cssWidth: number
  cssHeight: number
  /** Device pixels — backing-store size. */
  dpr: number
}

export const getDpr = (): number => {
  if (typeof window === 'undefined') return 1
  const raw = window.devicePixelRatio || 1
  return Math.max(1, Math.min(MAX_DPR, raw))
}

/**
 * Builds a managed canvas surface. Caller pins the canvas element; we size
 * it and reset the 2d context's transform to logical-pixel space.
 *
 * Subsequent calls to `setSize` re-allocate the backing store if the new
 * `cssW × cssH × DPR` differs from the current.
 */
export const setupSurface = (canvas: HTMLCanvasElement): CanvasSurface => {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2d context unavailable')
  return {
    canvas,
    ctx,
    cssWidth: 0,
    cssHeight: 0,
    dpr: getDpr(),
  }
}

/**
 * Resizes the surface to a new CSS-pixel size, picking up the current DPR.
 * Returns true if anything changed (caller should redraw).
 */
export const sizeSurface = (surface: CanvasSurface, cssW: number, cssH: number): boolean => {
  const dpr = getDpr()
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
