/**
 * Inline math support — LaTeX `$...$` tokens rendered via MathJax SVG.
 *
 * Exports the loader + cache. Layout / paint code imports from here
 * to compile and look up math bitmaps; consumers usually don't touch
 * this module directly.
 */
export { getMathJax, onMathJaxReady } from './loader'
export type { MathBitmap } from './cache'
export {
  clearMathCache,
  getMathBitmap,
  getMathCacheSize,
  getMathEpoch,
  subscribeMathEpoch,
} from './cache'
