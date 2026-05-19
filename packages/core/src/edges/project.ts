/**
 * Edge endpoint projection — see ARCHITECTURE.md §6.1.
 *
 * An EdgeEnd is either { nodeId, localOffset } (attached) or
 * { worldPoint } (free-floating). This module computes the current
 * world-space position of an endpoint by reading the latest node
 * state — no caching, no sync code; the projection is the truth.
 */
import { isAttached } from '../types'
import type { EdgeEnd, Node, NodeId, Vec2 } from '../types'

/**
 * Resolves an EdgeEnd to its current world coordinates.
 * Returns null when the endpoint is attached to a node that no longer exists.
 */
export const projectEndToWorld = (
  end: EdgeEnd,
  getNode: (id: NodeId) => Node | undefined,
): Vec2 | null => {
  if (!isAttached(end)) return end.worldPoint
  const node = getNode(end.nodeId)
  if (!node) return null
  return nodeLocalToWorld(end.localOffset, node)
}

/**
 * Transforms a point in a node's pre-rotation local frame (top-left origin)
 * into world coordinates.
 */
export const nodeLocalToWorld = (local: Vec2, node: Node): Vec2 => {
  if (node.angle === 0) {
    return { x: node.x + local.x, y: node.y + local.y }
  }
  const cx = node.x + node.w / 2
  const cy = node.y + node.h / 2
  const cos = Math.cos(node.angle)
  const sin = Math.sin(node.angle)
  const dx = local.x - node.w / 2
  const dy = local.y - node.h / 2
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos }
}

/**
 * Transforms a world point into the node's pre-rotation local frame.
 * Used by auto-clip and by edge-creation snap-to-boundary logic.
 */
export const worldToNodeLocal = (world: Vec2, node: Node): Vec2 => {
  if (node.angle === 0) {
    return { x: world.x - node.x, y: world.y - node.y }
  }
  const cx = node.x + node.w / 2
  const cy = node.y + node.h / 2
  const cos = Math.cos(-node.angle)
  const sin = Math.sin(-node.angle)
  const dx = world.x - cx
  const dy = world.y - cy
  return { x: dx * cos - dy * sin + node.w / 2, y: dx * sin + dy * cos + node.h / 2 }
}

/**
 * Given a world point and a node, returns the local-frame coords of the
 * nearest point on the node's rect boundary. If the world point is inside
 * the rect, projects to the nearest edge; if outside, clamps to the
 * containing edge / corner.
 *
 * Used by the edge-creation gesture to snap endpoints to the node boundary.
 */
export const projectToNodeBoundary = (world: Vec2, node: Node): Vec2 => {
  const local = worldToNodeLocal(world, node)
  const clampedX = Math.max(0, Math.min(node.w, local.x))
  const clampedY = Math.max(0, Math.min(node.h, local.y))

  const isOutside = local.x < 0 || local.x > node.w || local.y < 0 || local.y > node.h
  if (isOutside) return { x: clampedX, y: clampedY }

  // Inside: project to the nearest edge.
  const distLeft = local.x
  const distRight = node.w - local.x
  const distTop = local.y
  const distBottom = node.h - local.y
  const minDist = Math.min(distLeft, distRight, distTop, distBottom)
  if (minDist === distLeft) return { x: 0, y: clampedY }
  if (minDist === distRight) return { x: node.w, y: clampedY }
  if (minDist === distTop) return { x: clampedX, y: 0 }
  return { x: clampedX, y: node.h }
}
