import {
  type CanvasStore,
  type Edge,
  type EditorAdapter,
  type EditorAdapterFactory,
  type Node,
  asNodeId,
  createDefaultTextareaEditor,
  edgeLabelBoundsWorld,
} from '@canvas-harness/core'
import { useEffect, useRef } from 'react'

/**
 * EditorMount — wires an `EditorAdapter` to the in-canvas edit lifecycle.
 * Mounts the adapter at the editing node's screen position; tears it
 * down on commit / cancel.
 *
 * Camera is locked during edit (see `usePanZoom`) so the editor stays
 * pinned to the node it's editing without needing to chase pan/zoom.
 *
 * `factory` defaults to `createDefaultTextareaEditor` (a plain
 * `<textarea>`). Consumers can plug Lexical/ProseMirror/TipTap by
 * passing a custom factory.
 */
export function EditorMount({
  store,
  factory = createDefaultTextareaEditor,
}: {
  store: CanvasStore
  factory?: EditorAdapterFactory
}) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    let activeAdapter: EditorAdapter | null = null
    let currentEditingKey: string | null = null

    const teardown = (): void => {
      if (activeAdapter) {
        activeAdapter.destroy()
        activeAdapter = null
      }
      currentEditingKey = null
    }

    const onInteraction = () => {
      const state = store.getInteractionState()
      const target = state.mode === 'editing' ? state.editingTarget : null
      const key = target ? `${target.kind}:${target.id}` : null

      // No-op when state is unchanged.
      if (key === currentEditingKey) return

      // Tear down a stale editor (commit/cancel/switch).
      teardown()
      if (!target) return

      // Resolve the node passed to the editor adapter. For a node target
      // it's just the node; for an edge target we synthesize a Node that
      // boxes the label's world rect + the edge's style, so the existing
      // textarea editor positions + styles itself correctly.
      let editorNode: Node | null = null
      if (target.kind === 'node') {
        editorNode = store.getNode(target.id) ?? null
      } else {
        const edge = store.getEdge(target.id)
        const geom = store.getEdgeGeometry(target.id)
        if (edge && geom) editorNode = synthesizeLabelNode(edge, geom)
      }
      if (!editorNode) return

      currentEditingKey = key
      activeAdapter = factory({
        node: editorNode,
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
  }, [store, factory])

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

/**
 * Builds a synthetic Node that represents an edge's label rect for the
 * editor adapter. The adapter only reads `x/y/w/h/style/content`; the
 * synthetic node won't be stored or rendered as a real node — it's
 * just a positioning + styling vehicle for the textarea.
 */
const synthesizeLabelNode = (
  edge: Edge,
  geom: import('@canvas-harness/core').EdgeGeometry,
): Node | null => {
  const bounds = edgeLabelBoundsWorld(edge, geom)
  if (!bounds) {
    // Empty content — fabricate a small box at the label's would-be
    // anchor so the editor still has somewhere to mount.
    if (geom.samples.length < 2) return null
    const mid = geom.samples[Math.floor(geom.samples.length / 2)]!
    return {
      id: asNodeId(`__edge-label:${edge.id}`),
      type: 'text',
      x: mid.x - 60,
      y: mid.y - 12,
      w: 120,
      h: 24,
      angle: 0,
      z: 0,
      groups: [],
      content: '',
      style: edge.style,
    }
  }
  return {
    id: asNodeId(`__edge-label:${edge.id}`),
    type: 'text',
    x: bounds.x,
    y: bounds.y,
    w: bounds.w,
    h: bounds.h,
    angle: 0,
    z: 0,
    groups: [],
    content: edge.content ?? '',
    style: { ...edge.style, autoFit: false }, // labels don't autofit height
  }
}
