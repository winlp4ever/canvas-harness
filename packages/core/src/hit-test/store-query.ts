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

  // Then bodies, topmost-z first
  const candidates = store.querySpatial({ point: worldPoint }).nodes
  let best: Node | null = null
  let bestZ = Number.NEGATIVE_INFINITY
  for (const id of candidates) {
    const n = store.getNode(id)
    if (!n) continue
    if (pointInNode(worldPoint, n) && n.z >= bestZ) {
      best = n
      bestZ = n.z
    }
  }
  return best ? { kind: 'body', nodeId: best.id } : null
}

/**
 * Combined node + edge hit testing. Order: node handles > edge endpoint
 * handles > node bodies > edge bodies.
 *
 * Node bodies take priority over edge bodies because clicking ON a node
 * shouldn't accidentally select the edge passing behind it.
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

  // 2. edge endpoint handles (selected only)
  for (const id of selectedEdges) {
    const partial = hitTestEdge(store, worldPoint, cameraZ, new Set([id]))
    if (partial && (partial.kind === 'source-handle' || partial.kind === 'target-handle')) {
      return partial
    }
  }

  // 3. node bodies
  const nodeHit = hitTestPoint(store, worldPoint, cameraZ, selectedNodes)
  if (nodeHit) return nodeHit

  // 4. edge bodies
  return hitTestEdge(store, worldPoint, cameraZ)
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
