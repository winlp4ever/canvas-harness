import { useSyncExternalStore } from 'react'
import { useCanvasStore } from '../context'

/**
 * useCanUndo / useCanRedo — undo/redo button enablement state. Updates
 * on every committed batch (which is the only thing that mutates
 * either stack).
 */
export function useCanUndo(): boolean {
  const store = useCanvasStore()
  return useSyncExternalStore(
    cb => store.subscribe('change', cb),
    () => store.canUndo(),
  )
}

export function useCanRedo(): boolean {
  const store = useCanvasStore()
  return useSyncExternalStore(
    cb => store.subscribe('change', cb),
    () => store.canRedo(),
  )
}
