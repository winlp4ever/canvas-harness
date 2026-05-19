export type { CanvasSurface } from './canvas-setup'
export { clearSurface, getDpr, setupSurface, sizeSurface } from './canvas-setup'
export type { FrameLoop, FrameStats } from './frame-loop'
export { createFrameLoop } from './frame-loop'
export type { Renderer, RendererOptions } from './renderer'
export { createRenderer } from './renderer'
export { paintBackground } from './background'
export type { PrimitiveType, ThemeResolver } from './shapes'
export {
  DEFAULT_STYLE,
  drawShape,
  isDrawablePrimitive,
  resolveColor,
  resolveOpacity,
  resolveStrokeWidth,
} from './shapes'
export { applyCameraTransform, drawWithNodeTransform, worldViewport } from './transform'
