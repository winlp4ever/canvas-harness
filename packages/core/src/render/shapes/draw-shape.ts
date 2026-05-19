/**
 * Generic primitive paint pass.
 *
 * The renderer applies camera + node transforms (translate to node center,
 * rotate, translate back to top-left) before calling this. The drawer
 * just builds a local-space path and fills/strokes it with resolved style.
 */
import type { Node } from '../../types'
import {
  DEFAULT_STYLE,
  type ThemeResolver,
  dashPatternFor,
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

export const drawShape = (
  ctx: CanvasRenderingContext2D,
  node: Node,
  theme?: ThemeResolver,
): void => {
  if (!isDrawablePrimitive(node.type)) return
  if (node.hidden) return
  if (node.w <= 0 || node.h <= 0) return

  const style = node.style
  const strokeWidth = resolveStrokeWidth(style, theme)
  const opacity = resolveOpacity(style, theme)
  const fill = resolveColor(style, 'backgroundColor', DEFAULT_STYLE.backgroundColor, theme)
  const stroke = resolveColor(style, 'strokeColor', DEFAULT_STYLE.strokeColor, theme)
  const dash = dashPatternFor(style?.strokeStyle, strokeWidth)

  // Path is built in node-local coords (0..w, 0..h); caller has already
  // translated to node.x/y and applied rotation around the node center.
  switch (node.type) {
    case 'rect':
      buildRectPath(ctx, node.w, node.h, (style?.roundness ?? DEFAULT_STYLE.roundness) * 4)
      break
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

  ctx.save()
  ctx.globalAlpha = opacity

  // Fill: explicit transparent ("#00000000" or rgba(.., 0)) means skip.
  if (!isFullyTransparent(fill)) {
    ctx.fillStyle = fill
    ctx.fill()
  }

  // Stroke
  if (strokeWidth > 0 && !isFullyTransparent(stroke)) {
    ctx.strokeStyle = stroke
    ctx.lineWidth = strokeWidth
    ctx.setLineDash(dash)
    ctx.stroke()
  }

  ctx.restore()
}

const isFullyTransparent = (color: string): boolean => {
  if (color === 'transparent') return true
  // Quick string check for "#RRGGBB00" or "#RGBA" with 0 alpha; skip parsing rgba()
  if (color.length === 9 && color.startsWith('#') && color.slice(7, 9).toLowerCase() === '00')
    return true
  if (color.length === 5 && color.startsWith('#') && color[4] === '0') return true
  return false
}
