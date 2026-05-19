import type { Node, Vec2 } from '../types'
/**
 * Self-loop case — see ARCHITECTURE.md §6.8.
 *
 * When source.nodeId === target.nodeId, the regular bezier between two
 * coincident points collapses. Generate a small loop on the top-right
 * corner instead: exit the top edge, arc outward, re-enter via the
 * right edge.
 */
import { autoRouteControls, rotateVecByAngle, sideNormalLocal } from './auto-route'
import { nodeLocalToWorld } from './project'
import { sampleBezier } from './samples'

/** World-space loop radius factor based on max(w, h). */
const LOOP_SIZE_FRACTION = 0.6

/**
 * Returns world-space (source, target, control1, control2) for a self-loop
 * on the given node. The loop exits from the top edge and re-enters via
 * the right edge.
 */
export const selfLoopGeometry = (
  node: Node,
): { source: Vec2; target: Vec2; controls: [Vec2, Vec2] } => {
  const topAnchor = nodeLocalToWorld({ x: node.w / 2, y: 0 }, node)
  const rightAnchor = nodeLocalToWorld({ x: node.w, y: node.h / 2 }, node)
  const sourceNormal = rotateVecByAngle(sideNormalLocal('n'), node.angle)
  const targetNormal = rotateVecByAngle(sideNormalLocal('e'), node.angle)
  const offset = LOOP_SIZE_FRACTION * Math.max(node.w, node.h)
  const { c1, c2 } = autoRouteControlsAtOffset(
    topAnchor,
    rightAnchor,
    sourceNormal,
    targetNormal,
    offset,
  )
  return { source: topAnchor, target: rightAnchor, controls: [c1, c2] }
}

/**
 * Samples a self-loop given its node. Convenience wrapper that produces
 * the polyline samples auto-clip/hit-test/paint all consume.
 */
export const sampleSelfLoop = (node: Node): Vec2[] => {
  const { source, target, controls } = selfLoopGeometry(node)
  return sampleBezier(source, controls[0], controls[1], target)
}

/**
 * Like autoRouteControls but with an explicit offset; the loop wants a
 * larger control distance than the natural endpoint-distance formula
 * (which would be near-zero for coincident endpoints).
 */
const autoRouteControlsAtOffset = (
  source: Vec2,
  target: Vec2,
  sourceNormal: Vec2,
  targetNormal: Vec2,
  offset: number,
): { c1: Vec2; c2: Vec2 } => {
  void autoRouteControls // (keep type linker happy if the helper isn't used)
  return {
    c1: { x: source.x + sourceNormal.x * offset, y: source.y + sourceNormal.y * offset },
    c2: { x: target.x + targetNormal.x * offset, y: target.y + targetNormal.y * offset },
  }
}
