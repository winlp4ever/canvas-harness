import { describe, expect, test } from 'vitest'
import {
  asEdgeId,
  asNodeId,
  createCanvasStore,
  cubicBezier,
  getPointAndTangentAtArcLength,
  hitTestAny,
  midpointToCubicControls,
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

describe('midpointToCubicControls', () => {
  test('curve passes exactly through the chosen midpoint at t=0.5', () => {
    const source = { x: 0, y: 0 }
    const target = { x: 100, y: 0 }
    const wanted = { x: 50, y: 80 }
    const { c1, c2 } = midpointToCubicControls(source, wanted, target)
    const t = 0.5
    const at = cubicBezier(source, c1, c2, target, t)
    expect(at.x).toBeCloseTo(wanted.x, 5)
    expect(at.y).toBeCloseTo(wanted.y, 5)
  })

  test('on the line source→target the control points sit on the line', () => {
    const source = { x: 0, y: 0 }
    const target = { x: 100, y: 0 }
    const wanted = { x: 50, y: 0 }
    const { c1, c2 } = midpointToCubicControls(source, wanted, target)
    expect(c1.y).toBeCloseTo(0, 5)
    expect(c2.y).toBeCloseTo(0, 5)
  })

  test('symmetric input → symmetric output', () => {
    const source = { x: -50, y: 0 }
    const target = { x: 50, y: 0 }
    const wanted = { x: 0, y: 30 }
    const { c1, c2 } = midpointToCubicControls(source, wanted, target)
    expect(c1.x).toBeCloseTo(-c2.x, 5)
    expect(c1.y).toBeCloseTo(c2.y, 5)
  })
})

describe('midpoint-handle hit-test', () => {
  test('clicking near the midpoint of a selected bezier returns midpoint-handle', () => {
    const store = createCanvasStore()
    store.addNode(makeNode({ id: asNodeId('a') }))
    store.addNode(makeNode({ id: asNodeId('b'), x: 300 }))
    store.addEdge(makeEdge())
    const geom = store.getEdgeGeometry(asEdgeId('e'))!
    const mid = getPointAndTangentAtArcLength(geom.samples, 0.5).point
    const hit = hitTestAny(store, mid, 1, new Set(), new Set([asEdgeId('e')]))
    expect(hit?.kind).toBe('midpoint-handle')
  })

  test('unselected edges do not expose a midpoint handle', () => {
    const store = createCanvasStore()
    store.addNode(makeNode({ id: asNodeId('a') }))
    store.addNode(makeNode({ id: asNodeId('b'), x: 300 }))
    store.addEdge(makeEdge())
    const geom = store.getEdgeGeometry(asEdgeId('e'))!
    const mid = getPointAndTangentAtArcLength(geom.samples, 0.5).point
    const hit = hitTestAny(store, mid, 1) // no selectedEdges
    // Falls through to body hit since the click is on the curve.
    expect(hit?.kind).toBe('body')
  })
})

describe('dragging the midpoint reshapes the curve', () => {
  test('updateEdge with control [c1, c2] re-runs the cached bezier', () => {
    const store = createCanvasStore()
    store.addNode(makeNode({ id: asNodeId('a') }))
    store.addNode(makeNode({ id: asNodeId('b'), x: 300 }))
    store.addEdge(makeEdge())
    const geomBefore = store.getEdgeGeometry(asEdgeId('e'))!
    const wantedMid = { x: 150, y: -100 } // way above the auto-routed line
    const { c1, c2 } = midpointToCubicControls(geomBefore.source, wantedMid, geomBefore.target)
    store.updateEdge(asEdgeId('e'), { control: [c1, c2] })
    const geomAfter = store.getEdgeGeometry(asEdgeId('e'))!
    const midAfter = geomAfter.samples[Math.floor(geomAfter.samples.length / 2)]!
    // Curve should now pass close to wantedMid at t=0.5 (modulo sample resolution).
    expect(midAfter.y).toBeLessThan(-50)
  })
})
