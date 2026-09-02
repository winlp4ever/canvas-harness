export {
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
