/**
 * Derive a visible border color for rough shapes whose `strokeColor` is
 * transparent — without this, the rough.js pass paints nothing and the
 * misregistration effect (offset fill vs. stroke) has nothing to show.
 *
 * Mirrors dim0's `resolveEdgeRender` + tonal-shift mix:
 *   light mode: `mixHex(fill, '#fff', 0.2)`  → lighter than fill
 *   dark mode:  `mixHex(fill, '#000', 0.2)`  → darker than fill
 *
 * Result is memoized per `(fill, isDark)` pair so the rough drawable
 * cache key stays stable across renders.
 */
import { isFullyTransparent } from '../shapes/defaults'

const TONE_BLEND = 0.2
const cache = new Map<string, string>()

const parseHex = (hex: string): [number, number, number] | null => {
  if (!hex.startsWith('#')) return null
  const h = hex.slice(1)
  if (h.length === 3) {
    return [
      parseInt(h[0]! + h[0]!, 16),
      parseInt(h[1]! + h[1]!, 16),
      parseInt(h[2]! + h[2]!, 16),
    ]
  }
  if (h.length === 6 || h.length === 8) {
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
  }
  return null
}

const toHexPair = (n: number): string =>
  Math.max(0, Math.min(255, Math.round(n)))
    .toString(16)
    .padStart(2, '0')

const mixHex = (a: string, b: string, t: number): string => {
  const A = parseHex(a)
  const B = parseHex(b)
  if (!A || !B) return a
  const p = Math.max(0, Math.min(1, t))
  return `#${toHexPair(A[0] * (1 - p) + B[0] * p)}${toHexPair(A[1] * (1 - p) + B[1] * p)}${toHexPair(A[2] * (1 - p) + B[2] * p)}`
}

/**
 * If `stroke` is transparent and `fill` is a visible color, returns a
 * tonally-shifted variant of `fill` suitable for drawing a soft border.
 * Otherwise returns `stroke` unchanged. Memoized.
 */
export const deriveRoughStrokeColor = (
  stroke: string,
  fill: string,
  isDark: boolean,
): string => {
  if (!isFullyTransparent(stroke)) return stroke
  if (isFullyTransparent(fill)) return stroke
  const key = `${fill}|${isDark ? 'd' : 'l'}`
  const hit = cache.get(key)
  if (hit) return hit
  const next = mixHex(fill, isDark ? '#000000' : '#ffffff', TONE_BLEND)
  cache.set(key, next)
  return next
}

/** Reset state — tests only. */
export const __resetToneDownCache = (): void => {
  cache.clear()
}
