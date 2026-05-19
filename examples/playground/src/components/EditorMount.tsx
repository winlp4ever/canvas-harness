import {
  type CanvasStore,
  type NodeId,
  createDefaultTextareaEditor,
} from '@canvas-harness/core'
import { useEffect, useRef } from 'react'

/**
 * EditorMount — wires the core's `createDefaultTextareaEditor` adapter to
 * the in-canvas edit lifecycle. Mounts a `<textarea>` at the editing
 * node's screen position; tears it down on commit / cancel.
 *
 * Camera is locked during edit (see `usePanZoom`) so the editor stays
 * pinned to the node it's editing without needing to chase pan/zoom.
 */
export function EditorMount({ store }: { store: CanvasStore }) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    let activeAdapter: ReturnType<typeof createDefaultTextareaEditor> | null = null
    let currentEditingId: NodeId | null = null

    const teardown = (): void => {
      if (activeAdapter) {
        activeAdapter.destroy()
        activeAdapter = null
      }
      currentEditingId = null
    }

    const onInteraction = () => {
      const state = store.getInteractionState()
      const editingId = state.mode === 'editing' ? state.editingNodeId : null

      // No-op when state is unchanged.
      if (editingId === currentEditingId) return

      // Tear down a stale editor (commit/cancel/switch).
      teardown()

      if (!editingId) return
      const node = store.getNode(editingId)
      if (!node) return

      currentEditingId = editingId
      activeAdapter = createDefaultTextareaEditor({
        node,
        container: host,
        camera: store.getCamera(),
        dpr: window.devicePixelRatio || 1,
        onCommit: text => {
          store.commitEdit(text)
        },
        onCancel: () => {
          store.cancelEdit()
        },
      })
    }

    onInteraction()
    const unsub = store.subscribe('interaction', onInteraction)
    return () => {
      unsub()
      teardown()
    }
  }, [store])

  return (
    <div
      ref={hostRef}
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        // Children (the textarea) re-enable pointer events themselves.
      }}
    />
  )
}
