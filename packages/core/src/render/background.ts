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

  // 2a. User-configured zoom cliffs — hide pattern outside [minZoom, maxZoom].
  if (opts.zoom < bg.minZoom) return
  if (opts.zoom > bg.maxZoom) return

  // 2b. LOD — densify the gap in octaves until each cell is at least
  //     MIN_PATTERN_SCREEN_PX on-screen. Skip entirely when pattern
  //     would be sub-visible.
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
  // Use a tiny `fillRect` per dot rather than `arc + fill`. At 1-2px
  // on-screen the corners aren't perceivable (antialiasing softens
  // them into something visually indistinguishable from a small
  // round dot), and one canvas2d call replaces three (beginPath /
  // arc / fill) plus the implicit curve approximation. ~3-5x faster
  // across thousands of dots/frame.
  const sizeWorld = Math.max(1, 1.6 / zoom)
  const half = sizeWorld / 2
  ctx.save()
  ctx.fillStyle = color
  for (let y = minY; y <= maxY; y += gap) {
    for (let x = minX; x <= maxX; x += gap) {
      ctx.fillRect(x - half, y - half, sizeWorld, sizeWorld)
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
