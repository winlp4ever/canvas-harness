/**
 * Edge hit testing — see ARCHITECTURE.md §6.9.
 *
 * Broad-phase via the spatial index; narrow-phase via point-to-polyline
 * distance over the cached samples. Sub-region detection: arrowhead tips
 * and (when selected) endpoint handles are tested before the body.
 */
import { edgeLabelBoundsWorld } from '../edges/draw'
import type { CanvasStore, EdgeGeometry } from '../store'
import type { Edge, EdgeId, Vec2 } from '../types'

/** Hit-slop in screen pixels for the edge body. */
export const EDGE_HIT_SLOP_PX = 8
/** Hit-slop in screen pixels for endpoint / arrowhead handles. */
export const EDGE_HANDLE_SLOP_PX = 12

export type EdgeHit =
  | { kind: 'body'; edgeId: EdgeId; distance: number; arcLength: number }
  | { kind: 'source-handle'; edgeId: EdgeId; distance: number }
  | { kind: 'target-handle'; edgeId: EdgeId; distance: number }
  | { kind: 'label'; edgeId: EdgeId }

/**
 * Returns the topmost edge hit by a world point, or null.
 * `selectedEdges` enables endpoint-handle detection (handles only show
 * when the edge is selected).
 */
export const hitTestEdge = (
  store: CanvasStore,
  worldPoint: Vec2,
  cameraZ: number,
  selectedEdges: ReadonlySet<EdgeId> = new Set(),
): EdgeHit | null => {
  const slopWorld = EDGE_HIT_SLOP_PX / cameraZ
  const handleSlopWorld = EDGE_HANDLE_SLOP_PX / cameraZ

  // Endpoint handles win over body (interactive-over-background rule).
  for (const id of selectedEdges) {
    const geom = store.getEdgeGeometry(id)
    if (!geom) continue
    const dSource = distance(worldPoint, geom.source)
    if (dSource <= handleSlopWorld) {
      return { kind: 'source-handle', edgeId: id, distance: dSource }
    }
    const dTarget = distance(worldPoint, geom.target)
    if (dTarget <= handleSlopWorld) {
      return { kind: 'target-handle', edgeId: id, distance: dTarget }
    }
  }

  // Body hits — broad-phase via spatial index, narrow via polyline.
  const queryRect = {
    x: worldPoint.x - slopWorld,
    y: worldPoint.y - slopWorld,
    w: slopWorld * 2,
    h: slopWorld * 2,
  }
  const candidates = store.querySpatial({ rect: queryRect }).edges

  // Label hits — checked before body so a click on a label doesn't
  // accidentally select the edge body underneath. Iterates candidates
  // again because labels can extend slightly beyond the body slop.
  for (const id of candidates) {
    const edge = store.getEdge(id)
    if (!edge || edge.hidden || !edge.content || !edge.content.trim()) continue
    const geom = store.getEdgeGeometry(id)
    if (!geom) continue
    const bounds = edgeLabelBoundsWorld(edge, geom)
    if (!bounds) continue
    if (
      worldPoint.x >= bounds.x &&
      worldPoint.x <= bounds.x + bounds.w &&
      worldPoint.y >= bounds.y &&
      worldPoint.y <= bounds.y + bounds.h
    ) {
      return { kind: 'label', edgeId: id }
    }
  }

  type BodyHit = Extract<EdgeHit, { kind: 'body' }>
  let best: { hit: BodyHit; z: number; edge: Edge } | null = null
  for (const id of candidates) {
    const edge = store.getEdge(id)
    if (!edge || edge.hidden) continue
    const geom = store.getEdgeGeometry(id)
    if (!geom) continue
    const result = nearestSampleDistance(worldPoint, geom)
    if (result.distance > slopWorld) continue
    if (
      !best ||
      edge.z > best.edge.z ||
      (edge.z === best.edge.z && result.distance < best.hit.distance)
    ) {
      best = {
        hit: { kind: 'body', edgeId: id, distance: result.distance, arcLength: result.arcLength },
        z: edge.z,
        edge,
      }
    }
  }

  return best ? best.hit : null
}

/**
 * Walks the polyline samples and finds the nearest segment to the point.
 * Returns the perpendicular distance + the arc-length parameter (0..1)
 * of the foot of perpendicular along the polyline. Callers use arcLength
 * to insert midpoints or anchor labels.
 */
const nearestSampleDistance = (
  p: Vec2,
  geom: EdgeGeometry,
): { distance: number; arcLength: number } => {
  const samples = geom.samples
  if (samples.length < 2) return { distance: Number.POSITIVE_INFINITY, arcLength: 0 }

  const segmentLengths: number[] = []
  let totalLen = 0
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]!
    const b = samples[i]!
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    segmentLengths.push(len)
    totalLen += len
  }
  if (totalLen === 0) return { distance: distance(p, samples[0]!), arcLength: 0 }

  let bestD2 = Number.POSITIVE_INFINITY
  let bestArc = 0
  let cumLen = 0
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]!
    const b = samples[i]!
    const segLen = segmentLengths[i - 1]!
    const { d2, t } = pointSegmentDistanceSq(p, a, b)
    if (d2 < bestD2) {
      bestD2 = d2
      bestArc = (cumLen + t * segLen) / totalLen
    }
    cumLen += segLen
  }
  return { distance: Math.sqrt(bestD2), arcLength: bestArc }
}

const distance = (a: Vec2, b: Vec2): number => Math.hypot(b.x - a.x, b.y - a.y)

/**
 * Squared distance from point p to segment ab, plus parametric t along ab.
 * Squared to avoid the sqrt in the inner loop.
 */
const pointSegmentDistanceSq = (p: Vec2, a: Vec2, b: Vec2): { d2: number; t: number } => {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 === 0) {
    const ex = p.x - a.x
    const ey = p.y - a.y
    return { d2: ex * ex + ey * ey, t: 0 }
  }
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  const fx = a.x + dx * t
  const fy = a.y + dy * t
  const ex = p.x - fx
  const ey = p.y - fy
  return { d2: ex * ex + ey * ey, t }
}
