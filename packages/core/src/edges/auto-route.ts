/**
 * Auto-routing for bezier edges — see ARCHITECTURE.md §6.6.
 *
 * Computes cubic-bezier control points by projecting outward from each
 * endpoint along the attachment-side normal. Rotation-aware: a node
 * rotated 30° gets a normal rotated 30° too, so edges leave perpendicular
 * to the rotated side.
 */
import type { Node, Vec2 } from '../types'
import { nodeLocalToWorld, worldToNodeLocal } from './project'

/** Max world-space distance a control point can sit from its endpoint. */
const CONTROL_MAX = 200
/** Fraction of endpoint-to-endpoint distance used for the control offset. */
const CONTROL_FRACTION = 0.4

export type Side = 'n' | 's' | 'e' | 'w'

/**
 * Tolerance used to decide whether a localOffset sits *on* a node's
 * rect boundary (i.e. was explicitly placed by the user / arrow tool)
 * vs *inside* the body (no specific anchor — typically an AI- or
 * programmatically-generated edge that used the node center).
 */
const BOUNDARY_EPS = 0.5

/**
 * True when `localOffset` is on the rect's outline (within {@link BOUNDARY_EPS}
 * world units). Used to distinguish user-placed anchors from inside-body
 * anchors — the asymmetric-route only fires when both ends are inside
 * the body, preserving user picks elsewhere.
 */
export const isLocalOffsetInsideBody = (localOffset: Vec2, node: Node): boolean => {
  const onLeft = Math.abs(localOffset.x) <= BOUNDARY_EPS
  const onRight = Math.abs(localOffset.x - node.w) <= BOUNDARY_EPS
  const onTop = Math.abs(localOffset.y) <= BOUNDARY_EPS
  const onBottom = Math.abs(localOffset.y - node.h) <= BOUNDARY_EPS
  // Anchor must also be inside the rect at all (not outside any side).
  const inside =
    localOffset.x > -BOUNDARY_EPS &&
    localOffset.x < node.w + BOUNDARY_EPS &&
    localOffset.y > -BOUNDARY_EPS &&
    localOffset.y < node.h + BOUNDARY_EPS
  return inside && !onLeft && !onRight && !onTop && !onBottom
}

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
 * Asymmetric "mindmap" routing for an edge between two attached nodes:
 *
 *   - source endpoint  = radial intersection of the source-center →
 *                        target line with the source rect boundary;
 *   - source control   = offset along the radial direction (toward
 *                        target) — the curve emerges aimed at target;
 *   - target endpoint  = foot of the perpendicular from the source
 *                        center onto target's side facing the source,
 *                        clamped to that side's extent;
 *   - target control   = offset along that side's outward normal — the
 *                        curve enters perpendicular to the chosen side.
 *
 * Result: one bend region near the target. The curve emerges from
 * source pointing at the target, then bends to enter target cleanly
 * perpendicular to its facing side. Looks natural for mindmaps and
 * concept maps where the user / generator doesn't pick specific anchors.
 *
 * Rotation-aware: rect intersections + side selection are done in each
 * node's pre-rotation local frame, then rotated back to world.
 */
export const computeAsymmetricRoute = (
  sourceNode: Node,
  targetNode: Node,
): { source: Vec2; target: Vec2; c1: Vec2; c2: Vec2 } => {
  const srcCenterWorld = {
    x: sourceNode.x + sourceNode.w / 2,
    y: sourceNode.y + sourceNode.h / 2,
  }

  // --- Pick target's side facing the source ---
  // Convert source center into target's local frame. The side the
  // source center most "points at" is the one whose normalized offset
  // has the larger magnitude.
  const srcInTgtLocal = worldToNodeLocal(srcCenterWorld, targetNode)
  const tgtHalfW = targetNode.w / 2
  const tgtHalfH = targetNode.h / 2
  const dxNorm = (srcInTgtLocal.x - tgtHalfW) / Math.max(1, tgtHalfW)
  const dyNorm = (srcInTgtLocal.y - tgtHalfH) / Math.max(1, tgtHalfH)
  const targetSide: Side =
    Math.abs(dxNorm) >= Math.abs(dyNorm) ? (dxNorm > 0 ? 'e' : 'w') : dyNorm > 0 ? 's' : 'n'

  // --- Target entry: foot of perpendicular from source center to
  //     target's chosen side (in target's local frame), clamped. ---
  let tgtEntryLocal: Vec2
  if (targetSide === 'n' || targetSide === 's') {
    const sideY = targetSide === 'n' ? 0 : targetNode.h
    const clampX = Math.max(0, Math.min(targetNode.w, srcInTgtLocal.x))
    tgtEntryLocal = { x: clampX, y: sideY }
  } else {
    const sideX = targetSide === 'w' ? 0 : targetNode.w
    const clampY = Math.max(0, Math.min(targetNode.h, srcInTgtLocal.y))
    tgtEntryLocal = { x: sideX, y: clampY }
  }
  const targetEntryWorld = nodeLocalToWorld(tgtEntryLocal, targetNode)

  // --- Source exit: ray from source center to target entry, intersect
  //     source rect (in source's local frame). ---
  const tgtEntryInSrcLocal = worldToNodeLocal(targetEntryWorld, sourceNode)
  const srcHalfW = sourceNode.w / 2
  const srcHalfH = sourceNode.h / 2
  const rayDx = tgtEntryInSrcLocal.x - srcHalfW
  const rayDy = tgtEntryInSrcLocal.y - srcHalfH
  // Parametric t at which the ray crosses each pair of sides — pick
  // the smallest positive one (the side the ray hits first).
  const tx = rayDx === 0 ? Number.POSITIVE_INFINITY : (rayDx > 0 ? srcHalfW : -srcHalfW) / rayDx
  const ty = rayDy === 0 ? Number.POSITIVE_INFINITY : (rayDy > 0 ? srcHalfH : -srcHalfH) / rayDy
  const t = Math.min(tx, ty)
  const srcExitLocal: Vec2 = {
    x: srcHalfW + rayDx * t,
    y: srcHalfH + rayDy * t,
  }
  const sourceExitWorld = nodeLocalToWorld(srcExitLocal, sourceNode)

  // --- Controls ---
  const dxWorld = targetEntryWorld.x - sourceExitWorld.x
  const dyWorld = targetEntryWorld.y - sourceExitWorld.y
  const distance = Math.hypot(dxWorld, dyWorld)
  const offset = Math.min(CONTROL_MAX, CONTROL_FRACTION * distance)

  // Source control: along the radial direction toward target. Falls
  // back to a copy of the endpoint when source and target collapse.
  const c1 =
    distance > 0
      ? {
          x: sourceExitWorld.x + (dxWorld / distance) * offset,
          y: sourceExitWorld.y + (dyWorld / distance) * offset,
        }
      : { ...sourceExitWorld }

  // Target control: outward along target's side normal in world.
  const tgtNormalWorld = rotateVecByAngle(sideNormalLocal(targetSide), targetNode.angle)
  const c2 = {
    x: targetEntryWorld.x + tgtNormalWorld.x * offset,
    y: targetEntryWorld.y + tgtNormalWorld.y * offset,
  }

  return { source: sourceExitWorld, target: targetEntryWorld, c1, c2 }
}
