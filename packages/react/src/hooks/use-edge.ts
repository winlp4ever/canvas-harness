import type { Edge, EdgeId } from '@canvas-harness/core'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { useCanvasStore } from '../context'

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
 * useEdges — all edges (optionally filtered). Expensive; sidebars only.
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
