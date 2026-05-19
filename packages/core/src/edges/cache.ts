/**
 * Edge geometry cache — see ARCHITECTURE.md §6.12.
 *
 * Stores per-edge sampled polylines + AABB, indexed by an opaque "version"
 * string derived from inputs (endpoints, controls, pathStyle, attached
 * node positions/angles/sizes). Cache invalidates implicitly when the
 * version key changes — no explicit deletes needed; we just refetch.
 *
 * For the renderer this means: edges paint in O(samples) per frame
 * after the first miss; sampling cost is paid only when geometry truly
 * changes. Phase-1's incidentEdges map drives "moving node → its edges
 * version changes" propagation.
 */
import { isAttached } from '../types'
import type { Edge, EdgeId, Node, NodeId, Vec2, WorldRect } from '../types'
import { edgeAABBFromSamples } from './aabb'
import { autoRouteControls, rotateVecByAngle, sideNormalLocal, sideOf } from './auto-route'
import { projectEndToWorld } from './project'
import { samplesFor } from './samples'
import { sampleSelfLoop } from './self-loop'

export type EdgeGeometry = {
  /** Endpoint world positions (post-projection, pre-clip). */
  source: Vec2
  target: Vec2
  /** Polyline samples for paint / hit-test / clip. */
  samples: Vec2[]
  /** AABB enclosing samples (padded for arrowheads). */
  aabb: WorldRect
  /** Whether the edge is a self-loop (source.nodeId === target.nodeId). */
  isSelfLoop: boolean
  /** Source/target attached node IDs (or null). Used by paint to clip. */
  sourceNodeId: NodeId | null
  targetNodeId: NodeId | null
}

/**
 * Computes edge geometry from current node state. No caching — callers
 * memoize on a version key (see makeEdgeVersion).
 */
export const computeEdgeGeometry = (
  edge: Edge,
  getNode: (id: NodeId) => Node | undefined,
): EdgeGeometry | null => {
  const sourceNode = isAttached(edge.source) ? (getNode(edge.source.nodeId) ?? null) : null
  const targetNode = isAttached(edge.target) ? (getNode(edge.target.nodeId) ?? null) : null
  const sourceNodeId = sourceNode ? sourceNode.id : null
  const targetNodeId = targetNode ? targetNode.id : null

  // Self-loop shortcut.
  if (sourceNodeId && sourceNodeId === targetNodeId && sourceNode) {
    const samples = sampleSelfLoop(sourceNode)
    return {
      source: samples[0]!,
      target: samples[samples.length - 1]!,
      samples,
      aabb: edgeAABBFromSamples(samples),
      isSelfLoop: true,
      sourceNodeId,
      targetNodeId,
    }
  }

  const sourceWorld = projectEndToWorld(edge.source, getNode)
  const targetWorld = projectEndToWorld(edge.target, getNode)
  if (!sourceWorld || !targetWorld) return null

  let samples: Vec2[]
  if (edge.pathStyle === 'bezier') {
    let c1: Vec2
    let c2: Vec2
    if (edge.control && edge.control.length >= 2) {
      c1 = edge.control[0]!
      c2 = edge.control[1]!
    } else {
      const sourceNormal =
        sourceNode && isAttached(edge.source)
          ? rotateVecByAngle(
              sideNormalLocal(
                sideOf(sourceNode, edge.source.localOffset.x, edge.source.localOffset.y),
              ),
              sourceNode.angle,
            )
          : null
      const targetNormal =
        targetNode && isAttached(edge.target)
          ? rotateVecByAngle(
              sideNormalLocal(
                sideOf(targetNode, edge.target.localOffset.x, edge.target.localOffset.y),
              ),
              targetNode.angle,
            )
          : null
      ;({ c1, c2 } = autoRouteControls(sourceWorld, targetWorld, sourceNormal, targetNormal))
    }
    samples = samplesFor('bezier', sourceWorld, targetWorld, [c1, c2])
  } else {
    samples = samplesFor(edge.pathStyle, sourceWorld, targetWorld, edge.control)
  }

  return {
    source: sourceWorld,
    target: targetWorld,
    samples,
    aabb: edgeAABBFromSamples(samples),
    isSelfLoop: false,
    sourceNodeId,
    targetNodeId,
  }
}

/**
 * Cache wrapper: stores last-computed geometry per edge id alongside the
 * version key it was computed from. Hits as long as version matches.
 */
export class EdgeGeometryCache {
  private readonly entries = new Map<EdgeId, { version: string; geom: EdgeGeometry }>()

  /**
   * Returns the cached geometry for this edge, recomputing if the version
   * key has changed. Pure read-through cache.
   */
  get(edge: Edge, getNode: (id: NodeId) => Node | undefined): EdgeGeometry | null {
    const version = makeEdgeVersion(edge, getNode)
    const cached = this.entries.get(edge.id)
    if (cached && cached.version === version) return cached.geom
    const geom = computeEdgeGeometry(edge, getNode)
    if (geom) this.entries.set(edge.id, { version, geom })
    else this.entries.delete(edge.id)
    return geom
  }

  delete(id: EdgeId): void {
    this.entries.delete(id)
  }

  clear(): void {
    this.entries.clear()
  }
}

/**
 * Builds a small string that uniquely identifies an edge's geometry inputs.
 * Cheap to compute, cheap to compare. Includes everything that affects
 * the curve: endpoints, controls, pathStyle, attached-node geometry.
 */
const makeEdgeVersion = (edge: Edge, getNode: (id: NodeId) => Node | undefined): string => {
  let v = edge.pathStyle
  v += '|'
  v += endVersion(edge.source, getNode)
  v += '|'
  v += endVersion(edge.target, getNode)
  if (edge.control && edge.control.length > 0) {
    for (const c of edge.control) {
      v += `|${c.x.toFixed(2)},${c.y.toFixed(2)}`
    }
  }
  return v
}

const endVersion = (end: Edge['source'], getNode: (id: NodeId) => Node | undefined): string => {
  if (!isAttached(end)) return `w:${end.worldPoint.x.toFixed(2)},${end.worldPoint.y.toFixed(2)}`
  const n = getNode(end.nodeId)
  if (!n) return `n:${end.nodeId}:gone`
  // Include both node geometry and the local offset.
  return `n:${end.nodeId}:${n.x.toFixed(2)},${n.y.toFixed(2)},${n.w.toFixed(2)},${n.h.toFixed(2)},${n.angle.toFixed(4)}|o:${end.localOffset.x.toFixed(2)},${end.localOffset.y.toFixed(2)}`
}
