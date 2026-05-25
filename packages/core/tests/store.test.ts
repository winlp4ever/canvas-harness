import { describe, expect, test, vi } from 'vitest'
import { createCanvasStore } from '../src/store'
import {
  type Edge,
  type Group,
  type Node,
  asClientId,
  asEdgeId,
  asGroupId,
  asNodeId,
} from '../src/types'

// Test fixtures with optional `z` — addNode/addEdge auto-assign on
// the top of the stack when z is omitted.
type NodeInput = Omit<Node, 'z'> & { z?: number }
type EdgeInput = Omit<Edge, 'z'> & { z?: number }

const makeNode = (overrides: Partial<NodeInput> = {}): NodeInput => ({
  id: asNodeId('n-1'),
  type: 'rect',
  x: 0,
  y: 0,
  w: 100,
  h: 100,
  angle: 0,
  groups: [],
  ...overrides,
})

const makeEdge = (overrides: Partial<EdgeInput> = {}): EdgeInput => ({
  id: asEdgeId('e-1'),
  source: { nodeId: asNodeId('n-1'), localOffset: { x: 100, y: 50 } },
  target: { nodeId: asNodeId('n-2'), localOffset: { x: 0, y: 50 } },
  pathStyle: 'bezier',
  groups: [],
  ...overrides,
})

describe('createCanvasStore', () => {
  test('starts empty when no initial scene', () => {
    const store = createCanvasStore()
    expect(store.getAllNodes()).toEqual([])
    expect(store.getAllEdges()).toEqual([])
    expect(store.getSelection()).toEqual([])
    expect(store.getCamera()).toEqual({ x: 0, y: 0, z: 1 })
  })

  test('clientId defaults to a random "u-XXXX"', () => {
    const store = createCanvasStore()
    expect(store.clientId).toMatch(/^u-[0-9a-f]{4}$/)
  })

  test('explicit clientId is used', () => {
    const store = createCanvasStore({ clientId: asClientId('u-test') })
    expect(store.clientId).toBe('u-test')
    expect(store.generateId()).toMatch(/^u-test-\d+$/)
  })

  test('addNode persists the node and emits one change batch', () => {
    const store = createCanvasStore({ clientId: asClientId('u-x') })
    const onChange = vi.fn()
    store.subscribe('change', onChange)
    const n = makeNode()
    store.addNode(n)
    // addNode auto-assigns z (top of stack) when caller passes z=0,
    // so the stored copy has z > 0.
    const stored = store.getNode(n.id)
    expect(stored).toEqual({ ...n, z: stored!.z })
    expect(stored!.z).toBeGreaterThan(0)
    expect(onChange).toHaveBeenCalledTimes(1)
    const batch = onChange.mock.calls[0][0]
    expect(batch.ops).toHaveLength(1)
    expect(batch.ops[0]).toMatchObject({ type: 'node.add', node: { ...n, z: stored!.z } })
    expect(batch.origin).toBe('local')
  })

  test('updateNode patches fields and captures prev slice', () => {
    const store = createCanvasStore({ clientId: asClientId('u-x') })
    store.addNode(makeNode({ x: 10, y: 20 }))
    const onChange = vi.fn()
    store.subscribe('change', onChange)

    store.updateNode(asNodeId('n-1'), { x: 50 })
    expect(store.getNode(asNodeId('n-1'))?.x).toBe(50)
    expect(store.getNode(asNodeId('n-1'))?.y).toBe(20)
    expect(onChange).toHaveBeenCalledTimes(1)
    const op = onChange.mock.calls[0][0].ops[0]
    expect(op).toMatchObject({ type: 'node.update', id: 'n-1', patch: { x: 50 }, prev: { x: 10 } })
  })

  test('removeNode cascades to incident edges', () => {
    const store = createCanvasStore({ clientId: asClientId('u-x') })
    store.addNode(makeNode())
    store.addNode(makeNode({ id: asNodeId('n-2'), x: 200 }))
    store.addEdge(makeEdge())

    const onChange = vi.fn()
    store.subscribe('change', onChange)
    store.removeNode(asNodeId('n-1'))

    expect(store.getNode(asNodeId('n-1'))).toBeUndefined()
    expect(store.getEdge(asEdgeId('e-1'))).toBeUndefined()
    expect(onChange).toHaveBeenCalledTimes(1)
    const batch = onChange.mock.calls[0][0]
    expect(batch.ops.map((o: { type: string }) => o.type)).toEqual(['edge.remove', 'node.remove'])
  })

  test('batch() coalesces multiple ops into one change batch', () => {
    const store = createCanvasStore({ clientId: asClientId('u-x') })
    const onChange = vi.fn()
    store.subscribe('change', onChange)

    store.batch(() => {
      store.addNode(makeNode())
      store.addNode(makeNode({ id: asNodeId('n-2') }))
      store.addNode(makeNode({ id: asNodeId('n-3') }))
    })

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0].ops).toHaveLength(3)
  })

  test('batch() with no mutations does not fire change event', () => {
    const store = createCanvasStore({ clientId: asClientId('u-x') })
    const onChange = vi.fn()
    store.subscribe('change', onChange)
    store.batch(() => {})
    expect(onChange).not.toHaveBeenCalled()
  })

  test('addEdge / updateEdge / removeEdge work and track incidence', () => {
    const store = createCanvasStore({ clientId: asClientId('u-x') })
    store.addNode(makeNode())
    store.addNode(makeNode({ id: asNodeId('n-2'), x: 200 }))
    store.addEdge(makeEdge())
    expect(store.getEdge(asEdgeId('e-1'))).toBeDefined()

    store.updateEdge(asEdgeId('e-1'), { pathStyle: 'straight' })
    expect(store.getEdge(asEdgeId('e-1'))?.pathStyle).toBe('straight')

    store.removeEdge(asEdgeId('e-1'))
    expect(store.getEdge(asEdgeId('e-1'))).toBeUndefined()
  })

  test('querySpatial returns nodes intersecting a rect', () => {
    const store = createCanvasStore({ clientId: asClientId('u-x') })
    store.addNode(makeNode({ id: asNodeId('a'), x: 0, y: 0 }))
    store.addNode(makeNode({ id: asNodeId('b'), x: 500, y: 0 }))
    store.addNode(makeNode({ id: asNodeId('c'), x: 50, y: 50 }))
    const res = store.querySpatial({ rect: { x: 0, y: 0, w: 200, h: 200 } })
    expect(res.nodes.sort()).toEqual(['a', 'c'])
  })

  test('groups upsert + remove fire change ops', () => {
    const store = createCanvasStore({ clientId: asClientId('u-x') })
    const onChange = vi.fn()
    store.subscribe('change', onChange)

    const g: Group = { id: asGroupId('g-team'), name: 'Team Alpha' }
    store.upsertGroup(g)
    expect(store.getGroup(g.id)).toEqual(g)
    expect(onChange).toHaveBeenCalledTimes(1)

    store.upsertGroup({ id: g.id, name: 'Renamed' })
    expect(store.getGroup(g.id)?.name).toBe('Renamed')

    store.removeGroup(g.id)
    expect(store.getGroup(g.id)).toBeUndefined()
  })

  test('setCamera fires the camera event', () => {
    const store = createCanvasStore()
    const onCamera = vi.fn()
    store.subscribe('camera', onCamera)
    store.setCamera({ z: 2 })
    expect(store.getCamera()).toEqual({ x: 0, y: 0, z: 2 })
    expect(onCamera).toHaveBeenCalledWith({ x: 0, y: 0, z: 2 })
  })

  test('setSelection fires the selection event', () => {
    const store = createCanvasStore()
    const onSel = vi.fn()
    store.subscribe('selection', onSel)
    store.setSelection([asNodeId('n-1')])
    expect(store.getSelection()).toEqual(['n-1'])
    expect(onSel).toHaveBeenCalledWith(['n-1'])
  })

  test('unsubscribe stops further events', () => {
    const store = createCanvasStore()
    const onChange = vi.fn()
    const unsub = store.subscribe('change', onChange)
    store.addNode(makeNode())
    unsub()
    store.addNode(makeNode({ id: asNodeId('n-2') }))
    expect(onChange).toHaveBeenCalledTimes(1)
  })
})
