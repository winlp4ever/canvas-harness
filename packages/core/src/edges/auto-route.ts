/**
 * Auto-routing for bezier edges — see ARCHITECTURE.md §6.6.
 *
 * Unified rule: for each attached endpoint, cast a ray from the node
 * center toward the other endpoint and pick the side the ray exits
 * through. The bezier's control point at that end leaves along that
 * side's outward normal. Endpoints themselves stay at the user-supplied
 * localOffset; the renderer's clipSamples trims any inside-rect portion.
 *
 * Rotation-aware: side selection happens in each node's pre-rotation
 * local frame, then the normal is rotated back into world.
 */
import type { Node, Vec2 } from '../types'
import { worldToNodeLocal } from './project'

/** Max world-space distance a control point can sit from its endpoint. */
const CONTROL_MAX = 200
/** Fraction of endpoint-to-endpoint distance used for the control offset. */
const CONTROL_FRACTION = 0.4

export type Side = 'n' | 's' | 'e' | 'w'

/**
 * Picks the side of a node's local rect closest to the given local offset.
 * Used to determine which way a bezier should leave the node.
 */
export const sideOf = (node: Node, localX: number, localY: number): Side => {
  const distLeft = localX
  const distRight = node.w - localX
  const distTop = localY
  const distBottom = node.h - localY
  const minDist = Math.min(distLeft, distRight, distTop, distBottom)
  if (minDist === distLeft) return 'w'
  if (minDist === distRight) return 'e'
  if (minDist === distTop) return 'n'
  return 's'
}

/**
 * Outward-pointing unit vector for a given side, in the node's pre-rotation
 * local frame.
 */
export const sideNormalLocal = (side: Side): Vec2 => {
  switch (side) {
    case 'n':
      return { x: 0, y: -1 }
    case 's':
      return { x: 0, y: 1 }
    case 'e':
      return { x: 1, y: 0 }
    case 'w':
      return { x: -1, y: 0 }
  }
}

/**
 * Rotates a local-frame vector into world coordinates by the node's angle.
 */
export const rotateVecByAngle = (v: Vec2, angle: number): Vec2 => {
  if (angle === 0) return v
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos }
}

/**
 * Computes auto-routed control points for a cubic bezier between
 * sourceWorld and targetWorld. Each control point is offset along the
 * outward normal of its endpoint's attached node (if any).
 *
 * For free-floating endpoints (no node), the control aligns with the
 * source→target direction so the curve degenerates gracefully toward a
 * straight line.
 */
export const autoRouteControls = (
  sourceWorld: Vec2,
  targetWorld: Vec2,
  sourceNormalWorld: Vec2 | null,
  targetNormalWorld: Vec2 | null,
): { c1: Vec2; c2: Vec2 } => {
  const dx = targetWorld.x - sourceWorld.x
  const dy = targetWorld.y - sourceWorld.y
  const dist = Math.hypot(dx, dy)
  const offset = Math.min(CONTROL_MAX, CONTROL_FRACTION * dist)

  // Fallback direction when no node attached.
  const fallbackSource = dist > 0 ? { x: dx / dist, y: dy / dist } : { x: 1, y: 0 }
  const fallbackTarget = dist > 0 ? { x: -dx / dist, y: -dy / dist } : { x: -1, y: 0 }

  const ns = sourceNormalWorld ?? fallbackSource
  const nt = targetNormalWorld ?? fallbackTarget

  return {
    c1: { x: sourceWorld.x + ns.x * offset, y: sourceWorld.y + ns.y * offset },
    c2: { x: targetWorld.x + nt.x * offset, y: targetWorld.y + nt.y * offset },
  }
}

/**
 * Picks which side of {@link node}'s rect the line from the node's
 * center to {@link towardWorld} exits through. The bezier auto-route
 * uses this to choose each endpoint's outgoing direction: the control
 * leaves along the chosen side's outward normal.
 *
 * Rotation-aware: the ray is computed in the node's pre-rotation local
 * frame so a rotated rect still picks its locally-correct side.
 */
export const sideToward = (node: Node, towardWorld: Vec2): Side => {
  const local = worldToNodeLocal(towardWorld, node)
  const halfW = node.w / 2
  const halfH = node.h / 2
  const dx = local.x - halfW
  const dy = local.y - halfH
  if (dx === 0 && dy === 0) return 'e'
  const tx = dx === 0 ? Number.POSITIVE_INFINITY : (dx > 0 ? halfW : -halfW) / dx
  const ty = dy === 0 ? Number.POSITIVE_INFINITY : (dy > 0 ? halfH : -halfH) / dy
  if (tx <= ty) return dx > 0 ? 'e' : 'w'
  return dy > 0 ? 's' : 'n'
}
