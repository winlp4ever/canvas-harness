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
 */
export const drawWithNodeTransform = (
  ctx: CanvasRenderingContext2D,
  node: Node,
  fn: () => void,
): void => {
  ctx.save()
  if (node.angle === 0) {
    ctx.translate(node.x, node.y)
  } else {
    const cx = node.x + node.w / 2
    const cy = node.y + node.h / 2
    ctx.translate(cx, cy)
    ctx.rotate(node.angle)
    ctx.translate(-node.w / 2, -node.h / 2)
  }
  fn()
  ctx.restore()
}
