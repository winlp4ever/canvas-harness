/**
 * Small color utilities shared by the rendering pipeline. Pure
 * functions on hex strings — no canvas or DOM dependencies.
 */

const TONE_BLEND = 0.2

const parseHex = (hex: string): [number, number, number] | null => {
  if (!hex.startsWith('#')) return null
  const h = hex.slice(1)
  if (h.length === 3) {
    return [
      Number.parseInt(h[0]! + h[0]!, 16),
      Number.parseInt(h[1]! + h[1]!, 16),
      Number.parseInt(h[2]! + h[2]!, 16),
    ]
  }
  if (h.length === 6 || h.length === 8) {
    return [
      Number.parseInt(h.slice(0, 2), 16),
      Number.parseInt(h.slice(2, 4), 16),
      Number.parseInt(h.slice(4, 6), 16),
    ]
  }
  return null
}

const toHexPair = (n: number): string =>
  Math.max(0, Math.min(255, Math.round(n)))
    .toString(16)
    .padStart(2, '0')

/** Linear mix between two hex colors. `t = 0` returns `a`, `t = 1` returns `b`. */
export const mixHex = (a: string, b: string, t: number): string => {
  const A = parseHex(a)
  const B = parseHex(b)
  if (!A || !B) return a
  const p = Math.max(0, Math.min(1, t))
  return `#${toHexPair(A[0] * (1 - p) + B[0] * p)}${toHexPair(A[1] * (1 - p) + B[1] * p)}${toHexPair(A[2] * (1 - p) + B[2] * p)}`
}

const darkenCache = new Map<string, string>()

/**
 * Returns `hex` shifted 20% toward black. Memoized — colors used by
 * many layered nodes share a cache entry. Returns the input unchanged
 * if it isn't a parseable hex.
 */
export const darkenHex = (hex: string): string => {
  const cached = darkenCache.get(hex)
  if (cached !== undefined) return cached
  const result = mixHex(hex, '#000000', TONE_BLEND)
  darkenCache.set(hex, result)
  return result
}
