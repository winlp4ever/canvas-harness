import type { CameraState } from '@canvas-harness/core'
import { useSyncExternalStore } from 'react'
import { useCanvasStore } from '../context'

/**
 * Returns the current camera (`{ x, y, z }`). Re-renders on every
 * camera change — pan / zoom / `store.setCamera(...)`.
 *
 * Useful for status bars, minimaps, or positioning overlays in world
 * coordinates.
 *
 * @example
 * function ZoomReadout() {
 *   const { z } = useCamera()
 *   return <span>{Math.round(z * 100)}%</span>
 * }
 */
export function useCamera(): CameraState {
  const store = useCanvasStore()
  return useSyncExternalStore(
    cb => store.subscribe('camera', cb),
    () => store.getCamera(),
  )
}
