import { type ThemeResolver, dashPatternFor } from '../render/shapes/defaults'
import {
  DEFAULT_TEXT_COLOR,
  FONT_SIZE_MAP,
  LINE_HEIGHT_MAP,
  getOrRenderTextBitmap,
  measureText,
  subscribeFontEpoch,
} from '../text'
import type { Edge, EdgeStyle, Node, Vec2 } from '../types'
/**
 * Edge paint pipeline — see ARCHITECTURE.md §6.5–§6.7.
 *
 * Takes a precomputed EdgeGeometry (samples + AABB) and the attached
 * nodes, runs auto-clip, paints the visible polyline, draws arrowheads
 * at the clipped endpoints. World coords; caller already applied the
 * camera transform.
 */
import { getPointAndTangentAtArcLength } from './arc-length'
import { drawRoughEdge } from '../render/rough'
import { seedFromId } from '../render/rough/cache'
import { onRoughReady } from '../render/rough/loader'
import { arrowheadLength, drawArrowhead } from './arrowhead'
import type { EdgeGeometry } from './cache'
import { clipSamples, fullVisibleClipResult } from './clip'
import { getOrBuildFreehandPath } from './freehand'

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
  opts?: { roughEnabled?: boolean },
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
  // Rough body when (a) gate from caller is on, (b) style.roughness > 0.
  // Two technique dispatch:
  //   solid stroke    → perfect-freehand brushy polygon (filled, tapered).
  //   dashed/dotted   → rough.js linearPath (wobbly stroked line; needed
  //                      because a filled polygon can't dash naturally).
  // Falls back to plain stroke when rough.js hasn't loaded yet.
  const useRough = (opts?.roughEnabled ?? false) && (style?.roughness ?? 0) > 0
  if (useRough) {
    // Build a clipped sub-sample sequence so the rough body doesn't
    // extend past the visible portion (otherwise the wobble/brush pokes
    // into the node bodies). Re-uses the existing clip indices.
    const clipped: Vec2[] = [lineStart]
    for (let i = clip.startIndex + 1; i < clip.endIndex; i++) clipped.push(samples[i]!)
    clipped.push(lineEnd)

    const isSolid = (style?.strokeStyle ?? 'solid') === 'solid'
    if (isSolid) {
      const seed = edge.id ? (seedFromId(edge.id) % 2147483646) + 1 : 1337
      const path = getOrBuildFreehandPath(clipped, strokeWidth, seed)
      if (path) {
        ctx.save()
        ctx.fillStyle = strokeColor
        ctx.fill(path)
        ctx.restore()
        if (drawSourceArrow) {
          const tipDir = directionTowardTip(samples, clip.startIndex, clip.startPoint, +1)
          drawArrowhead(ctx, sourceArrowhead, clip.startPoint, negateVec(tipDir), strokeColor, strokeWidth)
        }
        if (drawTargetArrow) {
          const tipDir = directionTowardTip(samples, clip.endIndex, clip.endPoint, -1)
          drawArrowhead(ctx, targetArrowhead, clip.endPoint, tipDir, strokeColor, strokeWidth)
        }
        if (edge.content && edge.content.trim()) drawEdgeLabel(ctx, edge, geom, scale, theme)
        return
      }
      // freehand returned null (degenerate samples) — fall through.
    } else {
      const ok = drawRoughEdge(ctx, edge, clipped, scale, theme)
      if (!ok) {
        onRoughReady(() => {
          /* repaint is scheduled by the renderer's onRoughReady too;
             this handler is here for symmetry. */
        })
      } else {
        if (drawSourceArrow) {
          const tipDir = directionTowardTip(samples, clip.startIndex, clip.startPoint, +1)
          drawArrowhead(ctx, sourceArrowhead, clip.startPoint, negateVec(tipDir), strokeColor, strokeWidth)
        }
        if (drawTargetArrow) {
          const tipDir = directionTowardTip(samples, clip.endIndex, clip.endPoint, -1)
          drawArrowhead(ctx, targetArrowhead, clip.endPoint, tipDir, strokeColor, strokeWidth)
        }
        if (edge.content && edge.content.trim()) drawEdgeLabel(ctx, edge, geom, scale, theme)
        return
      }
    }
  }

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

  // ---- label (§6.11) ----
  // Painted last so it sits on top of the body + arrowheads.
  if (edge.content && edge.content.trim()) {
    drawEdgeLabel(ctx, edge, geom, scale, theme)
  }
}

/** Minimum on-screen font size — text smaller than this is unreadable
 *  noise, skip the chip + blit. Same threshold the node-content paint uses. */
const LABEL_MIN_READABLE_FONT_PX = 3
const LABEL_MAX_WIDTH_PX = 240
const LABEL_PADDING_X = 6
const LABEL_PADDING_Y = 2
const LABEL_BORDER_RADIUS = 3

const DEFAULT_LABEL_BACKGROUND = '#ffffff'

type LabelDims = { width: number; height: number; fontPx: number }

/**
 * Memoizes `computeLabelDims` per (content, font-family, font-size,
 * font-style) tuple. Many edges share labels in real graphs ("yes" /
 * "no" / "depends on"), so the hit rate is high. Cleared on font-epoch
 * bump because `measureText` depends on font load state.
 */
const labelDimsCache = new Map<string, LabelDims>()
const LABEL_DIMS_CACHE_MAX = 512

subscribeFontEpoch(() => {
  labelDimsCache.clear()
})

/**
 * Computes the label dimensions for an edge in world units. Heuristic:
 *   - width: single-line measurement of the raw content, clamped to
 *     [20, LABEL_MAX_WIDTH_PX]. Beyond the cap, the markdown layout
 *     wraps to multiple lines.
 *   - height: one line-height per wrap line, plus vertical padding.
 *
 * Returns null if dimensions are zero (empty content).
 */
const computeLabelDims = (edge: Edge): LabelDims | null => {
  const content = edge.content
  if (!content) return null
  const style = edge.style
  const fontFamily = style?.fontFamily ?? 'handwriting'
  const fontSize = style?.fontSize ?? 'M'
  const textStyle = style?.textStyle ?? 'normal'
  const cacheKey = `${content}|${fontFamily}|${fontSize}|${textStyle}`
  const hit = labelDimsCache.get(cacheKey)
  if (hit) return hit

  const fontPx = FONT_SIZE_MAP[fontSize]
  const naturalWidth = measureText({
    text: content,
    type: 'text',
    fontFamily,
    fontSize,
    textStyle,
  })
  const width = Math.min(LABEL_MAX_WIDTH_PX, Math.max(20, naturalWidth + LABEL_PADDING_X * 2))
  const lines = Math.max(1, Math.ceil(naturalWidth / Math.max(1, width - LABEL_PADDING_X * 2)))
  const height = lines * LINE_HEIGHT_MAP[fontSize] + LABEL_PADDING_Y * 2
  const dims: LabelDims = { width, height, fontPx }
  if (labelDimsCache.size >= LABEL_DIMS_CACHE_MAX) labelDimsCache.clear()
  labelDimsCache.set(cacheKey, dims)
  return dims
}

/**
 * Memoizes `getPointAndTangentAtArcLength` per (geometry, arcLength).
 * The geometry-cache returns the same object reference until any input
 * changes, so a WeakMap keyed on geometry auto-invalidates for free.
 *
 * Hot path: ~5-8µs / labeled edge saved per frame (the two-pass walk
 * over 32 samples per edge becomes a Map lookup).
 */
const anchorCache = new WeakMap<EdgeGeometry, Map<number, { point: Vec2; tangent: Vec2 }>>()

const getCachedLabelAnchor = (
  geom: EdgeGeometry,
  arcLength: number,
): { point: Vec2; tangent: Vec2 } => {
  let bucket = anchorCache.get(geom)
  if (!bucket) {
    bucket = new Map()
    anchorCache.set(geom, bucket)
  }
  const hit = bucket.get(arcLength)
  if (hit) return hit
  const fresh = getPointAndTangentAtArcLength(geom.samples, arcLength)
  bucket.set(arcLength, fresh)
  return fresh
}

const drawEdgeLabel = (
  ctx: CanvasRenderingContext2D,
  edge: Edge,
  geom: EdgeGeometry,
  scale: number,
  theme?: ThemeResolver,
): void => {
  const style = edge.style
  const fontSize = style?.fontSize ?? 'M'
  if (FONT_SIZE_MAP[fontSize] * scale < LABEL_MIN_READABLE_FONT_PX) return

  const dims = computeLabelDims(edge)
  if (!dims) return

  const t = clamp01(style?.labelArcLength ?? 0.5)
  const { point, tangent } = getCachedLabelAnchor(geom, t)
  const followTangent = style?.labelFollowsTangent === true

  const bg = (theme?.('edge.label.background') as string | undefined) ?? DEFAULT_LABEL_BACKGROUND

  ctx.save()
  ctx.translate(point.x, point.y)
  if (followTangent) {
    let angle = Math.atan2(tangent.y, tangent.x)
    // Keep text readable: flip upside-down labels so they read L→R.
    if (angle > Math.PI / 2) angle -= Math.PI
    if (angle < -Math.PI / 2) angle += Math.PI
    ctx.rotate(angle)
  }

  // Center the label rect on the anchor.
  const w = dims.width
  const h = dims.height
  const x = -w / 2
  const y = -h / 2

  // Chip background (rounded rect).
  if (bg !== 'none' && bg !== 'transparent') {
    ctx.fillStyle = bg
    drawRoundRect(ctx, x, y, w, h, LABEL_BORDER_RADIUS)
    ctx.fill()
  }

  // Text bitmap (reuses the Phase-6 cache).
  const bitmap = getOrRenderTextBitmap({
    id: edge.id,
    text: edge.content ?? '',
    width: w,
    height: h,
    zoom: scale,
    dpr: 1,
    isMoving: false,
    align: 'center',
    fontFamily: style?.fontFamily ?? 'handwriting',
    fontSize,
    textStyle: style?.textStyle ?? 'normal',
    textColor: style?.textColor ?? DEFAULT_TEXT_COLOR,
    highlightColor: '#fde047',
  })
  if (bitmap) ctx.drawImage(bitmap.canvas, x, y, w, h)
  ctx.restore()
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v))

const drawRoundRect = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void => {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.lineTo(x + w - radius, y)
  ctx.arcTo(x + w, y, x + w, y + radius, radius)
  ctx.lineTo(x + w, y + h - radius)
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius)
  ctx.lineTo(x + radius, y + h)
  ctx.arcTo(x, y + h, x, y + h - radius, radius)
  ctx.lineTo(x, y + radius)
  ctx.arcTo(x, y, x + radius, y, radius)
  ctx.closePath()
}

/**
 * World-space label bounding box. Used by the hit-test (see
 * `hitTestEdge`). Returns `null` when the edge has no content.
 */
export const edgeLabelBoundsWorld = (
  edge: Edge,
  geom: EdgeGeometry,
): { x: number; y: number; w: number; h: number } | null => {
  if (!edge.content || !edge.content.trim()) return null
  const dims = computeLabelDims(edge)
  if (!dims) return null
  const t = clamp01(edge.style?.labelArcLength ?? 0.5)
  const { point } = getCachedLabelAnchor(geom, t)
  return {
    x: point.x - dims.width / 2,
    y: point.y - dims.height / 2,
    w: dims.width,
    h: dims.height,
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
