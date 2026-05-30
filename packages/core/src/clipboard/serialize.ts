import type { CanvasStore } from '../store'
import { SCHEMA_VERSION, asEdgeId, asNodeId, isAttached } from '../types'
import type { Edge, EdgeEnd, EdgeId, Node, NodeId, Vec2 } from '../types'

/**
 * Clipboard serialization — see ARCHITECTURE.md §13 (copy/paste).
 *
 * Captures the selected nodes plus the edges *between* them (edges
 * crossing the selection are dropped — same rule as tldraw/excalidraw).
 * Pure functions; no clipboard-API I/O. The store wraps these with
 * `navigator.clipboard.{write,read}` calls.
 */

export type SerializedClipboard = {
  /** Schema version stamped at copy time. */
  v: number
  /** Source clientId — diagnostic only; not used for paste. */
  clientId: string
  /** Tagged so we can tell our payload apart from arbitrary JSON. */
  kind: 'canvas-harness/clipboard'
  nodes: Node[]
  edges: Edge[]
}

/**
 * Builds a clipboard payload from the store's current selection. Pure
 * — no I/O, no clipboard API. Useful for programmatic copy-paste
 * (snapshots, AI-driven duplication, drag-from-sidebar, ...).
 *
 * Edges crossing the selection boundary (only one endpoint in the
 * selection) are dropped. Edges with `worldPoint` endpoints are kept.
 *
 * @example
 * const clip = serializeSelection(store)
 * localStorage.setItem('clipboard', JSON.stringify(clip))
 */
export const serializeSelection = (store: CanvasStore): SerializedClipboard => {
  const selectedIds = store.getSelection()
  const selectedNodeIds = new Set<NodeId>()
  for (const id of selectedIds) {
    if (store.getNode(id as NodeId)) selectedNodeIds.add(id as NodeId)
  }
  const nodes: Node[] = []
  for (const id of selectedNodeIds) {
    const n = store.getNode(id)
    if (n) nodes.push(n)
  }
  // Edges: include if either both endpoints are in the selection (or
  // free-floating). Drop edges that cross the selection boundary.
  const edges: Edge[] = []
  for (const id of selectedIds) {
    const e = store.getEdge(id as EdgeId)
    if (e && bothEndsInsideSelection(e, selectedNodeIds)) edges.push(e)
  }
  // Also include any edges *between* selected nodes, even if not in the
  // selection itself — matches user expectation: "copy this cluster".
  for (const e of store.getAllEdges()) {
    if (edges.includes(e)) continue
    if (bothEndsInsideSelection(e, selectedNodeIds)) edges.push(e)
  }
  return {
    v: SCHEMA_VERSION,
    clientId: store.clientId,
    kind: 'canvas-harness/clipboard',
    nodes,
    edges,
  }
}

const bothEndsInsideSelection = (edge: Edge, ids: ReadonlySet<NodeId>): boolean => {
  return endInside(edge.source, ids) && endInside(edge.target, ids)
}
const endInside = (end: EdgeEnd, ids: ReadonlySet<NodeId>): boolean => {
  if (!isAttached(end)) return true // free-floating endpoint paste-safe
  return ids.has(end.nodeId)
}

export type DeserializeOptions = {
  /**
   * Relative world-space offset added to every pasted node's `x/y`
   * (and to free-floating edge endpoints). Takes precedence over
   * `at` when both are passed. Default `(20, 20)` when neither is
   * given.
   */
  offset?: Vec2
  /**
   * Absolute world-space target — the *center* of the pasted bbox
   * lands here. Used by `paste()` to place the paste at the cursor;
   * pass directly for programmatic absolute placement. Ignored if
   * `offset` is also set.
   */
  at?: Vec2
  /** Override the selection on the store after applying. Default true. */
  select?: boolean
}

/**
 * Bounding-box center of a clip's node rects (pre-offset). Used to
 * translate an absolute `at` target into the per-node offset that
 * lands the paste's visual center on that point.
 */
const clipBboxCenter = (nodes: Node[]): Vec2 => {
  if (nodes.length === 0) return { x: 0, y: 0 }
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const n of nodes) {
    if (n.x < minX) minX = n.x
    if (n.y < minY) minY = n.y
    if (n.x + n.w > maxX) maxX = n.x + n.w
    if (n.y + n.h > maxY) maxY = n.y + n.h
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
}

/**
 * Applies a clipboard payload to the store. New ids are minted; edge
 * endpoints are rewired; the resulting nodes + edges become the new
 * selection by default. Positioning precedence:
 *
 *   1. `opts.offset` (relative) — used as-is.
 *   2. `opts.at` (absolute) — offset computed so the clip's bbox
 *      center lands on this point.
 *   3. Default — relative `(20, 20)` offset.
 *
 * Free-floating edge endpoints (`{ worldPoint }`) also receive the
 * offset so an edge with an unattached end stays connected to the
 * surrounding nodes after the paste.
 *
 * One `store.batch` — one undo step.
 *
 * @example
 * // Restore from localStorage:
 * const clip = JSON.parse(localStorage.getItem('clipboard')!)
 * if (isCanvasHarnessClipboard(clip)) deserializeClipboard(store, clip)
 */
export const deserializeClipboard = (
  store: CanvasStore,
  clip: SerializedClipboard,
  opts: DeserializeOptions = {},
): NodeId[] => {
  let offset: Vec2
  if (opts.offset) {
    offset = opts.offset
  } else if (opts.at && clip.nodes.length > 0) {
    const center = clipBboxCenter(clip.nodes)
    offset = { x: opts.at.x - center.x, y: opts.at.y - center.y }
  } else {
    offset = { x: 20, y: 20 }
  }
  const select = opts.select ?? true

  // Old → new id maps.
  const nodeMap = new Map<NodeId, NodeId>()
  const edgeMap = new Map<EdgeId, EdgeId>()
  for (const n of clip.nodes) nodeMap.set(n.id, asNodeId(store.generateId()))
  for (const e of clip.edges) edgeMap.set(e.id, asEdgeId(store.generateId()))

  const remappedNodes: Node[] = clip.nodes.map(n => ({
    ...n,
    id: nodeMap.get(n.id)!,
    x: n.x + offset.x,
    y: n.y + offset.y,
  }))
  const remapEnd = (end: EdgeEnd): EdgeEnd => {
    if (!isAttached(end)) {
      // Free-floating endpoint — keep it visually attached to the
      // pasted neighbourhood by applying the same offset the nodes
      // got. Without this, the edge end stays at the original world
      // point and the connection visually stretches.
      return { worldPoint: { x: end.worldPoint.x + offset.x, y: end.worldPoint.y + offset.y } }
    }
    const newId = nodeMap.get(end.nodeId)
    return newId ? { nodeId: newId, localOffset: end.localOffset } : end
  }
  const remappedEdges: Edge[] = clip.edges.map(e => ({
    ...e,
    id: edgeMap.get(e.id)!,
    source: remapEnd(e.source),
    target: remapEnd(e.target),
  }))

  store.batch(() => {
    for (const n of remappedNodes) store.addNode(n)
    for (const e of remappedEdges) store.addEdge(e)
  })

  const ids = remappedNodes.map(n => n.id)
  if (select) store.setSelection([...ids, ...remappedEdges.map(e => e.id)])
  return ids
}

/**
 * Type guard — verifies a parsed JSON blob is a clipboard payload from
 * this library, not arbitrary JSON pasted from elsewhere.
 */
export const isCanvasHarnessClipboard = (raw: unknown): raw is SerializedClipboard => {
  if (!raw || typeof raw !== 'object') return false
  const r = raw as Record<string, unknown>
  return r.kind === 'canvas-harness/clipboard' && Array.isArray(r.nodes) && Array.isArray(r.edges)
}
