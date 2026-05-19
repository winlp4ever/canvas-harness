import type {
  EdgeId,
  InteractionMode,
  InteractionState,
  NodeId,
  PointerInfo,
} from '@canvas-harness/core'
import { useSyncExternalStore } from 'react'
import { useCanvasStore } from '../context'

/**
 * useInteractionState — full local interaction state. Fires on any
 * change (mode, pointer, drag delta, marquee rect, ...).
 */
export function useInteractionState(): InteractionState {
  const store = useCanvasStore()
  return useSyncExternalStore(
    cb => store.subscribe('interaction', cb),
    () => store.getInteractionState(),
  )
}

/**
 * useInteractionMode — narrows to `mode`. Re-renders only on mode
 * transition, not on every pointermove.
 */
export function useInteractionMode(): InteractionMode {
  const store = useCanvasStore()
  return useSyncExternalStore(
    cb => {
      let lastMode = store.getInteractionState().mode
      return store.subscribe('interaction', state => {
        if (state.mode !== lastMode) {
          lastMode = state.mode
          cb()
        }
      })
    },
    () => store.getInteractionState().mode,
  )
}

/** useCursor — current pointer info (world + screen coords), or null. */
export function useCursor(): PointerInfo | null {
  const store = useCanvasStore()
  return useSyncExternalStore(
    cb => store.subscribe('interaction', cb),
    () => store.getInteractionState().pointer,
  )
}

/** useIsMoving — true while panning/zooming/dragging/resizing/rotating. */
export function useIsMoving(): boolean {
  const mode = useInteractionMode()
  return (
    mode === 'panning' ||
    mode === 'zooming' ||
    mode === 'dragging' ||
    mode === 'resizing' ||
    mode === 'rotating'
  )
}

/**
 * useDraggedIds — ids currently being dragged/resized. Stable
 * reference between drag-start and drag-commit; new array on each
 * gesture. Empty array (constant) when idle so renders are bounded.
 */
const EMPTY_DRAGGED: NodeId[] = []
export function useDraggedIds(): readonly (NodeId | EdgeId)[] {
  const store = useCanvasStore()
  return useSyncExternalStore(
    cb => store.subscribe('interaction', cb),
    () => {
      const state = store.getInteractionState()
      return state.draggedIds.length === 0 ? EMPTY_DRAGGED : state.draggedIds
    },
  )
}
