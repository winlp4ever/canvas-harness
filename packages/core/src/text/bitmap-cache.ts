import type { FontFamily, FontSize, TextAlign, TextStyle } from '../types'
import { getFontEpoch, subscribeFontEpoch } from './font-epoch'
/**
 * Bitmap cache for rendered markdown content — the architectural rewrite
 * called out in ARCHITECTURE.md §8.
 *
 * dim0's `canvas-lite-markdown.tsx` rendered into a private canvas, called
 * `canvas.toBlob('image/png')`, then wrapped the resulting Blob URL in an
 * `<img>` element. That made sense in a DOM-board context: each note was
 * already a React subtree, and swapping its text for one `<img>` cut DOM
 * paint cost. The async stage there required a queue + listener
 * coalescing + URL.revokeObjectURL lifecycle management — about 150 LOC.
 *
 * In the canvas-harness scene we render into a `<canvas>` already, so the
 * roundtrip to PNG and back is pure waste. This module caches to an
 * `OffscreenCanvas` (or detached `HTMLCanvasElement` fallback) keyed on
 * everything that affects pixel output. On a cache miss we draw
 * synchronously into the cached canvas; on hit we just blit via
 * `ctx.drawImage(cached, x, y, w, h)`.
 *
 * Cache scope is module-global; all `<Canvas>` instances share the same
 * LRU. ~1000-entry cap (configurable on init).
 */
import { drawTextToCanvas } from './paint-canvas'
import { clampEffectiveScale, quantizeDpr, quantizeZoom, resolveRenderScale } from './render-scale'

const MAX_CACHE_SIZE = 1000

export type BitmapCacheRequest = {
  /** Stable id for the source — typically the node id. */
  id: string
  text: string
  /** Logical CSS pixels of the destination rect. */
  width: number
  height: number
  zoom: number
  dpr: number
  isMoving: boolean
  align: TextAlign
  fontFamily: FontFamily
  fontSize: FontSize
  textStyle: TextStyle
  textColor: string
  highlightColor: string
}

export type BitmapCacheEntry = {
  /** Backing-store canvas — pass to ctx.drawImage. */
  canvas: HTMLCanvasElement
  /** Logical (CSS) target width — what the caller should draw at. */
  width: number
  /** Logical (CSS) target height. */
  height: number
}

type StoredEntry = {
  canvas: HTMLCanvasElement
  width: number
  height: number
  lastUsed: number
}

const renderCache = new Map<string, StoredEntry>()

/**
 * Memoize FNV-1a text hashes so the per-frame cache-key build doesn't
 * re-walk the content string for every visible node. Bounded; cleared on
 * font-epoch bump alongside the bitmap cache.
 */
const HASH_CACHE_MAX = 2000
const textHashCache = new Map<string, string>()

/** Listen for font load → invalidate. */
subscribeFontEpoch(() => {
  renderCache.clear()
  textHashCache.clear()
})

/**
 * Lookup-or-build. Always returns a non-null entry as long as `text` is
 * non-empty — on miss it draws synchronously and stores. Same call site
 * for hit and miss.
 *
 * Returns null only when the input is empty/whitespace.
 */
export const getOrRenderTextBitmap = (req: BitmapCacheRequest): BitmapCacheEntry | null => {
  const text = req.text
  if (!text || !text.trim()) return null

  const quantZoom = quantizeZoom(req.zoom)
  const quantDpr = quantizeDpr(req.dpr)
  const renderScale = resolveRenderScale(1, quantZoom, req.isMoving)
  const epoch = getFontEpoch()

  const key = makeKey(req, quantZoom, quantDpr, renderScale, epoch)

  const cached = renderCache.get(key)
  if (cached) {
    cached.lastUsed = Date.now()
    return { canvas: cached.canvas, width: cached.width, height: cached.height }
  }

  const entry = drawIntoNewCanvas(req, quantDpr, renderScale)
  if (!entry) return null

  renderCache.set(key, { ...entry, lastUsed: Date.now() })
  evictIfNeeded()
  return { canvas: entry.canvas, width: entry.width, height: entry.height }
}

const makeKey = (
  req: BitmapCacheRequest,
  zoom: number,
  dpr: number,
  scale: number,
  epoch: number,
): string => {
  // Cheap deterministic key — small string concat, no number formatting.
  // cachedTextHash memoizes the FNV-1a walk so a node's content is hashed
  // once across frames, not on every cache lookup.
  return `${epoch}:${cachedTextHash(req.text)}:${req.width}:${req.height}:${zoom}:${dpr}:${scale}:${req.align}:${req.fontFamily}:${req.fontSize}:${req.textStyle}:${req.textColor}:${req.highlightColor}`
}

const cachedTextHash = (value: string): string => {
  const hit = textHashCache.get(value)
  if (hit !== undefined) return hit
  const hash = textHash(value)
  // Cap is a simple bound; on overflow clear the whole table rather than
  // pay LRU bookkeeping. The bitmap cache below it remains authoritative.
  if (textHashCache.size >= HASH_CACHE_MAX) textHashCache.clear()
  textHashCache.set(value, hash)
  return hash
}

/**
 * Fast non-cryptographic hash used to avoid putting full text in the key.
 */
const textHash = (value: string): string => {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

/**
 * Draws the request into a fresh detached canvas at the resolved scale.
 * Synchronous; returns null if document is unavailable (SSR / Node).
 */
const drawIntoNewCanvas = (
  req: BitmapCacheRequest,
  dpr: number,
  baseScale: number,
): BitmapCacheEntry | null => {
  if (typeof document === 'undefined') return null

  const effectiveScale = clampEffectiveScale(baseScale * dpr, req.width, req.height)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(req.width * effectiveScale))
  canvas.height = Math.max(1, Math.ceil(req.height * effectiveScale))

  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  // Draw in logical pixels (matches the request width/height) so
  // measureText / layout don't care about the backing-store scale.
  ctx.scale(effectiveScale, effectiveScale)

  drawTextToCanvas(ctx, {
    text: req.text,
    width: req.width,
    height: req.height,
    align: req.align,
    fontFamily: req.fontFamily,
    fontSize: req.fontSize,
    textStyle: req.textStyle,
    textColor: req.textColor,
    highlightColor: req.highlightColor,
  })

  return { canvas, width: req.width, height: req.height }
}

/**
 * LRU eviction. Sorts by lastUsed and trims to cap.
 */
const evictIfNeeded = (): void => {
  if (renderCache.size <= MAX_CACHE_SIZE) return
  const entries = [...renderCache.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)
  const toRemove = renderCache.size - MAX_CACHE_SIZE
  for (let i = 0; i < toRemove; i++) {
    const victim = entries[i]
    if (!victim) break
    renderCache.delete(victim[0])
  }
}

/** Test / debug aid. */
export const clearTextBitmapCache = (): void => {
  renderCache.clear()
  textHashCache.clear()
}

/** Test / debug aid. */
export const getTextBitmapCacheSize = (): number => renderCache.size
