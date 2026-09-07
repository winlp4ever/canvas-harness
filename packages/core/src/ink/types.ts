import type { Vec2 } from '../types'

/** One pressure-aware world-space sample collected during an active stroke. */
export type InkSample = Vec2 & {
  pressure: number
}

/** Portable, node-local sample stored in an ink node. */
export type InkPoint = readonly [x: number, y: number, pressure: number]

/**
 * perfect-freehand shape knobs exposed for tuning stroke feel. All optional;
 * an omitted (or non-finite) field falls back to {@link DEFAULT_INK_STROKE_OPTIONS},
 * and values outside the listed ranges are clamped when the outline is built.
 *   - `thinning`   pressure → width sensitivity (−1…1)
 *   - `smoothing`  outline smoothing (0…1)
 *   - `streamline` input jitter smoothing (0…1)
 */
export type InkStrokeOptions = {
  thinning?: number
  smoothing?: number
  streamline?: number
}

/** Versioned geometry owned by the built-in `ink` node. */
export type InkStrokeData = {
  type: 'ink'
  version: 1
  size: number
  points: InkPoint[]
  intrinsicWidth: number
  intrinsicHeight: number
  /**
   * Persisted shape knobs — only the fields that differ from the defaults are
   * stored (so default strokes stay compact and back-compatible). Renderers
   * rebuild the outline from `points + size + these`, so a stroke keeps the
   * feel it was drawn with across reload/sync even if the tool config changes.
   */
  thinning?: number
  smoothing?: number
  streamline?: number
}

/** Pure geometry produced at pointer-up, before a product builds its node payload. */
export type InkGeometry = {
  x: number
  y: number
  w: number
  h: number
  ink: InkStrokeData
}

/**
 * Ink nodes reserve `data.ink` for engine geometry. Consumers may put
 * arbitrary product metadata next to it (scope ids, timestamps, etc.).
 */
export type InkNodeData = Record<string, unknown> & {
  ink: InkStrokeData
}

/**
 * Ephemeral preview kept outside the document/op log while drawing.
 * `segments` is read-only: sealed (already-split) segments are frozen and
 * published by reference, so consumers must treat them as immutable.
 */
export type InkDraft = {
  segments: ReadonlyArray<ReadonlyArray<InkSample>>
  size: number
  color: string
  opacity: number
  /** Shape knobs for the live preview, so it matches the committed stroke. */
  options?: InkStrokeOptions
}

/** Ephemeral whole-stroke eraser cursor, expressed in world units. */
export type InkEraserDraft = {
  point: Vec2
  radius: number
  erasedIds: import('../types').NodeId[]
}
