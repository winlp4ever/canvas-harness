import { type ThemeResolver, dashPatternFor } from '../render/shapes/defaults'
import type { Edge, EdgeStyle, Node, Vec2 } from '../types'
/**
 * Edge paint pipeline — see ARCHITECTURE.md §6.5–§6.7.
 *
 * Takes a precomputed EdgeGeometry (samples + AABB) and the attached
 * nodes, runs auto-clip, paints the visible polyline, draws arrowheads
 * at the clipped endpoints. World coords; caller already applied the
 * camera transform.
 */
import { arrowheadLength, drawArrowhead } from './arrowhead'
import type { EdgeGeometry } from './cache'
import { clipSamples, fullVisibleClipResult } from './clip'

/** Defaults for edge style — see ARCHITECTURE.md §3.4. */
const DEFAULT_EDGE_STYLE: Required<
  Pick<
    EdgeStyle,
    'strokeColor' | 'strokeWidth' | 'strokeStyle' | 'sourceArrowhead' | 'targetArrowhead'
  >
> = {
  strokeColor: '#475569',
  strokeWidth: 2,
  strokeStyle: 'solid',
  sourceArrowhead: 'none',
  targetArrowhead: 'arrow-filled',
}

const STROKE_VISIBILITY_THRESHOLD_PX = 0.5

export const drawEdge = (
  ctx: CanvasRenderingContext2D,
  edge: Edge,
  geom: EdgeGeometry,
  sourceNode: Node | null,
  targetNode: Node | null,
  scale: number,
  theme?: ThemeResolver,
): void => {
  if (edge.hidden) return
  const samples = geom.samples
  if (samples.length < 2) return

  const style = edge.style
  const strokeWidth =
    typeof style?.strokeWidth === 'number'
      ? style.strokeWidth
      : ((theme?.('strokeWidth') as number | undefined) ?? DEFAULT_EDGE_STYLE.strokeWidth)
  if (strokeWidth * scale < STROKE_VISIBILITY_THRESHOLD_PX) return

  const strokeColor =
    typeof style?.strokeColor === 'string'
      ? style.strokeColor
      : ((theme?.('edge.strokeColor') as string | undefined) ?? DEFAULT_EDGE_STYLE.strokeColor)
  const sourceArrowhead = style?.sourceArrowhead ?? DEFAULT_EDGE_STYLE.sourceArrowhead
  const targetArrowhead = style?.targetArrowhead ?? DEFAULT_EDGE_STYLE.targetArrowhead

  // Self-loop doesn't get clipped (both endpoints are on the same node).
  const clip = geom.isSelfLoop
    ? fullVisibleClipResult(samples)
    : clipSamples(samples, sourceNode, targetNode)
  if (!clip.visible) return

  // Pull the rendered polyline endpoints back by the arrowhead length so
  // the line tail doesn't poke through the arrow tip.
  const headStart = arrowheadLength(sourceArrowhead, strokeWidth)
  const headEnd = arrowheadLength(targetArrowhead, strokeWidth)
  const lineStart = retreatFromPoint(samples, clip.startIndex, clip.startPoint, headStart, +1)
  const lineEnd = retreatFromPoint(samples, clip.endIndex, clip.endPoint, headEnd, -1)

  // ---- body ----
  ctx.save()
  ctx.strokeStyle = strokeColor
  ctx.lineWidth = strokeWidth
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.setLineDash(dashPatternFor(style?.strokeStyle, strokeWidth))
  ctx.beginPath()
  ctx.moveTo(lineStart.x, lineStart.y)
  for (let i = clip.startIndex + 1; i <= clip.endIndex - 1; i++) {
    const p = samples[i]!
    ctx.lineTo(p.x, p.y)
  }
  ctx.lineTo(lineEnd.x, lineEnd.y)
  ctx.stroke()
  ctx.restore()

  // ---- arrowheads ----
  if (sourceArrowhead !== 'none') {
    const tipDir = directionTowardTip(samples, clip.startIndex, clip.startPoint, +1)
    drawArrowhead(
      ctx,
      sourceArrowhead,
      clip.startPoint,
      negateVec(tipDir),
      strokeColor,
      strokeWidth,
    )
  }
  if (targetArrowhead !== 'none') {
    const tipDir = directionTowardTip(samples, clip.endIndex, clip.endPoint, -1)
    drawArrowhead(ctx, targetArrowhead, clip.endPoint, tipDir, strokeColor, strokeWidth)
  }
}

/**
 * Returns a unit vector pointing along the curve toward the clipped tip.
 * `direction` = +1 walks samples forward (for source end), -1 backward.
 */
const directionTowardTip = (
  samples: Vec2[],
  clippedIndex: number,
  clipPoint: Vec2,
  direction: 1 | -1,
): Vec2 => {
  const neighbor =
    direction === 1
      ? samples[Math.min(clippedIndex + 1, samples.length - 1)]!
      : samples[Math.max(clippedIndex - 1, 0)]!
  // tip direction = unit vector FROM neighbor TO tip
  const dx = clipPoint.x - neighbor.x
  const dy = clipPoint.y - neighbor.y
  const len = Math.hypot(dx, dy)
  if (len < 1e-6) return { x: direction, y: 0 }
  return { x: dx / len, y: dy / len }
}

/**
 * Returns the point `dist` along the curve back from `clipPoint`, toward
 * the curve interior. Used to retreat the line so the body doesn't poke
 * through the arrowhead tip.
 */
const retreatFromPoint = (
  samples: Vec2[],
  clippedIndex: number,
  clipPoint: Vec2,
  dist: number,
  direction: 1 | -1,
): Vec2 => {
  if (dist <= 0) return clipPoint
  const neighbor =
    direction === 1
      ? samples[Math.min(clippedIndex + 1, samples.length - 1)]!
      : samples[Math.max(clippedIndex - 1, 0)]!
  const dx = clipPoint.x - neighbor.x
  const dy = clipPoint.y - neighbor.y
  const len = Math.hypot(dx, dy)
  if (len < 1e-6) return clipPoint
  const t = Math.min(1, dist / len)
  return {
    x: clipPoint.x - (dx / len) * dist * Math.min(1, t),
    y: clipPoint.y - (dy / len) * dist * Math.min(1, t),
  }
}

const negateVec = (v: Vec2): Vec2 => ({ x: -v.x, y: -v.y })
