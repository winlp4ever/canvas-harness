import type { EdgeId, NodeId } from '@canvas-harness/core'
import { useSyncExternalStore } from 'react'
import { useCanvasStore } from '../context'

/**
 * Returns the current selection — an array of node and/or edge ids.
 * Re-renders only when the selection changes.
 *
 * @example
 * function DeleteButton() {
 *   const store = useCanvasStore()
 *   const selection = useSelection()
 *   return (
 *     <button disabled={selection.length === 0} onClick={() => {
 *       for (const id of selection) {
 *         if (store.getNode(id as NodeId)) store.removeNode(id as NodeId)
 *         else store.removeEdge(id as EdgeId)
 *       }
 *     }}>
 *       Delete ({selection.length})
 *     </button>
 *   )
 * }
 */
export function useSelection(): (NodeId | EdgeId)[] {
  const store = useCanvasStore()
  return useSyncExternalStore(
    cb => store.subscribe('selection', cb),
    () => store.getSelection(),
  )
}
