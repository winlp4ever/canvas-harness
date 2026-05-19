import { computeEdgeGeometry } from '../edges'
import { drawEdge } from '../edges/draw'
import { drawShape, isDrawablePrimitive } from '../render/shapes'
import type { ThemeResolver } from '../render/shapes'
import { drawWithNodeTransform } from '../render/transform'
import { nodeAABB } from '../spatial'
import {
  DEFAULT_HIGHLIGHT_COLOR,
  DEFAULT_TEXT_COLOR,
  FONT_SIZE_MAP,
  getOrRenderTextBitmap,
} from '../text'
import type { CanvasStore } from '../store'
import type { Edge, Node, NodeId } from '../types'

/**
 * PNG export — see ARCHITECTURE.md §13. Paints the requested set of
 * nodes + edges into an offscreen canvas at logical coords; returns a
 * Blob (image/png).
 */
export type ExportOptions = {
  /** Bitmap scale multiplier — defaults to 2 for retina-ish output. */
  scale?: number
  /** Padding (logical px) around the bounding rect. Default 16. */
  padding?: number
  /** Skip the background fill. Default false. */
  transparentBackground?: boolean
  /** Background color when not transparent. Default white. */
  backgroundColor?: string
  /** Theme resolver, same one passed to the live renderer. */
  theme?: ThemeResolver
}

const DEFAULT_SCALE = 2
const DEFAULT_PADDING = 16
const DEFAULT_BACKGROUND = '#ffffff'
const MIN_READABLE_FONT_PX = 3

/**
 * Renders the current selection to a PNG Blob. Edges between selected
 * nodes are included; edges crossing the selection boundary are dropped.
 */
export const exportSelection = async (
  store: CanvasStore,
  opts: ExportOptions = {},
): Promise<Blob> => {
  const ids = store.getSelection()
  const nodeIds = new Set<NodeId>()
  for (const id of ids) {
    if (store.getNode(id as NodeId)) nodeIds.add(id as NodeId)
  }
  return exportNodeSet(store, nodeIds, opts)
}

/**
 * Renders the camera's current viewport to a PNG Blob.
 */
export const exportViewport = async (
  store: CanvasStore,
  viewport: { x: number; y: number; w: number; h: number },
  opts: ExportOptions = {},
): Promise<Blob> => {
  const scale = opts.scale ?? DEFAULT_SCALE
  const padding = opts.padding ?? 0
  const ctx = makeContext(viewport.w + padding * 2, viewport.h + padding * 2, scale, opts)
  ctx.translate(-viewport.x + padding, -viewport.y + padding)
  paintScene(
    ctx,
    store,
    store.getAllNodes().filter((n: Node) => intersects(n, viewport)),
    scale,
    opts,
  )
  return toBlob(ctx.canvas)
}

const exportNodeSet = async (
  store: CanvasStore,
  nodeIds: ReadonlySet<NodeId>,
  opts: ExportOptions,
): Promise<Blob> => {
  if (nodeIds.size === 0) {
    // Empty selection — emit a 1×1 transparent png so callers don't crash.
    const c = document.createElement('canvas')
    c.width = 1
    c.height = 1
    return toBlob(c)
  }
  const nodes: Node[] = []
  for (const id of nodeIds) {
    const n = store.getNode(id)
    if (n) nodes.push(n)
  }
  const padding = opts.padding ?? DEFAULT_PADDING
  const scale = opts.scale ?? DEFAULT_SCALE
  const bbox = unionBounds(nodes)
  const w = bbox.w + padding * 2
  const h = bbox.h + padding * 2

  const ctx = makeContext(w, h, scale, opts)
  ctx.translate(-bbox.x + padding, -bbox.y + padding)

  // Edges that connect two selected nodes.
  const edges: Edge[] = []
  for (const e of store.getAllEdges()) {
    if (bothEndsInside(e, nodeIds)) edges.push(e)
  }
  paintScene(ctx, store, nodes, scale, opts, edges)
  return toBlob(ctx.canvas)
}

const makeContext = (
  cssW: number,
  cssH: number,
  scale: number,
  opts: ExportOptions,
): CanvasRenderingContext2D => {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(cssW * scale))
  canvas.height = Math.max(1, Math.ceil(cssH * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')
  if (!opts.transparentBackground) {
    ctx.fillStyle = opts.backgroundColor ?? DEFAULT_BACKGROUND
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }
  ctx.scale(scale, scale)
  return ctx
}

/**
 * Walks the node + edge set and paints them. Uses the same primitives
 * as the live renderer so output matches the canvas.
 */
const paintScene = (
  ctx: CanvasRenderingContext2D,
  store: CanvasStore,
  nodes: Node[],
  scale: number,
  opts: ExportOptions,
  edges?: Edge[],
): void => {
  const theme = opts.theme
  for (const node of nodes) {
    drawWithNodeTransform(ctx, node, () => {
      if (isDrawablePrimitive(node.type)) drawShape(ctx, node, scale, theme)
      paintContent(ctx, node)
    })
  }
  const edgeList = edges ?? store.getAllEdges()
  const getNode = (id: NodeId): Node | undefined => store.getNode(id)
  for (const edge of edgeList) {
    const geom = computeEdgeGeometry(edge, getNode)
    if (!geom) continue
    const sourceNode = geom.sourceNodeId ? (getNode(geom.sourceNodeId) ?? null) : null
    const targetNode = geom.targetNodeId ? (getNode(geom.targetNodeId) ?? null) : null
    drawEdge(ctx, edge, geom, sourceNode, targetNode, scale, theme)
  }
}

const paintContent = (ctx: CanvasRenderingContext2D, node: Node): void => {
  if (!node.content || !node.content.trim()) return
  const style = node.style
  const fontSize = style?.fontSize ?? 'M'
  // Same readability skip as the live renderer.
  if (FONT_SIZE_MAP[fontSize] * 1 < MIN_READABLE_FONT_PX) return
  const bitmap = getOrRenderTextBitmap({
    id: node.id,
    text: node.content,
    width: node.w,
    height: node.h,
    zoom: 1,
    dpr: 2,
    isMoving: false,
    align: style?.textAlign ?? 'center',
    fontFamily: style?.fontFamily ?? 'handwriting',
    fontSize,
    textStyle: style?.textStyle ?? 'normal',
    textColor: style?.textColor ?? DEFAULT_TEXT_COLOR,
    highlightColor: DEFAULT_HIGHLIGHT_COLOR,
  })
  if (!bitmap) return
  ctx.drawImage(bitmap.canvas, 0, 0, node.w, node.h)
}

const toBlob = (canvas: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob returned null'))), 'image/png')
  })

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

const intersects = (n: Node, vp: { x: number; y: number; w: number; h: number }): boolean => {
  const a = nodeAABB(n)
  return a.x < vp.x + vp.w && a.x + a.w > vp.x && a.y < vp.y + vp.h && a.y + a.h > vp.y
}

const bothEndsInside = (e: Edge, ids: ReadonlySet<NodeId>): boolean => {
  const inEnd = (end: typeof e.source): boolean => 'nodeId' in end && ids.has(end.nodeId)
  return inEnd(e.source) && inEnd(e.target)
}
