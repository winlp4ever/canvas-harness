import type { RoughDrawableLike } from './loader'

/**
 * Bounded LRU cache of rough.js drawables keyed by shape signature.
 *
 * Building a drawable (`rc.generator.path(...)`) walks the SVG path
 * and emits jittered sub-paths — that's the expensive bit. Once built,
 * `rc.draw(drawable)` just strokes the cached path; cheap.
 *
 * Cache key composes all inputs that affect the generated path:
 *   - primitive (rect / ellipse / diamond / capsule / edge)
 *   - size + corner radius
 *   - stroke color / style / width
 *   - roughness + seed (jitter inputs)
 *   - LOD bucket (curveStepCount, maxRandomnessOffset)
 *
 * On miss we build + insert; on overflow we evict the oldest entry.
 */

const cache = new Map<string, RoughDrawableLike>()
const MAX_ENTRIES = 1000

/** Read-or-build for a drawable. `build` runs only on miss. */
export const getOrBuildDrawable = (
  key: string,
  build: () => RoughDrawableLike,
): RoughDrawableLike => {
  const hit = cache.get(key)
  if (hit !== undefined) {
    // Touch — move to end (LRU).
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }
  const drawable = build()
  if (cache.size >= MAX_ENTRIES) {
    // Evict oldest.
    const first = cache.keys().next().value
    if (first !== undefined) cache.delete(first)
  }
  cache.set(key, drawable)
  return drawable
}

/** Test / debug aid. */
export const clearRoughCache = (): void => {
  cache.clear()
}

/** Test / debug aid. */
export const getRoughCacheSize = (): number => cache.size

/**
 * FNV-1a hash of a string id → 32-bit unsigned int. Used to derive
 * a stable per-node jitter seed so the wobble doesn't dance between
 * frames or sessions.
 */
export const seedFromId = (id: string): number => {
  let hash = 2166136261
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}
