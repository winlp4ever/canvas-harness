import type { FontFamily, FontSize, TextStyle } from '../types'
/**
 * Text measurement cache — ported from `canvas-lite-markdown.tsx`.
 *
 * `ctx.measureText` is the single most expensive operation in canvas text.
 * We memoize widths by (font, text) — a 5k-entry LRU keeps the working
 * set hot during pan/zoom and re-layouts.
 *
 * Cache is module-level so multiple Canvas instances share it. Eviction is
 * FIFO via Map iteration order (Maps preserve insertion order in JS).
 */
import { DEFAULT_TEXT_COLOR, FONT_FAMILY_MAP, FONT_SIZE_MAP } from './defaults'
import { getMathBitmap } from './math'
import type { InlineType } from './tokens'

const MAX_WIDTH_CACHE_SIZE = 5000

// Shared one-off canvas used purely for measurement.
const measureCanvas: HTMLCanvasElement | null =
  typeof document !== 'undefined' ? document.createElement('canvas') : null
const measureCtx: CanvasRenderingContext2D | null = measureCanvas?.getContext('2d') ?? null

const widthCache = new Map<string, number>()

/**
 * Returns the canvas `font` string for a given run.
 */
export const getCanvasFont = (opts: {
  type: InlineType
  fontFamily: FontFamily
  fontSize: FontSize
  textStyle: TextStyle
}): string => {
  const weight = opts.type === 'bold' || opts.textStyle === 'bold' ? '700' : '400'
  const italic = opts.type === 'italic' || opts.textStyle === 'italic' ? 'italic' : 'normal'
  const family = opts.type === 'code' ? FONT_FAMILY_MAP.monospace : FONT_FAMILY_MAP[opts.fontFamily]
  return `${italic} ${weight} ${FONT_SIZE_MAP[opts.fontSize]}px ${family}`
}

/**
 * Memoized width measurement. Cache key includes font (so different
 * fonts/sizes/styles get separate entries).
 *
 * Falls back to a heuristic when no canvas is available (SSR / Node tests).
 */
export const measureText = (opts: {
  text: string
  type: InlineType
  fontFamily: FontFamily
  fontSize: FontSize
  textStyle: TextStyle
}): number => {
  if (!opts.text) return 0
  // Math width comes from the bitmap cache (keyed by source + color +
  // size). Use DEFAULT_TEXT_COLOR so the lookup hits the SAME cache
  // entry that paint will later look up (paint's fallback is also
  // DEFAULT_TEXT_COLOR). Mismatch here = paint never finds the
  // bitmap layout compiled.
  if (opts.type === 'math') {
    const fontSizePx = FONT_SIZE_MAP[opts.fontSize]
    const bitmap = getMathBitmap(opts.text, DEFAULT_TEXT_COLOR, fontSizePx)
    if (bitmap) return bitmap.width
    return Math.max(8, opts.text.length * fontSizePx * 0.55 + fontSizePx)
  }
  const font = getCanvasFont(opts)
  const key = `${font}|${opts.text}`
  const cached = widthCache.get(key)
  if (cached !== undefined) return cached

  if (!measureCtx) {
    return opts.text.length * FONT_SIZE_MAP[opts.fontSize] * 0.55
  }

  measureCtx.font = font
  const width = measureCtx.measureText(opts.text).width
  widthCache.set(key, width)
  if (widthCache.size > MAX_WIDTH_CACHE_SIZE) {
    const oldestKey = widthCache.keys().next().value
    if (oldestKey !== undefined) widthCache.delete(oldestKey)
  }
  return width
}

/**
 * Clears all cached measurements. Called by the font-epoch system on
 * font load — fallback metrics returned before fonts settle would be
 * wrong, so we re-measure everything once they're ready.
 */
export const clearMeasureCache = (): void => {
  widthCache.clear()
}
