import { describe, expect, test } from 'vitest'
import {
  computeEdgeGeometry,
  cubicBezier,
  cubicBezierTangent,
  edgeAABBFromSamples,
  nodeLocalToWorld,
  projectEndToWorld,
  projectToNodeBoundary,
  sampleBezier,
  samplesFor,
  worldToNodeLocal,
} from '../src/edges'
import { autoRouteControls, sideOf } from '../src/edges/auto-route'
import { clipSamples } from '../src/edges/clip'
import { hitTestEdge } from '../src/hit-test/edge'
import { createCanvasStore } from '../src/store'
import { type Edge, type Node, asEdgeId, asNodeId } from '../src/types'

const makeNode = (overrides: Partial<Node> = {}): Node => ({
  id: asNodeId('n-1'),
  type: 'rect',
  x: 100,
  y: 100,
  w: 200,
  h: 100,
  angle: 0,
  z: 0,
  groups: [],
  ...overrides,
})

describe('project', () => {
  test('nodeLocalToWorld and worldToNodeLocal are inverses (axis-aligned)', () => {
    const n = makeNode()
    const local = { x: 50, y: 25 }
    const world = nodeLocalToWorld(local, n)
    expect(world).toEqual({ x: 150, y: 125 })
    const back = worldToNodeLocal(world, n)
    expect(back.x).toBeCloseTo(local.x)
    expect(back.y).toBeCloseTo(local.y)
  })

  test('nodeLocalToWorld respects rotation', () => {
    const n = makeNode({ angle: Math.PI / 2 })
    const local = { x: 0, y: 0 }
    const world = nodeLocalToWorld(local, n)
    // Node at (100, 100), w=200, h=100; center=(200, 150).
    // 90° rotation of (100, 100) around (200, 150) → (250, 50).
    expect(world.x).toBeCloseTo(250)
    expect(world.y).toBeCloseTo(50)
  })

  test('projectEndToWorld attached vs free-floating', () => {
    const n = makeNode()
    const getNode = (id: typeof n.id) => (id === n.id ? n : undefined)
    expect(projectEndToWorld({ nodeId: n.id, localOffset: { x: 50, y: 25 } }, getNode)).toEqual({
      x: 150,
      y: 125,
    })
    expect(projectEndToWorld({ worldPoint: { x: 7, y: 9 } }, getNode)).toEqual({ x: 7, y: 9 })
  })

  test('projectToNodeBoundary clamps outside points', () => {
    const n = makeNode()
    const result = projectToNodeBoundary({ x: 500, y: -100 }, n)
    // Outside on x>w and y<0: clamps to (w, 0)
    expect(result).toEqual({ x: n.w, y: 0 })
  })

  test('projectToNodeBoundary projects inside points to nearest edge', () => {
    const n = makeNode()
    // World (110, 130) → local (10, 30); nearest edge is left (distance 10).
    const result = projectToNodeBoundary({ x: 110, y: 130 }, n)
    expect(result).toEqual({ x: 0, y: 30 })
  })
})

describe('auto-route', () => {
  test('sideOf picks correct side', () => {
    const n = makeNode({ w: 200, h: 100 })
    expect(sideOf(n, 0, 50)).toBe('w')
    expect(sideOf(n, 200, 50)).toBe('e')
    expect(sideOf(n, 100, 0)).toBe('n')
    expect(sideOf(n, 100, 100)).toBe('s')
  })

  test('autoRouteControls picks control points along normals', () => {
    const source = { x: 0, y: 0 }
    const target = { x: 100, y: 0 }
    const { c1, c2 } = autoRouteControls(source, target, { x: 1, y: 0 }, { x: -1, y: 0 })
    expect(c1.x).toBeGreaterThan(source.x)
    expect(c2.x).toBeLessThan(target.x)
  })
})

describe('bezier sampling', () => {
  test('cubicBezier endpoints', () => {
    const p0 = { x: 0, y: 0 }
    const c1 = { x: 50, y: 0 }
    const c2 = { x: 50, y: 100 }
    const p1 = { x: 100, y: 100 }
    expect(cubicBezier(p0, c1, c2, p1, 0)).toEqual(p0)
    expect(cubicBezier(p0, c1, c2, p1, 1)).toEqual(p1)
  })

  test('sampleBezier returns N+1 evenly-spaced points', () => {
    const samples = sampleBezier(
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: 100, y: 100 },
      { x: 100, y: 0 },
      16,
    )
    expect(samples).toHaveLength(17)
    expect(samples[0]).toEqual({ x: 0, y: 0 })
    expect(samples[16]).toEqual({ x: 100, y: 0 })
  })

  test('cubicBezierTangent returns unit length', () => {
    const t = cubicBezierTangent(
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 100 },
      { x: 100, y: 100 },
      0.5,
    )
    const len = Math.hypot(t.x, t.y)
    expect(len).toBeCloseTo(1)
  })

  test('samplesFor matches pathStyle', () => {
    expect(samplesFor('straight', { x: 0, y: 0 }, { x: 10, y: 10 }, undefined)).toHaveLength(2)
    expect(samplesFor('polyline', { x: 0, y: 0 }, { x: 10, y: 10 }, [{ x: 5, y: 0 }])).toHaveLength(
      3,
    )
    expect(
      samplesFor('bezier', { x: 0, y: 0 }, { x: 10, y: 10 }, [
        { x: 5, y: 0 },
        { x: 5, y: 10 },
      ]),
    ).toHaveLength(33)
  })
})

describe('clip', () => {
  test('clips both ends when both endpoints attach to nodes', () => {
    const sourceNode = makeNode({ id: asNodeId('a'), x: 0, y: 0, w: 100, h: 100 })
    const targetNode = makeNode({ id: asNodeId('b'), x: 200, y: 0, w: 100, h: 100 })
    // straight line from inside source to inside target
    const samples = [
      { x: 50, y: 50 },
      { x: 150, y: 50 },
      { x: 250, y: 50 },
    ]
    const clip = clipSamples(samples, sourceNode, targetNode)
    expect(clip.visible).toBe(true)
    // Source clip should be at source boundary (x=100), target at target boundary (x=200)
    expect(clip.startPoint.x).toBeCloseTo(100, 0)
    expect(clip.endPoint.x).toBeCloseTo(200, 0)
  })

  test('returns invisible when nodes overlap completely', () => {
    const sourceNode = makeNode({ id: asNodeId('a'), x: 0, y: 0, w: 1000, h: 1000 })
    const samples = [
      { x: 100, y: 100 },
      { x: 200, y: 200 },
    ]
    const clip = clipSamples(samples, sourceNode, sourceNode)
    expect(clip.visible).toBe(false)
  })
})

describe('edge AABB from samples', () => {
  test('returns padded bounds', () => {
    const aabb = edgeAABBFromSamples([
      { x: 0, y: 0 },
      { x: 100, y: 50 },
    ])
    expect(aabb.x).toBeLessThan(0)
    expect(aabb.w).toBeGreaterThan(100)
  })
})

describe('computeEdgeGeometry', () => {
  const makeStore = () => {
    const store = createCanvasStore()
    store.addNode(makeNode({ id: asNodeId('a'), x: 0, y: 0 }))
    store.addNode(makeNode({ id: asNodeId('b'), x: 400, y: 0 }))
    return store
  }
  const sampleEdge = (overrides: Partial<Edge> = {}): Edge => ({
    id: asEdgeId('e-1'),
    source: { nodeId: asNodeId('a'), localOffset: { x: 200, y: 50 } },
    target: { nodeId: asNodeId('b'), localOffset: { x: 0, y: 50 } },
    pathStyle: 'bezier',
    z: 0,
    groups: [],
    ...overrides,
  })

  test('returns samples + aabb', () => {
    const store = makeStore()
    const geom = computeEdgeGeometry(sampleEdge(), id => store.getNode(id))!
    expect(geom.samples.length).toBeGreaterThan(2)
    expect(geom.aabb.w).toBeGreaterThan(0)
    expect(geom.sourceNodeId).toBe('a')
    expect(geom.targetNodeId).toBe('b')
  })

  test('handles self-loop', () => {
    const store = makeStore()
    const geom = computeEdgeGeometry(
      sampleEdge({ target: { nodeId: asNodeId('a'), localOffset: { x: 0, y: 0 } } }),
      id => store.getNode(id),
    )!
    expect(geom.isSelfLoop).toBe(true)
  })

  test('returns null when attached node is missing', () => {
    const geom = computeEdgeGeometry(sampleEdge(), () => undefined)
    expect(geom).toBeNull()
  })
})

describe('store integration', () => {
  test('store.getEdgeGeometry returns cached geometry; re-computes on node move', () => {
    const store = createCanvasStore()
    store.addNode(makeNode({ id: asNodeId('a'), x: 0, y: 0 }))
    store.addNode(makeNode({ id: asNodeId('b'), x: 400, y: 0 }))
    const edgeId = asEdgeId('e-1')
    store.addEdge({
      id: edgeId,
      source: { nodeId: asNodeId('a'), localOffset: { x: 200, y: 50 } },
      target: { nodeId: asNodeId('b'), localOffset: { x: 0, y: 50 } },
      pathStyle: 'bezier',
      z: 0,
      groups: [],
    })

    const g1 = store.getEdgeGeometry(edgeId)
    expect(g1).toBeDefined()
    const origSourceX = g1!.source.x

    // Move source node; geometry should reflect new position.
    store.updateNode(asNodeId('a'), { x: 500 })
    const g2 = store.getEdgeGeometry(edgeId)!
    expect(g2.source.x).not.toBe(origSourceX)
  })

  test('store.getIncidentEdges returns connected edges', () => {
    const store = createCanvasStore()
    store.addNode(makeNode({ id: asNodeId('a') }))
    store.addNode(makeNode({ id: asNodeId('b') }))
    store.addEdge({
      id: asEdgeId('e-1'),
      source: { nodeId: asNodeId('a'), localOffset: { x: 0, y: 0 } },
      target: { nodeId: asNodeId('b'), localOffset: { x: 0, y: 0 } },
      pathStyle: 'bezier',
      z: 0,
      groups: [],
    })
    expect(store.getIncidentEdges(asNodeId('a'))).toEqual(['e-1'])
    expect(store.getIncidentEdges(asNodeId('b'))).toEqual(['e-1'])
  })

  test('hitTestEdge body returns the edge when point is on the curve', () => {
    const store = createCanvasStore()
    store.addNode(makeNode({ id: asNodeId('a'), x: 0, y: 0 }))
    store.addNode(makeNode({ id: asNodeId('b'), x: 400, y: 0 }))
    const edgeId = asEdgeId('e-1')
    store.addEdge({
      id: edgeId,
      source: { nodeId: asNodeId('a'), localOffset: { x: 200, y: 50 } },
      target: { nodeId: asNodeId('b'), localOffset: { x: 0, y: 50 } },
      pathStyle: 'straight',
      z: 0,
      groups: [],
    })
    // Midpoint of straight line: (300, 50)
    const hit = hitTestEdge(store, { x: 300, y: 50 }, 1)
    expect(hit?.edgeId).toBe(edgeId)
    expect(hit?.kind).toBe('body')
  })
})
