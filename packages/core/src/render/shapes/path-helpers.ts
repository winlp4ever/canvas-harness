/**
 * Path-building helpers shared by shape draw functions.
 *
 * Each builds a path on the context using the node's local rect (0..w, 0..h);
 * the renderer has already applied translate(node.x, node.y) + rotation,
 * so shapes can think in pure local coordinates.
 */
export const buildRectPath = (
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  radius: number,
): void => {
  if (radius <= 0) {
    ctx.beginPath()
    ctx.rect(0, 0, w, h)
    return
  }
  const r = Math.min(radius, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(r, 0)
  ctx.lineTo(w - r, 0)
  ctx.quadraticCurveTo(w, 0, w, r)
  ctx.lineTo(w, h - r)
  ctx.quadraticCurveTo(w, h, w - r, h)
  ctx.lineTo(r, h)
  ctx.quadraticCurveTo(0, h, 0, h - r)
  ctx.lineTo(0, r)
  ctx.quadraticCurveTo(0, 0, r, 0)
  ctx.closePath()
}

export const buildEllipsePath = (ctx: CanvasRenderingContext2D, w: number, h: number): void => {
  const rx = w / 2
  const ry = h / 2
  ctx.beginPath()
  ctx.ellipse(rx, ry, rx, ry, 0, 0, Math.PI * 2)
}

export const buildDiamondPath = (ctx: CanvasRenderingContext2D, w: number, h: number): void => {
  ctx.beginPath()
  ctx.moveTo(w / 2, 0)
  ctx.lineTo(w, h / 2)
  ctx.lineTo(w / 2, h)
  ctx.lineTo(0, h / 2)
  ctx.closePath()
}

/**
 * Capsule = a rounded rectangle whose corner radius is min(w, h) / 2.
 * Produces a pill shape for tall/wide rects, a circle for squares.
 */
export const buildCapsulePath = (ctx: CanvasRenderingContext2D, w: number, h: number): void => {
  const r = Math.min(w, h) / 2
  buildRectPath(ctx, w, h, r)
}
