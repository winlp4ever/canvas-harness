export type { InkBitmapEntry, InkBitmapRequest, InkRenderDecision } from './bitmap-cache'
export {
  INK_BITMAP_CACHE_MAX,
  clearInkBitmapCache,
  getInkBitmapCacheSize,
  getInkRenderStats,
  resetInkRenderStats,
  resolveInkRender,
} from './bitmap-cache'
export {
  DEFAULT_INK_COLOR,
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
} from './types'
