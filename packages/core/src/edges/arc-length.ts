import type { Vec2 } from '../types'

/**
 * Returns `{ point, tangent }` at fractional arc-length `t ∈ [0..1]`
 * along a sample polyline.
 *
 * Walks the polyline summing segment lengths until the target is
 * reached; linearly interpolates inside the last segment. The tangent
 * is the unit direction of that segment.
 *
 * Used by edge-label placement (see ARCHITECTURE.md §6.11) — labels at
 * arc-length 0.5 sit at the geometric midpoint regardless of curve
 * shape, and the tangent lets a label rotate to follow the edge.
 *
 * @example
 * const { point, tangent } = getPointAndTangentAtArcLength(geom.samples, 0.5)
 * ctx.translate(point.x, point.y)
 */
export const getPointAndTangentAtArcLength = (
  samples: readonly Vec2[],
  t: number,
): { point: Vec2; tangent: Vec2 } => {
  if (samples.length < 2) {
    const p = samples[0] ?? { x: 0, y: 0 }
    return { point: p, tangent: { x: 1, y: 0 } }
  }
  const clamped = Math.max(0, Math.min(1, t))

  // First pass: total length.
  let total = 0
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]!
    const b = samples[i]!
    total += Math.hypot(b.x - a.x, b.y - a.y)
  }
  if (total === 0) {
    const p = samples[0]!
    return { point: p, tangent: { x: 1, y: 0 } }
  }
  const target = clamped * total

  // Second pass: walk until we hit the target.
  let traveled = 0
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]!
    const b = samples[i]!
    const segLen = Math.hypot(b.x - a.x, b.y - a.y)
    if (segLen === 0) continue
    if (traveled + segLen >= target) {
      const local = (target - traveled) / segLen
      return {
        point: { x: a.x + (b.x - a.x) * local, y: a.y + (b.y - a.y) * local },
        tangent: { x: (b.x - a.x) / segLen, y: (b.y - a.y) / segLen },
      }
    }
    traveled += segLen
  }
  // Fell off the end (t === 1 case).
  const last = samples[samples.length - 1]!
  const prev = samples[samples.length - 2]!
  const segLen = Math.hypot(last.x - prev.x, last.y - prev.y) || 1
  return {
    point: last,
    tangent: { x: (last.x - prev.x) / segLen, y: (last.y - prev.y) / segLen },
  }
}
