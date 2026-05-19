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

import { DEFAULT_CAMERA } from '../camera'
import { type IdGenerator, makeIdGenerator, randomClientId } from '../ids'
import { UniformGrid, nodeAABB } from '../spatial'
import { SCHEMA_VERSION, asBatchId, isAttached } from '../types'
import type {
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
  Scene,
  Vec2,
  WorldRect,
} from '../types'
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
 * Approximate AABB for an edge — enough for the spatial index in phase 1.
 * Phase 4 (edge system) replaces this with bezier-sample bounds + padding.
 */
const edgeAABB = (edge: Edge, getNodeBounds: (id: NodeId) => WorldRect | null): WorldRect => {
  const ends: Vec2[] = []
  for (const end of [edge.source, edge.target]) {
    if (isAttached(end)) {
      const b = getNodeBounds(end.nodeId)
      if (b) {
        // crude: use the node's AABB top-left + localOffset
        ends.push({ x: b.x + end.localOffset.x, y: b.y + end.localOffset.y })
      }
    } else {
      ends.push(end.worldPoint)
    }
  }
  if (ends.length === 0) return { x: 0, y: 0, w: 0, h: 0 }
  if (ends.length === 1) {
    const p = ends[0]!
    return { x: p.x - 4, y: p.y - 4, w: 8, h: 8 }
  }
  const a = ends[0]!
  const b = ends[1]!
  const x = Math.min(a.x, b.x) - 4
  const y = Math.min(a.y, b.y) - 4
  const w = Math.abs(b.x - a.x) + 8
  const h = Math.abs(b.y - a.y) + 8
  return { x, y, w, h }
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

  const nodeIndex = new UniformGrid()
  const edgeIndex = new UniformGrid()

  // incidentEdges: nodeId -> set of edgeIds. Phase 4 uses this heavily for
  // invalidation when nodes move; phase 1 maintains it so removeNode cascades.
  const incidentEdges = new Map<NodeId, Set<EdgeId>>()

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

  // ---- event bus ---------------------------------------------------------
  type Subscribers = { [E in StoreEventName]: Set<StoreEventHandler<E>> }
  const subscribers: Subscribers = {
    change: new Set(),
    camera: new Set(),
    selection: new Set(),
  }
  const emit = <E extends StoreEventName>(event: E, payload: StoreEvents[E]): void => {
    for (const cb of subscribers[event]) cb(payload)
  }

  // ---- spatial-index helpers --------------------------------------------
  const reindexNode = (node: Node): void => {
    nodeIndex.insert(node.id, nodeAABB(node))
  }
  const reindexEdge = (edge: Edge): void => {
    edgeIndex.insert(
      edge.id,
      edgeAABB(edge, id => nodeIndex.getAABB(id) ?? null),
    )
  }
  const unindexNode = (id: NodeId): void => {
    nodeIndex.remove(id)
  }
  const unindexEdge = (id: EdgeId): void => {
    edgeIndex.remove(id)
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
        break
      }
      case 'node.update': {
        const a = nodeAtoms.get(op.id)
        if (!a) return
        const next = { ...a.value, ...op.patch }
        a.set(next)
        reindexNode(next)
        // edges whose endpoint is on this node may now have stale AABBs
        const incident = incidentEdges.get(op.id)
        if (incident) {
          for (const eid of incident) {
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
        break
      }
      case 'edge.add': {
        const a = atom<Edge>(`edge:${op.edge.id}`, op.edge)
        edgeAtoms.set(op.edge.id, a)
        edgeIdsAtom.update(ids => [...ids, op.edge.id])
        trackIncidence(op.edge)
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
        reindexEdge(next)
        break
      }
      case 'edge.remove': {
        const id = op.edge.id
        const a = edgeAtoms.get(id)
        if (a) untrackIncidence(a.value)
        edgeAtoms.delete(id)
        edgeIdsAtom.update(ids => ids.filter(x => x !== id))
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
      if (batch) emit('change', batch)
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
    for (const id of Object.keys(scene.nodes)) {
      const node = scene.nodes[id as NodeId]
      if (!node) continue
      const a = atom<Node>(`node:${node.id}`, node)
      nodeAtoms.set(node.id, a)
      nodeIdsAtom.update(ids => [...ids, node.id])
      reindexNode(node)
    }
    for (const id of Object.keys(scene.edges)) {
      const edge = scene.edges[id as EdgeId]
      if (!edge) continue
      const a = atom<Edge>(`edge:${edge.id}`, edge)
      edgeAtoms.set(edge.id, a)
      edgeIdsAtom.update(ids => [...ids, edge.id])
      trackIncidence(edge)
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
      enqueueOp({ type: 'node.add', node })
      return node.id
    },
    updateNode(id, patch) {
      const current = nodeAtoms.get(id)?.value
      if (!current) return
      enqueueOp({ type: 'node.update', id, patch, prev: slicePrev(current, patch) })
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
        if (batch) emit('change', batch)
      })
    },

    addEdge(edge) {
      enqueueOp({ type: 'edge.add', edge })
      return edge.id
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
          if (batch) emit('change', batch)
        }
      })
    },

    applyOp(op, applyOpts) {
      const origin: OpOrigin = applyOpts?.origin ?? 'local'
      if (origin !== 'local') {
        // remote / history ops bypass the local batch buffer; emit their own
        applyOpInternal(op)
        emit('change', {
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
        for (const op of b.ops) applyOpInternal(op)
        emit('change', b)
      })
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

    subscribe<E extends StoreEventName>(event: E, cb: StoreEventHandler<E>): Unsubscribe {
      subscribers[event].add(cb)
      return () => {
        subscribers[event].delete(cb)
      }
    },
  }

  return store
}
