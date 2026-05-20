import { computeEdgeGeometry } from '../edges'
import { nodeAABB } from '../spatial'
import { FONT_FAMILY_MAP, FONT_SIZE_MAP } from '../text'
import type { CanvasStore } from '../store'
import type { Edge, Node, NodeId } from '../types'

/**
 * SVG export — see ARCHITECTURE.md §13.
 *
 * **Scope**: matches PNG export for shape geometry + edge geometry, but
 * markdown content is emitted as **plain text** (no inline bold /
 * italic / highlight). SVG `<text>` doesn't support our markdown
 * dialect without tspan positioning math; deferred to v2. PNG export
 * preserves all markdown styling via the bitmap pipeline.
 */
export type SvgExportOptions = {
  padding?: number
  transparentBackground?: boolean
  backgroundColor?: string
}

const DEFAULT_PADDING = 16
const DEFAULT_BACKGROUND = '#ffffff'

/**
 * Renders the current selection to an SVG string. Synchronous —
 * unlike PNG, no canvas roundtrip needed.
 *
 * **Caveat:** SVG `<text>` doesn't support our markdown dialect, so
 * `**bold**` / `==hl==` etc. render as plain text with the syntax
 * stripped. PNG export preserves all markdown via the bitmap pipeline.
 *
 * @example
 * const svg = exportSelectionSvg(store)
 * const blob = new Blob([svg], { type: 'image/svg+xml' })
 */
export const exportSelectionSvg = (store: CanvasStore, opts: SvgExportOptions = {}): string => {
  const ids = store.getSelection()
  const nodeIds = new Set<NodeId>()
  for (const id of ids) {
    if (store.getNode(id as NodeId)) nodeIds.add(id as NodeId)
  }
  return exportNodeSetSvg(store, nodeIds, opts)
}

const exportNodeSetSvg = (
  store: CanvasStore,
  nodeIds: ReadonlySet<NodeId>,
  opts: SvgExportOptions,
): string => {
  const padding = opts.padding ?? DEFAULT_PADDING
  if (nodeIds.size === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" />`
  }
  const nodes: Node[] = []
  for (const id of nodeIds) {
    const n = store.getNode(id)
    if (n) nodes.push(n)
  }
  const bbox = unionBounds(nodes)
  const w = Math.ceil(bbox.w + padding * 2)
  const h = Math.ceil(bbox.h + padding * 2)
  const tx = -bbox.x + padding
  const ty = -bbox.y + padding

  const bgRect = opts.transparentBackground
    ? ''
    : `<rect width="100%" height="100%" fill="${escapeAttr(opts.backgroundColor ?? DEFAULT_BACKGROUND)}" />`

  const edges: Edge[] = []
  for (const e of store.getAllEdges()) {
    if (bothEndsInside(e, nodeIds)) edges.push(e)
  }

  const parts: string[] = []
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
  )
  parts.push(bgRect)
  parts.push(`<g transform="translate(${tx} ${ty})">`)
  for (const node of nodes) parts.push(renderNodeSvg(node))
  for (const edge of edges) parts.push(renderEdgeSvg(edge, store))
  parts.push('</g>')
  parts.push('</svg>')
  return parts.join('')
}

const renderNodeSvg = (node: Node): string => {
  const fill = node.style?.backgroundColor ?? '#ffffff'
  const stroke = node.style?.strokeColor ?? '#0f172a'
  const strokeWidth = node.style?.strokeWidth ?? 1.5
  const opacity = node.style?.opacity ?? 1
  const rotate =
    node.angle !== 0
      ? ` transform="rotate(${(node.angle * 180) / Math.PI} ${node.x + node.w / 2} ${node.y + node.h / 2})"`
      : ''

  const shape = renderShapeSvg(node, fill, stroke, strokeWidth, opacity)

  const text = renderTextSvg(node)
  return `<g${rotate}>${shape}${text}</g>`
}

const renderShapeSvg = (
  node: Node,
  fill: string,
  stroke: string,
  strokeWidth: number,
  opacity: number,
): string => {
  const attrs = (extra: string): string =>
    `fill="${escapeAttr(fill)}" stroke="${escapeAttr(stroke)}" stroke-width="${strokeWidth}" opacity="${opacity}"${extra}`
  switch (node.type) {
    case 'rect': {
      const r = (node.style?.roundness ?? 0) * 4
      return `<rect x="${node.x}" y="${node.y}" width="${node.w}" height="${node.h}" rx="${r}" ry="${r}" ${attrs('')} />`
    }
    case 'ellipse':
      return `<ellipse cx="${node.x + node.w / 2}" cy="${node.y + node.h / 2}" rx="${node.w / 2}" ry="${node.h / 2}" ${attrs('')} />`
    case 'diamond': {
      const cx = node.x + node.w / 2
      const cy = node.y + node.h / 2
      const pts = `${cx},${node.y} ${node.x + node.w},${cy} ${cx},${node.y + node.h} ${node.x},${cy}`
      return `<polygon points="${pts}" ${attrs('')} />`
    }
    case 'tag': {
      // Approximate — emit the bounding rect. Full tag geometry is not
      // worth porting to the SVG export path.
      return `<rect x="${node.x}" y="${node.y}" width="${node.w}" height="${node.h}" rx="6" ry="6" ${attrs('')} />`
    }
    case 'capsule':
    case 'thought-cloud':
    case 'layered-rect':
    case 'layered-ellipse':
    case 'layered-diamond': {
      // Composites: emit a bounding rect placeholder. PNG export uses
      // the canvas renderer directly and renders these correctly.
      return `<rect x="${node.x}" y="${node.y}" width="${node.w}" height="${node.h}" rx="4" ry="4" ${attrs('')} />`
    }
    case 'text':
      return ''
    default:
      return `<rect x="${node.x}" y="${node.y}" width="${node.w}" height="${node.h}" fill="none" stroke="${escapeAttr(stroke)}" stroke-dasharray="4 4" stroke-width="1" opacity="0.5" />`
  }
}

const renderTextSvg = (node: Node): string => {
  if (!node.content || !node.content.trim()) return ''
  const fontSize = FONT_SIZE_MAP[node.style?.fontSize ?? 'M']
  const family = FONT_FAMILY_MAP[node.style?.fontFamily ?? 'handwriting']
  const color = node.style?.textColor ?? '#1f2937'
  const align = node.style?.textAlign ?? 'center'
  const anchor = align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle'
  // Plain text — see header doc. Strip markdown syntax for legibility
  // (so '**bold**' renders as 'bold' not '**bold**').
  const lines = node.content.split('\n').map(stripMarkdown)
  const cx = node.x + (align === 'left' ? 8 : align === 'right' ? node.w - 8 : node.w / 2)
  const totalH = lines.length * fontSize * 1.25
  const startY = node.y + (node.h - totalH) / 2 + fontSize * 0.8
  const tspans = lines
    .map(
      (line, i) =>
        `<tspan x="${cx}" y="${startY + i * fontSize * 1.25}">${escapeText(line)}</tspan>`,
    )
    .join('')
  return `<text fill="${escapeAttr(color)}" font-family="${escapeAttr(family)}" font-size="${fontSize}" text-anchor="${anchor}">${tspans}</text>`
}

const renderEdgeSvg = (edge: Edge, store: CanvasStore): string => {
  const getNode = (id: NodeId): Node | undefined => store.getNode(id)
  const geom = computeEdgeGeometry(edge, getNode)
  if (!geom) return ''
  const samples = geom.samples
  if (samples.length < 2) return ''
  const d = samples
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ')
  const stroke = edge.style?.strokeColor ?? '#0f172a'
  const strokeWidth = edge.style?.strokeWidth ?? 1.5
  return `<path d="${d}" fill="none" stroke="${escapeAttr(stroke)}" stroke-width="${strokeWidth}" />`
}

const stripMarkdown = (s: string): string =>
  s
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/==(.*?)==/g, '$1')
    .replace(/`(.*?)`/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')

const escapeText = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escapeAttr = (s: string): string => escapeText(s).replace(/"/g, '&quot;')

const unionBounds = (nodes: Node[]): { x: number; y: number; w: number; h: number } => {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const n of nodes) {
    const r = nodeAABB(n)
    if (r.x < minX) minX = r.x
    if (r.y < minY) minY = r.y
    if (r.x + r.w > maxX) maxX = r.x + r.w
    if (r.y + r.h > maxY) maxY = r.y + r.h
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

const bothEndsInside = (e: Edge, ids: ReadonlySet<NodeId>): boolean => {
  const inEnd = (end: typeof e.source): boolean => 'nodeId' in end && ids.has(end.nodeId)
  return inEnd(e.source) && inEnd(e.target)
}
