/**
 * Generic primitive paint pass.
 *
 * The renderer applies camera + node transforms (translate to node center,
 * rotate, translate back to top-left) before calling this. The drawer
 * just builds a local-space path and fills/strokes it with resolved style.
 *
 * `scale` is the current camera × DPR factor (world-units → device-pixels).
 * Callers compute it once per frame and pass it in so each drawShape call
 * doesn't allocate a DOMMatrix via ctx.getTransform().
 */
import type { Node, Style } from '../../types'
import { darkenHex } from '../color'
import {
  DEFAULT_STYLE,
  type ThemeResolver,
  dashPatternFor,
  isFullyTransparent,
  resolveColor,
  resolveOpacity,
  resolveStrokeWidth,
} from './defaults'
import { buildDiamondPath, buildEllipsePath, buildRectPath, buildTagPath } from './path-helpers'

/** Atomic single-path primitives. Composites paint multiple of these. */
export type AtomicPrimitive = 'rect' | 'ellipse' | 'diamond' | 'tag'

/** Composite primitives built from multiple atomic sub-shapes. */
type CompositePrimitive =
  | 'capsule'
  | 'thought-cloud'
  | 'layered-rect'
  | 'layered-ellipse'
  | 'layered-diamond'

export type PrimitiveType = AtomicPrimitive | CompositePrimitive

const ATOMIC: ReadonlySet<string> = new Set(['rect', 'ellipse', 'diamond', 'tag'])
const COMPOSITE: ReadonlySet<string> = new Set([
  'capsule',
  'thought-cloud',
  'layered-rect',
  'layered-ellipse',
  'layered-diamond',
])

/** Whether `type` is a composite primitive (paints multiple atomic sub-shapes). */
export const isCompositePrimitive = (type: string): boolean => COMPOSITE.has(type)

/** Returns true if `node.type` is one of the built-ins drawShape can render. */
export const isDrawablePrimitive = (type: string): type is PrimitiveType =>
  ATOMIC.has(type) || COMPOSITE.has(type)

/**
 * Below this threshold the rounded-rect path is visually indistinguishable
 * from a plain rect — at sub-pixel corner radius the difference disappears.
 */
const PLAIN_RECT_CORNER_THRESHOLD_PX = 1.5

/**
 * Below this on-screen stroke width, the stroke contributes only noisy
 * anti-aliased edge pixels — skipping it removes a per-shape ctx.stroke()
 * call with no visible loss.
 */
const STROKE_VISIBILITY_THRESHOLD_PX = 0.5

/** Offset for layered composites — back layer shifted down-right by this amount. */
const LAYERED_OFFSET = 12

export const drawShape = (
  ctx: CanvasRenderingContext2D,
  node: Node,
  scale: number,
  theme?: ThemeResolver,
  opts?: { skipStroke?: boolean },
): void => {
  if (!isDrawablePrimitive(node.type)) return
  if (node.hidden) return
  if (node.w <= 0 || node.h <= 0) return

  if (COMPOSITE.has(node.type)) {
    drawComposite(ctx, node, scale, theme, opts)
    return
  }
  drawAtomic(ctx, node.type as AtomicPrimitive, node.w, node.h, node.style, scale, theme, opts)
}

/**
 * Paints a single atomic primitive at (0, 0, w, h) using the provided
 * `style`. Composites call this for each sub-shape with a translated ctx.
 */
export const drawAtomic = (
  ctx: CanvasRenderingContext2D,
  type: AtomicPrimitive,
  w: number,
  h: number,
  style: Style | undefined,
  scale: number,
  theme: ThemeResolver | undefined,
  opts?: { skipStroke?: boolean },
): void => {
  if (w <= 0 || h <= 0) return
  const strokeWidth = resolveStrokeWidth(style, theme)
  const opacity = resolveOpacity(style, theme)
  const fill = resolveColor(style, 'backgroundColor', DEFAULT_STYLE.backgroundColor, theme)
  const stroke = resolveColor(style, 'strokeColor', DEFAULT_STYLE.strokeColor, theme)
  const fillVisible = !isFullyTransparent(fill)
  const strokeVisible =
    strokeWidth > 0 &&
    strokeWidth * scale >= STROKE_VISIBILITY_THRESHOLD_PX &&
    !isFullyTransparent(stroke)
  if (!fillVisible && !strokeVisible) return

  const cornerRadius = (style?.roundness ?? DEFAULT_STYLE.roundness) * 4

  switch (type) {
    case 'rect': {
      if (cornerRadius * scale < PLAIN_RECT_CORNER_THRESHOLD_PX) {
        ctx.beginPath()
        ctx.rect(0, 0, w, h)
      } else {
        buildRectPath(ctx, w, h, cornerRadius)
      }
      break
    }
    case 'ellipse':
      buildEllipsePath(ctx, w, h)
      break
    case 'diamond':
      buildDiamondPath(ctx, w, h, cornerRadius)
      break
    case 'tag':
      buildTagPath(ctx, w, h, cornerRadius)
      break
  }

  const needsScope = opacity !== 1
  if (needsScope) {
    ctx.save()
    ctx.globalAlpha = opacity
  }
  if (fillVisible) {
    ctx.fillStyle = fill
    ctx.fill()
  }
  if (strokeVisible && !opts?.skipStroke) {
    ctx.strokeStyle = stroke
    ctx.lineWidth = strokeWidth
    ctx.setLineDash(dashPatternFor(style?.strokeStyle, strokeWidth))
    ctx.stroke()
  }
  if (needsScope) ctx.restore()
}

/**
 * Layout each composite type as a list of `{ x, y, w, h, atomic }` sub-shapes
 * in the node's local frame. Paint order is back-to-front.
 *
 * For `layered-*`, the back layer's style is darkened to set it apart from
 * the front; the front uses the node's resolved style as-is.
 */
const drawComposite = (
  ctx: CanvasRenderingContext2D,
  node: Node,
  scale: number,
  theme: ThemeResolver | undefined,
  opts?: { skipStroke?: boolean },
): void => {
  const subs = compositeLayout(node)
  for (const s of subs) {
    ctx.save()
    ctx.translate(s.x, s.y)
    drawAtomic(ctx, s.atomic, s.w, s.h, s.style ?? node.style, scale, theme, opts)
    ctx.restore()
  }
}

type SubShape = {
  atomic: AtomicPrimitive
  x: number
  y: number
  w: number
  h: number
  style?: Style
}

/** Builds the back-to-front sub-shape list for a composite node. Exported for rough. */
export const compositeLayout = (node: Node): SubShape[] => {
  const { w, h, style } = node
  switch (node.type) {
    case 'capsule': {
      // Medicine pill: full circle on the left + rect that overlaps slightly
      // on its right. Circle is sized to the node height, rect fills the
      // remainder. Matches dim0's capsule.tsx (accent on the left, body
      // following).
      const circ = Math.min(h, w * 0.45)
      const overlap = circ * 0.1
      const rectX = circ - overlap
      const rectW = Math.max(0, w - rectX)
      const circY = (h - circ) / 2
      return [
        { atomic: 'ellipse', x: 0, y: circY, w: circ, h: circ },
        { atomic: 'rect', x: rectX, y: 0, w: rectW, h },
      ]
    }
    case 'thought-cloud': {
      // Dome ellipse centered on top + rect body underneath. The dome's
      // bottom half is naturally hidden by the rect's fill — only the top
      // arc reads as "the dome."
      const domeW = Math.min(w * 0.4, h * 1.2)
      const domeH = Math.min(h * 0.45, domeW)
      const domeX = (w - domeW) / 2
      const bodyY = domeH * 0.55
      const bodyH = Math.max(0, h - bodyY)
      return [
        { atomic: 'ellipse', x: domeX, y: 0, w: domeW, h: domeH },
        { atomic: 'rect', x: 0, y: bodyY, w, h: bodyH },
      ]
    }
    case 'layered-rect':
    case 'layered-ellipse':
    case 'layered-diamond': {
      const atomic: AtomicPrimitive =
        node.type === 'layered-rect'
          ? 'rect'
          : node.type === 'layered-ellipse'
            ? 'ellipse'
            : 'diamond'
      // Match dim0: front fills the bbox exactly, back is a same-sized
      // copy translated past the bbox by `LAYERED_OFFSET`. The back
      // reads as a "shadow" peeking out bottom-right rather than as
      // a distinct second shape. Clamped on small nodes so the offset
      // stays visually proportional.
      const off = Math.min(LAYERED_OFFSET, w * 0.15, h * 0.15)
      const back: SubShape = {
        atomic,
        x: off,
        y: off,
        w,
        h,
        style: darkenedStyle(style),
      }
      const front: SubShape = { atomic, x: 0, y: 0, w, h }
      return [back, front]
    }
  }
  return []
}

/**
 * Returns a clone of `style` with both fill and stroke shifted 20% toward
 * black — the "back layer" tone used by layered composites.
 */
const darkenedStyle = (style: Style | undefined): Style => {
  const fill = style?.backgroundColor
  const stroke = style?.strokeColor
  return {
    ...style,
    ...(fill ? { backgroundColor: darkenHex(fill) } : {}),
    ...(stroke ? { strokeColor: darkenHex(stroke) } : {}),
  }
}
