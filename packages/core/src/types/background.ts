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
}

export const DEFAULT_BACKGROUND: Required<CanvasBackground> = {
  color: '#f8fafc',
  pattern: 'none',
  gap: 20,
  patternColor: '#cbd5e1',
}
