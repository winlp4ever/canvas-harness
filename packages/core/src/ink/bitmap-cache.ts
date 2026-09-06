/**
 * Per-node bitmap cache for committed ink strokes — the zoom-LOD path
 * described in `docs/ink-lod-design.md`.
 *
 * A committed ink node paints by filling a perfect-freehand outline
 * (hundreds of `quadraticCurveTo` segments) on EVERY full static repaint
 * (`'change'`, zoom-bucket changes, eraser patches — see
 * `docs/rendering-scene-cache.md`). On dense-ink boards at low zoom that
 * fills many large outlines that resolve to a smudge — wasted work.
 *
 * This mirrors `text/bitmap-cache.ts`: rasterize the stroke once into a
 * detached canvas sized by a zoom + motion-derived scale, then blit it on
 * repaint instead of re-tracing the outline. Reuses `render-scale.ts`
 * (the same quantize + LOD pipeline text uses) and `ink/geometry.ts`
 * (`outlineFromInk` / `traceSmoothInkOutline`) verbatim.
 *
 * Unlike text, ink keeps a crisp VECTOR fallback: when zoomed-in and
 * idle a bitmap would blit softer than a direct fill (and few strokes are
 * visible, so the fill is cheap), so `resolveInkRender` returns `vector`
 * there. The gate lives here — one place, independently testable — rather
 * than in the renderer.
 *
 * Cache scope is module-global; all `<Canvas>` instances share one LRU.
 */
import { clampEffectiveScale, quantizeDpr, quantizeZoom, resolveRenderScale } from '../text'
import { outlineFromInk, traceSmoothInkOutline } from './geometry'
import type { InkStrokeData } from './types'

// Higher than text's 1000 — many strokes can be visible at once on a
// dense low-zoom board, where the cache is most valuable. Tune with the
// perf gate in `renderer.browser.test.ts`. Exported so tests can drive
// eviction at the real cap without hardcoding the number.
export const INK_BITMAP_CACHE_MAX = 4000

// Byte ceiling on total backing-store memory, evicted alongside the count
// cap. The count cap alone can't bound memory — a bitmap ranges from a few
// hundred bytes (tiny stroke, low zoom) to the ~9.6MB `clampEffectiveScale`
// limit (2000×1200×4) — so a dense board of mid-size bitmaps could sit on
// far more than intended. Whichever cap trips first drives eviction. A
// single bitmap can never exceed this, so no entry thrashes on insert.
const INK_BITMAP_CACHE_MAX_BYTES = 256 * 1024 * 1024

// An idle stroke uses a bitmap only when the bitmap is at least this dense
// relative to the screen — i.e. a genuine downscale, never an upscale that
// would blit softer than the analytic vector fill this used to be. 1.0
// keeps idle ink exactly as crisp as before (bitmap when it can downsample,
// vector otherwise); motion still forces a bitmap regardless (see the gate).
const BITMAP_CRISP_FACTOR = 1.0

// Max bitmaps rasterized per paint pass. A miss costs MORE than the old
// vector fill (canvas alloc + trace + fill), so an uncached scene with more
// distinct strokes than the cache can hold would otherwise rebuild-and-evict
// every frame — slower than never caching at all. Capping builds per pass
// makes any miss past the budget fall back to vector (the old cost), so a
// cold or over-cap board degrades TO the baseline, never below it, and warms
// over a few frames. High enough that ordinary boards (< this many newly
// visible strokes) still fully cache in one pass. Exported for tests.
export const INK_BITMAP_MISS_CEILING = 512

const MIN_INTRINSIC = 1

export type InkBitmapRequest = {
  /** Stable id for the source — the node id. */
  id: string
  /** Logical CSS pixels of the destination rect (== node.w / node.h). */
  width: number
  height: number
  zoom: number
  dpr: number
  isMoving: boolean
  /** Device px per world unit at blit time (`camera.z * surface.dpr`). */
  screenScale: number
  ink: InkStrokeData
  /** Baked fill color — `node.style.strokeColor` resolved by the caller. */
  strokeColor: string
  /** Baked opacity on the style's 0–100 scale. */
  opacity: number
}

export type InkBitmapEntry = {
  /** Backing-store canvas — pass to ctx.drawImage. */
  canvas: HTMLCanvasElement
  /** Logical (CSS) target width — what the caller should draw at. */
  width: number
  /** Logical (CSS) target height. */
  height: number
}

/**
 * Whether a stroke should blit a cached bitmap or fill its crisp vector
 * outline this frame. `bitmap` carries the ready-to-blit entry.
 */
export type InkRenderDecision = { kind: 'bitmap'; entry: InkBitmapEntry } | { kind: 'vector' }

type StoredEntry = {
  canvas: HTMLCanvasElement
  width: number
  height: number
  /** Backing-store bytes (canvas.width × canvas.height × 4) — for the byte cap. */
  bytes: number
}

// Insertion-order LRU: a `Map` preserves insertion order, so re-`set`ting a
// key on hit moves it to the most-recent end and eviction just drops from
// the oldest (front). That's O(1) per touch, unlike text's sort-on-evict —
// worth it here because ink's cap is 4× text's and a zoom sweep on a dense
// board churns the cache hard (a miss per visible stroke per bucket), where
// an O(n log n) sort per newly-rasterized stroke would spike each frame.
// A bonus: bitmaps for deleted/erased nodes are never touched again, so
// they drift to the front and evict first.
const renderCache = new Map<string, StoredEntry>()

// Running sum of `StoredEntry.bytes` — kept in step with the Map so the byte
// cap doesn't rescan every entry on each insert.
let cacheBytes = 0

// Debug/test counter — how each visible ink node resolved this session.
// Tests reset it, render, then assert the path taken.
const stats = { bitmap: 0, vector: 0 }

// Bitmaps built in the current paint pass, reset by `beginInkFrame`. Gates
// the per-pass build budget (see INK_BITMAP_MISS_CEILING).
let missesThisFrame = 0

/**
 * Reset the per-pass build budget. The renderer calls this at the top of
 * every `paintSceneBody` pass so each pass gets a fresh ceiling.
 */
export const beginInkFrame = (): void => {
  missesThisFrame = 0
}

/**
 * The one ink-render decision. Computes the zoom + motion scale once,
 * decides bitmap-vs-vector via the crispness gate, and only rasterizes
 * (lookup-or-build) when a bitmap wins. Never throws; returns `vector`
 * when `document` is unavailable (SSR / Node) so paint always has a path.
 */
export const resolveInkRender = (req: InkBitmapRequest): InkRenderDecision => {
  const quantZoom = quantizeZoom(req.zoom)
  const quantDpr = quantizeDpr(req.dpr)
  const renderScale = resolveRenderScale(1, quantZoom, req.isMoving)
  const effectiveScale = clampEffectiveScale(renderScale * quantDpr, req.width, req.height)

  // Zoomed-out or moving → bitmap (the win). Zoomed-in idle → vector
  // (crisp, and few strokes visible so the fill is affordable). A large
  // stroke shrinks `effectiveScale` toward the size cap in
  // `clampEffectiveScale`, flipping this off exactly when a bitmap would
  // blit soft.
  //
  // `effectiveScale` is the density the bitmap is ACTUALLY built at (from
  // the bucketed zoom/dpr), and `screenScale` is the density the screen
  // ACTUALLY needs (raw `camera.z * surface.dpr`). Comparing the two is
  // real-vs-real on purpose: the bucketing on the left isn't an error, it's
  // how the cached bitmap really looks, so this asks "is the bitmap I'd
  // blit dense enough for the screen?" — never picking a too-soft one.
  const useBitmap = req.isMoving || effectiveScale >= req.screenScale * BITMAP_CRISP_FACTOR
  if (!useBitmap) {
    stats.vector++
    return { kind: 'vector' }
  }

  const key = makeKey(req, quantDpr, renderScale)
  const cached = renderCache.get(key)
  if (cached) {
    // Move to the most-recent end of the LRU.
    renderCache.delete(key)
    renderCache.set(key, cached)
    stats.bitmap++
    return {
      kind: 'bitmap',
      entry: { canvas: cached.canvas, width: cached.width, height: cached.height },
    }
  }

  // Per-pass build budget spent → don't rasterize (which would thrash on an
  // over-cap board); draw this stroke as vector instead. It'll build on a
  // later pass once the budget refreshes, warming the cache gradually.
  if (missesThisFrame >= INK_BITMAP_MISS_CEILING) {
    stats.vector++
    return { kind: 'vector' }
  }

  const entry = drawIntoNewCanvas(req, quantDpr, renderScale)
  if (!entry) {
    // No document (SSR) — fall back to the vector path so paint still works.
    stats.vector++
    return { kind: 'vector' }
  }

  const bytes = entry.canvas.width * entry.canvas.height * 4
  renderCache.set(key, { ...entry, bytes })
  cacheBytes += bytes
  evictIfNeeded()
  missesThisFrame++
  stats.bitmap++
  return { kind: 'bitmap', entry }
}

const makeKey = (req: InkBitmapRequest, dpr: number, scale: number): string =>
  // `id`+`width`+`height` are the geometry identity: a resize yields a new
  // key, a genuinely new stroke yields a new node id. `points.length:size`
  // is cheap insurance in case `data.ink` is swapped under a stable id.
  // `strokeColor`+`opacity` must be here or a recolor blits stale pixels.
  // `scale` is the resolved renderScale, which already encodes the zoom-LOD
  // level AND the moving/idle split — so raw zoom is deliberately NOT keyed:
  // two zoom buckets on the same LOD plateau (e.g. any zoom ≤ 0.4 idle)
  // produce a byte-identical bitmap and correctly share one entry.
  `${req.id}:${req.width}:${req.height}:${dpr}:${scale}:${req.strokeColor}:${req.opacity}:${req.ink.points.length}:${req.ink.size}`

/**
 * Draws the stroke into a fresh detached canvas at the resolved scale, in
 * logical (node.w × node.h) pixels. Mirrors `drawInkNodeWithOpacity` but
 * bakes the caller-resolved color/opacity in. Returns null if `document`
 * is unavailable.
 */
const drawIntoNewCanvas = (
  req: InkBitmapRequest,
  dpr: number,
  baseScale: number,
): InkBitmapEntry | null => {
  if (typeof document === 'undefined') return null

  const effectiveScale = clampEffectiveScale(baseScale * dpr, req.width, req.height)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(req.width * effectiveScale))
  canvas.height = Math.max(1, Math.ceil(req.height * effectiveScale))

  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const outline = outlineFromInk(req.ink)
  if (outline.length === 0) return { canvas, width: req.width, height: req.height }

  // Draw in logical pixels (matches width/height) so the outline trace is
  // scale-agnostic; the backing-store scale is applied once up front.
  ctx.scale(effectiveScale, effectiveScale)
  ctx.scale(
    req.width / Math.max(MIN_INTRINSIC, req.ink.intrinsicWidth),
    req.height / Math.max(MIN_INTRINSIC, req.ink.intrinsicHeight),
  )
  ctx.fillStyle = req.strokeColor
  ctx.globalAlpha = Math.max(0, Math.min(1, req.opacity / 100))
  ctx.beginPath()
  traceSmoothInkOutline(ctx, outline)
  ctx.fill()

  return { canvas, width: req.width, height: req.height }
}

/**
 * LRU eviction: drop the oldest (front-of-Map) entries until BOTH the count
 * and byte caps are satisfied. O(1) per eviction.
 */
const evictIfNeeded = (): void => {
  while (renderCache.size > INK_BITMAP_CACHE_MAX || cacheBytes > INK_BITMAP_CACHE_MAX_BYTES) {
    const oldest = renderCache.keys().next().value
    if (oldest === undefined) break
    const victim = renderCache.get(oldest)
    if (victim) cacheBytes -= victim.bytes
    renderCache.delete(oldest)
  }
}

/** Test / debug aid. */
export const clearInkBitmapCache = (): void => {
  renderCache.clear()
  cacheBytes = 0
}

/** Test / debug aid. */
export const getInkBitmapCacheSize = (): number => renderCache.size

/** Test / debug aid — total backing-store bytes currently cached. */
export const getInkBitmapCacheBytes = (): number => cacheBytes

/** Test / debug aid — how visible ink nodes resolved since the last reset. */
export const getInkRenderStats = (): { bitmap: number; vector: number } => ({ ...stats })

/** Test / debug aid. */
export const resetInkRenderStats = (): void => {
  stats.bitmap = 0
  stats.vector = 0
}
