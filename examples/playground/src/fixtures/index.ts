/**
 * Stress fixtures — see IMPLEMENTATION.md §10.4.
 *
 * Each fixture mass-creates nodes via store.batch so the cost of generation
 * is captured by one OpBatch (and one repaint).
 */
import { type CanvasStore, type Node, asNodeId } from '@canvas-harness/core'

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
