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
import { mixHex } from '../color'
import { isFullyTransparent } from '../shapes/defaults'

const TONE_BLEND = 0.2
const cache = new Map<string, string>()

/**
 * If `stroke` is transparent and `fill` is a visible color, returns a
 * tonally-shifted variant of `fill` suitable for drawing a soft border.
 * Otherwise returns `stroke` unchanged. Memoized.
 */
export const deriveRoughStrokeColor = (stroke: string, fill: string, isDark: boolean): string => {
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
