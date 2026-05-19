/**
 * Resize-handle hit testing — see ARCHITECTURE.md §11.6.
 *
 * Handles are drawn at constant screen size (e.g. 8px), so their world-space
 * bounds change with camera zoom. They sit at the 8 cardinal points of the
 * node's bounding rect; for rotated nodes the handle positions rotate with
 * the node so a "north-east" handle is actually at the rotated NE corner.
 */
import type { Node, Vec2 } from '../types'

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

export const RESIZE_HANDLES: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

/** Screen-pixel size of a resize-handle hit target. Visual size matches. */
export const RESIZE_HANDLE_SIZE_PX = 10

/**
 * World-space centers of all 8 resize handles for the given node.
 * Rotation-aware: handles rotate with the node so they sit on the corners
 * and edge midpoints of the rotated rect (not the rotated AABB).
 */
export const handleWorldPositions = (node: Node): Record<ResizeHandle, Vec2> => {
  const localCenters: Record<ResizeHandle, Vec2> = {
    nw: { x: 0, y: 0 },
    n: { x: node.w / 2, y: 0 },
    ne: { x: node.w, y: 0 },
    e: { x: node.w, y: node.h / 2 },
    se: { x: node.w, y: node.h },
    s: { x: node.w / 2, y: node.h },
    sw: { x: 0, y: node.h },
    w: { x: 0, y: node.h / 2 },
  }
  if (node.angle === 0) {
    const offsetX = node.x
    const offsetY = node.y
    return {
      nw: { x: offsetX + localCenters.nw.x, y: offsetY + localCenters.nw.y },
      n: { x: offsetX + localCenters.n.x, y: offsetY + localCenters.n.y },
      ne: { x: offsetX + localCenters.ne.x, y: offsetY + localCenters.ne.y },
      e: { x: offsetX + localCenters.e.x, y: offsetY + localCenters.e.y },
      se: { x: offsetX + localCenters.se.x, y: offsetY + localCenters.se.y },
      s: { x: offsetX + localCenters.s.x, y: offsetY + localCenters.s.y },
      sw: { x: offsetX + localCenters.sw.x, y: offsetY + localCenters.sw.y },
      w: { x: offsetX + localCenters.w.x, y: offsetY + localCenters.w.y },
    }
  }

  const cx = node.x + node.w / 2
  const cy = node.y + node.h / 2
  const cos = Math.cos(node.angle)
  const sin = Math.sin(node.angle)
  const rotate = (p: Vec2): Vec2 => {
    // local coords (top-left origin) → center-origin → rotate → world
    const dx = p.x - node.w / 2
    const dy = p.y - node.h / 2
    return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos }
  }
  return {
    nw: rotate(localCenters.nw),
    n: rotate(localCenters.n),
    ne: rotate(localCenters.ne),
    e: rotate(localCenters.e),
    se: rotate(localCenters.se),
    s: rotate(localCenters.s),
    sw: rotate(localCenters.sw),
    w: rotate(localCenters.w),
  }
}

/**
 * Returns the handle hit by a world point, or null. `cameraZ` lets us map
 * the constant screen-size handle box to its current world-space footprint.
 */
export const hitTestHandles = (
  node: Node,
  worldPoint: Vec2,
  cameraZ: number,
): ResizeHandle | null => {
  const halfWorld = RESIZE_HANDLE_SIZE_PX / 2 / cameraZ
  const positions = handleWorldPositions(node)
  for (const h of RESIZE_HANDLES) {
    const center = positions[h]
    if (
      Math.abs(worldPoint.x - center.x) <= halfWorld &&
      Math.abs(worldPoint.y - center.y) <= halfWorld
    ) {
      return h
    }
  }
  return null
}
