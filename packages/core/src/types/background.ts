/**
 * Canvas background — see ARCHITECTURE.md §4 (rendering pipeline).
 *
 * Local-only render-time config (not part of the synced scene). Drives
 * the page color plus an optional infinite dot / grid pattern that
 * helps spatial orientation while panning.
 *
 * Patterns are world-space: dots/lines are anchored to the world
 * origin, so panning moves *through* them rather than dragging them
 * along.
 */
export type CanvasBackgroundPattern = 'none' | 'dots' | 'grid'

export type CanvasBackground = {
  /** Page background color. Default `'#f8fafc'`. */
  color?: string
  /** Pattern overlay on top of the color. Default `'none'`. */
  pattern?: CanvasBackgroundPattern
  /** World units between adjacent dots / grid lines. Default `20`. */
  gap?: number
  /** Color of the dots / grid lines. Default `'#cbd5e1'`. */
  patternColor?: string
  /**
   * Hide the pattern when `camera.z < minZoom`. Useful to declutter
   * zoomed-out views and skip the per-frame pattern paint cost. Default
   * `0` (no minimum — pattern shows at any zoom, subject to the LOD
   * skip when individual cells would be sub-2px).
   */
  minZoom?: number
  /**
   * Hide the pattern when `camera.z > maxZoom`. Default `Infinity` (no
   * maximum). Most consumers won't need this; useful if you want the
   * pattern to disappear when zoomed in past a "detail" threshold.
   */
  maxZoom?: number
}

export const DEFAULT_BACKGROUND: Required<CanvasBackground> = {
  color: '#f8fafc',
  pattern: 'none',
  gap: 20,
  patternColor: '#cbd5e1',
  minZoom: 0,
  maxZoom: Number.POSITIVE_INFINITY,
}
