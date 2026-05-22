/**
 * CanvasStore implementation — see ARCHITECTURE.md §10.
 *
 * Phase 1: typed-Op-driven mutations, signia atoms for fine-grained reactivity,
 * spatial index kept in sync, framework-agnostic.
 *
 * NOT in phase 1 (added later):
 *   - undo/redo (phase 8): the op log is built; the inverse machinery is not
 *   - presence (phase 8)
 *   - sync adapter (phase 8)
 *   - signia-based React hooks (phase 9)
 */
import { type Atom, atom, transact } from 'signia'

import {
  blobToDataUri,
  downscaleImageBlob,
  extractSvgDimensions,
  sanitizeSvg,
  toImageBlob,
  validateImageInput,
  validateSvgMarkup,
} from '../assets'
import { DEFAULT_CAMERA } from '../camera'
import { type EdgeGeometry, EdgeGeometryCache } from '../edges/cache'
import { shouldAutoFit, withAutoFitHeight } from '../edit/auto-fit'
import { type IdGenerator, makeIdGenerator, randomClientId } from '../ids'
import { UniformGrid, nodeAABB } from '../spatial'
import { SCHEMA_VERSION, asBatchId, asNodeId, isAttached } from '../types'
import type {
  CameraState,
  ClientId,
  Edge,
  EdgeId,
  Group,
  GroupId,
  IconNodeData,
  ImageNodeData,
  Node,
  NodeId,
  Op,
  OpBatch,
  Scene,
  Style,
} from '../types'
import { detectConflicts } from './conflict'
import { type InteractionState, idleInteractionState } from './interaction'
import { inverseBatch } from './inverse-op'
import { type PresencePatch, type PresenceState, emptyPresenceState } from './presence'
import type {
  CanvasStore,
  OpOrigin,
  SpatialQuery,
  SpatialResult,
  StoreEventHandler,
  StoreEventName,
  StoreEvents,
  StoreOptions,
  Unsubscribe,
} from './types'

const EMPTY_SCENE = (): Scene => ({
  schemaVersion: SCHEMA_VERSION,
  nodes: {},
  edges: {},
  groups: {},
  camera: DEFAULT_CAMERA,
  selection: [],
})

/**
 * Creates a new canvas store. One per scene / document. Pass into
 * `<CanvasProvider>` (React) or use the imperative API directly.
 *
 * @example
 * // Minimal
 * const store = createCanvasStore()
 *
 * @example
 * // With custom node types + a hydrated scene from JSON
 * const store = createCanvasStore({
 *   nodeTypes: [chartCardDef, todoCardDef],
 *   initial: fromSerialized(savedScene),
 * })
 */
/**
 * Index of the first entry strictly greater than `target`, or -1 if
 * none. Assumes `arr` is sorted ascending. Used by bringForward to
 * find the immediate-above neighbour's z.
 */
const binaryFirstGreater = (arr: number[], target: number): number => {
  let lo = 0
  let hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (arr[mid]! <= target) lo = mid + 1
    else hi = mid
  }
  return lo < arr.length ? lo : -1
}

/**
 * Index of the last entry strictly less than `target`, or -1 if none.
 * Used by sendBackward.
 */
const binaryLastLess = (arr: number[], target: number): number => {
  let lo = 0
  let hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (arr[mid]! < target) lo = mid + 1
    else hi = mid
  }
  return lo > 0 ? lo - 1 : -1
}

export const createCanvasStore = (opts: StoreOptions = {}): CanvasStore => {
  const clientId: ClientId = opts.clientId ?? randomClientId()
  const idGenerator: IdGenerator = opts.idGenerator ?? makeIdGenerator(clientId)
  const initial = opts.initial ?? EMPTY_SCENE()

  // ---- reactive state ----------------------------------------------------
  // One atom per entity gives us fine-grained subscriptions. The id-list
  // atoms drive iteration; the spatial index drives viewport queries.

  const nodeAtoms = new Map<NodeId, Atom<Node>>()
  const edgeAtoms = new Map<EdgeId, Atom<Edge>>()
  const groupAtoms = new Map<GroupId, Atom<Group>>()

  const nodeIdsAtom = atom<NodeId[]>('nodeIds', [])
  const edgeIdsAtom = atom<EdgeId[]>('edgeIds', [])
  const groupIdsAtom = atom<GroupId[]>('groupIds', [])

  const cameraAtom = atom<CameraState>('camera', initial.camera)
  const selectionAtom = atom<(NodeId | EdgeId)[]>('selection', initial.selection)
  // Presentation order for frame-typed nodes. Auto-maintained on
  // node.add (push) / node.remove (filter); explicitly mutated via the
  // `frame.reorder` op. See types/scene.ts.
  const frameOrderAtom = atom<NodeId[]>('frameOrder', initial.frameOrder ?? [])
  const interactionAtom = atom<InteractionState>('interaction', idleInteractionState())
  const localPresenceAtom = atom<PresenceState>('presence', emptyPresenceState(clientId))
  const remotePresence = new Map<ClientId, PresenceState>()

  const nodeIndex = new UniformGrid()
  const edgeIndex = new UniformGrid()
  const edgeGeoCache = new EdgeGeometryCache()

  // Custom node type registry — keyed by NodeTypeDef.type.
  const nodeTypeRegistry = new Map<string, import('../node-types').NodeTypeDef>()
  for (const def of opts.nodeTypes ?? []) {
    nodeTypeRegistry.set(def.type, def)
  }

  // Per-edge integer version. Bumped on edge.add/update and on node.update
  // for incident edges. Drives the EdgeGeometryCache invalidation without
  // having to compare full-state strings. See ARCHITECTURE.md §6.12.
  const edgeVersions = new Map<EdgeId, number>()
  const bumpEdgeVersion = (id: EdgeId): void => {
    edgeVersions.set(id, (edgeVersions.get(id) ?? 0) + 1)
  }

  // incidentEdges: nodeId -> set of edgeIds. Used by reindexEdge when a
  // node moves (to refresh all its edges' AABBs in the spatial index) and
  // by removeNode to cascade-delete attached edges.
  const incidentEdges = new Map<NodeId, Set<EdgeId>>()

  // Running ceiling of node + edge z values. New entities created without
  // an explicit z get `++topZ`, putting them above everything else
  // (matches Figma / Excalidraw defaults). Monotonic; never decremented
  // — reordering ops bump it as needed. Initialized from `initial` so
  // hydration from a saved scene doesn't restart the counter.
  let topZ = 0
  for (const n of Object.values(initial.nodes) as Node[]) if (n.z > topZ) topZ = n.z
  for (const e of Object.values(initial.edges) as Edge[]) if (e.z > topZ) topZ = e.z

  const getNodeForGeo = (id: NodeId): Node | undefined => nodeAtoms.get(id)?.value

  // ---- batching ----------------------------------------------------------
  let currentBatchOps: Op[] | null = null
  let batchDepth = 0

  const startBatch = (): void => {
    if (batchDepth === 0) currentBatchOps = []
    batchDepth++
  }

  const endBatch = (): OpBatch | null => {
    batchDepth--
    if (batchDepth > 0) return null
    const ops = currentBatchOps ?? []
    currentBatchOps = null
    if (ops.length === 0) return null
    return {
      id: asBatchId(idGenerator()),
      clientId,
      ts: Date.now(),
      origin: 'local',
      ops,
    }
  }

  // ---- undo / redo stacks ------------------------------------------------
  // Local committed batches push onto undoStack; redoStack is cleared on
  // any fresh local op (the standard "branching" rule). Remote and history
  // batches do not push to undoStack — see emitChange below. Cap at 50.
  const UNDO_STACK_CAP = 50
  const undoStack: OpBatch[] = []
  const redoStack: OpBatch[] = []

  // ---- event bus ---------------------------------------------------------
  type Subscribers = { [E in StoreEventName]: Set<StoreEventHandler<E>> }
  const subscribers: Subscribers = {
    change: new Set(),
    camera: new Set(),
    selection: new Set(),
    interaction: new Set(),
    presence: new Set(),
    conflict: new Set(),
  }
  const emit = <E extends StoreEventName>(event: E, payload: StoreEvents[E]): void => {
    for (const cb of subscribers[event]) cb(payload)
  }

  /**
   * Single entry point for 'change' emission. Centralizes the undo-stack
   * bookkeeping so every call site (enqueueOp, removeNode cascade,
   * applyOp, applyBatch) gets it for free. Only `origin: 'local'`
   * batches enter the undo stack; remote and history batches don't.
   */
  const emitChange = (batch: OpBatch): void => {
    if (batch.origin === 'local') {
      undoStack.push(batch)
      if (undoStack.length > UNDO_STACK_CAP) undoStack.shift()
      // A fresh local op invalidates any redo branch.
      redoStack.length = 0
    }
    emit('change', batch)
  }

  // ---- spatial-index helpers --------------------------------------------
  const reindexNode = (node: Node): void => {
    nodeIndex.insert(node.id, nodeAABB(node))
  }
  const reindexEdge = (edge: Edge): void => {
    const version = edgeVersions.get(edge.id) ?? 0
    const geom = edgeGeoCache.get(edge, version, getNodeForGeo)
    if (geom) {
      edgeIndex.insert(edge.id, geom.aabb)
    } else {
      // Edge references a missing node; remove from index until things settle.
      edgeIndex.remove(edge.id)
    }
  }
  const unindexNode = (id: NodeId): void => {
    nodeIndex.remove(id)
  }
  const unindexEdge = (id: EdgeId): void => {
    edgeIndex.remove(id)
    edgeGeoCache.delete(id)
  }

  const trackIncidence = (edge: Edge): void => {
    for (const end of [edge.source, edge.target]) {
      if (isAttached(end)) {
        let s = incidentEdges.get(end.nodeId)
        if (!s) {
          s = new Set()
          incidentEdges.set(end.nodeId, s)
        }
        s.add(edge.id)
      }
    }
  }
  const untrackIncidence = (edge: Edge): void => {
    for (const end of [edge.source, edge.target]) {
      if (isAttached(end)) {
        incidentEdges.get(end.nodeId)?.delete(edge.id)
      }
    }
  }

  // ---- op application (internal, no event emission per-op) ---------------
  const applyOpInternal = (op: Op): void => {
    switch (op.type) {
      case 'node.add': {
        const a = atom<Node>(`node:${op.node.id}`, op.node)
        nodeAtoms.set(op.node.id, a)
        nodeIdsAtom.update(ids => [...ids, op.node.id])
        reindexNode(op.node)
        if (op.node.type === 'frame') {
          frameOrderAtom.update(ids => (ids.includes(op.node.id) ? ids : [...ids, op.node.id]))
        }
        break
      }
      case 'node.update': {
        const a = nodeAtoms.get(op.id)
        if (!a) return
        const next = { ...a.value, ...op.patch }
        a.set(next)
        reindexNode(next)
        // Edges whose endpoint is on this node now have stale geometry.
        // Bump each incident edge's version so the cache invalidates.
        const incident = incidentEdges.get(op.id)
        if (incident) {
          for (const eid of incident) {
            bumpEdgeVersion(eid)
            const e = edgeAtoms.get(eid)
            if (e) reindexEdge(e.value)
          }
        }
        break
      }
      case 'node.remove': {
        const id = op.node.id
        nodeAtoms.delete(id)
        nodeIdsAtom.update(ids => ids.filter(x => x !== id))
        unindexNode(id)
        incidentEdges.delete(id)
        if (op.node.type === 'frame') {
          frameOrderAtom.update(ids => ids.filter(x => x !== id))
        }
        break
      }
      case 'edge.add': {
        const a = atom<Edge>(`edge:${op.edge.id}`, op.edge)
        edgeAtoms.set(op.edge.id, a)
        edgeIdsAtom.update(ids => [...ids, op.edge.id])
        trackIncidence(op.edge)
        bumpEdgeVersion(op.edge.id)
        reindexEdge(op.edge)
        break
      }
      case 'edge.update': {
        const a = edgeAtoms.get(op.id)
        if (!a) return
        const prev = a.value
        const next = { ...prev, ...op.patch }
        untrackIncidence(prev)
        trackIncidence(next)
        a.set(next)
        bumpEdgeVersion(op.id)
        reindexEdge(next)
        break
      }
      case 'edge.remove': {
        const id = op.edge.id
        const a = edgeAtoms.get(id)
        if (a) untrackIncidence(a.value)
        edgeAtoms.delete(id)
        edgeIdsAtom.update(ids => ids.filter(x => x !== id))
        edgeVersions.delete(id)
        unindexEdge(id)
        break
      }
      case 'group.upsert': {
        const existing = groupAtoms.get(op.group.id)
        if (existing) {
          existing.set(op.group)
        } else {
          groupAtoms.set(op.group.id, atom(`group:${op.group.id}`, op.group))
          groupIdsAtom.update(ids => [...ids, op.group.id])
        }
        break
      }
      case 'group.remove': {
        const id = op.group.id
        groupAtoms.delete(id)
        groupIdsAtom.update(ids => ids.filter(x => x !== id))
        break
      }
      case 'frame.reorder': {
        frameOrderAtom.set([...op.ids])
        break
      }
    }
  }

  // ---- public surface ----------------------------------------------------
  const enqueueOp = (op: Op): void => {
    if (currentBatchOps === null) {
      // single-op outside batch — wrap in implicit batch for consistency
      startBatch()
      currentBatchOps!.push(op)
      applyOpInternal(op)
      const batch = endBatch()
      if (batch) emitChange(batch)
    } else {
      currentBatchOps.push(op)
      applyOpInternal(op)
    }
  }

  const slicePrev = <T>(current: T, patch: Partial<T>): Partial<T> => {
    const prev: Partial<T> = {}
    for (const key of Object.keys(patch) as (keyof T)[]) {
      prev[key] = current[key]
    }
    return prev
  }

  // hoisted because applyOp/applyBatch and the public methods both need them
  const populateInitial = (scene: Scene): void => {
    // If the scene didn't carry an explicit frameOrder (older saves),
    // derive it from iteration order over frame-typed nodes so the
    // store has a usable order from the first frame the consumer asks
    // for. The explicit `scene.frameOrder` (when present) wins.
    const seededFrameOrder: NodeId[] = []
    for (const id of Object.keys(scene.nodes)) {
      const node = scene.nodes[id as NodeId]
      if (!node) continue
      const a = atom<Node>(`node:${node.id}`, node)
      nodeAtoms.set(node.id, a)
      nodeIdsAtom.update(ids => [...ids, node.id])
      reindexNode(node)
      if (node.type === 'frame') seededFrameOrder.push(node.id)
    }
    if (!scene.frameOrder) frameOrderAtom.set(seededFrameOrder)
    for (const id of Object.keys(scene.edges)) {
      const edge = scene.edges[id as EdgeId]
      if (!edge) continue
      const a = atom<Edge>(`edge:${edge.id}`, edge)
      edgeAtoms.set(edge.id, a)
      edgeIdsAtom.update(ids => [...ids, edge.id])
      trackIncidence(edge)
      bumpEdgeVersion(edge.id)
      reindexEdge(edge)
    }
    for (const id of Object.keys(scene.groups)) {
      const group = scene.groups[id as GroupId]
      if (!group) continue
      groupAtoms.set(group.id, atom(`group:${group.id}`, group))
      groupIdsAtom.update(ids => [...ids, group.id])
    }
  }

  populateInitial(initial)

  const store: CanvasStore = {
    clientId,
    generateId: () => idGenerator(),

    addNode(node) {
      // Auto-top z when not explicitly specified — newly created nodes
      // sit above everything else (Figma / Excalidraw default).
      // Convention: `z === 0` (the Node type's default) means
      // "auto-assign." Callers who explicitly want bottom can pass a
      // negative value; callers who want a specific layer can pass any
      // positive value.
      const withZ = node.z === 0 ? { ...node, z: ++topZ } : node
      if (withZ.z > topZ) topZ = withZ.z
      const fitted = withAutoFitHeight(withZ)
      enqueueOp({ type: 'node.add', node: fitted })
      return fitted.id
    },
    updateNode(id, patch) {
      const current = nodeAtoms.get(id)?.value
      if (!current) return
      let resolvedPatch = patch
      // Auto-fit on commit-boundary fields: content (commitEdit) or font
      // style (StylePanel applies). Width changes from a resize stream
      // deliberately do NOT trigger autofit — that would override the
      // user's drag mid-stream. Resize-commit refits explicitly.
      const next = { ...current, ...patch }
      const styleChanged =
        patch.style &&
        (patch.style.fontFamily !== undefined ||
          patch.style.fontSize !== undefined ||
          patch.style.textStyle !== undefined)
      if (shouldAutoFit(next) && (patch.content !== undefined || styleChanged)) {
        const fitted = withAutoFitHeight(next)
        if (fitted.h !== next.h) {
          resolvedPatch = { ...patch, h: fitted.h }
        }
      }
      enqueueOp({
        type: 'node.update',
        id,
        patch: resolvedPatch,
        prev: slicePrev(current, resolvedPatch),
      })
    },
    removeNode(id) {
      const node = nodeAtoms.get(id)?.value
      if (!node) return
      transact(() => {
        startBatch()
        // cascade-remove incident edges first; phase 8 will surface a config knob
        const incident = incidentEdges.get(id)
        if (incident) {
          for (const eid of [...incident]) {
            const edge = edgeAtoms.get(eid)?.value
            if (edge) {
              currentBatchOps!.push({ type: 'edge.remove', edge })
              applyOpInternal({ type: 'edge.remove', edge })
            }
          }
        }
        currentBatchOps!.push({ type: 'node.remove', node })
        applyOpInternal({ type: 'node.remove', node })
        const batch = endBatch()
        if (batch) emitChange(batch)
      })
    },

    async addImage(opts) {
      validateImageInput(opts.src)
      const rawBlob = await toImageBlob(opts.src)
      const maxDim = opts.maxDimension ?? 2048
      const { blob, naturalW, naturalH } = await downscaleImageBlob(rawBlob, maxDim)
      const src = await blobToDataUri(blob)
      // Default sizing: natural dimensions clamped to 400 px on the
      // longer side so a screen-filling node isn't created from a big
      // image. Aspect ratio is preserved.
      const DEFAULT_MAX_NODE_SIDE = 400
      const aspectScale = Math.min(1, DEFAULT_MAX_NODE_SIDE / Math.max(naturalW, naturalH))
      const w = opts.w ?? Math.max(1, Math.round(naturalW * aspectScale))
      const h = opts.h ?? Math.max(1, Math.round(naturalH * aspectScale))
      const id = asNodeId(idGenerator())
      this.addNode({
        id,
        type: 'image',
        x: opts.x,
        y: opts.y,
        w,
        h,
        angle: 0,
        z: 0,
        groups: [],
        style: opts.style,
        data: { src, naturalW, naturalH, alt: opts.alt } satisfies ImageNodeData,
      })
      return id
    },
    async addSvg(opts) {
      validateSvgMarkup(opts.src)
      const sanitized = sanitizeSvg(opts.src)
      const intrinsic = extractSvgDimensions(sanitized)
      const w = opts.w ?? intrinsic.w
      const h = opts.h ?? intrinsic.h
      const mergedStyle: Style | undefined =
        opts.color || opts.style
          ? { ...(opts.color ? { iconColor: opts.color } : {}), ...opts.style }
          : undefined
      const id = asNodeId(idGenerator())
      this.addNode({
        id,
        type: 'icon',
        x: opts.x,
        y: opts.y,
        w,
        h,
        angle: 0,
        z: 0,
        groups: [],
        ...(mergedStyle ? { style: mergedStyle } : {}),
        data: { src: sanitized, alt: opts.alt } satisfies IconNodeData,
      })
      return id
    },

    addEdge(edge) {
      const withZ = edge.z === 0 ? { ...edge, z: ++topZ } : edge
      if (withZ.z > topZ) topZ = withZ.z
      enqueueOp({ type: 'edge.add', edge: withZ })
      return withZ.id
    },
    updateEdge(id, patch) {
      const current = edgeAtoms.get(id)?.value
      if (!current) return
      enqueueOp({ type: 'edge.update', id, patch, prev: slicePrev(current, patch) })
    },
    removeEdge(id) {
      const edge = edgeAtoms.get(id)?.value
      if (!edge) return
      enqueueOp({ type: 'edge.remove', edge })
    },

    bringToFront(ids) {
      this.batch(() => {
        for (const id of ids) {
          if (nodeAtoms.has(id as NodeId)) this.updateNode(id as NodeId, { z: ++topZ })
          else if (edgeAtoms.has(id as EdgeId)) this.updateEdge(id as EdgeId, { z: ++topZ })
        }
      })
    },
    sendToBack(ids) {
      // Find the minimum z across all nodes + edges (excluding the
      // targets themselves), then place each target below that. We do
      // a single scan rather than maintain a `bottomZ` counter because
      // sendToBack is rare; the scan is O(n) per call and dominated by
      // the user gesture, not the frame budget.
      const targets = new Set<string>(ids as string[])
      let minZ = 0
      let initialized = false
      for (const a of nodeAtoms.values()) {
        if (targets.has(a.value.id)) continue
        if (!initialized || a.value.z < minZ) {
          minZ = a.value.z
          initialized = true
        }
      }
      for (const a of edgeAtoms.values()) {
        if (targets.has(a.value.id)) continue
        if (!initialized || a.value.z < minZ) {
          minZ = a.value.z
          initialized = true
        }
      }
      this.batch(() => {
        // Step the new z down per item so multi-select preserves
        // relative order (first selected stays on top of next).
        let next = (initialized ? minZ : 0) - 1
        for (const id of ids) {
          if (nodeAtoms.has(id as NodeId)) this.updateNode(id as NodeId, { z: next })
          else if (edgeAtoms.has(id as EdgeId)) this.updateEdge(id as EdgeId, { z: next })
          next -= 1
        }
      })
    },
    bringForward(ids) {
      // For each target, find the next-higher z among non-targets and
      // step the target above it. Self-stable: targets keep their
      // relative order if they're all moved past the same neighbour.
      const targets = new Set<string>(ids as string[])
      const allZ: number[] = []
      for (const a of nodeAtoms.values()) if (!targets.has(a.value.id)) allZ.push(a.value.z)
      for (const a of edgeAtoms.values()) if (!targets.has(a.value.id)) allZ.push(a.value.z)
      allZ.sort((a, b) => a - b)
      this.batch(() => {
        for (const id of ids) {
          const node = nodeAtoms.get(id as NodeId)?.value
          const edge = node ? null : edgeAtoms.get(id as EdgeId)?.value
          const currentZ = node?.z ?? edge?.z
          if (currentZ === undefined) continue
          // Smallest non-target z strictly greater than currentZ.
          const idx = binaryFirstGreater(allZ, currentZ)
          const nextZ = idx >= 0 ? allZ[idx]! + 1 : currentZ + 1
          if (nextZ > topZ) topZ = nextZ
          if (node) this.updateNode(id as NodeId, { z: nextZ })
          else this.updateEdge(id as EdgeId, { z: nextZ })
        }
      })
    },
    sendBackward(ids) {
      const targets = new Set<string>(ids as string[])
      const allZ: number[] = []
      for (const a of nodeAtoms.values()) if (!targets.has(a.value.id)) allZ.push(a.value.z)
      for (const a of edgeAtoms.values()) if (!targets.has(a.value.id)) allZ.push(a.value.z)
      allZ.sort((a, b) => a - b)
      this.batch(() => {
        for (const id of ids) {
          const node = nodeAtoms.get(id as NodeId)?.value
          const edge = node ? null : edgeAtoms.get(id as EdgeId)?.value
          const currentZ = node?.z ?? edge?.z
          if (currentZ === undefined) continue
          // Largest non-target z strictly less than currentZ.
          const idx = binaryLastLess(allZ, currentZ)
          const nextZ = idx >= 0 ? allZ[idx]! - 1 : currentZ - 1
          if (node) this.updateNode(id as NodeId, { z: nextZ })
          else this.updateEdge(id as EdgeId, { z: nextZ })
        }
      })
    },

    upsertGroup(group) {
      const prev = groupAtoms.get(group.id)?.value
      enqueueOp({ type: 'group.upsert', group, prev })
    },
    removeGroup(id) {
      const group = groupAtoms.get(id)?.value
      if (!group) return
      enqueueOp({ type: 'group.remove', group })
    },

    batch(fn) {
      transact(() => {
        startBatch()
        try {
          fn()
        } finally {
          const batch = endBatch()
          if (batch) emitChange(batch)
        }
      })
    },

    applyOp(op, applyOpts) {
      const origin: OpOrigin = applyOpts?.origin ?? 'local'
      if (origin !== 'local') {
        // remote / history ops bypass the local batch buffer; emit their own
        applyOpInternal(op)
        emitChange({
          id: asBatchId(idGenerator()),
          clientId,
          ts: Date.now(),
          origin,
          ops: [op],
        })
        return
      }
      enqueueOp(op)
    },

    applyBatch(b) {
      transact(() => {
        // Conflict detection runs BEFORE apply — the remote op's `prev`
        // slice describes what the remote client expected; once we apply
        // we lose the chance to compare. LWW still wins (we apply
        // regardless), but consumers get a 'conflict' event for UX.
        if (b.origin === 'remote') {
          const conflicts = detectConflicts(
            b,
            id => nodeAtoms.get(id)?.value,
            id => edgeAtoms.get(id)?.value,
          )
          if (conflicts.length > 0) emit('conflict', { batch: b, conflicts })
        }
        for (const op of b.ops) applyOpInternal(op)
        emitChange(b)
      })
    },

    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    undo() {
      const batch = undoStack.pop()
      if (!batch) return false
      const ops = inverseBatch(batch)
      const inverseB: OpBatch = {
        id: asBatchId(idGenerator()),
        clientId,
        ts: Date.now(),
        origin: 'history',
        ops,
      }
      transact(() => {
        for (const op of ops) applyOpInternal(op)
        emit('change', inverseB) // bypass emitChange — history doesn't push
      })
      redoStack.push(batch)
      return true
    },
    redo() {
      const batch = redoStack.pop()
      if (!batch) return false
      // Replay with history origin so the inverse machinery stays clean,
      // and the redo batch goes back onto the undo stack so the user can
      // undo it again.
      const redoB: OpBatch = { ...batch, origin: 'history' }
      transact(() => {
        for (const op of redoB.ops) applyOpInternal(op)
        emit('change', redoB)
      })
      undoStack.push(batch)
      return true
    },
    clearHistory() {
      undoStack.length = 0
      redoStack.length = 0
    },

    // reads
    getNode: id => nodeAtoms.get(id)?.value,
    getEdge: id => edgeAtoms.get(id)?.value,
    getGroup: id => groupAtoms.get(id)?.value,
    getAllNodes: () => nodeIdsAtom.value.map(id => nodeAtoms.get(id)!.value),
    getAllEdges: () => edgeIdsAtom.value.map(id => edgeAtoms.get(id)!.value),
    getAllGroups: () => groupIdsAtom.value.map(id => groupAtoms.get(id)!.value),
    getNodeCount: () => nodeIdsAtom.value.length,
    getEdgeCount: () => edgeIdsAtom.value.length,
    getGroupCount: () => groupIdsAtom.value.length,

    getFrames: () => {
      const out: Node[] = []
      for (const id of frameOrderAtom.value) {
        const n = nodeAtoms.get(id)?.value
        if (n && n.type === 'frame') out.push(n)
      }
      return out
    },
    setFrameOrder(ids: NodeId[]) {
      const valid = new Set<NodeId>()
      for (const a of nodeAtoms.values()) {
        if (a.value.type === 'frame') valid.add(a.value.id)
      }
      // Drop ids that aren't (or no longer are) frames; append any
      // frames the caller forgot so the order remains a permutation
      // of the actual frame set.
      const filtered: NodeId[] = []
      const seen = new Set<NodeId>()
      for (const id of ids) {
        if (valid.has(id) && !seen.has(id)) {
          filtered.push(id)
          seen.add(id)
        }
      }
      for (const id of valid) {
        if (!seen.has(id)) filtered.push(id)
      }
      const prev = [...frameOrderAtom.value]
      // No-op short-circuit.
      if (filtered.length === prev.length && filtered.every((id, i) => id === prev[i])) {
        return
      }
      enqueueOp({ type: 'frame.reorder', ids: filtered, prev })
    },
    getNodesInFrame(id: NodeId) {
      const frame = nodeAtoms.get(id)?.value
      if (!frame || frame.type !== 'frame') return []
      const frameAabb = nodeAABB(frame)
      // Spatial broad-phase: any node intersecting the frame's AABB
      // is a candidate. Then filter to "fully inside" — node's AABB
      // entirely contained by the frame's AABB.
      const candidates = nodeIndex.queryRect(frameAabb) as NodeId[]
      const out: Node[] = []
      for (const cid of candidates) {
        if (cid === id) continue
        const node = nodeAtoms.get(cid)?.value
        if (!node || node.type === 'frame') continue
        const a = nodeAABB(node)
        if (
          a.x >= frameAabb.x &&
          a.y >= frameAabb.y &&
          a.x + a.w <= frameAabb.x + frameAabb.w &&
          a.y + a.h <= frameAabb.y + frameAabb.h
        ) {
          out.push(node)
        }
      }
      return out
    },

    getEdgeGeometry(id: EdgeId): EdgeGeometry | undefined {
      const edge = edgeAtoms.get(id)?.value
      if (!edge) return undefined
      const version = edgeVersions.get(id) ?? 0
      return edgeGeoCache.get(edge, version, getNodeForGeo) ?? undefined
    },
    getIncidentEdges(id: NodeId): EdgeId[] {
      const set = incidentEdges.get(id)
      return set ? [...set] : []
    },
    getNodeTypeDef(type: string) {
      return nodeTypeRegistry.get(type)
    },

    querySpatial(q: SpatialQuery): SpatialResult {
      const rect = q.rect ?? (q.point ? { x: q.point.x, y: q.point.y, w: 0, h: 0 } : null)
      if (!rect) return { nodes: [], edges: [] }
      return {
        nodes: nodeIndex.queryRect(rect) as NodeId[],
        edges: edgeIndex.queryRect(rect) as EdgeId[],
      }
    },

    getCamera: () => cameraAtom.value,
    setCamera(patch) {
      const next: CameraState = { ...cameraAtom.value, ...patch }
      cameraAtom.set(next)
      emit('camera', next)
    },

    getSelection: () => selectionAtom.value,
    setSelection(ids) {
      selectionAtom.set(ids)
      emit('selection', ids)
    },

    getInteractionState: () => interactionAtom.value,
    setInteractionState(patch) {
      const next: InteractionState = { ...interactionAtom.value, ...patch }
      interactionAtom.set(next)
      emit('interaction', next)
    },
    resetInteractionState() {
      const next = idleInteractionState()
      interactionAtom.set(next)
      emit('interaction', next)
    },

    beginEdit(id) {
      // Polymorphic: id may belong to a node or an edge. Resolve which.
      let target: import('./interaction').EditTarget | null = null
      if (nodeAtoms.has(id as NodeId)) target = { kind: 'node', id: id as NodeId }
      else if (edgeAtoms.has(id as EdgeId)) target = { kind: 'edge', id: id as EdgeId }
      if (!target) return
      const next: InteractionState = {
        ...interactionAtom.value,
        mode: 'editing',
        editingTarget: target,
      }
      interactionAtom.set(next)
      emit('interaction', next)
    },
    commitEdit(content) {
      const state = interactionAtom.value
      if (state.mode !== 'editing' || !state.editingTarget) return
      const target = state.editingTarget
      // Write content + autofit-derived height in one update so the
      // bitmap cache sees the final geometry on the next paint, not an
      // intermediate one.
      if (target.kind === 'node') this.updateNode(target.id, { content })
      else this.updateEdge(target.id, { content })
      const idleState = { ...interactionAtom.value, mode: 'idle' as const, editingTarget: null }
      interactionAtom.set(idleState)
      emit('interaction', idleState)
    },
    cancelEdit() {
      const state = interactionAtom.value
      if (state.mode !== 'editing') return
      const idleState = { ...state, mode: 'idle' as const, editingTarget: null }
      interactionAtom.set(idleState)
      emit('interaction', idleState)
    },

    presence: {
      setLocal(patch: PresencePatch) {
        const next: PresenceState = { ...localPresenceAtom.value, ...patch }
        localPresenceAtom.set(next)
        emit('presence', { state: next })
      },
      getLocal: () => localPresenceAtom.value,
      get: (id: ClientId) => remotePresence.get(id),
      getAll: () => remotePresence,
      applyRemote(id: ClientId, state: PresenceState | null) {
        if (state === null) {
          if (remotePresence.delete(id)) emit('presence', { clientId: id, removed: true })
          return
        }
        remotePresence.set(id, state)
        emit('presence', { state })
      },
    },

    subscribe<E extends StoreEventName>(event: E, cb: StoreEventHandler<E>): Unsubscribe {
      subscribers[event].add(cb)
      return () => {
        subscribers[event].delete(cb)
      }
    },
  }

  return store
}
