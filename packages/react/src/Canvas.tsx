import {
  type CanvasStore,
  type EditorAdapterFactory,
  type NodeId,
  type Renderer,
  createRenderer,
  hitTestAny,
  screenToWorld,
} from '@canvas-harness/core'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { CanvasProvider, useCanvasStore } from './context'
import { EditorMount } from './internal/editor-mount'
import { useArrowTool } from './internal/use-arrow-tool'
import {
  type InteractionTool,
  useInteractionGesture,
} from './internal/use-interaction-gesture'
import { useOverlayHost } from './internal/use-overlay-host'
import { usePanZoom } from './internal/use-pan-zoom'
import { useResizeObserver } from './internal/use-resize-observer'
import type { ThemeResolver } from './types'

/**
 * Screen-space + world-space pointer info delivered to event-prop
 * callbacks (`onClick`, `onDoubleClick`).
 */
export type CanvasPointerEvent = {
  screen: { x: number; y: number }
  world: { x: number; y: number }
  /** Tool active when the event fired. */
  tool: string
  /** The native MouseEvent — caller can read modifiers, button, etc. */
  native: MouseEvent
}

export type CanvasProps = {
  /** Optional — if omitted, must be inside a `<CanvasProvider>`. */
  store?: CanvasStore
  /** Current tool. The library handles 'select' and 'arrow' internally;
   *  other strings are passed through so consumers can wire their own
   *  shape-create / text-tool logic via `onClick`. */
  tool: string
  /** Theme resolver — see ARCHITECTURE.md §13.10. */
  theme?: ThemeResolver
  /** Pluggable in-place editor factory; defaults to the DOM textarea. */
  editorAdapter?: EditorAdapterFactory
  /** Called once when the renderer is mounted. */
  onRenderer?: (r: Renderer) => void
  /** Click on the canvas surface (not over a node interactive handle). */
  onClick?: (e: CanvasPointerEvent) => void
  /** Double-click anywhere on the surface. */
  onDoubleClick?: (e: CanvasPointerEvent) => void
  /**
   * Render a custom node's React view. Returning `null` falls back to
   * the canvas paint path. Receives the node + its mount slot's screen
   * geometry already applied by the overlay container.
   */
  renderCustomNodeView?: (id: NodeId) => ReactNode
  /** Extra content rendered inside the canvas absolute container. */
  children?: ReactNode
}

/**
 * `<Canvas>` — see ARCHITECTURE.md §13.
 *
 * Mounts the static + interactive canvases plus the DOM overlay used
 * for custom-node React views and the in-place editor. Owns the
 * renderer lifecycle, the resize observer, and the gesture hooks.
 *
 * The store is read from `<CanvasProvider>` context; if a `store` prop
 * is also provided (rare — usually for tests / standalone usage), it
 * takes precedence and is wrapped in a local provider for descendants.
 */
export function Canvas(props: CanvasProps) {
  if (props.store) {
    return (
      <CanvasProvider store={props.store}>
        <CanvasSurface {...props} />
      </CanvasProvider>
    )
  }
  return <CanvasSurface {...props} />
}

function CanvasSurface({
  tool,
  theme,
  editorAdapter,
  onRenderer,
  onClick,
  onDoubleClick,
  renderCustomNodeView,
  children,
}: CanvasProps) {
  const store = useCanvasStore()
  const wrapRef = useRef<HTMLDivElement>(null)
  const staticRef = useRef<HTMLCanvasElement>(null)
  const interactiveRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<Renderer | null>(null)
  const toolRef = useRef(tool)
  toolRef.current = tool

  const { w, h } = useResizeObserver(wrapRef)
  usePanZoom(wrapRef, store)
  useInteractionGesture(wrapRef, store, tool as InteractionTool)
  useArrowTool(wrapRef, store, tool === 'arrow')

  const { mountedIds, setMountedIds } = useOverlayHost()
  const [camera, setCamera] = useState(() => store.getCamera())

  useEffect(() => store.subscribe('camera', c => setCamera({ ...c })), [store])

  // Renderer lifecycle. Creates on first mount + size>0; disposes on unmount.
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
      theme,
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
  }, [store, theme, w, h, onRenderer, setMountedIds])

  // Surface-level click — fires for any unhandled click (gesture hooks
  // consume their own). Consumer uses this to implement shape-tool /
  // text-tool create.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const dispatch = (
      e: MouseEvent,
      cb: ((ev: CanvasPointerEvent) => void) | undefined,
    ): void => {
      if (!cb) return
      const rect = el.getBoundingClientRect()
      const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top }
      const world = screenToWorld(screen, store.getCamera())
      cb({ screen, world, tool: toolRef.current, native: e })
    }
    const onClickHandler = (e: MouseEvent) => dispatch(e, onClick)
    const onDoubleClickHandler = (e: MouseEvent) => {
      // Built-in: dbl-click a node body → beginEdit. Consumer's
      // onDoubleClick fires too if provided.
      if (toolRef.current === 'select') {
        const rect = el.getBoundingClientRect()
        const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top }
        const camera = store.getCamera()
        const world = screenToWorld(screen, camera)
        const hit = hitTestAny(store, world, camera.z)
        if (hit && hit.kind === 'body' && 'nodeId' in hit) {
          store.beginEdit(hit.nodeId)
        }
      }
      dispatch(e, onDoubleClick)
    }
    el.addEventListener('click', onClickHandler)
    el.addEventListener('dblclick', onDoubleClickHandler)
    return () => {
      el.removeEventListener('click', onClickHandler)
      el.removeEventListener('dblclick', onDoubleClickHandler)
    }
  }, [store, onClick, onDoubleClick])

  // CSS transform on overlay div so child positions in world coords follow camera with one composite op.
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
        {renderCustomNodeView
          ? mountedIds.map(id => (
              <OverlayItem key={id} id={id}>
                {renderCustomNodeView(id)}
              </OverlayItem>
            ))
          : null}
      </div>
      <canvas
        ref={interactiveRef}
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      />
      <EditorMount store={store} factory={editorAdapter} />
      {children}
    </div>
  )
}

/**
 * One mounted custom-node React subtree. Positions itself at the node's
 * world coords; the overlay parent CSS-transform handles camera.
 *
 * Re-reads the node on each 'change' event (Phase-9 simplification; a
 * future hook tightening pass could narrow to per-id subscription).
 */
function OverlayItem({ id, children }: { id: NodeId; children: ReactNode }) {
  const store = useCanvasStore()
  const [node, setNode] = useState(() => store.getNode(id))
  useEffect(() => {
    return store.subscribe('change', () => setNode(store.getNode(id)))
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
      {children}
    </div>
  )
}
