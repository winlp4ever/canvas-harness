/**
 * Curve sampling — see ARCHITECTURE.md §6.6 / §6.9.
 *
 * The polyline samples are the load-bearing data for everything edge-related:
 * paint, auto-clip, hit testing all walk the same array. Caching is in
 * cache.ts; this module is pure geometry.
 */
import type { PathStyle, Vec2 } from '../types'

/** Default number of intermediate samples for a bezier (cubic). 32 is
 * indistinguishable from 64 at typical zoom; halve the array size. */
export const BEZIER_SEGMENTS = 32

/**
 * Evaluates a cubic bezier at parameter t ∈ [0, 1].
 */
export const cubicBezier = (p0: Vec2, c1: Vec2, c2: Vec2, p1: Vec2, t: number): Vec2 => {
  const it = 1 - t
  const it2 = it * it
  const it3 = it2 * it
  const t2 = t * t
  const t3 = t2 * t
  return {
    x: it3 * p0.x + 3 * it2 * t * c1.x + 3 * it * t2 * c2.x + t3 * p1.x,
    y: it3 * p0.y + 3 * it2 * t * c1.y + 3 * it * t2 * c2.y + t3 * p1.y,
  }
}

/**
 * Tangent (unit vector) to a cubic bezier at parameter t.
 * Used for arrowhead orientation.
 */
export const cubicBezierTangent = (p0: Vec2, c1: Vec2, c2: Vec2, p1: Vec2, t: number): Vec2 => {
  const it = 1 - t
  const it2 = it * it
  const t2 = t * t
  // derivative of cubic bezier
  const dx = 3 * (it2 * (c1.x - p0.x) + 2 * it * t * (c2.x - c1.x) + t2 * (p1.x - c2.x))
  const dy = 3 * (it2 * (c1.y - p0.y) + 2 * it * t * (c2.y - c1.y) + t2 * (p1.y - c2.y))
  const len = Math.hypot(dx, dy)
  if (len === 0) return { x: 1, y: 0 }
  return { x: dx / len, y: dy / len }
}

/**
 * Samples a cubic bezier into BEZIER_SEGMENTS+1 evenly-spaced points
 * (in parameter space — not arc-length).
 */
export const sampleBezier = (
  p0: Vec2,
  c1: Vec2,
  c2: Vec2,
  p1: Vec2,
  segments: number = BEZIER_SEGMENTS,
): Vec2[] => {
  const points: Vec2[] = new Array(segments + 1)
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    points[i] = cubicBezier(p0, c1, c2, p1, t)
  }
  return points
}

/**
 * Returns the polyline sample list for an edge given its path style,
 * world-projected endpoints, and (for bezier) control points or (for
 * polyline) midpoints. Straight = 2-point polyline.
 */
export const samplesFor = (
  pathStyle: PathStyle,
  source: Vec2,
  target: Vec2,
  controls: Vec2[] | undefined,
): Vec2[] => {
  switch (pathStyle) {
    case 'straight':
      return [source, target]
    case 'polyline':
      return [source, ...(controls ?? []), target]
    case 'bezier': {
      const c1 = controls?.[0] ?? source
      const c2 = controls?.[1] ?? target
      return sampleBezier(source, c1, c2, target)
    }
  }
}

/**
 * Tangent at parameter t along the sampled polyline (arc-length-ish).
 * Used for arrowhead orientation when we don't have analytic curve info.
 * For straight/polyline this returns the segment direction; for bezier
 * we approximate by the direction between adjacent samples around the
 * target t.
 */
export const tangentAtArcLength = (samples: Vec2[], t: number): Vec2 => {
  if (samples.length < 2) return { x: 1, y: 0 }
  // Walk arc length to find the segment containing the target distance.
  const totalLengths: number[] = [0]
  let total = 0
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]!
    const b = samples[i]!
    total += Math.hypot(b.x - a.x, b.y - a.y)
    totalLengths.push(total)
  }
  const target = total * Math.max(0, Math.min(1, t))
  let segIndex = 1
  for (; segIndex < totalLengths.length; segIndex++) {
    if (totalLengths[segIndex]! >= target) break
  }
  segIndex = Math.min(segIndex, samples.length - 1)
  const a = samples[segIndex - 1]!
  const b = samples[segIndex]!
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (len === 0) return { x: 1, y: 0 }
  return { x: dx / len, y: dy / len }
}
