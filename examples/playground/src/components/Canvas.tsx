import {
  type CameraState,
  type CanvasStore,
  type NodeId,
  type Renderer,
  asNodeId,
  createRenderer,
  hitTestAny,
  screenToWorld,
} from '@canvas-harness/core'
import { useEffect, useRef, useState } from 'react'
import { ChartCardView } from '../custom-nodes/chart-card'
import { useArrowTool } from '../hooks/useArrowTool'
import { useInteraction } from '../hooks/useInteraction'
import { useOverlayHost } from '../hooks/useOverlayHost'
import { usePanZoom } from '../hooks/usePanZoom'
import { useResizeObserver } from '../hooks/useResizeObserver'
import { EditorMount } from './EditorMount'

export type CanvasProps = {
  store: CanvasStore
  tool: Tool
  onRenderer?: (r: Renderer) => void
}

export type Tool = 'select' | 'rect' | 'ellipse' | 'diamond' | 'capsule' | 'arrow' | 'text'

const SHAPE_TOOLS = new Set(['rect', 'ellipse', 'diamond', 'capsule'])
const TOOL_TO_TYPE: Record<
  'rect' | 'ellipse' | 'diamond' | 'capsule',
  'rect' | 'ellipse' | 'diamond' | 'capsule'
> = {
  rect: 'rect',
  ellipse: 'ellipse',
  diamond: 'diamond',
  capsule: 'capsule',
}

export function Canvas({ store, tool, onRenderer }: CanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const staticRef = useRef<HTMLCanvasElement>(null)
  const interactiveRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<Renderer | null>(null)
  const toolRef = useRef(tool)
  toolRef.current = tool

  const { w, h } = useResizeObserver(wrapRef)
  usePanZoom(wrapRef, store)
  useInteraction(wrapRef, store, tool)
  useArrowTool(wrapRef, store, tool === 'arrow')

  const { mountedIds, setMountedIds } = useOverlayHost()
  const [camera, setCamera] = useState<CameraState>(() => store.getCamera())

  // Keep camera in sync for overlay positioning.
  useEffect(() => {
    const unsub = store.subscribe('camera', c => setCamera({ ...c }))
    return unsub
  }, [store])

  // create the renderer once both canvases mount
  useEffect(() => {
    if (!staticRef.current || !interactiveRef.current || w === 0 || h === 0) return
    if (rendererRef.current) {
      rendererRef.current.setSize(w, h)
      return
    }
    const r = createRenderer({
      store,
      staticCanvas: staticRef.current,
      interactiveCanvas: interactiveRef.current,
      width: w,
      height: h,
      onOverlayChange: ids => setMountedIds(ids),
    })
    r.start()
    rendererRef.current = r
    onRenderer?.(r)
    return () => {
      r.dispose()
      rendererRef.current = null
    }
  }, [store, w, h, onRenderer, setMountedIds])

  // click-to-create when a shape tool is active; text tool creates an
  // empty text node and immediately enters edit mode.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const onClick = (e: MouseEvent) => {
      const t = toolRef.current
      const rect = el.getBoundingClientRect()
      const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top }
      const world = screenToWorld(screen, store.getCamera())
      if (SHAPE_TOOLS.has(t)) {
        store.addNode({
          id: asNodeId(store.generateId()),
          type: TOOL_TO_TYPE[t as keyof typeof TOOL_TO_TYPE],
          x: world.x - 60,
          y: world.y - 40,
          w: 120,
          h: 80,
          angle: 0,
          z: 0,
          groups: [],
        })
        return
      }
      if (t === 'text') {
        const id = asNodeId(store.generateId())
        store.addNode({
          id,
          type: 'text',
          x: world.x - 100,
          y: world.y - 16,
          w: 200,
          h: 32,
          angle: 0,
          z: 0,
          groups: [],
          content: '',
          style: { fontSize: 'M', textAlign: 'left', autoFit: true },
        })
        store.beginEdit(id)
      }
    }
    el.addEventListener('click', onClick)
    return () => el.removeEventListener('click', onClick)
  }, [store])

  // double-click any node to enter edit mode (select tool only).
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const onDoubleClick = (e: MouseEvent) => {
      if (toolRef.current !== 'select') return
      const rect = el.getBoundingClientRect()
      const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top }
      const camera = store.getCamera()
      const world = screenToWorld(screen, camera)
      const hit = hitTestAny(store, world, camera.z)
      if (hit && hit.kind === 'body' && 'nodeId' in hit) {
        store.beginEdit(hit.nodeId)
      }
    }
    el.addEventListener('dblclick', onDoubleClick)
    return () => el.removeEventListener('dblclick', onDoubleClick)
  }, [store])

  // CSS transform on the overlay container so the children's world-coord
  // positions automatically follow pan/zoom — no per-child reflow.
  // Per ARCHITECTURE.md §4: pan moves the whole overlay as one compositor op.
  const overlayTransform = `translate(${-camera.x * camera.z}px, ${-camera.y * camera.z}px) scale(${camera.z})`

  return (
    <div
      ref={wrapRef}
      style={{
        position: 'absolute',
        inset: 0,
        background: '#f8fafc',
        overflow: 'hidden',
        cursor: tool === 'select' ? 'default' : 'crosshair',
        touchAction: 'none',
      }}
    >
      <canvas ref={staticRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
      <div
        ref={overlayRef}
        style={{
          position: 'absolute',
          inset: 0,
          transformOrigin: '0 0',
          transform: overlayTransform,
          pointerEvents: 'none',
        }}
      >
        {mountedIds.map(id => (
          <OverlayItem key={id} id={id} store={store} />
        ))}
      </div>
      <canvas
        ref={interactiveRef}
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      />
      <EditorMount store={store} />
    </div>
  )
}

/**
 * Single mounted custom node inside the overlay. Subscribes to its node id
 * so it re-renders when the node's data/style/geometry changes — but only
 * for that one node, never for others.
 */
function OverlayItem({ id, store }: { id: NodeId; store: CanvasStore }) {
  const [node, setNode] = useState(() => store.getNode(id))
  useEffect(() => {
    // Phase-5 simplification: re-read on every change event. Phase 9's
    // signia-backed React hooks will narrow to per-node subscriptions.
    const unsub = store.subscribe('change', () => setNode(store.getNode(id)))
    return unsub
  }, [id, store])
  if (!node) return null
  return (
    <div
      style={{
        position: 'absolute',
        left: node.x,
        top: node.y,
        width: node.w,
        height: node.h,
        transform: node.angle !== 0 ? `rotate(${node.angle}rad)` : undefined,
        transformOrigin: 'center',
      }}
    >
      <ChartCardView node={node} />
    </div>
  )
}
