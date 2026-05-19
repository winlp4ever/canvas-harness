import type { Vec2, WorldRect } from '../types'

/**
 * AABB utilities. Rectangles are { x, y, w, h } in world space.
 */

export const rectContainsPoint = (r: WorldRect, p: Vec2): boolean =>
  p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h

export const rectsIntersect = (a: WorldRect, b: WorldRect): boolean =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

/**
 * Inflate rect by a uniform world-space amount on all sides.
 */
export const inflateRect = (r: WorldRect, amount: number): WorldRect => ({
  x: r.x - amount,
  y: r.y - amount,
  w: r.w + amount * 2,
  h: r.h + amount * 2,
})

/**
 * Smallest AABB containing two points.
 */
export const rectFromPoints = (a: Vec2, b: Vec2): WorldRect => {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) }
}

/**
 * Smallest AABB containing all given rects. Returns null for empty input.
 */
export const unionRects = (rects: WorldRect[]): WorldRect | null => {
  if (rects.length === 0) return null
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const r of rects) {
    if (r.x < minX) minX = r.x
    if (r.y < minY) minY = r.y
    if (r.x + r.w > maxX) maxX = r.x + r.w
    if (r.y + r.h > maxY) maxY = r.y + r.h
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}
