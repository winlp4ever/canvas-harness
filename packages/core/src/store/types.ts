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
 * The single source of truth for one canvas. Mutations go through
 * typed ops (collab-ready + undoable), reads are imperative, and
 * change events drive React hooks + sync adapters.
 *
 * Created via `createCanvasStore(opts)`. See ARCHITECTURE.md §10.
 */
export interface CanvasStore {
  /** Stable id for *this* client. Generated ids embed it. */
  readonly clientId: ClientId
  /**
   * Mints a new globally-unique id. Embeds `clientId` so ids generated
   * concurrently across peers don't collide.
   *
   * @example
   * const id = asNodeId(store.generateId())
   */
  generateId(): string

  // ----- mutations ------------------------------------------------------
  // Every mutation builds an `Op`, applies it, and emits a 'change' event.
  // Wrap multiple calls in `store.batch(...)` to coalesce them into one
  // undoable batch.

  /**
   * Adds a node. Returns its id. If `node.style.autoFit !== false` and
   * `node.content` is set, height is grown to fit.
   *
   * @example
   * const id = store.addNode({
   *   id: asNodeId(store.generateId()),
   *   type: 'rect', x: 0, y: 0, w: 200, h: 100,
   *   angle: 0, z: 0, groups: [],
   * })
   */
  addNode(node: Node): NodeId

  /**
   * Patches fields on an existing node. Captures the previous slice on
   * the op so undo is free. Autofit re-runs when `content` or font
   * style fields change.
   *
   * @example
   * store.updateNode(id, { x: 100, style: { backgroundColor: '#fef9c3' } })
   */
  updateNode(id: NodeId, patch: Partial<Node>): void

  /**
   * Removes a node and cascade-removes its incident edges in the same
   * batch (so one undo restores the node + every edge that pointed to it).
   */
  removeNode(id: NodeId): void

  /** Adds an edge. Returns its id. */
  addEdge(edge: Edge): EdgeId
  /** Patches fields on an existing edge. */
  updateEdge(id: EdgeId, patch: Partial<Edge>): void
  /** Removes an edge. */
  removeEdge(id: EdgeId): void
  upsertGroup(group: Group): void
  removeGroup(id: GroupId): void

  /**
   * Collapses every mutation inside `fn` into a single `OpBatch` — one
   * undo step, one change event, one sync send.
   *
   * @example
   * store.batch(() => {
   *   for (const id of selection) store.removeNode(id as NodeId)
   * })
   */
  batch(fn: () => void): void

  /**
   * Low-level op application — usually called by sync adapters or
   * tool-use AI agents that generate ops directly.
   * `opts.origin` defaults to `'local'`. Remote/history origins skip
   * the undo stack.
   *
   * @example
   * // Apply an AI-generated op:
   * store.applyOp({ type: 'node.add', node: aiNode })
   */
  applyOp(op: Op, opts?: { origin?: OpOrigin }): void
  /** Apply an entire batch (origin lives on the batch). */
  applyBatch(batch: OpBatch): void

  // ----- undo / redo ----------------------------------------------------
  // Local committed batches push onto an undo stack capped at 50.
  // Remote / history batches don't pollute the stack.

  /** True when there's something to undo. */
  canUndo(): boolean
  /** True when there's something to redo. */
  canRedo(): boolean
  /**
   * Pops the most recent local batch and applies its inverse. Returns
   * true if anything was undone.
   *
   * @example
   * if (e.metaKey && e.key === 'z') store.undo()
   */
  undo(): boolean
  /** Re-applies a previously-undone batch. */
  redo(): boolean
  /** Drops both undo and redo stacks. Call after `fromJSON` / scene reset. */
  clearHistory(): void

  /**
   * Per-client *synced* state — cursor / selection / editing / color /
   * name. Distinct from `getInteractionState()` (which is local-only).
   *
   * @example
   * store.presence.setLocal({ name: 'Alice', color: '#ef4444' })
   */
  presence: PresenceSlice

  // ----- reads ----------------------------------------------------------
  // Imperative (no subscription). For reactive reads in React, use the
  // hooks in @canvas-harness/react.

  /** O(1) lookup; undefined if not found or removed. */
  getNode(id: NodeId): Node | undefined
  /** O(1) lookup. */
  getEdge(id: EdgeId): Edge | undefined
  /** O(1) lookup. */
  getGroup(id: GroupId): Group | undefined
  /** O(n) — materializes the full list. Use sparingly. */
  getAllNodes(): Node[]
  /** O(n) — materializes the full list. */
  getAllEdges(): Edge[]
  /** O(n) — materializes the full list. */
  getAllGroups(): Group[]
  /** O(1) count without materializing the list. */
  getNodeCount(): number
  /** O(1) count. */
  getEdgeCount(): number
  /** O(1) count. */
  getGroupCount(): number

  /**
   * Spatial query — ids of nodes + edges that intersect a rect or
   * contain a point. Backed by a uniform grid for sub-millisecond
   * queries at 10k+ entities.
   *
   * @example
   * const visible = store.querySpatial({ rect: viewport })
   */
  querySpatial(q: SpatialQuery): SpatialResult

  /**
   * Cached edge geometry — sample polyline, AABB, attached-node ids,
   * self-loop flag. Lazily recomputed when any input changes.
   */
  getEdgeGeometry(id: EdgeId): EdgeGeometry | undefined

  /**
   * Ids of every edge attached to this node (either endpoint). O(1) —
   * maintained as an inverted index internally.
   */
  getIncidentEdges(id: NodeId): EdgeId[]

  /**
   * The registered `NodeTypeDef` for a type id, or `undefined` for
   * built-in shapes. See `defineNode`.
   */
  getNodeTypeDef(type: string): NodeTypeDef | undefined

  // ----- camera + selection --------------------------------------------

  getCamera(): CameraState
  /**
   * Set camera fields (partial patch). Clamped to legal zoom range.
   *
   * @example
   * store.setCamera({ z: 1.5 })
   */
  setCamera(patch: Partial<CameraState>): void
  getSelection(): (NodeId | EdgeId)[]
  /** Replace the selection. Pass `[]` to deselect everything. */
  setSelection(ids: (NodeId | EdgeId)[]): void

  // ----- interaction state (local-only, ephemeral) ----------------------

  /** Current interaction state — mode, drag delta, marquee rect, etc. */
  getInteractionState(): InteractionState
  /** Patch fields on interaction state. Emits a 'interaction' event. */
  setInteractionState(patch: Partial<InteractionState>): void
  /** Reset to idle (clears drag / marquee / draft edge / edit mode). */
  resetInteractionState(): void

  // ----- edit mode (text + markdown content) ----------------------------

  /**
   * Enter edit mode for `id`. Polymorphic — `id` may be a {@link NodeId}
   * (to edit `node.content`) or an {@link EdgeId} (to edit
   * `edge.content`, the edge label). Flips interaction mode to
   * `'editing'`; the library's `EditorMount` picks up the change and
   * mounts the configured editor adapter at the right anchor.
   *
   * @example
   * // Double-click a node body or an edge label to edit:
   * onDoubleClick={e => {
   *   const hit = hitTestAny(store, e.world, camera.z)
   *   if (hit?.kind === 'body' && 'nodeId' in hit) store.beginEdit(hit.nodeId)
   *   if (hit?.kind === 'label') store.beginEdit(hit.edgeId)
   * }}
   */
  beginEdit(id: NodeId | EdgeId): void
  /**
   * Write the new content + apply autofit (if opted in) + exit edit
   * mode. No-op when not editing.
   */
  commitEdit(content: string): void
  /** Exit edit mode without writing content. */
  cancelEdit(): void

  // ----- events --------------------------------------------------------

  /**
   * Subscribe to a store event. Returns an unsubscribe function.
   * Events fire synchronously; subscribers must not throw.
   *
   * Events:
   *   - `'change'` — any committed batch (local / remote / history)
   *   - `'camera'` — pan or zoom
   *   - `'selection'` — selection change
   *   - `'interaction'` — interaction state change (frequent during drag)
   *   - `'presence'` — local or remote presence update
   *   - `'conflict'` — LWW conflict detected when applying a remote batch
   *
   * @example
   * const unsub = store.subscribe('change', batch => save(batch))
   */
  subscribe<E extends StoreEventName>(event: E, cb: StoreEventHandler<E>): Unsubscribe
}

export type { BatchId, OpBatch }
