/**
 * SVG-path builders for our four built-in shape primitives. Designed
 * to feed `rough.generator.path(d, ...)`.
 *
 * The rounded-rect builder follows the excalidraw style — quadratic
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

export const diamondPath = (x: number, y: number, w: number, h: number): string => {
  const cx = x + w / 2
  const cy = y + h / 2
  return `M${cx} ${y} L${x + w} ${cy} L${cx} ${y + h} L${x} ${cy} Z`
}

/**
 * Capsule = horizontal pill. Two semicircles bridged by horizontal
 * lines. Renders sensibly even when w < h (degenerates to ellipse-ish).
 */
export const capsulePath = (x: number, y: number, w: number, h: number): string => {
  const r = Math.min(w, h) / 2
  if (w <= h) {
    // Vertical orientation degenerate — treat as ellipse via path.
    return ellipsePath(x, y, w, h)
  }
  const x1 = x + r
  const x2 = x + w - r
  return [
    `M${x1} ${y}`,
    `L${x2} ${y}`,
    `A${r} ${r} 0 0 1 ${x2} ${y + h}`,
    `L${x1} ${y + h}`,
    `A${r} ${r} 0 0 1 ${x1} ${y}`,
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
