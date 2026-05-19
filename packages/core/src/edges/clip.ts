import type { Node, Vec2 } from '../types'
/**
 * Auto-clip: hide the part of an edge that's inside its attached nodes.
 * See ARCHITECTURE.md §6.5.
 *
 * For each end, transform the polyline samples into the attached node's
 * pre-rotation local frame (collapsing the rotated-rect problem to
 * axis-aligned). Walk samples from that endpoint outward; the first
 * sample outside the rect is the exit. Sub-pixel interpolate between
 * the last-inside and first-outside samples for a clean clip point.
 */
import { nodeLocalToWorld, worldToNodeLocal } from './project'

/**
 * Result of clipping the polyline against the two attached-node rects.
 * `startIndex` / `endIndex` are sample indices; the visible polyline is
 * `[startPoint, samples[startIndex+1..endIndex-1], endPoint]`.
 * If both ends are free-floating (no attached node), returns the full range.
 */
export type ClipResult = {
  startIndex: number
  endIndex: number
  startPoint: Vec2
  endPoint: Vec2
  visible: boolean
}

export const fullVisibleClipResult = (samples: Vec2[]): ClipResult => ({
  startIndex: 0,
  endIndex: samples.length - 1,
  startPoint: samples[0] ?? { x: 0, y: 0 },
  endPoint: samples[samples.length - 1] ?? { x: 0, y: 0 },
  visible: samples.length >= 2,
})

/**
 * Clips a polyline against (up to) two attached-node rects.
 * `sourceNode` / `targetNode` are the nodes the source/target endpoints
 * attach to (null for free-floating endpoints).
 */
export const clipSamples = (
  samples: Vec2[],
  sourceNode: Node | null,
  targetNode: Node | null,
): ClipResult => {
  if (samples.length < 2) return fullVisibleClipResult(samples)

  let startIndex = 0
  let startPoint = samples[0]!
  if (sourceNode) {
    const trimmed = trimFromStart(samples, sourceNode)
    if (!trimmed) return { ...fullVisibleClipResult(samples), visible: false }
    startIndex = trimmed.index
    startPoint = trimmed.point
  }

  let endIndex = samples.length - 1
  let endPoint = samples[endIndex]!
  if (targetNode) {
    const trimmed = trimFromEnd(samples, targetNode)
    if (!trimmed) return { ...fullVisibleClipResult(samples), visible: false }
    endIndex = trimmed.index
    endPoint = trimmed.point
  }

  // Source clip is strictly after target clip → nothing visible (clips
  // crossed over each other; happens when nodes overlap and edge ends
  // are inside both).
  if (startIndex > endIndex) {
    return {
      startIndex,
      endIndex,
      startPoint,
      endPoint,
      visible: false,
    }
  }

  return { startIndex, endIndex, startPoint, endPoint, visible: true }
}

/**
 * Walks samples from index 0 outward, returns the exit point where the
 * polyline first leaves the node's local rect. Returns null if every
 * sample is inside the rect (edge fully consumed by the node).
 */
const trimFromStart = (samples: Vec2[], node: Node): { index: number; point: Vec2 } | null => {
  const localSamples = samples.map(p => worldToNodeLocal(p, node))
  // Find first "outside" sample after we've seen at least one "inside".
  let lastInside = -1
  for (let i = 0; i < localSamples.length; i++) {
    const p = localSamples[i]!
    if (isInsideLocalRect(p, node.w, node.h)) {
      lastInside = i
    } else if (lastInside >= 0) {
      // Transition: lastInside → i is the crossing segment.
      const crossingLocal = segmentRectExit(localSamples[lastInside]!, p, node.w, node.h)
      return {
        index: i,
        point: nodeLocalToWorld(crossingLocal, node),
      }
    }
    // First sample already outside → the source endpoint is outside its node.
    // That's normal for free-floating endpoints; for attached endpoints it
    // happens when the node is small and the endpoint is exactly on the edge.
    if (i === 0 && !isInsideLocalRect(p, node.w, node.h)) {
      return { index: 0, point: samples[0]! }
    }
  }
  // Every sample inside → nothing visible.
  return null
}

/**
 * Mirror of trimFromStart: walk from the end backwards.
 */
const trimFromEnd = (samples: Vec2[], node: Node): { index: number; point: Vec2 } | null => {
  const localSamples = samples.map(p => worldToNodeLocal(p, node))
  let lastInside = -1
  for (let i = localSamples.length - 1; i >= 0; i--) {
    const p = localSamples[i]!
    if (isInsideLocalRect(p, node.w, node.h)) {
      lastInside = i
    } else if (lastInside >= 0) {
      const crossingLocal = segmentRectExit(localSamples[lastInside]!, p, node.w, node.h)
      return {
        index: i,
        point: nodeLocalToWorld(crossingLocal, node),
      }
    }
    if (i === localSamples.length - 1 && !isInsideLocalRect(p, node.w, node.h)) {
      return { index: i, point: samples[i]! }
    }
  }
  return null
}

/**
 * Boolean: is a local-frame point inside the rect [0..w, 0..h]?
 * Allows a tiny inset epsilon so the "first sample on the boundary"
 * case behaves consistently.
 */
const isInsideLocalRect = (p: Vec2, w: number, h: number): boolean => {
  const eps = 1e-6
  return p.x >= -eps && p.x <= w + eps && p.y >= -eps && p.y <= h + eps
}

/**
 * Given a local-frame segment from `inside` to `outside`, find the exact
 * point where it exits the rect [0..w, 0..h]. Tests against all 4 edges
 * and picks the smallest t in (0, 1].
 */
const segmentRectExit = (inside: Vec2, outside: Vec2, w: number, h: number): Vec2 => {
  let bestT = 1
  const ts: number[] = []
  if (outside.x !== inside.x) {
    ts.push(crossEdge(inside.x, outside.x, 0, inside, outside, h, /* checkY */ true))
    ts.push(crossEdge(inside.x, outside.x, w, inside, outside, h, true))
  }
  if (outside.y !== inside.y) {
    ts.push(crossEdgeY(inside.y, outside.y, 0, inside, outside, w))
    ts.push(crossEdgeY(inside.y, outside.y, h, inside, outside, w))
  }
  for (const t of ts) {
    if (t > 0 && t <= 1 && t < bestT) bestT = t
  }
  return {
    x: inside.x + bestT * (outside.x - inside.x),
    y: inside.y + bestT * (outside.y - inside.y),
  }
}

/**
 * Tests crossing of a segment with a vertical edge at x=edgeX.
 * Returns the parametric t along the segment, or Infinity if the
 * y at that t is outside [0..h].
 */
const crossEdge = (
  ax: number,
  bx: number,
  edgeX: number,
  a: Vec2,
  b: Vec2,
  h: number,
  _checkY: boolean,
): number => {
  if (ax === bx) return Number.POSITIVE_INFINITY
  const t = (edgeX - ax) / (bx - ax)
  if (t < 0 || t > 1) return Number.POSITIVE_INFINITY
  const y = a.y + t * (b.y - a.y)
  if (y < -1e-6 || y > h + 1e-6) return Number.POSITIVE_INFINITY
  return t
}

/**
 * Tests crossing of a segment with a horizontal edge at y=edgeY.
 */
const crossEdgeY = (ay: number, by: number, edgeY: number, a: Vec2, b: Vec2, w: number): number => {
  if (ay === by) return Number.POSITIVE_INFINITY
  const t = (edgeY - ay) / (by - ay)
  if (t < 0 || t > 1) return Number.POSITIVE_INFINITY
  const x = a.x + t * (b.x - a.x)
  if (x < -1e-6 || x > w + 1e-6) return Number.POSITIVE_INFINITY
  return t
}
