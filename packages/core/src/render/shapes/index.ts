export type { ThemeResolver } from './defaults'
export {
  DEFAULT_STYLE,
  dashPatternFor,
  resolveColor,
  resolveOpacity,
  resolveStrokeWidth,
} from './defaults'
export {
  buildDiamondPath,
  buildEllipsePath,
  buildRectPath,
  buildTagPath,
} from './path-helpers'
export type { PrimitiveType } from './draw-shape'
export { drawShape, isCompositePrimitive, isDrawablePrimitive } from './draw-shape'
export type { ContentBounds } from './content-bounds'
export { contentBounds } from './content-bounds'
