/**
 * Compute world-space AABB for a (possibly rotated) node.
 *
 * For axis-aligned nodes (angle === 0): the AABB is the node rect itself.
 * For rotated nodes: enclose the 4 rotated corners.
 */
import type { Node, Vec2, WorldRect } from '../types'

export const nodeAABB = (node: Node): WorldRect => {
  if (node.angle === 0) {
    return { x: node.x, y: node.y, w: node.w, h: node.h }
  }

  const cx = node.x + node.w / 2
  const cy = node.y + node.h / 2
  const cos = Math.cos(node.angle)
  const sin = Math.sin(node.angle)

  const corners: Vec2[] = [
    rotatePoint(node.x, node.y, cx, cy, cos, sin),
    rotatePoint(node.x + node.w, node.y, cx, cy, cos, sin),
    rotatePoint(node.x + node.w, node.y + node.h, cx, cy, cos, sin),
    rotatePoint(node.x, node.y + node.h, cx, cy, cos, sin),
  ]

  let minX = corners[0]!.x
  let minY = corners[0]!.y
  let maxX = minX
  let maxY = minY
  for (let i = 1; i < corners.length; i++) {
    const c = corners[i]!
    if (c.x < minX) minX = c.x
    if (c.x > maxX) maxX = c.x
    if (c.y < minY) minY = c.y
    if (c.y > maxY) maxY = c.y
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

const rotatePoint = (
  px: number,
  py: number,
  cx: number,
  cy: number,
  cos: number,
  sin: number,
): Vec2 => {
  const dx = px - cx
  const dy = py - cy
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos }
}
