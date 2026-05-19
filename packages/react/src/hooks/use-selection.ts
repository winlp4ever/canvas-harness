import type { EdgeId, NodeId } from '@canvas-harness/core'
import { useSyncExternalStore } from 'react'
import { useCanvasStore } from '../context'

/**
 * useSelection — current selection (node + edge ids). Re-renders only
 * when the selection changes. Store keeps selection in a single atom so
 * the returned array reference is stable between updates.
 */
export function useSelection(): (NodeId | EdgeId)[] {
  const store = useCanvasStore()
  return useSyncExternalStore(
    cb => store.subscribe('selection', cb),
    () => store.getSelection(),
  )
}
