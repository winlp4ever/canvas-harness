/**
 * Stress fixtures — see IMPLEMENTATION.md §10.4.
 *
 * Each fixture mass-creates nodes via store.batch so the cost of generation
 * is captured by one OpBatch (and one repaint).
 */
import { type CanvasStore, type Node, asEdgeId, asNodeId } from '@canvas-harness/core'

const CARD_PALETTE = ['#fef3c7', '#fce7f3', '#dbeafe', '#dcfce7', '#ede9fe', '#fee2e2']
const CARD_TITLES = ['Q3 Revenue', 'Active Users', 'Errors', 'Latency', 'Churn', 'Conversion']

type Primitive =
  | 'rect'
  | 'ellipse'
  | 'diamond'
  | 'tag'
  | 'capsule'
  | 'thought-cloud'
  | 'layered-rect'
  | 'layered-ellipse'
  | 'layered-diamond'
  | 'soft-diamond'

const palette = ['#dbeafe', '#fef08a', '#fde68a', '#fecaca', '#bbf7d0', '#e9d5ff', '#fed7aa']

// "Atomic" pool: shapes that paint as a single drawable per node.
// Includes capsule because, while it's a composite, both sub-shapes
// are simple primitives.
const ATOMIC_TYPES: Primitive[] = ['rect', 'ellipse', 'diamond', 'capsule']

// "Layered" pool: shapes that paint two sub-drawables per node
// (darker back + front, offset). Composite-paint heavy.
const LAYERED_TYPES: Primitive[] = [
  'layered-rect',
  'layered-ellipse',
  'layered-diamond',
  'soft-diamond',
]

// "SVG-path" pool: shapes whose silhouette is a custom union path
// with curves and arcs. Their rough drawables are slower to build
// because rough.js has to subdivide and apply bowing to curves.
const SVG_TYPES: Primitive[] = ['tag', 'thought-cloud']

const SeedKind = {
  Mono: 'mono',
  Atomic: 'atomic',
  Layered: 'layered',
  Svg: 'svg',
} as const
type SeedKindValue = (typeof SeedKind)[keyof typeof SeedKind]

export type FixtureResult = {
  added: number
  ms: number
}

export type Fixture = (store: CanvasStore) => FixtureResult | Promise<FixtureResult>

const pickType = (i: number, kind: SeedKindValue): Primitive => {
  if (kind === SeedKind.Mono) return 'rect'
  if (kind === SeedKind.Atomic) return ATOMIC_TYPES[i % ATOMIC_TYPES.length]!
  if (kind === SeedKind.Layered) return LAYERED_TYPES[i % LAYERED_TYPES.length]!
  return SVG_TYPES[i % SVG_TYPES.length]!
}

// Omit-z return so each fresh fixture node climbs `topZ` on add and
// gets a unique stacking position. If we returned a fixed z (e.g. 0),
// 10k nodes would all stack at the same z and fall back to id-tiebreak
// (which goes lexicographic at counter > 9 — visible mis-orderings).
const seededRect = (store: CanvasStore, i: number, kind: SeedKindValue): Omit<Node, 'z'> => {
  const cols = 50
  const x = (i % cols) * 50
  const y = Math.floor(i / cols) * 50
  return {
    id: asNodeId(store.generateId()),
    type: pickType(i, kind),
    x,
    y,
    w: 40,
    h: 40,
    angle: 0,
    groups: [],
    style: { backgroundColor: palette[i % palette.length], roughness: 1 },
  }
}

const seedN = (store: CanvasStore, n: number, kind: SeedKindValue): FixtureResult => {
  const t0 = performance.now()
  store.batch(() => {
    for (let i = 0; i < n; i++) store.addNode(seededRect(store, i, kind))
  })
  return { added: n, ms: performance.now() - t0 }
}

export const fixture100Rects: Fixture = store => seedN(store, 100, SeedKind.Mono)
export const fixture1kRects: Fixture = store => seedN(store, 1000, SeedKind.Mono)
export const fixture10kRects: Fixture = store => seedN(store, 10000, SeedKind.Mono)
export const fixture1kAtomic: Fixture = store => seedN(store, 1000, SeedKind.Atomic)
export const fixture1kLayered: Fixture = store => seedN(store, 1000, SeedKind.Layered)
export const fixture1kSvg: Fixture = store => seedN(store, 1000, SeedKind.Svg)

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
 * 25 rect notes carrying LaTeX math (inline `$...$` only). Exercises
 * the MathJax lazy load, compile queue, and bitmap cache. First load
 * pulls the ~600KB MathJax chunk; subsequent runs reuse the cache.
 */
const MATH_CONTENTS = [
  'Mass–energy: $E = mc^2$',
  'Pythagoras: $a^2 + b^2 = c^2$',
  'Quadratic: $x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$',
  "Euler's identity: $e^{i\\pi} + 1 = 0$",
  'Sum: $\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}$',
  'Limit: $\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1$',
  'Integral: $\\int_{0}^{1} x^2 \\,dx = \\frac{1}{3}$',
  'Binomial: $(a+b)^n = \\sum_{k=0}^{n} \\binom{n}{k} a^{n-k} b^k$',
  'Probability: $P(A \\cup B) = P(A) + P(B) - P(A \\cap B)$',
  'Maxwell: $\\nabla \\times \\mathbf{E} = -\\frac{\\partial \\mathbf{B}}{\\partial t}$',
]

export const fixtureMathHeavy: Fixture = store => {
  const t0 = performance.now()
  const count = 25
  store.batch(() => {
    for (let i = 0; i < count; i++) {
      const cols = 5
      const x = (i % cols) * 260
      const y = Math.floor(i / cols) * 140
      store.addNode({
        id: asNodeId(store.generateId()),
        type: 'rect',
        x,
        y,
        w: 240,
        h: 120,
        angle: 0,
        groups: [],
        content: MATH_CONTENTS[i % MATH_CONTENTS.length]!,
        style: {
          backgroundColor: MARKDOWN_FILLS[i % MARKDOWN_FILLS.length]!,
          fontFamily: 'sans-serif',
          fontSize: 'M',
          textAlign: 'left',
          roughness: 1,
        },
      })
    }
  })
  return { added: count, ms: performance.now() - t0 }
}

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
        groups: [],
        content: MARKDOWN_CONTENTS[i % MARKDOWN_CONTENTS.length]!,
        style: {
          backgroundColor: MARKDOWN_FILLS[i % MARKDOWN_FILLS.length]!,
          fontFamily: MARKDOWN_FAMILIES[i % MARKDOWN_FAMILIES.length]!,
          fontSize: MARKDOWN_SIZES[i % MARKDOWN_SIZES.length]!,
          textAlign: 'left',
          roughness: 1,
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
        groups: [],
        style: { roughness: 1 },
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
        groups: [],
        style: { roughness: 1 },
      })
      added++
    }
  })
  return { added, ms: performance.now() - t0 }
}

/**
 * 1000 labeled edges. Pairs the existing nodes (creating some if
 * needed); applies short random labels from the rotation. Stresses the
 * edge-label paint path (Phase 12.5) — `getOrRenderTextBitmap` for
 * labels + arc-length anchor computation per frame.
 */
const LABEL_POOL = [
  'depends on',
  'blocks',
  'yes',
  'no',
  'maybe',
  'related',
  'next',
  'prev',
  'parent',
  'child',
  '→',
  'fork',
  'merge',
  'TODO',
  'WIP',
  'done',
]
export const fixture1kLabeledEdges: Fixture = store => {
  const t0 = performance.now()
  const edgeCount = 1000
  let added = 0
  store.batch(() => {
    let nodeIds: import('@canvas-harness/core').NodeId[] = store.getAllNodes().map(n => n.id)
    // Ensure at least ~500 nodes so we have variety.
    if (nodeIds.length < 500) {
      const cols = 25
      const need = 500 - nodeIds.length
      for (let i = 0; i < need; i++) {
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
          groups: [],
          style: { roughness: 1 },
        })
        added++
      }
    }
    nodeIds = store.getAllNodes().map(n => n.id)
    for (let i = 0; i < edgeCount; i++) {
      const a = nodeIds[Math.floor(Math.random() * nodeIds.length)]!
      let b = nodeIds[Math.floor(Math.random() * nodeIds.length)]!
      if (b === a) b = nodeIds[(nodeIds.indexOf(a) + 1) % nodeIds.length]!
      store.addEdge({
        id: asEdgeId(store.generateId()),
        source: { nodeId: a, localOffset: { x: 80, y: 25 } },
        target: { nodeId: b, localOffset: { x: 0, y: 25 } },
        pathStyle: 'bezier',
        groups: [],
        content: LABEL_POOL[i % LABEL_POOL.length],
        style: { roughness: 1 },
      })
      added++
    }
  })
  return { added, ms: performance.now() - t0 }
}

// Five inline SVG icons used by the image-heavy fixture. Each uses
// `currentColor` so the per-node `style.iconColor` substitution exercises
// the rasterizer cache key.
const SVG_ICONS = [
  // heart
  `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`,
  // star
  `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
  // gear
  `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
  // check
  `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  // x
  `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="6"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
]

const ICON_TINTS = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899']

/**
 * Generates a small procedural PNG via OffscreenCanvas. Each tile is a
 * gradient + a contrasting circle so the renderer's downscaler + bitmap
 * cache have something distinct to chew on per node. Returns a data URI.
 */
const makeProceduralPng = async (i: number, size = 256): Promise<string> => {
  const canvas = new OffscreenCanvas(size, size)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('OffscreenCanvas 2d unavailable')
  const hue = (i * 47) % 360
  const grad = ctx.createLinearGradient(0, 0, size, size)
  grad.addColorStop(0, `hsl(${hue}, 70%, 70%)`)
  grad.addColorStop(1, `hsl(${(hue + 60) % 360}, 70%, 45%)`)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)
  ctx.fillStyle = `hsl(${(hue + 180) % 360}, 80%, 60%)`
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, size / 3, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.font = `bold ${size / 5}px system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(String(i), size / 2, size / 2)
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('FileReader returned non-string result'))
    }
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'))
    reader.readAsDataURL(blob)
  })
}

/**
 * Adds 30 procedural raster images + 30 SVG icons in a tidy grid.
 * Stresses the asset pipeline end-to-end: validation, downscale,
 * data-URI round-trip, SVG sanitize + dimension extraction, and the
 * renderer's image / icon paint paths.
 */
export const fixtureImagesAndSvgs: Fixture = async store => {
  const t0 = performance.now()
  const imageCount = 30
  const iconCount = 30
  const cols = 10

  // Generate procedural PNGs in parallel — addImage itself awaits the
  // downscale, but PNG generation can pipeline through OffscreenCanvas
  // without contention.
  const pngs = await Promise.all(Array.from({ length: imageCount }, (_, i) => makeProceduralPng(i)))

  let added = 0
  for (let i = 0; i < imageCount; i++) {
    const x = (i % cols) * 140
    const y = Math.floor(i / cols) * 140
    await store.addImage({
      src: pngs[i]!,
      x,
      y,
      w: 120,
      h: 120,
      alt: `procedural ${i}`,
    })
    added++
  }

  for (let i = 0; i < iconCount; i++) {
    const x = (i % cols) * 140
    const y = Math.floor((imageCount + i) / cols) * 140 + 40 // shift below images
    await store.addSvg({
      src: SVG_ICONS[i % SVG_ICONS.length]!,
      x,
      y,
      w: 64,
      h: 64,
      color: ICON_TINTS[i % ICON_TINTS.length]!,
      alt: `icon ${i}`,
    })
    added++
  }

  return { added, ms: performance.now() - t0 }
}

/**
 * Mindmap with a central node and N peripheral nodes radiating around
 * it, connected by edges whose endpoints are at the **center** of each
 * node (localOffset = w/2, h/2). This is the AI-/programmatic-style
 * anchor that triggers the asymmetric auto-route (radial exit on
 * source, perpendicular entry on target). Use to eyeball how edges
 * leave the central node toward each peripheral, and how they enter
 * each peripheral perpendicular to its facing side.
 */
export const fixtureMindmap: Fixture = store => {
  const t0 = performance.now()
  const camera = store.getCamera()
  const centerX = camera.x + 400
  const centerY = camera.y + 300
  const centralW = 220
  const centralH = 120
  const peripheralW = 140
  const peripheralH = 70
  const radius = 360
  const N = 12
  let added = 0
  store.batch(() => {
    const centerId = asNodeId(store.generateId())
    store.addNode({
      id: centerId,
      type: 'rect',
      x: centerX - centralW / 2,
      y: centerY - centralH / 2,
      w: centralW,
      h: centralH,
      angle: 0,
      groups: [],
      content: 'Mindmap',
      style: { backgroundColor: '#c7d2fe', roundness: 2 },
    })
    added++
    for (let i = 0; i < N; i++) {
      const angle = (i / N) * Math.PI * 2 - Math.PI / 2
      const px = centerX + Math.cos(angle) * radius
      const py = centerY + Math.sin(angle) * radius
      const id = asNodeId(store.generateId())
      store.addNode({
        id,
        type: 'rect',
        x: px - peripheralW / 2,
        y: py - peripheralH / 2,
        w: peripheralW,
        h: peripheralH,
        angle: 0,
        groups: [],
        content: `Topic ${i + 1}`,
        style: { backgroundColor: CARD_PALETTE[i % CARD_PALETTE.length], roundness: 2 },
      })
      added++
      // Center-anchored edge — triggers the asymmetric auto-route.
      store.addEdge({
        id: asEdgeId(store.generateId()),
        source: { nodeId: centerId, localOffset: { x: centralW / 2, y: centralH / 2 } },
        target: { nodeId: id, localOffset: { x: peripheralW / 2, y: peripheralH / 2 } },
        pathStyle: 'bezier',
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
