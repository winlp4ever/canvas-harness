/**
 * Selection-overlay drawing — runs on the interactive canvas.
 *
 * Renders:
 *   - selection outlines around selected node bounds
 *   - 8 resize handles for a single-node or multi-select selection
 *   - the marquee rect during marquee selection
 *   - dragged nodes at their uncommitted (delta-offset) positions
 *
 * Visual sizes are constant in screen pixels — `scale` (camera.z × DPR)
 * is used to convert px → world for outline strokes and handle sizes.
 */
import {
  RESIZE_HANDLE_SIZE_PX,
  ROTATE_HANDLE_RADIUS_PX,
  handleWorldPositions,
  rotateHandleWorldPosition,
} from '../hit-test/handle'
import type { Node, Vec2, WorldRect } from '../types'

export const SELECTION_COLOR = '#3b82f6'
export const SELECTION_OUTLINE_PX = 1.5
export const MARQUEE_FILL = 'rgba(59, 130, 246, 0.08)'
export const MARQUEE_STROKE_PX = 1

/**
 * Draws a 1.5px-on-screen outline around the node's (rotated) bounds.
 */
export const drawSelectionOutline = (
  ctx: CanvasRenderingContext2D,
  node: Node,
  scale: number,
): void => {
  if (node.angle === 0) {
    ctx.save()
    ctx.strokeStyle = SELECTION_COLOR
    ctx.lineWidth = SELECTION_OUTLINE_PX / scale
    ctx.beginPath()
    ctx.rect(node.x, node.y, node.w, node.h)
    ctx.stroke()
    ctx.restore()
    return
  }
  // Rotated: build the 4-corner path manually
  const cx = node.x + node.w / 2
  const cy = node.y + node.h / 2
  const cos = Math.cos(node.angle)
  const sin = Math.sin(node.angle)
  const corners: Vec2[] = [
    { x: -node.w / 2, y: -node.h / 2 },
    { x: node.w / 2, y: -node.h / 2 },
    { x: node.w / 2, y: node.h / 2 },
    { x: -node.w / 2, y: node.h / 2 },
  ].map(p => ({ x: cx + p.x * cos - p.y * sin, y: cy + p.x * sin + p.y * cos }))

  ctx.save()
  ctx.strokeStyle = SELECTION_COLOR
  ctx.lineWidth = SELECTION_OUTLINE_PX / scale
  ctx.beginPath()
  const first = corners[0]!
  ctx.moveTo(first.x, first.y)
  for (let i = 1; i < corners.length; i++) {
    const c = corners[i]!
    ctx.lineTo(c.x, c.y)
  }
  ctx.closePath()
  ctx.stroke()
  ctx.restore()
}

/**
 * Draws the 8 resize handles for a node at constant screen size.
 */
export const drawResizeHandles = (
  ctx: CanvasRenderingContext2D,
  node: Node,
  scale: number,
): void => {
  const halfPx = RESIZE_HANDLE_SIZE_PX / 2
  const halfWorld = halfPx / scale
  const positions = handleWorldPositions(node)

  ctx.save()
  ctx.fillStyle = '#fff'
  ctx.strokeStyle = SELECTION_COLOR
  ctx.lineWidth = SELECTION_OUTLINE_PX / scale
  for (const key of Object.keys(positions) as (keyof typeof positions)[]) {
    const p = positions[key]
    ctx.beginPath()
    ctx.rect(p.x - halfWorld, p.y - halfWorld, halfWorld * 2, halfWorld * 2)
    ctx.fill()
    ctx.stroke()
  }
  ctx.restore()
}

/**
 * Draws the rotation handle — circle above the top edge midpoint,
 * connected by a tether line. Constant screen size; rotation-aware so
 * the handle stays "above" the rotated top edge.
 *
 * cameraZ is passed separately from `scale` because the handle's
 * world-space offset depends on plain zoom (not DPR-multiplied scale).
 */
export const drawRotateHandle = (
  ctx: CanvasRenderingContext2D,
  node: Node,
  scale: number,
  cameraZ: number,
): void => {
  const center = rotateHandleWorldPosition(node, cameraZ)
  const radiusWorld = ROTATE_HANDLE_RADIUS_PX / scale

  // Tether: top edge midpoint → handle center, in the node's local frame.
  const cx = node.x + node.w / 2
  const cy = node.y + node.h / 2
  const cos = Math.cos(node.angle)
  const sin = Math.sin(node.angle)
  const topMidLocalY = -node.h / 2
  const topMidWorld = {
    x: cx + 0 * cos - topMidLocalY * sin,
    y: cy + 0 * sin + topMidLocalY * cos,
  }

  ctx.save()
  ctx.strokeStyle = SELECTION_COLOR
  ctx.lineWidth = SELECTION_OUTLINE_PX / scale
  ctx.beginPath()
  ctx.moveTo(topMidWorld.x, topMidWorld.y)
  ctx.lineTo(center.x, center.y)
  ctx.stroke()

  ctx.fillStyle = '#fff'
  ctx.beginPath()
  ctx.arc(center.x, center.y, radiusWorld, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.restore()
}

/**
 * Draws a single midpoint handle at the visual midpoint of a selected
 * bezier/polyline edge. Drag it to reshape the curve (the gesture in
 * `useInteractionGesture` converts the drag point into cubic controls
 * via `midpointToCubicControls`).
 */
export const drawEdgeMidpointHandle = (
  ctx: CanvasRenderingContext2D,
  midpoint: { x: number; y: number },
  scale: number,
): void => {
  const radiusPx = 5
  const radiusWorld = radiusPx / scale
  ctx.save()
  ctx.fillStyle = '#fff'
  ctx.strokeStyle = SELECTION_COLOR
  ctx.lineWidth = SELECTION_OUTLINE_PX / scale
  ctx.beginPath()
  ctx.arc(midpoint.x, midpoint.y, radiusWorld, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.restore()
}

/**
 * Draws the endpoint handles for a selected edge at the source/target
 * world points. Used during edit/reconnection.
 */
export const drawEdgeEndpointHandles = (
  ctx: CanvasRenderingContext2D,
  source: { x: number; y: number },
  target: { x: number; y: number },
  scale: number,
): void => {
  const radiusPx = 5
  const radiusWorld = radiusPx / scale
  ctx.save()
  ctx.fillStyle = '#fff'
  ctx.strokeStyle = SELECTION_COLOR
  ctx.lineWidth = SELECTION_OUTLINE_PX / scale
  for (const p of [source, target]) {
    ctx.beginPath()
    ctx.arc(p.x, p.y, radiusWorld, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }
  ctx.restore()
}

/**
 * Draws the marquee selection rectangle.
 */
export const drawMarquee = (
  ctx: CanvasRenderingContext2D,
  rect: WorldRect,
  scale: number,
): void => {
  ctx.save()
  ctx.fillStyle = MARQUEE_FILL
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h)
  ctx.strokeStyle = SELECTION_COLOR
  ctx.lineWidth = MARQUEE_STROKE_PX / scale
  ctx.setLineDash([4 / scale, 3 / scale])
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h)
  ctx.restore()
}
