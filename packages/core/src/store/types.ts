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

import type { EdgeGeometry } from '../edges/cache'
import type { IdGenerator } from '../ids'
import type { NodeTypeDef } from '../node-types'
import type { InteractionState } from './interaction'
import type { PresencePatch, PresenceState } from './presence'

export type StoreOptions = {
  initial?: import('../types').Scene
  clientId?: ClientId
  idGenerator?: IdGenerator
  /**
   * Custom node type registry. Each entry created via `defineNode`. The
   * renderer consults this to decide between built-in shapes, canvas
   * custom paint, and React-overlay views. See ARCHITECTURE.md §5.
   */
  nodeTypes?: NodeTypeDef[]
}

/**
 * Origin of an applied op — drives sync + undo behavior.
 *
 * Phase 1 only uses 'local'; remote/history wire up in phase 8.
 */
export type OpOrigin = 'local' | 'remote' | 'history'

/**
 * Presence change event payload. `removed: true` signals a remote client
 * has left. Local-presence changes carry the full new state.
 */
export type PresenceEvent =
  | { state: PresenceState; removed?: false }
  | { clientId: ClientId; removed: true }

export type StoreEvents = {
  /** Fires once per committed OpBatch (one batch per mutation or per `batch()` call). */
  change: OpBatch
  /** Camera state changed (any field). */
  camera: CameraState
  /** Selection changed. */
  selection: (NodeId | EdgeId)[]
  /** Interaction state changed (mode / pointer / drag / marquee / resize / edit). */
  interaction: InteractionState
  /** Local or remote presence changed. Subscribers compare clientId to filter. */
  presence: PresenceEvent
  /**
   * LWW conflict detected when applying a remote batch — `prev` slice
   * didn't match local current value. The op was still applied (last
   * writer wins); the event fires for telemetry / consumer UX.
   */
  conflict: { batch: OpBatch; conflicts: { op: Op; field: string }[] }
}

/** Public presence slice on the store. */
export interface PresenceSlice {
  /** Patch this client's presence; emits a 'presence' event + forwards via SyncAdapter. */
  setLocal(patch: PresencePatch): void
  /** Current local presence. */
  getLocal(): PresenceState
  /** Snapshot of a remote client's presence, or undefined. */
  get(clientId: ClientId): PresenceState | undefined
  /** Snapshot of all remote presences. */
  getAll(): ReadonlyMap<ClientId, PresenceState>
  /**
   * Adapter-facing: apply a remote client's presence patch. `state === null`
   * removes the remote client (they've left). Emits a 'presence' event so
   * consumers can update overlay UI.
   *
   * @internal — used by `attachSync`. Not meant for app code.
   */
  applyRemote(clientId: ClientId, state: PresenceState | null): void
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

  // undo / redo (phase 8) — local committed batches push onto an undo
  // stack capped at 50; remote and history batches don't.
  canUndo(): boolean
  canRedo(): boolean
  /** Pops the most recent local batch and applies its inverse. Returns true if anything was undone. */
  undo(): boolean
  /** Re-applies a previously-undone batch. Returns true if anything was redone. */
  redo(): boolean
  /** Drops both undo and redo stacks. Used by `fromJSON` and any reset path. */
  clearHistory(): void

  /** Per-client ephemeral *synced* state — cursor / selection / editing / color / name. */
  presence: PresenceSlice

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

  /**
   * Returns the (cached) world-space geometry for an edge — sample
   * polyline, AABB, attached-node ids, self-loop flag. Re-computes if
   * any input has changed since the last read. Used by the renderer
   * and edge hit-test. See ARCHITECTURE.md §6.12.
   */
  getEdgeGeometry(id: EdgeId): EdgeGeometry | undefined

  /**
   * Returns the edge ids incident to a given node (either endpoint
   * attaches to it). Maintained internally so it's O(1) to query when
   * a node moves and we need to refresh its edges.
   */
  getIncidentEdges(id: NodeId): EdgeId[]

  /**
   * Returns the registered NodeTypeDef for a type id, or undefined if the
   * type isn't a custom registered type (built-in shapes return undefined).
   * Used by the renderer for custom-node dispatch.
   */
  getNodeTypeDef(type: string): NodeTypeDef | undefined

  // camera + selection
  getCamera(): CameraState
  setCamera(patch: Partial<CameraState>): void
  getSelection(): (NodeId | EdgeId)[]
  setSelection(ids: (NodeId | EdgeId)[]): void

  // interaction state (§10.11)
  getInteractionState(): InteractionState
  setInteractionState(patch: Partial<InteractionState>): void
  resetInteractionState(): void

  // edit mode (phase 7) — content-bearing text edit lifecycle.
  /**
   * Enter edit mode for `id`. Selects the node and flips interaction.mode
   * to 'editing'. The renderer skips painting this node's content bitmap
   * (the editor overlay occludes it).
   */
  beginEdit(id: NodeId): void
  /**
   * Write the new content for the editing node, apply autofit (if the
   * node opts in), and exit edit mode. No-op if not editing.
   */
  commitEdit(content: string): void
  /** Exit edit mode without writing content. No-op if not editing. */
  cancelEdit(): void

  // events
  subscribe<E extends StoreEventName>(event: E, cb: StoreEventHandler<E>): Unsubscribe
}

export type { BatchId, OpBatch }
