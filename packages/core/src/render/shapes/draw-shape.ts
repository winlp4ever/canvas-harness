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
import type { Node } from '../../types'
import {
  DEFAULT_STYLE,
  type ThemeResolver,
  dashPatternFor,
  isFullyTransparent,
  resolveColor,
  resolveOpacity,
  resolveStrokeWidth,
} from './defaults'
import { buildCapsulePath, buildDiamondPath, buildEllipsePath, buildRectPath } from './path-helpers'

export type PrimitiveType = 'rect' | 'ellipse' | 'diamond' | 'capsule'

/**
 * Returns true if `node.type` is one of the built-ins drawShape can render.
 */
export const isDrawablePrimitive = (type: string): type is PrimitiveType =>
  type === 'rect' || type === 'ellipse' || type === 'diamond' || type === 'capsule'

/**
 * Below this threshold the rounded-rect path is visually indistinguishable
 * from a plain rect — at sub-pixel corner radius the difference disappears.
 */
const PLAIN_RECT_CORNER_THRESHOLD_PX = 1.5

/**
 * Below this on-screen stroke width, the stroke contributes only noisy
 * anti-aliased edge pixels — skipping it removes a per-shape ctx.stroke()
 * call (the single most expensive op at low zoom) with no visible loss.
 */
const STROKE_VISIBILITY_THRESHOLD_PX = 0.5

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

  const style = node.style
  const strokeWidth = resolveStrokeWidth(style, theme)
  const opacity = resolveOpacity(style, theme)
  const fill = resolveColor(style, 'backgroundColor', DEFAULT_STYLE.backgroundColor, theme)
  const stroke = resolveColor(style, 'strokeColor', DEFAULT_STYLE.strokeColor, theme)

  // Decide what we'll actually paint. Cheaper to early-out than to build a path
  // we then never fill or stroke.
  const fillVisible = !isFullyTransparent(fill)
  const strokeVisible =
    strokeWidth > 0 &&
    strokeWidth * scale >= STROKE_VISIBILITY_THRESHOLD_PX &&
    !isFullyTransparent(stroke)
  if (!fillVisible && !strokeVisible) return

  // Path is built in node-local coords (0..w, 0..h); caller has already
  // translated to node.x/y and applied rotation around the node center.
  switch (node.type) {
    case 'rect': {
      const cornerRadius = (style?.roundness ?? DEFAULT_STYLE.roundness) * 4
      if (cornerRadius * scale < PLAIN_RECT_CORNER_THRESHOLD_PX) {
        ctx.beginPath()
        ctx.rect(0, 0, node.w, node.h)
      } else {
        buildRectPath(ctx, node.w, node.h, cornerRadius)
      }
      break
    }
    case 'ellipse':
      buildEllipsePath(ctx, node.w, node.h)
      break
    case 'diamond':
      buildDiamondPath(ctx, node.w, node.h)
      break
    case 'capsule':
      buildCapsulePath(ctx, node.w, node.h)
      break
  }

  // Skip save/restore when opacity is unchanged. ctx.save/restore allocates
  // state-stack entries; at 20k shapes/frame it's measurable overhead.
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
    const dash = dashPatternFor(style?.strokeStyle, strokeWidth)
    ctx.setLineDash(dash)
    ctx.stroke()
  }

  if (needsScope) ctx.restore()
}
