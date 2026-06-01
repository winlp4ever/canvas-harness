/**
 * Higher-level hit queries that combine the spatial index with per-shape
 * narrow-phase tests. Returns the topmost hit by z, or all hits inside a
 * marquee rect.
 */
import type { CanvasStore } from '../store'
import type { EdgeId, Node, NodeId, Vec2, WorldRect } from '../types'
import { type EdgeHit, hitTestEdge } from './edge'
import { type ResizeHandle, hitTestHandles, hitTestRotateHandle } from './handle'
import { nodeIntersectsRect, pointInNode } from './node'

export type NodeHit =
  | { kind: 'body'; nodeId: NodeId }
  | { kind: 'resize-handle'; nodeId: NodeId; handle: ResizeHandle }
  | { kind: 'rotate-handle'; nodeId: NodeId }

/** A hit covers either a node or an edge sub-region. */
export type Hit = NodeHit | EdgeHit

/**
 * Returns the topmost node hit by a world-space point, plus the part hit
 * (body or resize handle). Handles are tested before bodies (interactive
 * elements always win over background — see ARCHITECTURE.md §7).
 *
 * If `selectedIds` is provided, only those nodes' handles are considered
 * — handles only display when the node is selected.
 */
export const hitTestPoint = (
  store: CanvasStore,
  worldPoint: Vec2,
  cameraZ: number,
  selectedIds: ReadonlySet<NodeId> = new Set(),
): NodeHit | null => {
  // First try rotation + resize handles on selected nodes (drawn above
  // bodies). Rotate handle sits OUTSIDE the node bounds so it gets
  // priority over neighboring bodies underneath.
  for (const id of selectedIds) {
    const n = store.getNode(id)
    if (!n) continue
    if (hitTestRotateHandle(n, worldPoint, cameraZ)) {
      return { kind: 'rotate-handle', nodeId: id }
    }
    const h = hitTestHandles(n, worldPoint, cameraZ)
    if (h) return { kind: 'resize-handle', nodeId: id, handle: h }
  }

  // Then bodies, topmost-z first. Tiebreak on id (lexically greater id
  // is painted later → sits on top → wins the hit) so hit-test matches
  // paint order exactly.
  const candidates = store.querySpatial({ point: worldPoint }).nodes
  let best: Node | null = null
  for (const id of candidates) {
    const n = store.getNode(id)
    if (!n) continue
    if (!pointInNode(worldPoint, n)) continue
    if (!best || n.z > best.z || (n.z === best.z && n.id > best.id)) {
      best = n
    }
  }
  return best ? { kind: 'body', nodeId: best.id } : null
}

/**
 * Combined node + edge hit testing. Order: node handles > edge endpoint
 * handles > visually-topmost body (node or edge, compared by z).
 *
 * For bodies, the rule is paint-order: whichever of (node body, edge
 * body) has the higher z wins, with ties going to edges (edges paint
 * over nodes by convention). This lets users click an edge that runs
 * visually over a large background-style node — the 8px polyline slop
 * keeps the edge's hit zone narrow, so clicks far from the polyline
 * still land on the node underneath.
 */
export const hitTestAny = (
  store: CanvasStore,
  worldPoint: Vec2,
  cameraZ: number,
  selectedNodes: ReadonlySet<NodeId> = new Set(),
  selectedEdges: ReadonlySet<EdgeId> = new Set(),
): Hit | null => {
  // 1. node rotate + resize handles (selected only)
  for (const id of selectedNodes) {
    const n = store.getNode(id)
    if (!n) continue
    if (hitTestRotateHandle(n, worldPoint, cameraZ)) {
      return { kind: 'rotate-handle', nodeId: id }
    }
    const h = hitTestHandles(n, worldPoint, cameraZ)
    if (h) return { kind: 'resize-handle', nodeId: id, handle: h }
  }

  // 2. edge handles (selected only) — endpoint reconnect handles and
  // the midpoint reshape handle.
  for (const id of selectedEdges) {
    const partial = hitTestEdge(store, worldPoint, cameraZ, new Set([id]))
    if (
      partial &&
      (partial.kind === 'source-handle' ||
        partial.kind === 'target-handle' ||
        partial.kind === 'midpoint-handle')
    ) {
      return partial
    }
  }

  // 3. bodies — visually topmost wins. Edge body / label both expose
  // an `edgeId` field; either competes with the node body via z.
  const nodeHit = hitTestPoint(store, worldPoint, cameraZ, selectedNodes)
  const edgeHit = hitTestEdge(store, worldPoint, cameraZ)
  if (nodeHit && edgeHit && 'edgeId' in edgeHit) {
    const nodeZ = store.getNode(nodeHit.nodeId)?.z ?? 0
    const edgeZ = store.getEdge(edgeHit.edgeId)?.z ?? 0
    return edgeZ >= nodeZ ? edgeHit : nodeHit
  }
  return nodeHit ?? edgeHit
}

/**
 * Returns ids of all nodes whose (rotated) rect intersects the given rect.
 * Used for marquee selection.
 */
export const marqueeNodes = (store: CanvasStore, rect: WorldRect): NodeId[] => {
  const candidates = store.querySpatial({ rect }).nodes
  const result: NodeId[] = []
  for (const id of candidates) {
    const n = store.getNode(id)
    if (!n) continue
    if (nodeIntersectsRect(n, rect)) result.push(id)
  }
  return result
}
