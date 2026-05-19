/**
 * Store public types — see ARCHITECTURE.md §10.
 */
import type {
  BatchId,
  CameraState,
  ClientId,
  Edge,
  EdgeId,
  Group,
  GroupId,
  Node,
  NodeId,
  Op,
  OpBatch,
  Vec2,
  WorldRect,
} from '../types'

import type { IdGenerator } from '../ids'

export type StoreOptions = {
  initial?: import('../types').Scene
  clientId?: ClientId
  idGenerator?: IdGenerator
}

/**
 * Origin of an applied op — drives sync + undo behavior.
 *
 * Phase 1 only uses 'local'; remote/history wire up in phase 8.
 */
export type OpOrigin = 'local' | 'remote' | 'history'

export type StoreEvents = {
  /** Fires once per committed OpBatch (one batch per mutation or per `batch()` call). */
  change: OpBatch
  /** Camera state changed (any field). */
  camera: CameraState
  /** Selection changed. */
  selection: (NodeId | EdgeId)[]
}

export type StoreEventName = keyof StoreEvents
export type StoreEventHandler<E extends StoreEventName> = (payload: StoreEvents[E]) => void
export type Unsubscribe = () => void

export type SpatialQuery = {
  rect?: WorldRect
  point?: Vec2
}

export type SpatialResult = {
  nodes: NodeId[]
  edges: EdgeId[]
}

/**
 * Public store surface — see ARCHITECTURE.md §12.3.
 *
 * Phase 1 ships the imperative shape; React hooks come in phase 9.
 */
export interface CanvasStore {
  readonly clientId: ClientId
  generateId(): string

  // mutations (each builds an Op internally + calls applyOp)
  addNode(node: Node): NodeId
  updateNode(id: NodeId, patch: Partial<Node>): void
  removeNode(id: NodeId): void
  addEdge(edge: Edge): EdgeId
  updateEdge(id: EdgeId, patch: Partial<Edge>): void
  removeEdge(id: EdgeId): void
  upsertGroup(group: Group): void
  removeGroup(id: GroupId): void

  batch(fn: () => void): void
  applyOp(op: Op, opts?: { origin?: OpOrigin }): void
  applyBatch(batch: OpBatch): void

  // reads (imperative, no subscription)
  getNode(id: NodeId): Node | undefined
  getEdge(id: EdgeId): Edge | undefined
  getGroup(id: GroupId): Group | undefined
  getAllNodes(): Node[]
  getAllEdges(): Edge[]
  getAllGroups(): Group[]
  /** O(1) count without materializing the full list. */
  getNodeCount(): number
  /** O(1) count without materializing the full list. */
  getEdgeCount(): number
  /** O(1) count without materializing the full list. */
  getGroupCount(): number
  querySpatial(q: SpatialQuery): SpatialResult

  // camera + selection
  getCamera(): CameraState
  setCamera(patch: Partial<CameraState>): void
  getSelection(): (NodeId | EdgeId)[]
  setSelection(ids: (NodeId | EdgeId)[]): void

  // events
  subscribe<E extends StoreEventName>(event: E, cb: StoreEventHandler<E>): Unsubscribe
}

export type { BatchId, OpBatch }
