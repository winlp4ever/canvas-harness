import {
  type CanvasStore,
  type Edge,
  type EdgeStyle,
  type Node,
  type PathStyle,
  type Style,
} from '@canvas-harness/core'
import { useEffect, useRef, useState } from 'react'

/**
 * Sticky style memory — see IMPROVEMENTS.md.
 *
 * Captures the last-used style per node type + edge, so the next
 * thing the user creates inherits their last choice. Excalidraw-style.
 * Persisted to `localStorage` so the preference survives reloads.
 *
 * Watches the store's `change` event:
 *   - `node.update` with a `style` patch → remember the resolved style
 *     for that node's type.
 *   - `edge.update` with a `style` / `pathStyle` patch → remember the
 *     resolved edge style.
 *
 * Returns a `getStyle(typeOrEdge)` accessor consumers call when
 * creating new nodes / edges.
 */

const STORAGE_KEY = 'canvas-harness-playground:style-memory:v1'

export type EdgeMemory = {
  style?: EdgeStyle
  pathStyle?: PathStyle
}

export type StyleMemory = {
  /** Per node type (`rect`, `ellipse`, `text`, ...). */
  nodes: Record<string, Style>
  /** Shared across all edges. */
  edge: EdgeMemory
}

const emptyMemory = (): StyleMemory => ({ nodes: {}, edge: {} })

const loadFromStorage = (): StyleMemory => {
  if (typeof window === 'undefined') return emptyMemory()
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyMemory()
    const parsed = JSON.parse(raw)
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.nodes === 'object' &&
      typeof parsed.edge === 'object'
    ) {
      return parsed as StyleMemory
    }
  } catch {
    // Corrupt JSON; fall through to fresh memory.
  }
  return emptyMemory()
}

const saveToStorage = (mem: StyleMemory): void => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(mem))
  } catch {
    // Quota / privacy mode — ignore.
  }
}

export function useStyleMemory(store: CanvasStore): {
  getNodeStyle: (type: string) => Style | undefined
  getEdgeStyle: () => EdgeStyle | undefined
  getEdgePathStyle: () => PathStyle | undefined
} {
  const [, force] = useState(0)
  const memoryRef = useRef<StyleMemory>(loadFromStorage())

  useEffect(() => {
    const unsub = store.subscribe('change', batch => {
      let dirty = false
      for (const op of batch.ops) {
        if (op.type === 'node.update') {
          // Only react to style changes — content / position updates
          // shouldn't move the style memory.
          if (op.patch.style === undefined) continue
          const node = store.getNode(op.id)
          if (!node) continue
          memoryRef.current.nodes[node.type] = node.style ?? {}
          dirty = true
        } else if (op.type === 'edge.update') {
          if (op.patch.style === undefined && op.patch.pathStyle === undefined) continue
          const edge = store.getEdge(op.id)
          if (!edge) continue
          if (op.patch.style !== undefined) memoryRef.current.edge.style = edge.style
          if (op.patch.pathStyle !== undefined) memoryRef.current.edge.pathStyle = edge.pathStyle
          dirty = true
        }
      }
      if (dirty) {
        saveToStorage(memoryRef.current)
        force(n => n + 1)
      }
    })
    return unsub
  }, [store])

  return {
    getNodeStyle: (type: string) => memoryRef.current.nodes[type],
    getEdgeStyle: () => memoryRef.current.edge.style,
    getEdgePathStyle: () => memoryRef.current.edge.pathStyle,
  }
}

// Re-exports for the playground's create paths (kept as imports to
// avoid `any` casts in consumer code).
export type { Edge, Node }
