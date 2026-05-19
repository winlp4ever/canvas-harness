import { type CanvasBackground, DEFAULT_BACKGROUND, type WorldRect } from '../types'

/**
 * Page background + optional infinite dot / grid pattern.
 *
 * Called inside `paintStatic` after the camera transform is applied,
 * before nodes. Dots / grid lines are drawn in world coordinates so
 * they anchor to the world origin — panning moves the user *through*
 * the pattern, zooming changes visual density.
 *
 * LOD: when `gap × zoom` drops below `MIN_PATTERN_SCREEN_PX`, the
 * effective gap doubles in octaves so the pattern stays roughly the
 * same on-screen density. Below `MIN_VISIBLE_PATTERN_PX` the pattern
 * is omitted entirely (sub-pixel would be unreadable mush + waste).
 */
export type PaintBackgroundOptions = {
  /** Visible world rect (after viewport-overscan). */
  viewport: WorldRect
  /** camera.z — used for LOD octave selection + screen-px conversion. */
  zoom: number
  background?: CanvasBackground
}

const MIN_PATTERN_SCREEN_PX = 8
const MIN_VISIBLE_PATTERN_PX = 2

export const paintBackground = (
  ctx: CanvasRenderingContext2D,
  opts: PaintBackgroundOptions,
): void => {
  const bg = { ...DEFAULT_BACKGROUND, ...opts.background }

  // 1. Solid page color. Fill the visible world rect; the caller has
  //    already applied the camera transform so we paint in world coords.
  ctx.save()
  ctx.fillStyle = bg.color
  ctx.fillRect(opts.viewport.x, opts.viewport.y, opts.viewport.w, opts.viewport.h)
  ctx.restore()

  if (bg.pattern === 'none') return

  // 2. LOD — densify the gap in octaves until each cell is at least
  //    MIN_PATTERN_SCREEN_PX on-screen. Skip entirely when pattern
  //    would be sub-visible.
  let effectiveGap = bg.gap
  while (effectiveGap * opts.zoom < MIN_PATTERN_SCREEN_PX) {
    effectiveGap *= 2
    if (effectiveGap > 1e6) return // runaway guard
  }
  if (effectiveGap * opts.zoom < MIN_VISIBLE_PATTERN_PX) return

  // 3. First grid line / dot inside the viewport — snap to the gap.
  const minX = Math.floor(opts.viewport.x / effectiveGap) * effectiveGap
  const minY = Math.floor(opts.viewport.y / effectiveGap) * effectiveGap
  const maxX = opts.viewport.x + opts.viewport.w
  const maxY = opts.viewport.y + opts.viewport.h

  if (bg.pattern === 'dots') {
    paintDots(ctx, minX, minY, maxX, maxY, effectiveGap, bg.patternColor, opts.zoom)
  } else if (bg.pattern === 'grid') {
    paintGrid(ctx, minX, minY, maxX, maxY, effectiveGap, bg.patternColor, opts.zoom)
  }
}

const paintDots = (
  ctx: CanvasRenderingContext2D,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  gap: number,
  color: string,
  zoom: number,
): void => {
  // Dot radius constant in screen px so dots don't get huge at high zoom.
  const radiusWorld = Math.max(0.5, 1.2 / zoom)
  ctx.save()
  ctx.fillStyle = color
  for (let y = minY; y <= maxY; y += gap) {
    for (let x = minX; x <= maxX; x += gap) {
      ctx.beginPath()
      ctx.arc(x, y, radiusWorld, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.restore()
}

const paintGrid = (
  ctx: CanvasRenderingContext2D,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  gap: number,
  color: string,
  zoom: number,
): void => {
  const lineWidth = 1 / zoom // constant 1px on screen
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = lineWidth
  ctx.beginPath()
  for (let x = minX; x <= maxX; x += gap) {
    ctx.moveTo(x, minY)
    ctx.lineTo(x, maxY)
  }
  for (let y = minY; y <= maxY; y += gap) {
    ctx.moveTo(minX, y)
    ctx.lineTo(maxX, y)
  }
  ctx.stroke()
  ctx.restore()
}
