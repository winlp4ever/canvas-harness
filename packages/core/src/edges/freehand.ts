/**
 * Brushy edge bodies via perfect-freehand. Used for `solid` rough edges
 * — the dim0 "Spider-Verse" look: tapered ends, variable thickness,
 * filled polygon rather than a stroked line.
 *
 * Pipeline:
 *   sample polyline → pressure-bell profile → getStroke() → Path2D
 *
 * Caching: the resulting Path2D is keyed on a coarse signature of the
 * sample points + strokeWidth + seed. Subsequent paints (stable scenes)
 * hit the cache and pay only one `ctx.fill()`.
 *
 * `dashed` / `dotted` strokes don't route here — they fall back to
 * `drawRoughEdge` (rough.js linearPath) since a filled polygon can't
 * dash naturally.
 */
import { getStroke } from 'perfect-freehand'
import type { Vec2 } from '../types'

/**
 * LRU-ish cap on cached Path2Ds. Bigger payload per entry than rough
 * drawables (polygon vertices), so set lower than ROUGH_PATH_CACHE_MAX.
 */
const FREEHAND_CACHE_MAX = 500
const cache = new Map<string, Path2D>()

const remember = (key: string, path: Path2D): void => {
  cache.set(key, path)
  if (cache.size > FREEHAND_CACHE_MAX) {
    // Map iteration order is insertion order; evict oldest.
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
}

/**
 * Coarse signature: stride-sampled endpoints + length. Quantized to 1px
 * so sub-pixel jitter from camera math doesn't bust the cache every
 * frame. Length is the hash anchor.
 */
const signaturePoints = (samples: Vec2[]): string => {
  if (samples.length === 0) return 'e'
  const n = samples.length
  const step = Math.max(1, Math.floor(n / 6))
  const parts: string[] = [String(n)]
  for (let i = 0; i < n; i += step) {
    const p = samples[i]!
    parts.push(`${Math.round(p.x)},${Math.round(p.y)}`)
  }
  const last = samples[n - 1]!
  parts.push(`${Math.round(last.x)},${Math.round(last.y)}`)
  return parts.join('|')
}

type StrokeOpts = {
  size: number
  thinning: number
  smoothing: number
  streamline: number
  simulatePressure: false
  last: true
  start: { taper: number; cap: true }
  end: { taper: number; cap: true }
}

/**
 * perfect-freehand expects `[x, y, pressure]`. Bell profile produces a
 * brush stroke that's thin at both ends and fatter in the middle —
 * matches dim0's signature look.
 */
const buildPressurePoints = (samples: Vec2[]): [number, number, number][] => {
  const n = samples.length
  if (n === 0) return []
  const out: [number, number, number][] = new Array(n)
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1)
    const bell = Math.sin(Math.PI * t)
    const pressure = 0.35 + 0.55 * bell
    const p = samples[i]!
    out[i] = [p.x, p.y, pressure]
  }
  return out
}

/**
 * Builds the outline polygon and emits a closed Path2D. Quadratic
 * midpoint smoothing on the polygon edges (the tldraw trick) gives
 * soft corners instead of faceted ones.
 */
const outlineToPath2D = (ring: number[][]): Path2D => {
  const path = new Path2D()
  const n = ring.length
  if (n === 0) return path
  if (n < 3) {
    path.moveTo(ring[0]![0]!, ring[0]![1]!)
    path.closePath()
    return path
  }
  path.moveTo(ring[0]![0]!, ring[0]![1]!)
  for (let i = 0; i < n; i++) {
    const a = ring[i]!
    const b = ring[(i + 1) % n]!
    const mx = (a[0]! + b[0]!) / 2
    const my = (a[1]! + b[1]!) / 2
    path.quadraticCurveTo(a[0]!, a[1]!, mx, my)
  }
  path.closePath()
  return path
}

/**
 * Returns a Path2D representing the brushy outline of `samples`. Cached
 * by sample-signature + strokeWidth + seed. Caller fills it with
 * `ctx.fillStyle = stroke; ctx.fill(path)`.
 *
 * `seed` exists to keep the cache key stable per-edge across frames
 * even though perfect-freehand itself is deterministic — different
 * edges produce different polygons because their inputs differ, not
 * because of any random source.
 */
export const getOrBuildFreehandPath = (
  samples: Vec2[],
  strokeWidth: number,
  seed: number,
): Path2D | null => {
  if (samples.length < 2) return null
  const cacheKey = `${seed}|${strokeWidth.toFixed(2)}|${signaturePoints(samples)}`
  const hit = cache.get(cacheKey)
  if (hit) {
    // LRU touch: re-insert at tail.
    cache.delete(cacheKey)
    cache.set(cacheKey, hit)
    return hit
  }

  const pts = buildPressurePoints(samples)
  if (pts.length < 2) return null

  const size = Math.max(1.2, strokeWidth) * 1.3
  const taper = Math.min(24, size * 3)
  const strokeOpts: StrokeOpts = {
    size,
    thinning: 0.55,
    smoothing: 0.6,
    streamline: 0.55,
    simulatePressure: false,
    last: true,
    start: { taper, cap: true },
    end: { taper, cap: true },
  }
  const ring = getStroke(pts, strokeOpts)
  if (!ring || ring.length === 0) return null

  const path = outlineToPath2D(ring)
  remember(cacheKey, path)
  return path
}

/** Reset state — tests only. */
export const __resetFreehandCache = (): void => {
  cache.clear()
}

/** Diagnostic only. */
export const getFreehandCacheSize = (): number => cache.size
