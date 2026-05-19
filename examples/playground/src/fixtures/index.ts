/**
 * Stress fixtures — see IMPLEMENTATION.md §10.4.
 *
 * Each fixture mass-creates nodes via store.batch so the cost of generation
 * is captured by one OpBatch (and one repaint).
 */
import { type CanvasStore, type Node, asEdgeId, asNodeId } from '@canvas-harness/core'

type Primitive = 'rect' | 'ellipse' | 'diamond' | 'capsule'

const palette = ['#dbeafe', '#fef08a', '#fde68a', '#fecaca', '#bbf7d0', '#e9d5ff', '#fed7aa']
const types: Primitive[] = ['rect', 'ellipse', 'diamond', 'capsule']

export type FixtureResult = {
  added: number
  ms: number
}

export type Fixture = (store: CanvasStore) => FixtureResult

const seededRect = (store: CanvasStore, i: number, kind: 'mono' | 'mixed'): Node => {
  const cols = 50
  const x = (i % cols) * 50
  const y = Math.floor(i / cols) * 50
  return {
    id: asNodeId(store.generateId()),
    type: kind === 'mono' ? 'rect' : types[i % types.length]!,
    x,
    y,
    w: 40,
    h: 40,
    angle: 0,
    z: 0,
    groups: [],
    style: { backgroundColor: palette[i % palette.length] },
  }
}

const seedN = (store: CanvasStore, n: number, kind: 'mono' | 'mixed'): FixtureResult => {
  const t0 = performance.now()
  store.batch(() => {
    for (let i = 0; i < n; i++) store.addNode(seededRect(store, i, kind))
  })
  return { added: n, ms: performance.now() - t0 }
}

export const fixture100Rects: Fixture = store => seedN(store, 100, 'mono')
export const fixture1kRects: Fixture = store => seedN(store, 1000, 'mono')
export const fixture10kRects: Fixture = store => seedN(store, 10000, 'mono')
export const fixture1kMixed: Fixture = store => seedN(store, 1000, 'mixed')

/**
 * 1000 nodes (5 cols × 200 rows spread out) + 5000 bezier edges to random
 * other nodes. Stresses edge auto-clip, hit testing, and the
 * incidentEdges-driven drag invalidation.
 */
export const fixture5kEdges: Fixture = store => {
  const t0 = performance.now()
  const nodeCount = 1000
  const edgeCount = 5000
  let added = 0
  store.batch(() => {
    const nodeIds: import('@canvas-harness/core').NodeId[] = []
    for (let i = 0; i < nodeCount; i++) {
      const cols = 25
      const x = (i % cols) * 180
      const y = Math.floor(i / cols) * 120
      const id = asNodeId(store.generateId())
      nodeIds.push(id)
      store.addNode({
        id,
        type: 'rect',
        x,
        y,
        w: 80,
        h: 50,
        angle: 0,
        z: 0,
        groups: [],
      })
      added++
    }
    for (let i = 0; i < edgeCount; i++) {
      const a = nodeIds[Math.floor(Math.random() * nodeIds.length)]!
      let b = nodeIds[Math.floor(Math.random() * nodeIds.length)]!
      if (b === a) b = nodeIds[(nodeIds.indexOf(a) + 1) % nodeIds.length]!
      store.addEdge({
        id: asEdgeId(store.generateId()),
        source: { nodeId: a, localOffset: { x: 80, y: 25 } },
        target: { nodeId: b, localOffset: { x: 0, y: 25 } },
        pathStyle: 'bezier',
        z: 0,
        groups: [],
      })
      added++
    }
  })
  return { added, ms: performance.now() - t0 }
}

export const clearScene: Fixture = store => {
  const t0 = performance.now()
  const nodeCount = store.getAllNodes().length
  const edgeCount = store.getAllEdges().length
  store.batch(() => {
    for (const e of store.getAllEdges()) store.removeEdge(e.id)
    for (const n of store.getAllNodes()) store.removeNode(n.id)
  })
  return { added: -(nodeCount + edgeCount), ms: performance.now() - t0 }
}
