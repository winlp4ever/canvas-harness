/**
 * Edge AABB from samples — see ARCHITECTURE.md §6.12.
 *
 * Phase-1 had a crude AABB based on raw endpoint positions. Phase 4
 * computes the actual sample bounds + padding for arrowheads and labels,
 * which is what the spatial index needs for correct hit-testing.
 */
import type { Vec2, WorldRect } from '../types'

/** Extra padding around sample bounds to cover arrowhead tips. */
const SAMPLE_PADDING = 12

export const edgeAABBFromSamples = (samples: Vec2[]): WorldRect => {
  if (samples.length === 0) return { x: 0, y: 0, w: 0, h: 0 }
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const p of samples) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  return {
    x: minX - SAMPLE_PADDING,
    y: minY - SAMPLE_PADDING,
    w: maxX - minX + SAMPLE_PADDING * 2,
    h: maxY - minY + SAMPLE_PADDING * 2,
  }
}
