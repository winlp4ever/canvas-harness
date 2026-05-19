import type { CameraState } from '@canvas-harness/core'
import { useSyncExternalStore } from 'react'
import { useCanvasStore } from '../context'

export function useCamera(): CameraState {
  const store = useCanvasStore()
  return useSyncExternalStore(
    cb => store.subscribe('camera', cb),
    () => store.getCamera(),
  )
}
