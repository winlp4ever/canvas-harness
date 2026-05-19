/**
 * Font-load reactivity — ported from `canvas-lite-markdown.tsx`.
 *
 * Custom fonts (Architects Daughter, Inconsolata, etc.) load asynchronously
 * — `ctx.measureText` returns fallback metrics until they settle, which
 * means initial layouts would be wrong if we trusted them. The font-epoch
 * mechanism:
 *
 *   1. On first subscribe, attach listeners to document.fonts.ready and
 *      'loadingdone'.
 *   2. When fonts settle, bump an integer epoch and notify subscribers.
 *   3. Subscribers (measureCache + bitmap cache) clear themselves on bump.
 *   4. The renderer re-paints (one frame of "jump" as fonts settle, then
 *      stable forever).
 */
import { clearMeasureCache } from './measure'

const fontEpochListeners = new Set<(epoch: number) => void>()
let fontEpoch = 0
let fontTrackingInitialized = false

const emitFontEpoch = (): void => {
  for (const listener of fontEpochListeners) listener(fontEpoch)
}

/**
 * Bumps the epoch and tells everyone. Caches (measure, bitmap) clear
 * themselves so the next paint pulls fresh metrics.
 */
const bumpFontEpoch = (): void => {
  fontEpoch += 1
  clearMeasureCache()
  emitFontEpoch()
}

const initFontTracking = (): void => {
  if (fontTrackingInitialized) return
  fontTrackingInitialized = true

  if (typeof document === 'undefined' || !('fonts' in document)) return
  const fontSet = document.fonts
  let didSettleInitialFonts = false

  fontSet.ready
    .then(() => {
      if (didSettleInitialFonts) return
      didSettleInitialFonts = true
      bumpFontEpoch()
    })
    .catch(() => {
      /* ignore */
    })

  fontSet.addEventListener?.('loadingdone', () => {
    if (!didSettleInitialFonts) didSettleInitialFonts = true
    bumpFontEpoch()
  })
}

/**
 * Subscribe to font-epoch bumps. Lazy-initializes the document.fonts
 * listeners on first call. Returns an unsubscribe.
 */
export const subscribeFontEpoch = (listener: (epoch: number) => void): (() => void) => {
  initFontTracking()
  fontEpochListeners.add(listener)
  return () => {
    fontEpochListeners.delete(listener)
  }
}

/**
 * Current epoch — included in bitmap-cache keys so they invalidate when
 * custom fonts settle.
 */
export const getFontEpoch = (): number => fontEpoch
