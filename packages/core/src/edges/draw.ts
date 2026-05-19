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

/** Below this on-screen length, an arrowhead is invisible noise; skip it. */
const ARROWHEAD_VISIBILITY_THRESHOLD_PX = 2

/**
 * How many polyline samples to skip per drawn segment when painting the
 * body. The cached sample array is 32 segments for visual smoothness at
 * full zoom, but at low zoom adjacent samples are within a fraction of a
 * pixel — drawing every-Nth is indistinguishable but cuts work N-fold.
 *
 * Hit-test, auto-clip, and arrowhead-tangent still walk the full sample
 * array — only the per-frame path build skips. So no correctness impact.
 */
const samplePaintStride = (scale: number): number => {
  if (scale < 0.15) return 8
  if (scale < 0.3) return 4
  if (scale < 0.7) return 2
  return 1
}

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

  // Arrowheads vanish at sub-perceivable on-screen size; the line still
  // shows, just without the cap.
  const headStartWorld = arrowheadLength(sourceArrowhead, strokeWidth)
  const headEndWorld = arrowheadLength(targetArrowhead, strokeWidth)
  const drawSourceArrow =
    sourceArrowhead !== 'none' && headStartWorld * scale >= ARROWHEAD_VISIBILITY_THRESHOLD_PX
  const drawTargetArrow =
    targetArrowhead !== 'none' && headEndWorld * scale >= ARROWHEAD_VISIBILITY_THRESHOLD_PX

  // Pull the rendered polyline endpoints back by the arrowhead length so
  // the line tail doesn't poke through the arrow tip — only when actually
  // drawing the arrow.
  const lineStart = drawSourceArrow
    ? retreatFromPoint(samples, clip.startIndex, clip.startPoint, headStartWorld, +1)
    : clip.startPoint
  const lineEnd = drawTargetArrow
    ? retreatFromPoint(samples, clip.endIndex, clip.endPoint, headEndWorld, -1)
    : clip.endPoint

  // ---- body ----
  ctx.save()
  ctx.strokeStyle = strokeColor
  ctx.lineWidth = strokeWidth
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.setLineDash(dashPatternFor(style?.strokeStyle, strokeWidth))
  ctx.beginPath()
  ctx.moveTo(lineStart.x, lineStart.y)
  // Adaptive sampling: stride through the cached polyline at low zoom.
  // Hit-test / clip still use the full samples; only paint skips.
  const stride = samplePaintStride(scale)
  const limit = clip.endIndex - 1
  for (let i = clip.startIndex + stride; i <= limit; i += stride) {
    const p = samples[i]!
    ctx.lineTo(p.x, p.y)
  }
  ctx.lineTo(lineEnd.x, lineEnd.y)
  ctx.stroke()
  ctx.restore()

  // ---- arrowheads ----
  if (drawSourceArrow) {
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
  if (drawTargetArrow) {
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
