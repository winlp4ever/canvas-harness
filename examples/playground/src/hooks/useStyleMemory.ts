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
 * Captures the last-used style across all shape creations so the next
 * thing the user makes inherits their last choice. Single shared
 * bucket for nodes (matches excalidraw / tldraw / figma — set a color
 * on a rect, switch to ellipse, ellipse is also that color). Edges
 * have their own shared bucket since their style fields diverge
 * (arrowheads, pathStyle).
 *
 * Persisted to `localStorage` so the preference survives reloads.
 * Storage key is versioned — `v2` switched to the shared model and
 * deliberately ignores `v1` per-type entries.
 *
 * Watches the store's `change` event:
 *   - `node.update` with a `style` patch → fold the resolved style
 *     into the shared node bucket.
 *   - `edge.update` with a `style` / `pathStyle` patch → fold into
 *     the edge bucket.
 *
 * Returns accessors callers use when creating new nodes / edges.
 */

const STORAGE_KEY = 'canvas-harness-playground:style-memory:v2'

export type EdgeMemory = {
  style?: EdgeStyle
  pathStyle?: PathStyle
}

export type StyleMemory = {
  /** Shared across all node types. */
  nodes: Style
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
  getNodeStyle: () => Style | undefined
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
          if (op.patch.style === undefined) continue
          const node = store.getNode(op.id)
          if (!node) continue
          // Merge so unset fields on the latest edit don't wipe earlier
          // preferences (e.g. user nudges roughness but didn't touch
          // backgroundColor → keep the prior backgroundColor).
          memoryRef.current.nodes = { ...memoryRef.current.nodes, ...(node.style ?? {}) }
          dirty = true
        } else if (op.type === 'edge.update') {
          if (op.patch.style === undefined && op.patch.pathStyle === undefined) continue
          const edge = store.getEdge(op.id)
          if (!edge) continue
          if (op.patch.style !== undefined) {
            memoryRef.current.edge.style = { ...memoryRef.current.edge.style, ...(edge.style ?? {}) }
          }
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
    getNodeStyle: () => {
      const s = memoryRef.current.nodes
      return Object.keys(s).length === 0 ? undefined : s
    },
    getEdgeStyle: () => memoryRef.current.edge.style,
    getEdgePathStyle: () => memoryRef.current.edge.pathStyle,
  }
}

// Re-exports for the playground's create paths (kept as imports to
// avoid `any` casts in consumer code).
export type { Edge, Node }
