import type { Node, NodeId } from '@canvas-harness/core'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { useCanvasStore } from '../context'

/**
 * Subscribes to a single node. Re-renders **only** when that node
 * changes — moves on other nodes are free.
 *
 * The recommended hook for custom-node React views, layer panels keyed
 * by id, and any per-node UI.
 *
 * @example
 * function StickyView({ id }: { id: NodeId }) {
 *   const node = useNode(id)
 *   if (!node) return null
 *   return <div>{node.content ?? 'empty'}</div>
 * }
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
 * Returns every node (optionally filtered). Re-renders on **every**
 * committed batch — expensive. Use for sidebars / minimaps / layer
 * panels that legitimately see all nodes; never inside per-node
 * components.
 *
 * @example
 * // Layer panel: list every node grouped by type.
 * function Layers() {
 *   const nodes = useNodes()
 *   return <ul>{nodes.map(n => <li key={n.id}>{n.type}</li>)}</ul>
 * }
 *
 * @example
 * // Filtered: only text nodes.
 * const textNodes = useNodes(n => n.type === 'text')
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
