import type { Node, NodeId } from '@canvas-harness/core'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { useCanvasStore } from '../context'

/**
 * useNode — subscribes to ONE node. Re-renders only when that node
 * changes. The recommended hook for custom-node React views.
 *
 * The store stores each node in its own signia atom; the atom's `value`
 * is a stable reference until that node mutates. So
 * `useSyncExternalStore` works directly — React compares by reference
 * and we only re-render when the node atom updates.
 */
export function useNode(id: NodeId): Node | undefined {
  const store = useCanvasStore()
  return useSyncExternalStore(
    cb => {
      // Re-emit only when a batch touches this node.
      return store.subscribe('change', batch => {
        for (const op of batch.ops) {
          if ('node' in op && op.node.id === id) {
            cb()
            return
          }
          if ('id' in op && (op.id as unknown) === id) {
            cb()
            return
          }
        }
      })
    },
    () => store.getNode(id),
  )
}

/**
 * useNodes — returns nodes matching an optional predicate.
 *
 * Re-renders on every committed batch since the visible set can change
 * arbitrarily. **Expensive — sidebars / minimaps / layer panels only.**
 * Inside per-node components prefer `useNode(id)`.
 *
 * Implemented with useState + 'change' subscription because the
 * filtered array is a fresh reference every call, which would loop
 * useSyncExternalStore.
 */
export function useNodes(predicate?: (n: Node) => boolean): Node[] {
  const store = useCanvasStore()
  const [nodes, setNodes] = useState<Node[]>(() => {
    const all = store.getAllNodes()
    return predicate ? all.filter(predicate) : all
  })
  useEffect(() => {
    const recompute = (): void => {
      const all = store.getAllNodes()
      setNodes(predicate ? all.filter(predicate) : all)
    }
    return store.subscribe('change', recompute)
  }, [store, predicate])
  return nodes
}
