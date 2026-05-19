import type { CanvasStore } from '../store'
import { isAttached } from '../types'
import type { Edge, EdgeEnd, EdgeId, Node, NodeId } from '../types'

/**
 * AI scene context — see ARCHITECTURE.md §13.
 *
 * Returns a human- or machine-readable snapshot of the scene for use
 * as a system-prompt payload or AI tool-call argument. **Markdown is
 * the prose form** (better for LLM comprehension token-per-token);
 * JSON is the structured form for downstream automation.
 *
 * Output keeps it tight: each node + edge becomes one line, with
 * truncation when the scene is large.
 */
export type GetContextOptions = {
  format?: 'markdown' | 'json'
  /** Restrict to the current selection. Default: include the whole scene. */
  selectionOnly?: boolean
  /** Truncate node list at this count. Default 500. */
  maxNodes?: number
}

const DEFAULT_MAX_NODES = 500

export const getContext = (
  store: CanvasStore,
  opts: GetContextOptions = {},
): string | SceneContextJson => {
  const format = opts.format ?? 'markdown'
  const maxNodes = opts.maxNodes ?? DEFAULT_MAX_NODES

  let nodes: Node[]
  let edges: Edge[]
  if (opts.selectionOnly) {
    const ids = new Set(store.getSelection())
    nodes = []
    edges = []
    for (const id of ids) {
      const n = store.getNode(id as NodeId)
      if (n) nodes.push(n)
      else {
        const e = store.getEdge(id as EdgeId)
        if (e) edges.push(e)
      }
    }
  } else {
    nodes = store.getAllNodes()
    edges = store.getAllEdges()
  }

  const truncated = nodes.length > maxNodes
  if (truncated) nodes = nodes.slice(0, maxNodes)

  if (format === 'json') return toJsonContext(nodes, edges, store, truncated)
  return toMarkdownContext(nodes, edges, store, truncated)
}

// ----- JSON output ------------------------------------------------------

export type SceneContextJson = {
  camera: { x: number; y: number; z: number }
  nodes: ContextNode[]
  edges: ContextEdge[]
  truncated: boolean
}

export type ContextNode = {
  id: string
  type: string
  x: number
  y: number
  w: number
  h: number
  angle?: number
  content?: string
  style?: Record<string, unknown>
}

export type ContextEdge = {
  id: string
  source: string | { x: number; y: number }
  target: string | { x: number; y: number }
  pathStyle?: string
}

const toJsonContext = (
  nodes: Node[],
  edges: Edge[],
  store: CanvasStore,
  truncated: boolean,
): SceneContextJson => {
  const camera = store.getCamera()
  return {
    camera: { x: camera.x, y: camera.y, z: camera.z },
    nodes: nodes.map(n => {
      const out: ContextNode = { id: n.id, type: n.type, x: n.x, y: n.y, w: n.w, h: n.h }
      if (n.angle !== 0) out.angle = n.angle
      if (n.content) out.content = n.content
      if (n.style && Object.keys(n.style).length > 0)
        out.style = n.style as Record<string, unknown>
      return out
    }),
    edges: edges.map(e => ({
      id: e.id,
      source: serializeEnd(e.source),
      target: serializeEnd(e.target),
      pathStyle: e.pathStyle,
    })),
    truncated,
  }
}

const serializeEnd = (end: EdgeEnd): string | { x: number; y: number } => {
  if (isAttached(end)) return end.nodeId
  return { x: end.worldPoint.x, y: end.worldPoint.y }
}

// ----- Markdown output --------------------------------------------------

const toMarkdownContext = (
  nodes: Node[],
  edges: Edge[],
  store: CanvasStore,
  truncated: boolean,
): string => {
  const lines: string[] = []
  const camera = store.getCamera()

  lines.push(`# Canvas scene`)
  lines.push('')
  lines.push(
    `camera at (${formatNumber(camera.x)}, ${formatNumber(camera.y)}) zoom ${formatNumber(camera.z)}`,
  )
  lines.push(`${nodes.length} node(s), ${edges.length} edge(s)`)
  if (truncated) lines.push(`_(truncated to first ${nodes.length} nodes)_`)
  lines.push('')

  if (nodes.length > 0) {
    lines.push(`## Nodes`)
    lines.push('')
    for (const n of nodes) lines.push(`- ${formatNode(n)}`)
    lines.push('')
  }

  if (edges.length > 0) {
    lines.push(`## Edges`)
    lines.push('')
    for (const e of edges) lines.push(`- ${formatEdge(e)}`)
  }

  return lines.join('\n')
}

const formatNode = (n: Node): string => {
  const pos = `at (${formatNumber(n.x)}, ${formatNumber(n.y)}) size ${formatNumber(n.w)}×${formatNumber(n.h)}`
  const angle = n.angle !== 0 ? ` rotated ${formatNumber((n.angle * 180) / Math.PI)}°` : ''
  const id = `\`${n.id}\``
  const type = `**${n.type}**`
  const content = n.content ? ` — "${truncateText(n.content, 80)}"` : ''
  return `${id} ${type} ${pos}${angle}${content}`
}

const formatEdge = (e: Edge): string => {
  const id = `\`${e.id}\``
  const src = describeEnd(e.source)
  const tgt = describeEnd(e.target)
  const style = e.pathStyle !== 'bezier' ? ` (${e.pathStyle})` : ''
  return `${id} ${src} → ${tgt}${style}`
}

const describeEnd = (end: EdgeEnd): string => {
  if (isAttached(end)) return `\`${end.nodeId}\``
  return `(${formatNumber(end.worldPoint.x)}, ${formatNumber(end.worldPoint.y)})`
}

const formatNumber = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1))

const truncateText = (s: string, max: number): string =>
  s.length <= max ? s.replace(/\n/g, ' ↵ ') : `${s.slice(0, max - 1).replace(/\n/g, ' ↵ ')}…`
