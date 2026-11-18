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
import { autoRouteControls, sideOf, sideToward } from '../src/edges/auto-route'
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

  test('sideToward picks the cardinal side facing the target', () => {
    const n = makeNode({ x: 0, y: 0, w: 100, h: 100, angle: 0 })
    expect(sideToward(n, { x: 500, y: 50 })).toBe('e')
    expect(sideToward(n, { x: -500, y: 50 })).toBe('w')
    expect(sideToward(n, { x: 50, y: -500 })).toBe('n')
    expect(sideToward(n, { x: 50, y: 500 })).toBe('s')
  })

  test('sideToward is rotation-aware', () => {
    // 90° rotation: local +x axis points along world +y. A target at
    // world (50, 500) is "east" in the node's local frame.
    const n = makeNode({ x: 0, y: 0, w: 100, h: 100, angle: Math.PI / 2 })
    expect(sideToward(n, { x: 50, y: 500 })).toBe('e')
    expect(sideToward(n, { x: 50, y: -500 })).toBe('w')
  })

  test('sideToward returns deterministic fallback for coincident point', () => {
    const n = makeNode({ x: 0, y: 0, w: 100, h: 100, angle: 0 })
    // World (50, 50) is the node center → zero ray direction.
    expect(sideToward(n, { x: 50, y: 50 })).toBe('e')
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

  const nodeA = () => makeNode({ id: asNodeId('a'), x: 0, y: 0, w: 100, h: 100 })

  test('keeps a straight edge whose endpoints sit on both node borders', () => {
    const targetNode = makeNode({ id: asNodeId('b'), x: 200, y: 0, w: 100, h: 100 })
    const samples = [
      { x: 100, y: 50 },
      { x: 200, y: 50 },
    ]
    const clip = clipSamples(samples, nodeA(), targetNode)
    expect(clip.visible).toBe(true)
    // Border endpoints heading outward are untrimmed: the endpoints themselves.
    expect(clip.startIndex).toBe(0)
    expect(clip.endIndex).toBe(1)
    expect(clip.startPoint).toEqual({ x: 100, y: 50 })
    expect(clip.endPoint).toEqual({ x: 200, y: 50 })
  })

  test('keeps both bends of a border-to-border polyline in the painted run', () => {
    // A's east border → bend → B's top border. The renderer paints
    // samples[startIndex+1..endIndex-1], which must include the bend.
    const targetNode = makeNode({ id: asNodeId('b'), x: 300, y: 300, w: 100, h: 100 })
    const samples = [
      { x: 100, y: 50 },
      { x: 350, y: 50 },
      { x: 350, y: 300 },
    ]
    const clip = clipSamples(samples, nodeA(), targetNode)
    expect(clip.visible).toBe(true)
    expect(clip.startIndex).toBe(0)
    expect(clip.endIndex).toBe(2)
    expect(samples.slice(clip.startIndex + 1, clip.endIndex)).toEqual([{ x: 350, y: 50 }])
  })

  test('keeps the full line from a border source to a free target', () => {
    // Source on the west border, target dropped in empty space.
    const samples = [
      { x: 0, y: 50 },
      { x: -150, y: 200 },
    ]
    const clip = clipSamples(samples, nodeA(), null)
    expect(clip.visible).toBe(true)
    expect(clip.startPoint).toEqual({ x: 0, y: 50 })
    expect(clip.endPoint).toEqual({ x: -150, y: 200 })
  })

  test('treats endpoints a hair off the border (round-off) as on it', () => {
    const targetNode = makeNode({ id: asNodeId('b'), x: 200, y: 0, w: 100, h: 100 })
    const samples = [
      { x: 100 - 1e-9, y: 50 },
      { x: 200 + 1e-9, y: 50 },
    ]
    const clip = clipSamples(samples, nodeA(), targetNode)
    expect(clip.visible).toBe(true)
    expect(clip.startIndex).toBe(0)
    expect(clip.endIndex).toBe(1)
    expect(clip.startPoint).toEqual(samples[0])
    expect(clip.endPoint).toEqual(samples[1])
    // A hair outside the border: the endpoint is simply untrimmed.
    const outside = clipSamples(
      [
        { x: 100 + 1e-9, y: 50 },
        { x: 200 - 1e-9, y: 50 },
      ],
      nodeA(),
      targetNode,
    )
    expect(outside.startIndex).toBe(0)
    expect(outside.endIndex).toBe(1)
  })

  test('clips a 2-sample straight edge attached at both node centers', () => {
    const targetNode = makeNode({ id: asNodeId('b'), x: 200, y: 0, w: 100, h: 100 })
    const samples = [
      { x: 50, y: 50 },
      { x: 250, y: 50 },
    ]
    const clip = clipSamples(samples, nodeA(), targetNode)
    expect(clip.visible).toBe(true)
    expect(clip.startPoint.x).toBeCloseTo(100)
    expect(clip.endPoint.x).toBeCloseTo(200)
  })

  test('still clips a border endpoint whose path heads into its own node', () => {
    // Starts on the west border and runs east through the node.
    const samples = [
      { x: 0, y: 50 },
      { x: 300, y: 50 },
    ]
    const clip = clipSamples(samples, nodeA(), null)
    expect(clip.visible).toBe(true)
    expect(clip.startPoint.x).toBeCloseTo(100)
  })

  test('clips an inward border path at its far-side exit across many samples', () => {
    // North-border start dipping through the node, leaving via the east side.
    const samples = [
      { x: 30, y: 0 },
      { x: 60, y: 40 },
      { x: 90, y: 50 },
      { x: 150, y: 50 },
    ]
    const clip = clipSamples(samples, nodeA(), null)
    expect(clip.startIndex).toBe(3)
    expect(clip.startPoint.x).toBeCloseTo(100)
    expect(clip.startPoint.y).toBeCloseTo(50)
  })

  test('keeps the original index meaning: first sample past the clip point', () => {
    const targetNode = makeNode({ id: asNodeId('b'), x: 300, y: 0, w: 100, h: 100 })
    const samples = [
      { x: 50, y: 50 },
      { x: 200, y: 50 },
      { x: 350, y: 50 },
    ]
    const clip = clipSamples(samples, nodeA(), targetNode)
    expect(clip.startIndex).toBe(1)
    expect(clip.endIndex).toBe(1)
  })

  test('keeps the bend after a later sample lying on the border', () => {
    // Center → border sample → bend → down: the clip lands on samples[1].
    const samples = [
      { x: 50, y: 50 },
      { x: 100, y: 50 },
      { x: 200, y: 50 },
      { x: 200, y: 300 },
    ]
    const clip = clipSamples(samples, nodeA(), null)
    expect(clip.startIndex).toBe(1)
    expect(clip.startPoint).toEqual({ x: 100, y: 50 })
    expect(samples.slice(clip.startIndex + 1, clip.endIndex)).toEqual([{ x: 200, y: 50 }])
  })

  test('treats a border endpoint on a rotated node as on the border', () => {
    // East-border midpoint of a rotated node, projected to world (round-off
    // from cos/sin), heading outward along the node's local +x.
    const node = makeNode({ id: asNodeId('a'), x: 0, y: 0, w: 100, h: 100, angle: 0.7 })
    const at = (lx: number, ly: number) => nodeLocalToWorld({ x: lx, y: ly }, node)
    const samples = [at(100, 50), at(150, 50), at(150, 300)]
    const clip = clipSamples(samples, node, null)
    expect(clip.visible).toBe(true)
    expect(clip.startIndex).toBe(0)
    expect(clip.startPoint).toEqual(samples[0])
  })

  test('snaps a near-border endpoint leaving at a shallow angle', () => {
    // 5e-7 inside the east border, first segment almost parallel to it.
    const samples = [
      { x: 100 - 5e-7, y: 50 },
      { x: 100.001, y: 1000 },
      { x: 500, y: 1000 },
    ]
    const clip = clipSamples(samples, nodeA(), null)
    expect(clip.startIndex).toBe(0)
    expect(samples.slice(clip.startIndex + 1, clip.endIndex)).toEqual([{ x: 100.001, y: 1000 }])
  })

  test('mirrors the border rules at the target end', () => {
    const targetNode = makeNode({ id: asNodeId('b'), x: 300, y: 0, w: 100, h: 100 })
    // Inward: target on B's east border, path arriving from the west through
    // B, so it's trimmed where it enters B's west side.
    const inward = clipSamples(
      [
        { x: 0, y: 50 },
        { x: 400, y: 50 },
      ],
      null,
      targetNode,
    )
    expect(inward.endPoint.x).toBeCloseTo(300)
    // A later sample on B's border: the bend before it stays painted.
    const samples = [
      { x: 150, y: 300 },
      { x: 150, y: 50 },
      { x: 300, y: 50 },
      { x: 350, y: 50 },
    ]
    const clip = clipSamples(samples, null, targetNode)
    expect(clip.endIndex).toBe(2)
    expect(clip.endPoint).toEqual({ x: 300, y: 50 })
    expect(samples.slice(clip.startIndex + 1, clip.endIndex)).toEqual([{ x: 150, y: 50 }])
  })

  test('hides an edge between touching nodes (zero-length span)', () => {
    const targetNode = makeNode({ id: asNodeId('b'), x: 100, y: 0, w: 100, h: 100 })
    const samples = [
      { x: 50, y: 50 },
      { x: 150, y: 50 },
    ]
    expect(clipSamples(samples, nodeA(), targetNode).visible).toBe(false)
  })

  test('hides touching nodes when a sample lands exactly on the shared border', () => {
    const targetNode = makeNode({ id: asNodeId('b'), x: 100, y: 0, w: 100, h: 100 })
    const samples = [
      { x: 50, y: 50 },
      { x: 100, y: 50 },
      { x: 150, y: 50 },
    ]
    expect(clipSamples(samples, nodeA(), targetNode).visible).toBe(false)
  })

  test('keeps very short edges between nearly touching nodes despite round-off', () => {
    // Center-to-center edges across a 0.5-unit gap, over many non-round
    // sizes: round-off between the two node frames must not hide them.
    for (let i = 1; i <= 200; i++) {
      const w = 37.3 + i * 1.7
      const x = 0.1 * i
      const sourceNode = makeNode({ id: asNodeId('a'), x, y: 0, w, h: 80 })
      const targetNode = makeNode({ id: asNodeId('b'), x: x + w + 0.5, y: 0, w: w * 0.6, h: 80 })
      const samples = [
        { x: x + w / 2, y: 40 + i * 0.01 },
        { x: x + w + 0.5 + w * 0.3, y: 40 - i * 0.013 },
      ]
      expect(clipSamples(samples, sourceNode, targetNode).visible).toBe(true)
    }
  })

  test('hides a straight edge whose clip points cross on one segment (overlapping nodes)', () => {
    // Source spans x 0..150, target x 100..250: the source exit (150) lies
    // past the target entry (100) on the same segment.
    const sourceNode = makeNode({ id: asNodeId('a'), x: 0, y: 0, w: 150, h: 100 })
    const targetNode = makeNode({ id: asNodeId('b'), x: 100, y: 0, w: 150, h: 100 })
    const samples = [
      { x: 50, y: 50 },
      { x: 200, y: 50 },
    ]
    expect(clipSamples(samples, sourceNode, targetNode).visible).toBe(false)
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

describe('bezier auto-route (unified rule)', () => {
  test('both endpoints inside body: endpoints stay at localOffset, controls aim outward', () => {
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
    // Endpoints stay at user-supplied localOffsets — no boundary snap.
    expect(geom.source).toEqual({ x: 50, y: 50 })
    expect(geom.target).toEqual({ x: 450, y: 50 })
    // First sample is the source endpoint (clipSamples runs later in
    // the renderer to trim the inside-rect part).
    expect(geom.samples[0]).toEqual({ x: 50, y: 50 })
    expect(geom.samples[geom.samples.length - 1]).toEqual({ x: 450, y: 50 })
  })

  test('user-placed boundary anchors: endpoints respected', () => {
    const src = makeNode({ id: asNodeId('a'), x: 0, y: 0, w: 100, h: 100 })
    const tgt = makeNode({ id: asNodeId('b'), x: 400, y: 0, w: 100, h: 100 })
    const getNode = (id: string) => (id === 'a' ? src : id === 'b' ? tgt : undefined)
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

  test('mixed (one boundary, one inside): endpoints respected', () => {
    const src = makeNode({ id: asNodeId('a'), x: 0, y: 0, w: 100, h: 100 })
    const tgt = makeNode({ id: asNodeId('b'), x: 400, y: 0, w: 100, h: 100 })
    const getNode = (id: string) => (id === 'a' ? src : id === 'b' ? tgt : undefined)
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
    expect(geom.source).toEqual({ x: 100, y: 50 })
    expect(geom.target).toEqual({ x: 450, y: 50 })
  })
})
