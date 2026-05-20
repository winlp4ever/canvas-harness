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

/**
 * Diamond inscribed in `(0, 0, w, h)`. When `radius` > 0, each 45° edge is
 * trimmed by `radius * √2` and the corner vertex is replaced with a
 * quadratic curve — produces the "soft diamond" excalidraw look. At
 * radius 0 the corners are sharp.
 */
export const buildDiamondPath = (
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  radius = 0,
): void => {
  ctx.beginPath()
  if (radius <= 0) {
    ctx.moveTo(w / 2, 0)
    ctx.lineTo(w, h / 2)
    ctx.lineTo(w / 2, h)
    ctx.lineTo(0, h / 2)
    ctx.closePath()
    return
  }
  const cx = w / 2
  const cy = h / 2
  const T = { x: cx, y: 0 }
  const R = { x: w, y: cy }
  const B = { x: cx, y: h }
  const L = { x: 0, y: cy }
  const edgeLen = Math.hypot(R.x - T.x, R.y - T.y)
  const sMax = Math.max(0, edgeLen / 2 - 0.01)
  const s = Math.min(radius * Math.SQRT2, sMax)
  if (s <= 0.0001) {
    ctx.moveTo(T.x, T.y)
    ctx.lineTo(R.x, R.y)
    ctx.lineTo(B.x, B.y)
    ctx.lineTo(L.x, L.y)
    ctx.closePath()
    return
  }
  const along = (a: { x: number; y: number }, b: { x: number; y: number }, d: number) => {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy) || 1
    const t = d / len
    return { x: a.x + dx * t, y: a.y + dy * t }
  }
  const TR = along(T, R, s)
  const RT = along(R, T, s)
  const RB = along(R, B, s)
  const BR = along(B, R, s)
  const BL = along(B, L, s)
  const LB = along(L, B, s)
  const LT = along(L, T, s)
  const TL = along(T, L, s)
  ctx.moveTo(TR.x, TR.y)
  ctx.lineTo(RT.x, RT.y)
  ctx.quadraticCurveTo(R.x, R.y, RB.x, RB.y)
  ctx.lineTo(BR.x, BR.y)
  ctx.quadraticCurveTo(B.x, B.y, BL.x, BL.y)
  ctx.lineTo(LB.x, LB.y)
  ctx.quadraticCurveTo(L.x, L.y, LT.x, LT.y)
  ctx.lineTo(TL.x, TL.y)
  ctx.quadraticCurveTo(T.x, T.y, TR.x, TR.y)
  ctx.closePath()
}

/**
 * Tag shape — pointed notch on the left flowing into a rounded body.
 * `notch` is the horizontal distance from the tip to the body edge.
 * Ported from dim0/components/rough/paths.ts.
 */
export const buildTagPath = (
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  radius = 8,
): void => {
  const notch = Math.min(h * 0.5, w * 0.3)
  const tipRadius = 6
  const tipX = 0
  const tipY = h / 2

  const bodyLeft = Math.max(0, Math.min(notch, w))
  const right = w
  const bottom = h
  const rBody = Math.min(radius, h / 2, (right - bodyLeft) / 2)
  const rJoin = Math.min(radius, h * 0.45, bodyLeft * 0.8)

  ctx.beginPath()
  if (bodyLeft <= 0.001) {
    const r = Math.min(radius, h / 2, w / 2)
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
    return
  }

  const pTop = { x: bodyLeft, y: rJoin }
  const pBot = { x: bodyLeft, y: bottom - rJoin }
  const dirX = tipX - bodyLeft
  const dirYTop = tipY - rJoin
  const dirYBot = tipY - (bottom - rJoin)
  const lenTop = Math.hypot(dirX, dirYTop) || 1
  const lenBot = Math.hypot(dirX, dirYBot) || 1
  const maxTipRound = Math.min(lenTop, lenBot) * 0.49
  const t = Math.max(0, Math.min(tipRadius, maxTipRound))
  const tipEnter = { x: tipX - (dirX / lenBot) * t, y: tipY - (dirYBot / lenBot) * t }
  const tipExit = { x: tipX - (dirX / lenTop) * t, y: tipY - (dirYTop / lenTop) * t }
  const k = rJoin * 0.65
  const topStart = { x: bodyLeft + rBody, y: 0 }
  const botEnd = { x: bodyLeft + rBody, y: bottom }

  ctx.moveTo(topStart.x, topStart.y)
  ctx.lineTo(right - rBody, 0)
  ctx.quadraticCurveTo(right, 0, right, rBody)
  ctx.lineTo(right, bottom - rBody)
  ctx.quadraticCurveTo(right, bottom, right - rBody, bottom)
  ctx.lineTo(botEnd.x, botEnd.y)
  ctx.bezierCurveTo(
    botEnd.x - k,
    bottom,
    pBot.x - (dirX / lenBot) * k,
    pBot.y - (dirYBot / lenBot) * k,
    pBot.x,
    pBot.y,
  )
  ctx.lineTo(t > 0 ? tipEnter.x : tipX, t > 0 ? tipEnter.y : tipY)
  if (t > 0) ctx.quadraticCurveTo(tipX, tipY, tipExit.x, tipExit.y)
  ctx.lineTo(pTop.x, pTop.y)
  ctx.bezierCurveTo(
    pTop.x - (dirX / lenTop) * k,
    pTop.y - (dirYTop / lenTop) * k,
    topStart.x - k,
    0,
    topStart.x,
    0,
  )
  ctx.closePath()
}
