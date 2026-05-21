/**
 * Paint helpers for `image` and `icon` node types. Caller is already
 * inside `drawWithNodeTransform` (origin at the node's top-left,
 * rotation applied), so we paint into local space `(0, 0, w, h)`.
 *
 * Both helpers return true when a bitmap was blitted, false when the
 * bitmap is still loading (caller may paint a placeholder).
 */
import type { IconNodeData, ImageNodeData, Node } from '../../types'
import { resolveOpacity } from '../shapes/defaults'
import type { ThemeResolver } from '../shapes/defaults'
import type { AssetCache } from './cache'

/** Cheap loading placeholder — light fill so the user sees a tile while we decode. */
const PLACEHOLDER_FILL = '#e5e7eb'
const PLACEHOLDER_TEXT_FILL = '#94a3b8'

const paintPlaceholder = (ctx: CanvasRenderingContext2D, w: number, h: number, label: string) => {
  ctx.fillStyle = PLACEHOLDER_FILL
  ctx.fillRect(0, 0, w, h)
  if (w >= 32 && h >= 16) {
    ctx.fillStyle = PLACEHOLDER_TEXT_FILL
    ctx.font = '11px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, w / 2, h / 2)
  }
}

export const paintImageNode = (
  ctx: CanvasRenderingContext2D,
  node: Node,
  cache: AssetCache,
  theme?: ThemeResolver,
): void => {
  if (node.w <= 0 || node.h <= 0) return
  const data = node.data as ImageNodeData | undefined
  if (!data?.src) return
  const bitmap = cache.getImage(data.src)
  const opacity = resolveOpacity(node.style, theme)
  const needsScope = opacity !== 1
  if (needsScope) {
    ctx.save()
    ctx.globalAlpha = opacity
  }
  if (bitmap?.complete) {
    ctx.drawImage(bitmap, 0, 0, node.w, node.h)
  } else {
    paintPlaceholder(ctx, node.w, node.h, 'loading…')
  }
  if (needsScope) ctx.restore()
}

export const paintIconNode = (
  ctx: CanvasRenderingContext2D,
  node: Node,
  cache: AssetCache,
  scale: number,
  theme?: ThemeResolver,
): void => {
  if (node.w <= 0 || node.h <= 0) return
  const data = node.data as IconNodeData | undefined
  if (!data?.src) return
  // Bucket raster size by on-device pixels. We pass the longer side
  // so non-square nodes still render at their native quality on the
  // larger axis.
  const sizePx = Math.max(node.w, node.h) * scale
  const color = node.style?.iconColor
  const bitmap = cache.getIcon(data.src, color, sizePx)
  const opacity = resolveOpacity(node.style, theme)
  const needsScope = opacity !== 1
  if (needsScope) {
    ctx.save()
    ctx.globalAlpha = opacity
  }
  if (bitmap) {
    ctx.drawImage(bitmap, 0, 0, node.w, node.h)
  } else {
    paintPlaceholder(ctx, node.w, node.h, 'svg…')
  }
  if (needsScope) ctx.restore()
}
