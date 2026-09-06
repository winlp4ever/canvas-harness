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
 * Coalesce a list of rects into the fewest disjoint rects that cover the same
 * area, merging any that intersect (transitively) into their bounding union.
 * Disjoint rects are kept separate — unlike {@link unionRects}, which always
 * collapses to one bounding box.
 *
 * Used by the eraser preview patch so scattered erasures repaint one small
 * rect each instead of the whole span between them; adjacent erasures (a drag
 * along a line) still collapse into one. Worst case is superlinear (the
 * re-scan on each merge is up to O(n³)) — fine for the handful of rects a
 * patch ever sees; not meant for large inputs.
 */
export const mergeOverlappingRects = (rects: WorldRect[]): WorldRect[] => {
  const result: WorldRect[] = []
  for (const rect of rects) {
    let current = rect
    // Absorb every result rect `current` now overlaps; a merge grows `current`
    // and may create new overlaps, so re-scan until a pass merges nothing.
    let mergedAny = true
    while (mergedAny) {
      mergedAny = false
      for (let i = result.length - 1; i >= 0; i--) {
        const other = result[i]!
        if (rectsIntersect(current, other)) {
          current = unionRects([current, other])!
          result.splice(i, 1)
          mergedAny = true
        }
      }
    }
    result.push(current)
  }
  return result
}

/**
 * Merge input rects (see {@link mergeOverlappingRects}), then decide between
 * the merged per-region rects and their single bounding box: if the merged
 * rects already fill at least `fillRatio` of their bounding box they're dense
 * enough that one union pass is cheaper than many small ones, so return the
 * box; otherwise keep them separate (scattered — localizing pays off).
 *
 * Encapsulates the eraser-patch "how many rects to repaint" heuristic so it's
 * unit-testable independent of the renderer.
 */
export const coalesceEraseRects = (rects: WorldRect[], fillRatio: number): WorldRect[] => {
  const merged = mergeOverlappingRects(rects)
  if (merged.length <= 1) return merged
  const box = unionRects(merged)!
  const boxArea = box.w * box.h
  const splitArea = merged.reduce((sum, r) => sum + r.w * r.h, 0)
  return boxArea > 0 && splitArea < fillRatio * boxArea ? merged : [box]
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
