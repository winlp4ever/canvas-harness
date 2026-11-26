export type { InlineType, Token } from './tokens'
export { tokenize } from './tokens'

export type { LayoutLine, LayoutOptions, StyledRun } from './layout'
export { layoutTokens } from './layout'

export type { FontConfig } from './defaults'
export {
  CODE_BG_COLOR,
  CODE_BLOCK_MARGIN_Y,
  CODE_BLOCK_PADDING_X,
  CONTENT_HEIGHT_BUFFER,
  CONTENT_PADDING,
  DEFAULT_NUMERIC_LINE_HEIGHT_RATIO,
  DEFAULT_FONT_SIZES,
  DEFAULT_FONT_STACKS,
  DEFAULT_HIGHLIGHT_COLOR,
  DEFAULT_HIGHLIGHT_COLOR_DARK,
  DEFAULT_LINE_HEIGHTS,
  DEFAULT_TEXT_COLOR,
  // Deprecated map aliases — reflect defaults only; prefer the getters.
  FONT_FAMILY_MAP,
  FONT_SIZE_MAP,
  LINE_HEIGHT_MAP,
  LINK_COLOR,
  MAX_FONT_SIZE_PX,
  MIN_FONT_SIZE_PX,
  configureFonts,
  getFontSizePx,
  getFontSizePresetForPx,
  getFontStack,
  getLineHeightPx,
  resetFonts,
} from './defaults'

export { clearMeasureCache, getCanvasFont, measureText } from './measure'

export { getFontEpoch, subscribeFontEpoch } from './font-epoch'

export type { MathBitmap } from './math'
export {
  clearMathCache,
  getMathBitmap,
  getMathCacheSize,
  getMathEpoch,
  getMathJax,
  onMathJaxReady,
  subscribeMathEpoch,
} from './math'

export {
  clampEffectiveScale,
  quantizeDpr,
  quantizeZoom,
  resolveRenderScale,
} from './render-scale'

export type { DrawTextOptions } from './paint-canvas'
export { drawTextToCanvas } from './paint-canvas'

export type { EstimateOptions } from './estimate-height'
export {
  estimateMarkdownContentHeight,
  getContentHeight,
  getMarkdownLineHeightPx,
} from './estimate-height'

export type { BitmapCacheEntry, BitmapCacheRequest } from './bitmap-cache'
export {
  clearTextBitmapCache,
  getOrRenderTextBitmap,
  getTextBitmapCacheSize,
} from './bitmap-cache'
