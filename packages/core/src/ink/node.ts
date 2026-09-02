import { defineNode } from '../node-types'
import { drawInkNode, hitTestInkLocal } from './geometry'

/** Built-in canvas-only definition automatically registered by every store. */
export const inkNodeDef = defineNode({
  type: 'ink',
  renderCanvas: drawInkNode,
  drawPlaceholder: drawInkNode,
  hitTest: (node, point) => hitTestInkLocal(node, point),
  lod: { minZoomForPlaceholder: 0.02 },
})
