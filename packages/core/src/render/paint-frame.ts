/**
 * Paint for `type: 'frame'` nodes. Frames are slide regions that sit
 * visually behind content — see ARCHITECTURE.md §3.7 frames.
 *
 * Visual:
 *   - Thin 1.5px-on-screen border in a subdued color
 *   - Faint fill so the boundary reads even on textured backgrounds
 *   - Name label above the top edge (`node.content`, fallback "Frame")
 *
 * Caller is already inside `drawWithNodeTransform` (origin at frame's
 * top-left, rotation applied). No rough.js — frames are organizational
 * chrome, not hand-drawn content.
 */
import type { Node } from '../types'
import { resolveColor, resolveOpacity } from './shapes/defaults'
import type { ThemeResolver } from './shapes/defaults'

const FRAME_BORDER_PX = 1.5
const FRAME_BORDER_COLOR_DEFAULT = '#94a3b8'
const FRAME_FILL_DEFAULT = 'rgba(148, 163, 184, 0.06)'
const FRAME_LABEL_FONT_PX = 12
const FRAME_LABEL_GAP_PX = 6
const FRAME_LABEL_COLOR = '#64748b'

export const paintFrameNode = (
  ctx: CanvasRenderingContext2D,
  node: Node,
  scale: number,
  theme?: ThemeResolver,
): void => {
  if (node.w <= 0 || node.h <= 0) return
  const opacity = resolveOpacity(node.style, theme)
  const needsScope = opacity !== 1
  if (needsScope) {
    ctx.save()
    ctx.globalAlpha = opacity
  }

  // Fill
  const fill =
    node.style?.backgroundColor ??
    (theme ? (theme('frame.background') as string | undefined) : undefined) ??
    FRAME_FILL_DEFAULT
  ctx.fillStyle = fill
  ctx.fillRect(0, 0, node.w, node.h)

  // Border
  const stroke = resolveColor(node.style, 'strokeColor', FRAME_BORDER_COLOR_DEFAULT, theme)
  ctx.strokeStyle = stroke
  ctx.lineWidth = FRAME_BORDER_PX / scale
  ctx.setLineDash([])
  ctx.strokeRect(0, 0, node.w, node.h)

  // Label above the top edge. Drawn in screen-pixel sizes via
  // 1/scale so it stays constant across zoom levels.
  const labelPx = FRAME_LABEL_FONT_PX / scale
  const gapPx = FRAME_LABEL_GAP_PX / scale
  const label = node.content?.trim() || 'Frame'
  ctx.fillStyle = FRAME_LABEL_COLOR
  ctx.textBaseline = 'bottom'
  ctx.textAlign = 'left'
  ctx.font = `500 ${labelPx}px system-ui, -apple-system, sans-serif`
  ctx.fillText(label, 0, -gapPx)

  if (needsScope) ctx.restore()
}
