/**
 * SVG-path builders for our shape primitives. Designed to feed
 * `rough.generator.path(d, ...)`.
 *
 * Rounded rect / diamond follow the excalidraw style — quadratic
 * curves at the corners that, combined with rough.js jitter, look
 * organically imperfect.
 */

export const rectPath = (x: number, y: number, w: number, h: number): string => {
  return `M${x} ${y} L${x + w} ${y} L${x + w} ${y + h} L${x} ${y + h} Z`
}

/**
 * Excalidraw-style rounded rect — corners use quadratic curves rather
 * than perfect arcs. Slight asymmetry under rough.js jitter looks
 * hand-drawn instead of CAD-clean.
 */
export const excalidrawRoundedRectPath = (
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): string => {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2))
  if (r === 0) return rectPath(x, y, w, h)
  const x2 = x + w
  const y2 = y + h
  return [
    `M${x + r} ${y}`,
    `L${x2 - r} ${y}`,
    `Q${x2} ${y}, ${x2} ${y + r}`,
    `L${x2} ${y2 - r}`,
    `Q${x2} ${y2}, ${x2 - r} ${y2}`,
    `L${x + r} ${y2}`,
    `Q${x} ${y2}, ${x} ${y2 - r}`,
    `L${x} ${y + r}`,
    `Q${x} ${y}, ${x + r} ${y}`,
    'Z',
  ].join(' ')
}

/**
 * Diamond inscribed in `(x, y, w, h)`. At `radius = 0` the corners are
 * sharp; positive radius produces the soft-diamond excalidraw look —
 * each edge trimmed by r·√2, corners replaced with quadratic curves.
 */
export const diamondPath = (x: number, y: number, w: number, h: number, radius = 0): string => {
  const cx = x + w / 2
  const cy = y + h / 2
  if (radius <= 0) {
    return `M${cx} ${y} L${x + w} ${cy} L${cx} ${y + h} L${x} ${cy} Z`
  }
  const T = { x: cx, y }
  const R = { x: x + w, y: cy }
  const B = { x: cx, y: y + h }
  const L = { x, y: cy }
  const edgeLen = Math.hypot(R.x - T.x, R.y - T.y)
  const sMax = Math.max(0, edgeLen / 2 - 0.01)
  const s = Math.min(radius * Math.SQRT2, sMax)
  if (s <= 0.0001) {
    return `M${T.x} ${T.y} L${R.x} ${R.y} L${B.x} ${B.y} L${L.x} ${L.y} Z`
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
  return [
    `M${TR.x} ${TR.y}`,
    `L${RT.x} ${RT.y}`,
    `Q${R.x} ${R.y}, ${RB.x} ${RB.y}`,
    `L${BR.x} ${BR.y}`,
    `Q${B.x} ${B.y}, ${BL.x} ${BL.y}`,
    `L${LB.x} ${LB.y}`,
    `Q${L.x} ${L.y}, ${LT.x} ${LT.y}`,
    `L${TL.x} ${TL.y}`,
    `Q${T.x} ${T.y}, ${TR.x} ${TR.y}`,
    'Z',
  ].join(' ')
}

/**
 * Ellipse as an SVG path. rough.js has its own `ellipse` primitive
 * but using a single path keeps the rough cache key compact.
 */
export const ellipsePath = (x: number, y: number, w: number, h: number): string => {
  const cx = x + w / 2
  const rx = w / 2
  const ry = h / 2
  return [
    `M${cx} ${y}`,
    `A${rx} ${ry} 0 1 0 ${cx} ${y + h}`,
    `A${rx} ${ry} 0 1 0 ${cx} ${y}`,
    'Z',
  ].join(' ')
}

/**
 * Thought-cloud — rect body with a dome that merges seamlessly into
 * the top edge. Single continuous outline, no internal seam between
 * dome and rect.
 */
export const thoughtCloudPath = (
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): string => {
  const domeW = Math.min(w * 0.4, h * 1.2)
  const domeH = Math.min(h * 0.45, domeW)
  const domeAnchorX = w * 0.3
  const domeX = Math.max(0, Math.min(w - domeW, domeAnchorX - domeW / 2))
  const cx = x + domeX + domeW / 2
  const cy = y + domeH / 2
  const rx = domeW / 2
  const ry = domeH / 2
  const bodyY = y + domeH * 0.55
  const bodyH = y + h - bodyY
  const r = Math.max(0, Math.min(radius, bodyH / 2, w / 2))

  const t = ry > 0 ? (bodyY - cy) / ry : 0
  let xL = x + domeX
  let xR = x + domeX + domeW
  if (Math.abs(t) < 1) {
    const xOffset = rx * Math.sqrt(1 - t * t)
    xL = cx - xOffset
    xR = cx + xOffset
  }
  xL = Math.max(x + r, xL)
  xR = Math.min(x + w - r, xR)

  // Large-arc=1 (longer arc, through top), sweep=1 (clockwise / positive
  // angle direction in SVG, i.e. up over the dome).
  return [
    `M${x + r} ${bodyY}`,
    `L${xL} ${bodyY}`,
    `A${rx} ${ry} 0 1 1 ${xR} ${bodyY}`,
    `L${x + w - r} ${bodyY}`,
    `Q${x + w} ${bodyY}, ${x + w} ${bodyY + r}`,
    `L${x + w} ${y + h - r}`,
    `Q${x + w} ${y + h}, ${x + w - r} ${y + h}`,
    `L${x + r} ${y + h}`,
    `Q${x} ${y + h}, ${x} ${y + h - r}`,
    `L${x} ${bodyY + r}`,
    `Q${x} ${bodyY}, ${x + r} ${bodyY}`,
    'Z',
  ].join(' ')
}

/**
 * Tag — pointed notch on the left flowing into a rounded body.
 * Ported from dim0. `radius` controls both the body corner radius and
 * the join smoothness.
 */
export const tagPath = (
  x: number,
  y: number,
  w: number,
  h: number,
  radius = 8,
): string => {
  const notch = Math.min(h * 0.5, w * 0.3)
  const tipRadius = 6
  const tipX = x
  const tipY = y + h / 2
  const bodyLeft = x + Math.max(0, Math.min(notch, w))
  const right = x + w
  const bottom = y + h
  const rBody = Math.min(radius, h / 2, (right - bodyLeft) / 2)
  const rJoin = Math.min(radius, h * 0.45, (bodyLeft - x) * 0.8)

  if (bodyLeft - x <= 0.001) {
    return excalidrawRoundedRectPath(x, y, w, h, Math.min(radius, h / 2, w / 2))
  }

  const pTop = { x: bodyLeft, y: y + rJoin }
  const pBot = { x: bodyLeft, y: bottom - rJoin }
  const dirX = tipX - bodyLeft
  const dirYTop = tipY - pTop.y
  const dirYBot = tipY - pBot.y
  const lenTop = Math.hypot(dirX, dirYTop) || 1
  const lenBot = Math.hypot(dirX, dirYBot) || 1
  const maxTipRound = Math.min(lenTop, lenBot) * 0.49
  const t = Math.max(0, Math.min(tipRadius, maxTipRound))
  const tipEnter = { x: tipX - (dirX / lenBot) * t, y: tipY - (dirYBot / lenBot) * t }
  const tipExit = { x: tipX - (dirX / lenTop) * t, y: tipY - (dirYTop / lenTop) * t }
  const k = rJoin * 0.65
  const topStart = { x: bodyLeft + rBody, y }
  const botEnd = { x: bodyLeft + rBody, y: bottom }

  const parts: string[] = [
    `M${topStart.x} ${topStart.y}`,
    `L${right - rBody} ${y}`,
    `Q${right} ${y}, ${right} ${y + rBody}`,
    `L${right} ${bottom - rBody}`,
    `Q${right} ${bottom}, ${right - rBody} ${bottom}`,
    `L${botEnd.x} ${botEnd.y}`,
    `C${botEnd.x - k} ${bottom}, ${pBot.x - (dirX / lenBot) * k} ${pBot.y - (dirYBot / lenBot) * k}, ${pBot.x} ${pBot.y}`,
    `L${t > 0 ? tipEnter.x : tipX} ${t > 0 ? tipEnter.y : tipY}`,
  ]
  if (t > 0) parts.push(`Q${tipX} ${tipY}, ${tipExit.x} ${tipExit.y}`)
  parts.push(
    `L${pTop.x} ${pTop.y}`,
    `C${pTop.x - (dirX / lenTop) * k} ${pTop.y - (dirYTop / lenTop) * k}, ${topStart.x - k} ${y}, ${topStart.x} ${topStart.y}`,
    'Z',
  )
  return parts.join(' ')
}
