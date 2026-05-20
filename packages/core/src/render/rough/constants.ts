/**
 * Rough-rendering thresholds — see IMPROVEMENTS.md and dim0/rough.
 *
 * Below `ROUGH_MIN_ZOOM` or above `ROUGH_MAX_NODES` we fall back to
 * plain strokes; the wobble is invisible at low zoom and the per-shape
 * cost stacks up past the cap. These are the two cheap gates that
 * protect the frame budget without the consumer having to think about
 * it.
 */
export const ROUGH_MIN_ZOOM = 0.4
export const ROUGH_MAX_NODES = 800

/**
 * Path-cache hard cap. Keyed entries: per-shape `(type, w, h, stroke,
 * style, roughness, seed)` tuples. LRU eviction.
 */
export const ROUGH_PATH_CACHE_MAX = 1000

/**
 * rough.js generator defaults. The combination of `disableMultiStroke`
 * + `preserveVertices` + `bowing: 2` is the one that yields the
 * excalidraw-feeling stroke without the 3-5× cost of multi-stroke.
 */
export const ROUGH_DEFAULTS = {
  bowing: 2,
  disableMultiStroke: true,
  preserveVertices: true,
} as const
