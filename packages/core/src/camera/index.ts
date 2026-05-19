/**
 * Camera math — see ARCHITECTURE.md §4.3 and §13.4.
 *
 * The camera maps world coordinates to screen coordinates via:
 *   screen = (world - camera.{x,y}) * camera.z
 *   world  = screen / camera.z + camera.{x,y}
 *
 * camera.{x,y} is the world-space point shown at screen (0,0).
 * camera.z is the zoom factor (1 = identity).
 */
import type { CameraState, Vec2, WorldRect } from '../types'

export const DEFAULT_CAMERA: CameraState = { x: 0, y: 0, z: 1 }

export const MIN_ZOOM = 0.05
export const MAX_ZOOM = 16

/**
 * Converts a screen-space point to world coords given the current camera.
 */
export const screenToWorld = (screen: Vec2, camera: CameraState): Vec2 => ({
  x: screen.x / camera.z + camera.x,
  y: screen.y / camera.z + camera.y,
})

/**
 * Converts a world-space point to screen coords given the current camera.
 */
export const worldToScreen = (world: Vec2, camera: CameraState): Vec2 => ({
  x: (world.x - camera.x) * camera.z,
  y: (world.y - camera.y) * camera.z,
})

/**
 * Computes the world-space rect currently visible inside a viewport of the
 * given screen-space size. Used for viewport culling queries.
 */
export const viewportWorldRect = (
  camera: CameraState,
  viewportW: number,
  viewportH: number,
): WorldRect => ({
  x: camera.x,
  y: camera.y,
  w: viewportW / camera.z,
  h: viewportH / camera.z,
})

/**
 * Clamps a zoom factor to the supported range.
 */
export const clampZoom = (z: number): number => {
  if (!Number.isFinite(z)) return 1
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z))
}

/**
 * Applies a zoom delta keeping the world point under `screenAnchor` stationary.
 * Useful for wheel-zoom and pinch-zoom — keeps focus where the user looks.
 */
export const zoomAtScreenPoint = (
  camera: CameraState,
  newZoom: number,
  screenAnchor: Vec2,
): CameraState => {
  const z = clampZoom(newZoom)
  const worldAnchor = screenToWorld(screenAnchor, camera)
  // Solve for new x/y so that worldToScreen(worldAnchor, new) === screenAnchor.
  return {
    x: worldAnchor.x - screenAnchor.x / z,
    y: worldAnchor.y - screenAnchor.y / z,
    z,
  }
}

/**
 * Pans the camera by a screen-space delta (e.g. from a drag gesture).
 */
export const panByScreen = (camera: CameraState, deltaScreen: Vec2): CameraState => ({
  x: camera.x - deltaScreen.x / camera.z,
  y: camera.y - deltaScreen.y / camera.z,
  z: camera.z,
})
