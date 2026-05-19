/**
 * Arrowheads — see ARCHITECTURE.md §6.5 + §3.4 (4 styles).
 *
 * The arrowhead sits at the clipped endpoint of the edge; its direction
 * comes from the curve's tangent at that arc-length position. We draw
 * in world coords so the strokeWidth follows the camera transform —
 * scale of strokeWidth/scale gives a constant-screen-px width.
 */
import type { Arrowhead, Vec2 } from '../types'

/** Arrow length in world units at zoom 1; scales with strokeWidth. */
const ARROW_BASE_LENGTH = 12
const ARROW_BASE_WIDTH = 8

/**
 * Draws an arrowhead at the given world tip, pointing toward `tipDir`
 * (the unit tangent direction at that point — pointing FROM the curve
 * INTO the tip).
 */
export const drawArrowhead = (
  ctx: CanvasRenderingContext2D,
  kind: Arrowhead,
  tip: Vec2,
  tipDir: Vec2,
  strokeColor: string,
  strokeWidth: number,
): void => {
  if (kind === 'none') return

  // Scale arrowhead with stroke width so styling stays consistent.
  const scale = Math.max(1, strokeWidth / 2)
  const len = ARROW_BASE_LENGTH * scale
  const half = (ARROW_BASE_WIDTH / 2) * scale

  // Perpendicular to tipDir (rotate 90° ccw).
  const px = -tipDir.y
  const py = tipDir.x

  // Two base corners of the arrowhead triangle.
  const baseCenter: Vec2 = { x: tip.x - tipDir.x * len, y: tip.y - tipDir.y * len }
  const left: Vec2 = { x: baseCenter.x + px * half, y: baseCenter.y + py * half }
  const right: Vec2 = { x: baseCenter.x - px * half, y: baseCenter.y - py * half }

  ctx.save()
  if (kind === 'arrow') {
    // Two short strokes from the tip back along the curve direction.
    ctx.strokeStyle = strokeColor
    ctx.lineWidth = strokeWidth
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(left.x, left.y)
    ctx.lineTo(tip.x, tip.y)
    ctx.lineTo(right.x, right.y)
    ctx.stroke()
  } else if (kind === 'arrow-filled') {
    ctx.fillStyle = strokeColor
    ctx.beginPath()
    ctx.moveTo(tip.x, tip.y)
    ctx.lineTo(left.x, left.y)
    ctx.lineTo(right.x, right.y)
    ctx.closePath()
    ctx.fill()
  } else if (kind === 'barb') {
    // Open arrow with the base barbed inward (a notched chevron).
    const notch: Vec2 = {
      x: baseCenter.x + tipDir.x * len * 0.35,
      y: baseCenter.y + tipDir.y * len * 0.35,
    }
    ctx.strokeStyle = strokeColor
    ctx.lineWidth = strokeWidth
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.fillStyle = strokeColor
    ctx.beginPath()
    ctx.moveTo(tip.x, tip.y)
    ctx.lineTo(left.x, left.y)
    ctx.lineTo(notch.x, notch.y)
    ctx.lineTo(right.x, right.y)
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
}

/**
 * World-space length added to the visible arrowhead at a given stroke
 * width. Used to know how much to shorten the curve's visible portion
 * so the line tail doesn't poke through the arrowhead tip.
 */
export const arrowheadLength = (kind: Arrowhead, strokeWidth: number): number => {
  if (kind === 'none') return 0
  const scale = Math.max(1, strokeWidth / 2)
  return ARROW_BASE_LENGTH * scale
}
