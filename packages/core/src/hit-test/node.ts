/**
 * Node hit testing — see ARCHITECTURE.md §6.9 (parallels edge hit testing
 * structure for phase 4).
 *
 * For axis-aligned nodes: a fast AABB check.
 * For rotated nodes: transform the world point into node-local pre-rotation
 * coords (collapsing the rotation problem to AABB).
 */
import type { Node, Vec2, WorldRect } from '../types'

/**
 * Returns true if the world-space point is inside the (possibly rotated) node.
 */
export const pointInNode = (point: Vec2, node: Node): boolean => {
  if (node.hidden) return false
  if (node.w <= 0 || node.h <= 0) return false

  if (node.angle === 0) {
    return (
      point.x >= node.x &&
      point.x <= node.x + node.w &&
      point.y >= node.y &&
      point.y <= node.y + node.h
    )
  }

  const cx = node.x + node.w / 2
  const cy = node.y + node.h / 2
  const cos = Math.cos(-node.angle)
  const sin = Math.sin(-node.angle)
  const dx = point.x - cx
  const dy = point.y - cy
  // localCoord = rotate(point - center, -angle) + (w/2, h/2)
  const localX = dx * cos - dy * sin + node.w / 2
  const localY = dx * sin + dy * cos + node.h / 2
  return localX >= 0 && localX <= node.w && localY >= 0 && localY <= node.h
}

/**
 * Returns true if the node's rotated rect intersects the given AABB.
 * For axis-aligned nodes this collapses to two AABB ranges; for rotated
 * nodes we test all 4 corners + 4 axis projections (SAT).
 */
export const nodeIntersectsRect = (node: Node, rect: WorldRect): boolean => {
  if (node.hidden) return false
  if (node.w <= 0 || node.h <= 0) return false

  if (node.angle === 0) {
    return (
      node.x < rect.x + rect.w &&
      node.x + node.w > rect.x &&
      node.y < rect.y + rect.h &&
      node.y + node.h > rect.y
    )
  }

  // SAT against the rotated rect — cheap enough that this is fine for marquee.
  const cx = node.x + node.w / 2
  const cy = node.y + node.h / 2
  const cos = Math.cos(node.angle)
  const sin = Math.sin(node.angle)
  const localCorners: Vec2[] = [
    { x: -node.w / 2, y: -node.h / 2 },
    { x: node.w / 2, y: -node.h / 2 },
    { x: node.w / 2, y: node.h / 2 },
    { x: -node.w / 2, y: node.h / 2 },
  ]
  const worldCorners: Vec2[] = localCorners.map(p => ({
    x: cx + p.x * cos - p.y * sin,
    y: cy + p.x * sin + p.y * cos,
  }))
  const rectCorners: Vec2[] = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.w, y: rect.y },
    { x: rect.x + rect.w, y: rect.y + rect.h },
    { x: rect.x, y: rect.y + rect.h },
  ]
  const axes: Vec2[] = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: cos, y: sin },
    { x: -sin, y: cos },
  ]
  for (const a of axes) {
    let minA = Number.POSITIVE_INFINITY
    let maxA = Number.NEGATIVE_INFINITY
    for (const p of worldCorners) {
      const v = p.x * a.x + p.y * a.y
      if (v < minA) minA = v
      if (v > maxA) maxA = v
    }
    let minB = Number.POSITIVE_INFINITY
    let maxB = Number.NEGATIVE_INFINITY
    for (const p of rectCorners) {
      const v = p.x * a.x + p.y * a.y
      if (v < minB) minB = v
      if (v > maxB) maxB = v
    }
    if (maxA < minB || maxB < minA) return false
  }
  return true
}
