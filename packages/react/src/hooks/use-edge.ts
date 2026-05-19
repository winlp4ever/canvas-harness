import type { Edge, EdgeId } from '@canvas-harness/core'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { useCanvasStore } from '../context'

/**
 * Subscribes to a single edge. Re-renders only when that edge mutates
 * (style change, endpoint reconnect, etc.). Use inside per-edge UI
 * like a label component or an inspector panel.
 *
 * @example
 * function EdgeLabel({ id }: { id: EdgeId }) {
 *   const edge = useEdge(id)
 *   return <span>{edge?.style?.strokeColor ?? 'default'}</span>
 * }
 */
export function useEdge(id: EdgeId): Edge | undefined {
  const store = useCanvasStore()
  return useSyncExternalStore(
    cb =>
      store.subscribe('change', batch => {
        for (const op of batch.ops) {
          if ('edge' in op && op.edge.id === id) {
            cb()
            return
          }
          if ('id' in op && (op.id as unknown) === id) {
            cb()
            return
          }
        }
      }),
    () => store.getEdge(id),
  )
}

/**
 * Returns every edge (optionally filtered). Re-renders on every
 * committed batch — expensive. Use for inspector panels or minimaps;
 * never inside per-edge components.
 *
 * @example
 * const dashed = useEdges(e => e.style?.strokeStyle === 'dashed')
 */
export function useEdges(predicate?: (e: Edge) => boolean): Edge[] {
  const store = useCanvasStore()
  const [edges, setEdges] = useState<Edge[]>(() => {
    const all = store.getAllEdges()
    return predicate ? all.filter(predicate) : all
  })
  useEffect(() => {
    const recompute = (): void => {
      const all = store.getAllEdges()
      setEdges(predicate ? all.filter(predicate) : all)
    }
    return store.subscribe('change', recompute)
  }, [store, predicate])
  return edges
}
