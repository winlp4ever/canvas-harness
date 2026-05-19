/**
 * Stress fixtures — see IMPLEMENTATION.md §10.4.
 *
 * Each fixture mass-creates nodes via store.batch so the cost of generation
 * is captured by one OpBatch (and one repaint).
 */
import { type CanvasStore, type Node, asEdgeId, asNodeId } from '@canvas-harness/core'

const CARD_PALETTE = ['#fef3c7', '#fce7f3', '#dbeafe', '#dcfce7', '#ede9fe', '#fee2e2']
const CARD_TITLES = ['Q3 Revenue', 'Active Users', 'Errors', 'Latency', 'Churn', 'Conversion']

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

const MARKDOWN_CONTENTS = [
  '**Hire** Lara before _Q3_\n- write JD\n- schedule loop\n- get budget',
  '`/api/users` returning 500s\n- need to check **logs**\n- ping the team',
  'Goals:\n- ==focus==\n- ==ship== fast\n- *measure* impact',
  '# meeting\n1. status\n2. blockers\n3. next steps',
  '```\nconst x = 1\nconst y = 2\n```',
  '_Reminder:_ deploy at __5pm__\n---\nrollback plan ready',
  'See ~~old~~ **new** doc at [link](https://example.com)',
  'Pros\n- fast\n- cheap\n\nCons\n- ~~ugly~~\n- tedious',
  '**Status:** ==in progress==\n→ blocked on review',
  'Idea: caching layer for **edge geometry**\n`O(1)` lookups',
]
const MARKDOWN_FAMILIES = ['handwriting', 'sans-serif', 'serif', 'monospace', 'informal'] as const
const MARKDOWN_SIZES = ['S', 'M', 'L'] as const
const MARKDOWN_FILLS = ['#fef9c3', '#fce7f3', '#dbeafe', '#dcfce7', '#fee2e2', '#ede9fe']

/**
 * 1000 rect stickies with multi-line markdown content. Stresses the
 * tokenizer + layout + bitmap cache. Cache key includes font/size, so
 * variety across the fixture exercises eviction.
 */
export const fixtureMarkdownHeavy: Fixture = store => {
  const t0 = performance.now()
  const count = 1000
  store.batch(() => {
    for (let i = 0; i < count; i++) {
      const cols = 25
      const x = (i % cols) * 240
      const y = Math.floor(i / cols) * 180
      store.addNode({
        id: asNodeId(store.generateId()),
        type: 'rect',
        x,
        y,
        w: 220,
        h: 160,
        angle: 0,
        z: 0,
        groups: [],
        content: MARKDOWN_CONTENTS[i % MARKDOWN_CONTENTS.length]!,
        style: {
          backgroundColor: MARKDOWN_FILLS[i % MARKDOWN_FILLS.length]!,
          fontFamily: MARKDOWN_FAMILIES[i % MARKDOWN_FAMILIES.length]!,
          fontSize: MARKDOWN_SIZES[i % MARKDOWN_SIZES.length]!,
          textAlign: 'left',
        },
      })
    }
  })
  return { added: count, ms: performance.now() - t0 }
}

/**
 * 200 chart-card custom nodes. Stresses the DOM overlay viewport culling
 * and the LOD ladder. The chart-card type must be registered with the
 * store (via createCanvasStore({ nodeTypes: [chartCardDef] })) before
 * loading this fixture; nothing will render otherwise.
 */
export const fixture200Cards: Fixture = store => {
  const t0 = performance.now()
  const count = 200
  store.batch(() => {
    for (let i = 0; i < count; i++) {
      const cols = 12
      const x = (i % cols) * 200
      const y = Math.floor(i / cols) * 140
      const palette = CARD_PALETTE[i % CARD_PALETTE.length]!
      const title = CARD_TITLES[i % CARD_TITLES.length]!
      const series = [3 + (i % 6), 1 + ((i * 7) % 9), 2 + ((i * 13) % 8), 4 + ((i * 5) % 5)]
      store.addNode({
        id: asNodeId(store.generateId()),
        type: 'chart-card',
        x,
        y,
        w: 180,
        h: 120,
        angle: 0,
        z: 0,
        groups: [],
        data: { title, series, fill: palette },
      })
    }
  })
  return { added: count, ms: performance.now() - t0 }
}

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
