import { describe, expect, test } from 'vitest'
import {
  asEdgeId,
  asNodeId,
  createCanvasStore,
  edgeLabelBoundsWorld,
  getPointAndTangentAtArcLength,
  hitTestAny,
} from '../src'
import type { Edge, Node } from '../src'

const makeNode = (overrides: Partial<Node> = {}): Node => ({
  id: asNodeId('n'),
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

const makeEdge = (overrides: Partial<Edge> = {}): Edge => ({
  id: asEdgeId('e'),
  source: { nodeId: asNodeId('a'), localOffset: { x: 100, y: 50 } },
  target: { nodeId: asNodeId('b'), localOffset: { x: 0, y: 50 } },
  pathStyle: 'bezier',
  z: 0,
  groups: [],
  ...overrides,
})

describe('getPointAndTangentAtArcLength', () => {
  test('t=0 returns first sample', () => {
    const samples = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ]
    const r = getPointAndTangentAtArcLength(samples, 0)
    expect(r.point).toEqual({ x: 0, y: 0 })
    expect(r.tangent.x).toBeCloseTo(1, 5)
    expect(r.tangent.y).toBeCloseTo(0, 5)
  })

  test('t=1 returns last sample', () => {
    const samples = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]
    const r = getPointAndTangentAtArcLength(samples, 1)
    expect(r.point).toEqual({ x: 10, y: 0 })
  })

  test('t=0.5 on a straight line lands at the midpoint', () => {
    const samples = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]
    const r = getPointAndTangentAtArcLength(samples, 0.5)
    expect(r.point.x).toBeCloseTo(50, 5)
    expect(r.point.y).toBeCloseTo(0, 5)
  })

  test('handles multi-segment polylines proportionally', () => {
    // Two segments: 30 horiz, then 70 vertical. Total = 100.
    // t=0.5 → 50 along the path → 30 horiz used + 20 into vertical.
    const samples = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 70 },
    ]
    const r = getPointAndTangentAtArcLength(samples, 0.5)
    expect(r.point.x).toBeCloseTo(30, 5)
    expect(r.point.y).toBeCloseTo(20, 5)
    expect(r.tangent.x).toBeCloseTo(0, 5)
    expect(r.tangent.y).toBeCloseTo(1, 5)
  })

  test('clamps t outside [0..1]', () => {
    const samples = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]
    expect(getPointAndTangentAtArcLength(samples, -1).point).toEqual({ x: 0, y: 0 })
    expect(getPointAndTangentAtArcLength(samples, 2).point).toEqual({ x: 10, y: 0 })
  })
})

describe('edgeLabelBoundsWorld', () => {
  test('null when edge has no content', () => {
    const store = createCanvasStore()
    store.addNode(makeNode({ id: asNodeId('a') }))
    store.addNode(makeNode({ id: asNodeId('b'), x: 300 }))
    store.addEdge(makeEdge())
    const geom = store.getEdgeGeometry(asEdgeId('e'))!
    expect(edgeLabelBoundsWorld(store.getEdge(asEdgeId('e'))!, geom)).toBeNull()
  })

  test('returns a rect when edge has content', () => {
    const store = createCanvasStore()
    store.addNode(makeNode({ id: asNodeId('a') }))
    store.addNode(makeNode({ id: asNodeId('b'), x: 300 }))
    store.addEdge(makeEdge({ content: 'depends on' }))
    const geom = store.getEdgeGeometry(asEdgeId('e'))!
    const bounds = edgeLabelBoundsWorld(store.getEdge(asEdgeId('e'))!, geom)
    expect(bounds).not.toBeNull()
    expect(bounds!.w).toBeGreaterThan(0)
    expect(bounds!.h).toBeGreaterThan(0)
  })
})

describe('hit-test prioritizes label over body', () => {
  test('clicking a labeled edge midpoint returns kind=label', () => {
    const store = createCanvasStore()
    store.addNode(makeNode({ id: asNodeId('a') }))
    store.addNode(makeNode({ id: asNodeId('b'), x: 300 }))
    store.addEdge(makeEdge({ content: 'yes' }))
    const geom = store.getEdgeGeometry(asEdgeId('e'))!
    const bounds = edgeLabelBoundsWorld(store.getEdge(asEdgeId('e'))!, geom)!
    const center = { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 }
    const hit = hitTestAny(store, center, 1)
    expect(hit?.kind).toBe('label')
  })

  test('clicking the edge body away from the label returns kind=body', () => {
    const store = createCanvasStore()
    store.addNode(makeNode({ id: asNodeId('a') }))
    store.addNode(makeNode({ id: asNodeId('b'), x: 300 }))
    store.addEdge(makeEdge({ content: 'yes' }))
    // Sample the body near the source endpoint where the label isn't.
    const geom = store.getEdgeGeometry(asEdgeId('e'))!
    const near = geom.samples[1]!
    const hit = hitTestAny(store, near, 1)
    expect(hit?.kind).toBe('body')
  })
})

describe('store beginEdit/commitEdit with edges', () => {
  test('beginEdit on an edge id flips mode + sets editingTarget', () => {
    const store = createCanvasStore()
    store.addNode(makeNode({ id: asNodeId('a') }))
    store.addNode(makeNode({ id: asNodeId('b'), x: 300 }))
    store.addEdge(makeEdge({ content: 'initial' }))
    store.beginEdit(asEdgeId('e'))
    const state = store.getInteractionState()
    expect(state.mode).toBe('editing')
    expect(state.editingTarget).toEqual({ kind: 'edge', id: asEdgeId('e') })
  })

  test('commitEdit writes content to the edge', () => {
    const store = createCanvasStore()
    store.addNode(makeNode({ id: asNodeId('a') }))
    store.addNode(makeNode({ id: asNodeId('b'), x: 300 }))
    store.addEdge(makeEdge({ content: 'before' }))
    store.beginEdit(asEdgeId('e'))
    store.commitEdit('after')
    expect(store.getEdge(asEdgeId('e'))?.content).toBe('after')
    expect(store.getInteractionState().mode).toBe('idle')
  })

  test('cancelEdit leaves edge content unchanged', () => {
    const store = createCanvasStore()
    store.addNode(makeNode({ id: asNodeId('a') }))
    store.addNode(makeNode({ id: asNodeId('b'), x: 300 }))
    store.addEdge(makeEdge({ content: 'before' }))
    store.beginEdit(asEdgeId('e'))
    store.cancelEdit()
    expect(store.getEdge(asEdgeId('e'))?.content).toBe('before')
  })
})
