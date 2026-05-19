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
 * Cache wrapper: stores last-computed geometry per edge id, keyed by an
 * integer version supplied by the caller. The store maintains the version
 * counter and bumps it on geometry-affecting mutations (edge.update or
 * incident node moves), so this cache becomes a pure integer-compare.
 *
 * Earlier versions of this file used a `toFixed(2)`-built string version
 * to detect changes implicitly. That allocated ~14 strings per edge per
 * paint and cost ~5-8ms at 2k visible edges. Explicit integer versioning
 * eliminates that entirely.
 */
export class EdgeGeometryCache {
  private readonly entries = new Map<EdgeId, { version: number; geom: EdgeGeometry }>()

  /**
   * Returns the cached geometry if `version` matches the cache entry;
   * otherwise recomputes via `computeEdgeGeometry`, stores, and returns.
   * Caller is responsible for passing the current store-managed version.
   */
  get(edge: Edge, version: number, getNode: (id: NodeId) => Node | undefined): EdgeGeometry | null {
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
