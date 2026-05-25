/**
 * Lazy loader for MathJax — same pattern as `render/rough/loader.ts`.
 *
 * MathJax is ~600KB and only useful for scenes with LaTeX math. We
 * defer loading until the first `$...$` token requests a compile,
 * then convert LaTeX → SVG strings off the main rAF path.
 *
 * Loaded from jsDelivr CDN rather than bundled because the v4
 * tex-svg.js bundle uses `importScripts('sre/speech-worker.js')` for
 * accessibility; the relative URL resolves wrong when served from a
 * dev bundler's node_modules. The CDN serves sibling files at
 * predictable paths so the bundle finds its workers. Self-host by
 * pointing `VENDOR_URL` at your own copy of the v4 component files.
 *
 * Notes:
 *   - MathJax's `tex-svg.js` bundle attaches itself to `window.MathJax`
 *     when loaded. This is the documented v4 browser API.
 *   - If a consumer also uses MathJax, they should configure the
 *     global *before* canvas-harness's first math node loads.
 */

type MathJaxLike = {
  tex2svgPromise(
    source: string,
    opts?: { display?: boolean; em?: number; ex?: number; containerWidth?: number },
  ): Promise<MathJaxSvgElement>
  startup: {
    /**
     * The "lite adaptor" used by the SVG output in browser context.
     * `serializeXML` returns standalone-valid SVG markup with
     * namespaces intact (which `outerHTML` does not always do).
     */
    adaptor: {
      serializeXML?(el: MathJaxSvgElement): string
      outerHTML(el: MathJaxSvgElement): string
    }
  }
}

/**
 * MathJax returns a "lite element" virtual-DOM node, not a real SVG
 * element. We only need to serialize it via the adaptor.
 */
export type MathJaxSvgElement = unknown

// `window.MathJax` is partially populated by us pre-load (config),
// then fully populated by the tex-svg bundle post-load. We type it
// as `unknown` here and cast at the two access sites.
declare global {
  var MathJax: unknown
}

let cached: MathJaxLike | null = null
let loadPromise: Promise<MathJaxLike | null> | null = null
let loadFailed = false
const readyCallbacks = new Set<() => void>()

/**
 * Returns the configured MathJax instance if loaded, else `null` and
 * triggers the lazy import on first call. Subscribers via `onMathJaxReady`
 * are notified when the import resolves.
 */
export const getMathJax = (): MathJaxLike | null => {
  if (cached) return cached
  if (loadFailed) return null
  if (!loadPromise) {
    loadPromise = loadMathJax()
      .then(instance => {
        if (instance) {
          cached = instance
          // Fire pending callbacks ONLY on real load success — firing
          // on null would re-trigger cache drains in a loop.
          for (const cb of readyCallbacks) cb()
        } else {
          // SSR / no window — mark terminal so future `onMathJaxReady`
          // calls bail instead of accumulating callbacks.
          loadFailed = true
        }
        readyCallbacks.clear()
        return cached
      })
      .catch(err => {
        console.warn('[math] failed to load MathJax:', err)
        loadFailed = true
        readyCallbacks.clear()
        return null
      })
  }
  return null
}

/**
 * Registers a callback that fires once when MathJax becomes available.
 * No-op if already loaded — caller should check `getMathJax() !== null`
 * first. Used to trigger a re-paint of math-bearing text nodes.
 */
export const onMathJaxReady = (cb: () => void): void => {
  if (cached) return
  if (loadFailed) return
  readyCallbacks.add(cb)
}

type MathJaxConfig = {
  startup?: { typeset?: boolean; promise?: Promise<void> }
  options?: {
    enableMenu?: boolean
    enableEnrichment?: boolean
    enableSpeech?: boolean
    enableComplexity?: boolean
    sre?: { speech?: 'none' | 'shallow' | 'deep' }
  }
  svg?: {
    scale?: number
    fontCache?: 'local' | 'global' | 'none'
    /**
     * v4 introduces inline-math linebreaking that splits long
     * formulas across MULTIPLE <svg> blocks separated by <mjx-break>
     * markers. Great for HTML flow layout, fatal for our Blob URL
     * pipeline (multiple root elements aren't valid in one SVG doc).
     * Disabling it forces one <svg> per formula no matter how wide.
     */
    linebreaks?: { inline?: boolean; width?: string }
  }
}

const loadMathJax = async (): Promise<MathJaxLike | null> => {
  if (typeof window === 'undefined') return null

  // Configure before importing so MathJax picks up the settings. The
  // tex-svg bundle reads `window.MathJax` at script-execution time.
  // `fontCache: 'local'` embeds glyph paths inline in each SVG (bigger
  // SVG, no <defs> dependency). Required for SVGs that get detached
  // from MathJax's host container, like ours.
  const winAny = window as typeof window & { MathJax?: MathJaxConfig }
  // Disable a11y / SRE features. MathJax v4's tex-svg bundle tries to
  // load a speech-rule-engine worker by default for screen reader
  // support — its bundled path resolves to `http://sre//...` which
  // 404s in browsers and clutters the console. We're rendering to
  // canvas, not DOM — no AT to serve anyway.
  winAny.MathJax = {
    ...(winAny.MathJax ?? {}),
    startup: { typeset: false },
    options: {
      enableMenu: false,
      enableEnrichment: false,
      enableSpeech: false,
      enableComplexity: false,
      sre: { speech: 'none' },
    },
    // `fontCache: 'none'` inlines every glyph as a raw <path>
    // (slightly bigger SVG, no <use> references). Required for SVGs
    // we extract to a Blob URL and rasterize via <img> — `<use>`
    // refs to <defs> elsewhere in the page wouldn't resolve.
    // `linebreaks: { inline: false }` keeps the whole formula in one
    // <svg> element (v4 defaults to true for long inline math).
    svg: {
      scale: 1,
      fontCache: 'none',
      linebreaks: { inline: false },
    },
  }

  // Load via <script> tag from CDN rather than `import('mathjax/tex-svg.js')`.
  // The bundle's `importScripts('sre/speech-worker.js')` for the
  // accessibility feature uses a relative URL that Vite (and most
  // bundlers) can't serve from node_modules. The CDN serves sibling
  // files at predictable paths so the bundle finds its workers.
  // Override `MATHJAX_VENDOR_URL` to self-host.
  const VENDOR_URL = 'https://cdn.jsdelivr.net/npm/mathjax@4/tex-svg.js'
  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector(
      `script[src="${VENDOR_URL}"]`,
    ) as HTMLScriptElement | null
    if (existing) {
      // Already injected by a previous call — wait for it to finish.
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('MathJax CDN load failed')), {
        once: true,
      })
      return
    }
    const script = document.createElement('script')
    script.src = VENDOR_URL
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('MathJax CDN load failed'))
    document.head.appendChild(script)
  })

  // MathJax's startup is a Promise; wait for it before returning.
  const mj = winAny.MathJax as (MathJaxLike & { startup?: { promise?: Promise<void> } }) | undefined
  if (!mj) throw new Error('MathJax did not install on window after import')
  if (typeof mj.tex2svgPromise !== 'function') {
    throw new Error('MathJax loaded but tex2svgPromise is missing — wrong bundle?')
  }
  await mj.startup?.promise
  return mj as MathJaxLike
}

/** Reset state — tests only. */
export const __resetMathLoader = (): void => {
  cached = null
  loadPromise = null
  loadFailed = false
  readyCallbacks.clear()
}
