/**
 * Camera transform application + viewport math.
 *
 * The trick: instead of transforming each shape's coordinates by hand,
 * we set the canvas matrix once per frame and draw every shape in world
 * coordinates. The DPR factor is folded into the matrix so logical-pixel
 * stroke widths come out crisp.
 */
import { viewportWorldRect } from '../camera'
import type { CameraState, Node, WorldRect } from '../types'
import type { CanvasSurface } from './canvas-setup'

/**
 * Sets the 2d transform so subsequent draw calls take world coords.
 *
 *   screen.x = (world.x - camera.x) * camera.z * dpr
 *   screen.y = (world.y - camera.y) * camera.z * dpr
 */
export const applyCameraTransform = (surface: CanvasSurface, camera: CameraState): void => {
  const sx = camera.z * surface.dpr
  const sy = camera.z * surface.dpr
  const tx = -camera.x * sx
  const ty = -camera.y * sy
  surface.ctx.setTransform(sx, 0, 0, sy, tx, ty)
}

/**
 * The world rect currently visible inside the surface.
 */
export const worldViewport = (surface: CanvasSurface, camera: CameraState): WorldRect =>
  viewportWorldRect(camera, surface.cssWidth, surface.cssHeight)

/**
 * Wraps a draw callback in the local-frame transform for one node:
 * translates to the node's center, rotates by node.angle, then translates
 * back to the node's top-left so the drawer can build paths in (0..w, 0..h).
 *
 * Fast path: when `node.angle === 0` (the common case) we skip the
 * canvas2d save/restore pair entirely and manually un-translate after
 * the callback. `save()`/`restore()` allocate + swap a full graphics
 * state record; at 10k+ nodes/frame that's ~1ms of the paint budget.
 * The callback is responsible for not leaking transform state — all
 * built-in drawers (drawShape, drawCompositeRough, paintFrameNode,
 * paintImageNode, paintIconNode) honor this contract by either
 * leaving the transform untouched or restoring their own inner pushes.
 */
export const drawWithNodeTransform = (
  ctx: CanvasRenderingContext2D,
  node: Node,
  fn: () => void,
): void => {
  if (node.angle === 0) {
    ctx.translate(node.x, node.y)
    fn()
    ctx.translate(-node.x, -node.y)
    return
  }
  // Rotated path keeps the save/restore — un-doing translate + rotate
  // + translate manually is error-prone and rotated nodes are rare.
  ctx.save()
  const cx = node.x + node.w / 2
  const cy = node.y + node.h / 2
  ctx.translate(cx, cy)
  ctx.rotate(node.angle)
  ctx.translate(-node.w / 2, -node.h / 2)
  fn()
  ctx.restore()
}
