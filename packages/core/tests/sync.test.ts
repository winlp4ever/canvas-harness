import { describe, expect, test, vi } from 'vitest'
import {
  type Edge,
  type Node,
  type OpBatch,
  type SyncAdapter,
  asClientId,
  asEdgeId,
  asNodeId,
  attachSync,
  createCanvasStore,
  detectConflicts,
  inverseBatch,
  inverseOp,
} from '../src'

const makeNode = (overrides: Partial<Node> = {}): Node => ({
  id: asNodeId('n-1'),
  type: 'rect',
  x: 0,
  y: 0,
  w: 100,
  h: 100,
  angle: 0,
  z: 0,
  groups: [],
  ...overrides,
})

describe('inverseOp', () => {
  test('node.add ↔ node.remove', () => {
    const node = makeNode()
    expect(inverseOp({ type: 'node.add', node })).toEqual({ type: 'node.remove', node })
    expect(inverseOp({ type: 'node.remove', node })).toEqual({ type: 'node.add', node })
  })

  test('node.update swaps patch and prev', () => {
    const op = {
      type: 'node.update' as const,
      id: asNodeId('n-1'),
      patch: { x: 50 },
      prev: { x: 10 },
    }
    expect(inverseOp(op)).toEqual({
      type: 'node.update',
      id: asNodeId('n-1'),
      patch: { x: 10 },
      prev: { x: 50 },
    })
  })

  test('inverseBatch reverses op order', () => {
    const node = makeNode()
    const batch = {
      id: 'b' as ReturnType<typeof Symbol>,
      clientId: asClientId('c'),
      ts: 0,
      origin: 'local' as const,
      ops: [
        { type: 'node.add' as const, node },
        {
          type: 'node.update' as const,
          id: node.id,
          patch: { x: 10 },
          prev: { x: 0 },
        },
      ],
    } as Parameters<typeof inverseBatch>[0]
    const inv = inverseBatch(batch)
    expect(inv[0]?.type).toBe('node.update') // last op inverted first
    expect(inv[1]?.type).toBe('node.remove')
  })
})

describe('store undo / redo', () => {
  test('undo rolls back an addNode; redo re-applies', () => {
    const store = createCanvasStore({ clientId: asClientId('u') })
    const node = makeNode()
    store.addNode(node)
    expect(store.getNode(node.id)).toBeTruthy()
    expect(store.canUndo()).toBe(true)
    expect(store.canRedo()).toBe(false)

    store.undo()
    expect(store.getNode(node.id)).toBeUndefined()
    expect(store.canUndo()).toBe(false)
    expect(store.canRedo()).toBe(true)

    store.redo()
    expect(store.getNode(node.id)).toBeTruthy()
    expect(store.canUndo()).toBe(true)
    expect(store.canRedo()).toBe(false)
  })

  test('undo rolls back an update to its prev value', () => {
    const store = createCanvasStore({ clientId: asClientId('u') })
    store.addNode(makeNode({ x: 10 }))
    store.updateNode(asNodeId('n-1'), { x: 999 })
    expect(store.getNode(asNodeId('n-1'))?.x).toBe(999)
    store.undo()
    expect(store.getNode(asNodeId('n-1'))?.x).toBe(10)
  })

  test('a fresh local op clears the redo stack', () => {
    const store = createCanvasStore({ clientId: asClientId('u') })
    store.addNode(makeNode())
    store.undo()
    expect(store.canRedo()).toBe(true)
    store.addNode(makeNode({ id: asNodeId('n-2'), x: 50 }))
    expect(store.canRedo()).toBe(false)
  })

  test('remote-origin batches do NOT enter the undo stack', () => {
    const store = createCanvasStore({ clientId: asClientId('u') })
    const node = makeNode()
    store.applyBatch({
      id: 'b' as unknown as ReturnType<typeof Symbol>,
      clientId: asClientId('other'),
      ts: 1,
      origin: 'remote',
      ops: [{ type: 'node.add', node }],
    } as Parameters<typeof store.applyBatch>[0])
    expect(store.getNode(node.id)).toBeTruthy()
    expect(store.canUndo()).toBe(false)
  })
})

describe('conflict detection (LWW)', () => {
  test('detects mismatch between local current and remote `prev`', () => {
    const store = createCanvasStore({ clientId: asClientId('u') })
    store.addNode(makeNode({ x: 100 }))
    // Remote op says "I changed x from 50 to 999" — but local x is 100,
    // not 50. That's a concurrent edit.
    const conflicts = detectConflicts(
      {
        id: 'b' as unknown as ReturnType<typeof Symbol>,
        clientId: asClientId('other'),
        ts: 2,
        origin: 'remote',
        ops: [
          {
            type: 'node.update',
            id: asNodeId('n-1'),
            patch: { x: 999 },
            prev: { x: 50 },
          },
        ],
      } as Parameters<typeof detectConflicts>[0],
      id => store.getNode(id),
      id => store.getEdge(id),
    )
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]?.field).toBe('x')
  })

  test('no conflict when prev matches local', () => {
    const store = createCanvasStore({ clientId: asClientId('u') })
    store.addNode(makeNode({ x: 50 }))
    const conflicts = detectConflicts(
      {
        id: 'b' as unknown as ReturnType<typeof Symbol>,
        clientId: asClientId('other'),
        ts: 2,
        origin: 'remote',
        ops: [
          {
            type: 'node.update',
            id: asNodeId('n-1'),
            patch: { x: 999 },
            prev: { x: 50 },
          },
        ],
      } as Parameters<typeof detectConflicts>[0],
      id => store.getNode(id),
      id => store.getEdge(id),
    )
    expect(conflicts).toHaveLength(0)
  })

  test("applyBatch with origin: 'remote' emits 'conflict' event", () => {
    const store = createCanvasStore({ clientId: asClientId('u') })
    store.addNode(makeNode({ x: 100 }))
    const onConflict = vi.fn()
    store.subscribe('conflict', onConflict)
    store.applyBatch({
      id: 'b' as unknown as ReturnType<typeof Symbol>,
      clientId: asClientId('other'),
      ts: 2,
      origin: 'remote',
      ops: [
        {
          type: 'node.update',
          id: asNodeId('n-1'),
          patch: { x: 999 },
          prev: { x: 50 },
        },
      ],
    } as Parameters<typeof store.applyBatch>[0])
    expect(onConflict).toHaveBeenCalledTimes(1)
    // LWW: remote wins regardless.
    expect(store.getNode(asNodeId('n-1'))?.x).toBe(999)
  })
})

describe('presence slice', () => {
  test('setLocal patches local state + emits', () => {
    const store = createCanvasStore({ clientId: asClientId('u-pre') })
    const events: string[] = []
    store.subscribe('presence', e => {
      if ('removed' in e && e.removed) events.push('leave')
      else events.push(e.state.name)
    })
    store.presence.setLocal({ name: 'Alice', color: '#f00' })
    expect(store.presence.getLocal().name).toBe('Alice')
    expect(events).toEqual(['Alice'])
  })

  test('applyRemote stores + emits; null removes', () => {
    const store = createCanvasStore({ clientId: asClientId('u') })
    const events: string[] = []
    store.subscribe('presence', e => {
      if ('removed' in e && e.removed) events.push(`leave:${e.clientId}`)
      else events.push(`enter:${e.state.name}`)
    })
    store.presence.applyRemote(asClientId('peer-1'), {
      clientId: asClientId('peer-1'),
      cursor: null,
      selection: [],
      editing: null,
      color: '#0f0',
      name: 'Bob',
    })
    expect(store.presence.get(asClientId('peer-1'))?.name).toBe('Bob')
    store.presence.applyRemote(asClientId('peer-1'), null)
    expect(store.presence.get(asClientId('peer-1'))).toBeUndefined()
    expect(events).toEqual(['enter:Bob', 'leave:peer-1'])
  })
})

describe('attachSync', () => {
  test('rejects an adapter with neither causalOrdering nor crdt', () => {
    const store = createCanvasStore({ clientId: asClientId('u') })
    const bad: SyncAdapter = {
      capabilities: {},
      sendBatch: () => {},
      sendPresence: () => {},
      onBatch: () => () => {},
      onPresence: () => () => {},
    }
    expect(() => attachSync(store, bad)).toThrow(/capabilities/)
  })

  test('forwards local batches to adapter.sendBatch', () => {
    const store = createCanvasStore({ clientId: asClientId('u') })
    const sent: unknown[] = []
    const adapter: SyncAdapter = {
      capabilities: { causalOrdering: true },
      sendBatch: b => sent.push(b),
      sendPresence: () => {},
      onBatch: () => () => {},
      onPresence: () => () => {},
    }
    attachSync(store, adapter)
    store.addNode(makeNode())
    expect(sent).toHaveLength(1)
  })

  test('forwards history batches (undo/redo) so peers stay in sync', () => {
    const store = createCanvasStore({ clientId: asClientId('u') })
    const sent: { origin: string }[] = []
    const adapter: SyncAdapter = {
      capabilities: { causalOrdering: true },
      sendBatch: b => sent.push(b),
      sendPresence: () => {},
      onBatch: () => () => {},
      onPresence: () => () => {},
    }
    attachSync(store, adapter)
    store.addNode(makeNode())
    sent.length = 0
    store.undo()
    expect(sent).toHaveLength(1)
    expect(sent[0]?.origin).toBe('history')
  })

  test('does NOT forward remote-origin batches (loop prevention)', () => {
    const store = createCanvasStore({ clientId: asClientId('u') })
    const sent: unknown[] = []
    const adapter: SyncAdapter = {
      capabilities: { causalOrdering: true },
      sendBatch: b => sent.push(b),
      sendPresence: () => {},
      onBatch: () => () => {},
      onPresence: () => () => {},
    }
    attachSync(store, adapter)
    store.applyBatch({
      id: 'b' as unknown as ReturnType<typeof Symbol>,
      clientId: asClientId('other'),
      ts: 1,
      origin: 'remote',
      ops: [{ type: 'node.add', node: makeNode() }],
    } as Parameters<typeof store.applyBatch>[0])
    expect(sent).toHaveLength(0)
  })

  test('routes adapter.onBatch into the store', () => {
    const store = createCanvasStore({ clientId: asClientId('u') })
    let inbound: ((batch: Parameters<typeof store.applyBatch>[0]) => void) | null = null
    const adapter: SyncAdapter = {
      capabilities: { causalOrdering: true },
      sendBatch: () => {},
      sendPresence: () => {},
      onBatch: cb => {
        inbound = cb
        return () => {}
      },
      onPresence: () => () => {},
    }
    attachSync(store, adapter)
    expect(inbound).toBeTruthy()
    inbound?.({
      id: 'b' as unknown as ReturnType<typeof Symbol>,
      clientId: asClientId('other'),
      ts: 1,
      origin: 'local', // attachSync overrides to 'remote'
      ops: [{ type: 'node.add', node: makeNode() }],
    } as Parameters<typeof store.applyBatch>[0])
    expect(store.getNode(asNodeId('n-1'))).toBeTruthy()
    expect(store.canUndo()).toBe(false)
  })
})

/**
 * Regression coverage for the undefined-vs-null wire serialization bug:
 * a node/edge field that was previously `undefined`, set, then undone,
 * used to silently no-op on JSON-serialized sync adapters because
 * `JSON.stringify({ x: undefined })` drops the key. The store now
 * normalizes both `patch` and `prev` undefineds to `null` so they
 * survive a round-trip.
 */
describe('undefined → null wire normalization', () => {
  test("detectConflicts treats null and undefined as equivalent for 'no value'", () => {
    // Local edge has content === undefined (never set). Remote op
    // claims prev: { content: null } (the wire form of a first-time
    // set's prev slice). These must match — without the sameValue
    // fix, every legitimate first-time-set forward edit would fire
    // a spurious 'conflict' event on the peer.
    const store = createCanvasStore({ clientId: asClientId('A') })
    store.addNode(makeNode({ id: asNodeId('a') }))
    store.addNode(makeNode({ id: asNodeId('b'), x: 400 }))
    store.addEdge({
      id: asEdgeId('e-1'),
      source: { nodeId: asNodeId('a'), localOffset: { x: 100, y: 50 } },
      target: { nodeId: asNodeId('b'), localOffset: { x: 0, y: 50 } },
      pathStyle: 'bezier',
      z: 0,
      groups: [],
    })
    const conflicts = detectConflicts(
      {
        id: 'b' as unknown as ReturnType<typeof Symbol>,
        clientId: asClientId('B'),
        ts: 1,
        origin: 'remote',
        ops: [
          {
            type: 'edge.update',
            id: asEdgeId('e-1'),
            patch: { content: 'hello' },
            prev: { content: null as unknown as undefined },
          },
        ],
      } as Parameters<typeof detectConflicts>[0],
      id => store.getNode(id),
      id => store.getEdge(id),
    )
    expect(conflicts).toHaveLength(0)
  })

  test('undo of first-time edge.content set survives JSON round-trip', () => {
    const storeA = createCanvasStore({ clientId: asClientId('A') })
    storeA.addNode(makeNode({ id: asNodeId('a') }))
    storeA.addNode(makeNode({ id: asNodeId('b'), x: 400 }))
    const edgeId = asEdgeId('e-1')
    storeA.addEdge({
      id: edgeId,
      source: { nodeId: asNodeId('a'), localOffset: { x: 100, y: 50 } },
      target: { nodeId: asNodeId('b'), localOffset: { x: 0, y: 50 } },
      pathStyle: 'bezier',
      z: 0,
      groups: [],
    })

    // Peer mirrors the state up to here.
    const storeB = createCanvasStore({ clientId: asClientId('B') })
    storeB.addNode(makeNode({ id: asNodeId('a') }))
    storeB.addNode(makeNode({ id: asNodeId('b'), x: 400 }))
    storeB.addEdge({
      id: edgeId,
      source: { nodeId: asNodeId('a'), localOffset: { x: 100, y: 50 } },
      target: { nodeId: asNodeId('b'), localOffset: { x: 0, y: 50 } },
      pathStyle: 'bezier',
      z: 0,
      groups: [],
    })

    // A sets the previously-undefined content, then undoes. Capture
    // the inverse batch — that's what the peer would receive.
    const batches: OpBatch[] = []
    storeA.subscribe('change', b => batches.push(b))
    storeA.updateEdge(edgeId, { content: 'hello' })
    expect(storeA.getEdge(edgeId)?.content).toBe('hello')
    storeA.undo()
    expect(storeA.getEdge(edgeId)?.content).toBeFalsy()

    const undoBatch = batches[batches.length - 1]!
    // The crucial step: cross a JSON boundary the way any
    // server-relay sync adapter would.
    const wire = JSON.parse(JSON.stringify(undoBatch)) as OpBatch

    // Peer's edge currently has 'hello' (it received the forward set).
    storeB.updateEdge(edgeId, { content: 'hello' })
    storeB.applyBatch({ ...wire, origin: 'remote' })

    expect(storeB.getEdge(edgeId)?.content).toBeFalsy()
  })

  test('forward updateEdge(id, { content: undefined }) survives JSON round-trip', () => {
    // Explicit-undefined clear. Most code uses `''` but the API
    // accepts undefined, and it should reach peers as a clear, not
    // get silently dropped over JSON.
    const storeA = createCanvasStore({ clientId: asClientId('A') })
    storeA.addNode(makeNode({ id: asNodeId('a') }))
    storeA.addNode(makeNode({ id: asNodeId('b'), x: 400 }))
    const edgeId = asEdgeId('e-1')
    storeA.addEdge({
      id: edgeId,
      source: { nodeId: asNodeId('a'), localOffset: { x: 100, y: 50 } },
      target: { nodeId: asNodeId('b'), localOffset: { x: 0, y: 50 } },
      pathStyle: 'bezier',
      z: 0,
      groups: [],
      content: 'hello',
    } as Edge)

    const batches: OpBatch[] = []
    storeA.subscribe('change', b => batches.push(b))
    storeA.updateEdge(edgeId, { content: undefined })
    expect(storeA.getEdge(edgeId)?.content).toBeFalsy()

    const forwardBatch = batches[batches.length - 1]!
    const wire = JSON.parse(JSON.stringify(forwardBatch)) as OpBatch

    const storeB = createCanvasStore({ clientId: asClientId('B') })
    storeB.addNode(makeNode({ id: asNodeId('a') }))
    storeB.addNode(makeNode({ id: asNodeId('b'), x: 400 }))
    storeB.addEdge({
      id: edgeId,
      source: { nodeId: asNodeId('a'), localOffset: { x: 100, y: 50 } },
      target: { nodeId: asNodeId('b'), localOffset: { x: 0, y: 50 } },
      pathStyle: 'bezier',
      z: 0,
      groups: [],
      content: 'hello',
    } as Edge)
    storeB.applyBatch({ ...wire, origin: 'remote' })

    expect(storeB.getEdge(edgeId)?.content).toBeFalsy()
  })
})
