import { useSyncExternalStore } from 'react'
import { useCanvasStore } from '../context'

/**
 * `true` when there's something to undo. Updates after every committed
 * batch (the only thing that changes the stack).
 *
 * @example
 * const canUndo = useCanUndo()
 * <button disabled={!canUndo} onClick={() => store.undo()}>Undo</button>
 */
export function useCanUndo(): boolean {
  const store = useCanvasStore()
  return useSyncExternalStore(
    cb => store.subscribe('change', cb),
    () => store.canUndo(),
  )
}

/**
 * `true` when there's something to redo. See {@link useCanUndo}.
 *
 * @example
 * const canRedo = useCanRedo()
 * <button disabled={!canRedo} onClick={() => store.redo()}>Redo</button>
 */
export function useCanRedo(): boolean {
  const store = useCanvasStore()
  return useSyncExternalStore(
    cb => store.subscribe('change', cb),
    () => store.canRedo(),
  )
}
