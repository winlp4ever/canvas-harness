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
 * Full interaction state. Fires on **any** change — mode flips,
 * pointermoves, drag delta updates, marquee rect updates, ...
 *
 * Most consumers want a narrower hook (`useInteractionMode`,
 * `useCursor`, `useIsMoving`, `useDraggedIds`). Reach for this one only
 * if you need multiple fields together.
 *
 * @example
 * const state = useInteractionState()
 * if (state.mode === 'marqueeing') drawMarqueeOverlay(state.marqueeRect)
 */
export function useInteractionState(): InteractionState {
  const store = useCanvasStore()
  return useSyncExternalStore(
    cb => store.subscribe('interaction', cb),
    () => store.getInteractionState(),
  )
}

/**
 * Just the interaction mode. Re-renders only on mode transitions,
 * never on pointermove.
 *
 * Use to gate heavy effects ("only run X when mode === 'idle'") or
 * disable UI affordances during a drag.
 *
 * @example
 * const mode = useInteractionMode()
 * <button disabled={mode !== 'idle'}>Run AI suggestion</button>
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

/**
 * Latest pointer info — `worldX/Y`, `screenX/Y`, `pointerType`,
 * optional `pressure` (for pens). Updated on every pointermove.
 *
 * @example
 * const cursor = useCursor()
 * <div>x: {cursor?.worldX.toFixed(1)}</div>
 */
export function useCursor(): PointerInfo | null {
  const store = useCanvasStore()
  return useSyncExternalStore(
    cb => store.subscribe('interaction', cb),
    () => store.getInteractionState().pointer,
  )
}

/**
 * `true` while the user is panning, zooming, dragging, resizing, or
 * rotating. Derived from {@link useInteractionMode}.
 *
 * Useful for skipping expensive renders during motion (the library
 * does this internally for the bitmap cache; consumers can do the same
 * for custom-node React views).
 *
 * @example
 * const isMoving = useIsMoving()
 * return isMoving ? <Skeleton /> : <ExpensiveChart />
 */
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
 * Ids being dragged or resized right now. Empty array when idle (with
 * a stable reference, so consumers can use as a dep).
 *
 * @example
 * const ids = useDraggedIds()
 * useEffect(() => { … }, [ids])  // safe; same array between gestures
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

/**
 * `true` when the most recent pointer was a stylus. Falls back to
 * `false` before any pointer event has fired.
 *
 * Use to surface pen-specific UI (pressure-aware tools, ink hints).
 *
 * @example
 * const isPen = useIsPenActive()
 * {isPen && <PressureToolbar />}
 */
export function useIsPenActive(): boolean {
  const cursor = useCursor()
  return cursor?.pointerType === 'pen'
}
