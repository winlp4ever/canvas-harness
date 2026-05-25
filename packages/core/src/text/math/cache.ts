/**
 * Math compile + raster cache.
 *
 * Pipeline per formula:
 *   1. LaTeX source → MathJax SVG string (sync once MathJax loaded)
 *   2. Inject the requested text color via `currentColor` substitution
 *   3. Rasterize to ImageBitmap at the requested on-device pixel size
 *   4. Cache by (source, color, sizeBucket)
 *
 * Compile work is queued and drained over rAF frames so a paste of
 * 100 math-heavy paragraphs doesn't block the main thread. Each
 * resolve bumps the math-epoch; the text bitmap cache reads the
 * epoch and invalidates only its math-bearing entries.
 */
import { getMathJax, onMathJaxReady } from './loader'

// Round to integer to bound cache entries — math is keyed by
// (source, color, sizePx). Font sizes in the library are a small
// fixed set (14, 16, 24, 36), so no power-of-two bucketing needed;
// integer rounding handles minor floating-point variance.
const normalizeSize = (px: number): number => Math.max(8, Math.round(px))

/** Result of a successful math compile + raster. */
export type MathBitmap = {
  bitmap: ImageBitmap
  /** Width in logical CSS pixels at the requested font size. */
  width: number
  /** Height in logical CSS pixels at the requested font size. */
  height: number
  /**
   * Baseline offset in CSS pixels (positive = bitmap top sits ABOVE
   * the text baseline; the bottom dips below by `height - baseline`).
   * Parsed from MathJax's `vertical-align: -Nex` style attribute.
   */
  baselineOffset: number
}

type Entry =
  | { state: 'pending' }
  | { state: 'ready'; bitmap: MathBitmap }
  | { state: 'error'; err: unknown }

const cache = new Map<string, Entry>()
const compileQueue: Array<{ key: string; source: string; color: string; sizePx: number }> = []
let compileScheduled = false

// ---- epoch ----------------------------------------------------------
// Bumped once per drained compile batch (not per formula), to amortize
// text bitmap invalidation. Subscribed by the text bitmap cache.

let mathEpoch = 0
const epochSubscribers = new Set<() => void>()

export const getMathEpoch = (): number => mathEpoch

export const subscribeMathEpoch = (cb: () => void): (() => void) => {
  epochSubscribers.add(cb)
  return () => {
    epochSubscribers.delete(cb)
  }
}

const bumpMathEpoch = (): void => {
  mathEpoch += 1
  for (const cb of epochSubscribers) cb()
}

// ---- public API ----------------------------------------------------

/**
 * Look up a math bitmap or kick off compilation. Returns the cached
 * bitmap if ready, `null` if still loading / queued (caller should
 * paint a placeholder this frame). Triggers a math-epoch bump when
 * the formula resolves.
 *
 * `sizePx` is the on-screen height in logical px (typically the line
 * height of the surrounding text × DPR).
 */
export const getMathBitmap = (source: string, color: string, sizePx: number): MathBitmap | null => {
  const size = normalizeSize(sizePx)
  const key = `${size}:${color}:${source}`
  const existing = cache.get(key)
  if (existing) {
    if (existing.state === 'ready') return existing.bitmap
    return null
  }
  // Miss — enqueue for compile. The compile path triggers the lazy
  // MathJax load on its own; if it's not ready, we re-queue from
  // onMathJaxReady.
  cache.set(key, { state: 'pending' })
  compileQueue.push({ key, source, color, sizePx: size })
  scheduleCompile()
  return null
}

const scheduleCompile = (): void => {
  if (compileScheduled) return
  compileScheduled = true
  if (typeof window === 'undefined' || typeof requestAnimationFrame === 'undefined') {
    // SSR / Node — drain synchronously so tests still progress.
    void drainQueue()
    return
  }
  requestAnimationFrame(() => {
    void drainQueue()
  })
}

/**
 * Compile loop. Time-sliced: each rAF tick spends up to 4ms on
 * compiles, then yields. After the queue drains, bumps the math
 * epoch once so text bitmaps containing math can invalidate in a
 * single pass.
 */
const drainQueue = async (): Promise<void> => {
  compileScheduled = false
  if (compileQueue.length === 0) return

  const mj = getMathJax()
  if (!mj) {
    // Not loaded yet — wait for the import, then resume.
    onMathJaxReady(() => scheduleCompile())
    return
  }

  const FRAME_BUDGET_MS = 4
  const start = performance.now()
  let didResolve = false

  while (compileQueue.length > 0 && performance.now() - start < FRAME_BUDGET_MS) {
    const item = compileQueue.shift()!
    if (cache.get(item.key)?.state !== 'pending') continue
    try {
      const bitmap = await compileOne(mj, item.source, item.color, item.sizePx)
      cache.set(item.key, { state: 'ready', bitmap })
      didResolve = true
    } catch (err) {
      cache.set(item.key, { state: 'error', err })
      console.warn(`[math] failed to compile "${item.source}":`, err)
    }
  }

  if (didResolve) bumpMathEpoch()
  if (compileQueue.length > 0) scheduleCompile()
}

const compileOne = async (
  mj: NonNullable<ReturnType<typeof getMathJax>>,
  source: string,
  color: string,
  sizePx: number,
): Promise<MathBitmap> => {
  // Step 1: LaTeX → SVG via MathJax. `em` controls the typesetting
  // scale; we pass the requested px so the SVG comes out at the right
  // intrinsic size.
  const svgElement = await mj.tex2svgPromise(source, { display: false, em: sizePx, ex: sizePx / 2 })
  // Prefer `serializeXML` (v4 canonical) so namespaces survive; fall
  // back to `outerHTML` for v3 compatibility.
  let markup = mj.startup.adaptor.serializeXML
    ? mj.startup.adaptor.serializeXML(svgElement)
    : mj.startup.adaptor.outerHTML(svgElement)
  // MathJax wraps the actual <svg> in a <mjx-container> element with
  // a sibling <mjx-speech> block for accessibility. We need just the
  // outer <svg>...</svg> for the blob.
  //
  // With `linebreaks.inline: false` set in the loader config, MathJax
  // produces exactly ONE <svg> per formula and no <mjx-break> markers.
  // We still defensively pick the FIRST <svg>...</svg> here (non-greedy)
  // in case the config doesn't fully prevent breaks for pathological
  // inputs — losing trailing fragments is preferable to a parse error
  // that kills the whole formula.
  const svgMatch = /<svg[\s\S]*?<\/svg>/.exec(markup)
  if (svgMatch) markup = svgMatch[0]
  // Strip accessibility / semantic attributes. MathJax v4 emits a
  // huge set of data-semantic-*, data-speech-*, aria-*, role, and
  // focusable attributes whose values contain XML-encoded HTML. When
  // the SVG is loaded via a Blob URL into `<img>`, the strict XML
  // parser chokes on some of these (specifically the speech / braille
  // ones for certain formulas). We're rendering to canvas — no AT
  // consumes these — so dropping them is safe and shrinks the blob
  // ~70%.
  markup = markup
    .replace(/\sdata-semantic-[a-z0-9-]+="[^"]*"/g, '')
    .replace(/\sdata-speech-[a-z0-9-]+="[^"]*"/g, '')
    .replace(/\sdata-mml-node="[^"]*"/g, '')
    .replace(/\sdata-latex="[^"]*"/g, '')
    .replace(/\sdata-braille[a-z0-9-]*="[^"]*"/g, '')
    .replace(/\saria-[a-z0-9-]+="[^"]*"/g, '')
    .replace(/\srole="[^"]*"/g, '')
    .replace(/\sfocusable="[^"]*"/g, '')
    .replace(/\stabindex="[^"]*"/g, '')
    .replace(/\shas-speech="[^"]*"/g, '')
  // Ensure the xmlns is present (the lite-adaptor sometimes omits it,
  // which makes the <img> blob fail with a generic onerror).
  if (!markup.includes('xmlns="http://www.w3.org/2000/svg"')) {
    markup = markup.replace(/^<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"')
  }

  // Step 2: tint. MathJax SVG output uses `currentColor` for glyph
  // fills; substitute the requested color.
  markup = markup.replace(/currentColor/gi, color)

  // Step 3: parse intrinsic dims + baseline offset from the SVG markup
  // before rasterizing. The outer <svg> carries `width` / `height` in
  // ex units and a `style="vertical-align: -Nex"` for baseline.
  const dims = parseSvgDims(markup, sizePx)

  // Step 4: rasterize via Blob URL → Image → createImageBitmap.
  const blob = new Blob([markup], { type: 'image/svg+xml' })
  const url = URL.createObjectURL(blob)
  try {
    let img: HTMLImageElement
    try {
      img = await loadImage(url)
    } catch (e) {
      // Log the full markup so we can see WHY the SVG failed to load.
      console.warn(`[math] SVG failed to load for "${source}":\n${markup}`)
      throw e
    }
    // Rasterize at 2x for crisp small glyphs without committing to a
    // full DPR-aware bucket key — sizes are already bucketed.
    const rasterW = Math.max(1, Math.ceil(dims.width * 2))
    const rasterH = Math.max(1, Math.ceil(dims.height * 2))
    const bitmap = await createImageBitmap(img, {
      resizeWidth: rasterW,
      resizeHeight: rasterH,
      resizeQuality: 'high',
    })
    return {
      bitmap,
      width: dims.width,
      height: dims.height,
      baselineOffset: dims.baselineOffset,
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = e => reject(e)
    img.src = src
  })

/**
 * Parse `<svg width="Nex" height="Nex" style="vertical-align: -Nex">`
 * from the markup. Approximate `1 ex ≈ sizePx / 2`.
 */
const parseSvgDims = (
  markup: string,
  sizePx: number,
): { width: number; height: number; baselineOffset: number } => {
  const exToPx = sizePx / 2
  const widthMatch = /<svg[^>]*\bwidth="([0-9.]+)ex"/.exec(markup)
  const heightMatch = /<svg[^>]*\bheight="([0-9.]+)ex"/.exec(markup)
  const vAlignMatch = /vertical-align:\s*(-?[0-9.]+)ex/.exec(markup)

  const widthEx = widthMatch ? Number.parseFloat(widthMatch[1]!) : 2
  const heightEx = heightMatch ? Number.parseFloat(heightMatch[1]!) : 2
  const vAlignEx = vAlignMatch ? Number.parseFloat(vAlignMatch[1]!) : 0

  const width = widthEx * exToPx
  const height = heightEx * exToPx
  // vertical-align is negative = descend below baseline.
  // baselineOffset is the px from the bitmap top down to the text
  // baseline. If the bitmap descends `d` below baseline, baseline is
  // at `height - d` from the top.
  const descent = Math.abs(vAlignEx) * exToPx
  const baselineOffset = height - descent

  return { width, height, baselineOffset }
}

/** Test / debug aid. */
export const clearMathCache = (): void => {
  cache.clear()
  compileQueue.length = 0
  compileScheduled = false
}

/** Test / debug aid. */
export const getMathCacheSize = (): number => cache.size
