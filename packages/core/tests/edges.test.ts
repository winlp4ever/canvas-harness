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
import { autoRouteControls, computeAsymmetricRoute, sideOf } from '../src/edges/auto-route'
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

describe('computeAsymmetricRoute', () => {
  test('source-right-of-target: source exits via right side, target enters via left side', () => {
    const src = makeNode({ id: asNodeId('a'), x: 0, y: 0, w: 100, h: 100 })
    const tgt = makeNode({ id: asNodeId('b'), x: 400, y: 0, w: 100, h: 100 })
    const r = computeAsymmetricRoute(src, tgt)
    // Source center (50, 50). Target center (450, 50). Pure horizontal.
    // Source exit must be on src right edge (x = 100, y = 50).
    expect(r.source.x).toBeCloseTo(100)
    expect(r.source.y).toBeCloseTo(50)
    // Target enters left side (x = 400, y = 50).
    expect(r.target.x).toBeCloseTo(400)
    expect(r.target.y).toBeCloseTo(50)
    // Source control points right (toward target).
    expect(r.c1.x).toBeGreaterThan(r.source.x)
    expect(r.c1.y).toBeCloseTo(r.source.y)
    // Target control points left (outward from target's left side).
    expect(r.c2.x).toBeLessThan(r.target.x)
    expect(r.c2.y).toBeCloseTo(r.target.y)
  })

  test('target above source: target enters via its bottom side', () => {
    const src = makeNode({ id: asNodeId('a'), x: 0, y: 500, w: 100, h: 100 })
    const tgt = makeNode({ id: asNodeId('b'), x: 0, y: 0, w: 100, h: 100 })
    const r = computeAsymmetricRoute(src, tgt)
    // Target is above source → enters from its bottom side (y = 100).
    expect(r.target.y).toBeCloseTo(100)
    // Source exits via its top side (y = 500).
    expect(r.source.y).toBeCloseTo(500)
    // Target control points downward (outward from bottom side).
    expect(r.c2.y).toBeGreaterThan(r.target.y)
  })

  test('diagonal layout: source emerges radially, target enters perpendicular', () => {
    const src = makeNode({ id: asNodeId('a'), x: 0, y: 0, w: 100, h: 100 })
    const tgt = makeNode({ id: asNodeId('b'), x: 500, y: 400, w: 100, h: 100 })
    const r = computeAsymmetricRoute(src, tgt)
    // Source center (50, 50). Target center (550, 450). Target is
    // far-right and far-down. dxNorm = 500/50 = 10, dyNorm = 400/50 = 8;
    // |dx| > |dy| → target's facing side is 'w' (left), entry at left edge.
    expect(r.target.x).toBeCloseTo(500)
    // Source exit lies on the line from source center toward target
    // entry, so its y > 50 (heading down) and x > 50 (heading right).
    expect(r.source.x).toBeGreaterThan(50)
    expect(r.source.y).toBeGreaterThan(50)
    // Source control offsets from exit along the radial direction
    // (away from source, toward target).
    const expectedRadialX = r.target.x - r.source.x
    const expectedRadialY = r.target.y - r.source.y
    const c1OffsetX = r.c1.x - r.source.x
    const c1OffsetY = r.c1.y - r.source.y
    expect(Math.sign(c1OffsetX)).toBe(Math.sign(expectedRadialX))
    expect(Math.sign(c1OffsetY)).toBe(Math.sign(expectedRadialY))
    // Target control offsets along target's left-side outward normal
    // (pointing left, away from target).
    expect(r.c2.x).toBeLessThan(r.target.x)
    expect(r.c2.y).toBeCloseTo(r.target.y)
  })

  test('both endpoints inside-body: asymmetric route fires (endpoints snap to boundary)', () => {
    // AI-style edge with both anchors at node centers (inside body) →
    // cache.ts triggers the asymmetric route and snaps the endpoints
    // to the rect boundaries facing each other.
    const src = makeNode({ id: asNodeId('a'), x: 0, y: 0, w: 100, h: 100 })
    const tgt = makeNode({ id: asNodeId('b'), x: 400, y: 0, w: 100, h: 100 })
    const getNode = (id: string) => (id === 'a' ? src : id === 'b' ? tgt : undefined)
    const edge: Edge = {
      id: asEdgeId('e-1'),
      source: { nodeId: asNodeId('a'), localOffset: { x: 50, y: 50 } },
      target: { nodeId: asNodeId('b'), localOffset: { x: 50, y: 50 } },
      pathStyle: 'bezier',
      z: 0,
      groups: [],
    }
    const geom = computeEdgeGeometry(
      edge,
      getNode as (id: import('../src/types').NodeId) => Node | undefined,
    )!
    // Source endpoint snapped to src's right edge (x = 100).
    expect(geom.source.x).toBeCloseTo(100)
    expect(geom.source.y).toBeCloseTo(50)
    // Target endpoint snapped to tgt's left edge (x = 400).
    expect(geom.target.x).toBeCloseTo(400)
    expect(geom.target.y).toBeCloseTo(50)
  })

  test('user-placed boundary anchors: endpoints respected (no asymmetric override)', () => {
    // Drag-created edge whose anchors land on the boundary →
    // cache.ts skips the asymmetric route and the geometry honors
    // the user's exact pick.
    const src = makeNode({ id: asNodeId('a'), x: 0, y: 0, w: 100, h: 100 })
    const tgt = makeNode({ id: asNodeId('b'), x: 400, y: 0, w: 100, h: 100 })
    const getNode = (id: string) => (id === 'a' ? src : id === 'b' ? tgt : undefined)
    // Anchors at top-center of source and bottom-center of target —
    // both lie on the boundary (y = 0 / y = h).
    const edge: Edge = {
      id: asEdgeId('e-1'),
      source: { nodeId: asNodeId('a'), localOffset: { x: 50, y: 0 } },
      target: { nodeId: asNodeId('b'), localOffset: { x: 50, y: 100 } },
      pathStyle: 'bezier',
      z: 0,
      groups: [],
    }
    const geom = computeEdgeGeometry(
      edge,
      getNode as (id: import('../src/types').NodeId) => Node | undefined,
    )!
    expect(geom.source).toEqual({ x: 50, y: 0 })
    expect(geom.target).toEqual({ x: 450, y: 100 })
  })

  test('mixed (one boundary, one inside): existing logic, no asymmetric override', () => {
    const src = makeNode({ id: asNodeId('a'), x: 0, y: 0, w: 100, h: 100 })
    const tgt = makeNode({ id: asNodeId('b'), x: 400, y: 0, w: 100, h: 100 })
    const getNode = (id: string) => (id === 'a' ? src : id === 'b' ? tgt : undefined)
    // Source anchor on boundary, target anchor inside body.
    const edge: Edge = {
      id: asEdgeId('e-1'),
      source: { nodeId: asNodeId('a'), localOffset: { x: 100, y: 50 } },
      target: { nodeId: asNodeId('b'), localOffset: { x: 50, y: 50 } },
      pathStyle: 'bezier',
      z: 0,
      groups: [],
    }
    const geom = computeEdgeGeometry(
      edge,
      getNode as (id: import('../src/types').NodeId) => Node | undefined,
    )!
    // Source kept at the user's boundary anchor.
    expect(geom.source).toEqual({ x: 100, y: 50 })
    // Target kept at the localOffset world (50, 50 inside its rect)
    // — no boundary override, clipSamples handles the inside-rect part.
    expect(geom.target).toEqual({ x: 450, y: 50 })
  })
})
