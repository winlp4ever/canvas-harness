import type { Vec2 } from '../types'

/** One pressure-aware world-space sample collected during an active stroke. */
export type InkSample = Vec2 & {
  pressure: number
}

/** Portable, node-local sample stored in an ink node. */
export type InkPoint = readonly [x: number, y: number, pressure: number]

/** Versioned geometry owned by the built-in `ink` node. */
export type InkStrokeData = {
  type: 'ink'
  version: 1
  size: number
  points: InkPoint[]
  intrinsicWidth: number
  intrinsicHeight: number
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

/** Ephemeral preview kept outside the document/op log while drawing. */
export type InkDraft = {
  segments: InkSample[][]
  size: number
  color: string
  opacity: number
}

/** Ephemeral whole-stroke eraser cursor, expressed in world units. */
export type InkEraserDraft = {
  point: Vec2
  radius: number
  erasedIds: import('../types').NodeId[]
}
