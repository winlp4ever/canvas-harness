export type { InkBitmapEntry, InkBitmapRequest, InkRenderDecision } from './bitmap-cache'
export {
  INK_BITMAP_CACHE_MAX,
  INK_BITMAP_MISS_CEILING,
  beginInkFrame,
  clearInkBitmapCache,
  getInkBitmapCacheBytes,
  getInkBitmapCacheSize,
  getInkRenderStats,
  resetInkRenderStats,
  resolveInkRender,
} from './bitmap-cache'
export {
  DEFAULT_INK_COLOR,
  DEFAULT_INK_STROKE_OPTIONS,
  buildInkOutline,
  createInkGeometry,
  distanceBetweenSegments,
  distanceToSegment,
  drawInkDraft,
  drawInkNode,
  drawInkNodeWithOpacity,
  hitTestInkLocal,
  hitTestInkSegmentWorld,
  hitTestInkWorld,
  outlineFromInk,
  pickInkStrokeOptions,
  readInkData,
  traceSmoothInkOutline,
} from './geometry'
export { inkNodeDef } from './node'
export type {
  InkDraft,
  InkEraserDraft,
  InkGeometry,
  InkNodeData,
  InkPoint,
  InkSample,
  InkStrokeData,
  InkStrokeOptions,
} from './types'
