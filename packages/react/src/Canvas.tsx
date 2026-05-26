import {
  type CanvasBackground,
  type CanvasStore,
  type EditorAdapterFactory,
  type NodeId,
  type Renderer,
  copy,
  createRenderer,
  cut,
  hitTestAny,
  paste,
  screenToWorld,
} from '@canvas-harness/core'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { CanvasProvider, useCanvasStore } from './context'
import { useInteractionMode } from './hooks/use-interaction'
import { EditorMount } from './internal/editor-mount'
import { type ArrowToolDefaults, useArrowTool } from './internal/use-arrow-tool'
import { type InteractionTool, useInteractionGesture } from './internal/use-interaction-gesture'
import { useOverlayHost } from './internal/use-overlay-host'
import { usePanZoom } from './internal/use-pan-zoom'
import { useResizeObserver } from './internal/use-resize-observer'
import type { ThemeResolver } from './types'

/**
 * Pointer info passed to `onClick` / `onDoubleClick`. Includes the
 * point in both screen space and world space so consumers don't have
 * to convert.
 */
export type CanvasPointerEvent = {
  /** Position relative to the canvas element. */
  screen: { x: number; y: number }
  /** Position in scene coordinates (camera-adjusted). */
  world: { x: number; y: number }
  /** Tool active when the event fired. */
  tool: string
  /** The native MouseEvent — read modifiers, button, etc. */
  native: MouseEvent
}

/**
 * Fired on pointerup after a drag-to-create gesture (non-select tool,
 * drag larger than ~5px). The consumer maps the rect into a new node
 * (defaults, type, style — all consumer policy).
 */
export type CanvasCreateDragEvent = {
  /** Bounding rect of the drag, in world coordinates. */
  rect: { x: number; y: number; w: number; h: number }
  /** Tool active when the gesture ended. */
  tool: string
  native: PointerEvent
}

export type CanvasProps = {
  /**
   * Optional — when omitted, the component reads the store from
   * `<CanvasProvider>` context. Pass directly for tests or
   * standalone-canvas use.
   */
  store?: CanvasStore
  /**
   * Current tool. The library handles `'select'` and `'arrow'`
   * internally; any other string passes through to `onClick` /
   * `onCreateDrag` so consumers can wire their own shape-create /
   * text-tool / lasso / ... logic.
   */
  tool: string
  /** Theme resolver — see ARCHITECTURE.md §13.10 for the token catalog. */
  theme?: ThemeResolver
  /**
   * Pluggable in-place editor factory; defaults to the built-in
   * `<textarea>`. Implement to swap in Lexical / ProseMirror / TipTap.
   */
  editorAdapter?: EditorAdapterFactory
  /** Called once when the renderer is mounted. Useful for perf overlays. */
  onRenderer?: (r: Renderer) => void
  /** Click on the canvas surface (not over a node handle). */
  onClick?: (e: CanvasPointerEvent) => void
  /** Double-click on the surface. The library has already triggered
   *  `beginEdit` if the click landed on a node body. */
  onDoubleClick?: (e: CanvasPointerEvent) => void
  /**
   * Drag-to-create — fires on pointerup when the user dragged with a
   * non-select tool. Sub-threshold drags fall through to `onClick`.
   *
   * @example
   * onCreateDrag={({ rect, tool }) => {
   *   if (tool === 'rect') store.addNode({ ...rect, type: 'rect', ... })
   * }}
   */
  onCreateDrag?: (e: CanvasCreateDragEvent) => void
  /**
   * Defaults applied to every edge the built-in arrow tool creates.
   * Lets a consumer remember the user's last-used pathStyle / style /
   * arrowheads. Shape + text tools route through `onClick` /
   * `onCreateDrag` so consumer controls those defaults directly.
   */
  arrowDefaults?: ArrowToolDefaults
  /**
   * Page background + optional infinite dot/grid pattern. Local-only
   * (not part of the synced scene). Update by changing the prop —
   * `<Canvas>` calls `renderer.setBackground` and forces a repaint.
   *
   * @example
   * <Canvas background={{ color: '#fffaf3', pattern: 'dots', gap: 24 }} />
   */
  background?: CanvasBackground
  /**
   * Color for all selection chrome: outline, resize + rotate handles,
   * edge endpoint + midpoint handles, marquee, drag-create preview,
   * and the draft edge during creation. Defaults to `#3b82f6`. Update
   * by changing the prop — `<Canvas>` calls
   * `renderer.setSelectionColor` without recreating the renderer.
   *
   * Accepts any CSS color literal (hex, rgb(), named). Typically you
   * also want to pass the same value to `<Minimap viewportColor={...} />`
   * so the two stay visually in sync.
   *
   * @example
   * <Canvas selectionColor="#10b981" />
   */
  selectionColor?: string
  /**
   * Cap on the canvas backing-store DPR. Defaults to `1`.
   *
   * At native device-pixel ratio on hi-DPI displays (Mac Retina ≈ 2,
   * Windows 4K @ 175% ≈ 1.75), the canvas backing buffer can hit
   * 20-30 megapixels per frame — the per-frame GPU-upload cost alone
   * eats a sizable slice of the frame budget. Capping DPR at 1 keeps
   * perf consistent across hardware at the cost of slightly softer
   * shape outlines on hi-DPI displays. Text remains crisp regardless
   * (the text bitmap cache handles its own DPR).
   *
   * Bump to `2` (or `window.devicePixelRatio`) when crispness matters
   * more than FPS — e.g. presentation slides, print-export views.
   *
   * @example
   * <Canvas maxDpr={2} />  // pixel-crisp at the cost of FPS on hi-DPI
   */
  maxDpr?: number
  /**
   * Render a custom node's React subtree. Called once per
   * library-mounted custom-node id; positioning is handled by the
   * overlay container (consumer fills the slot).
   *
   * @example
   * renderCustomNodeView={id => {
   *   const node = store.getNode(id)
   *   if (node?.type === 'chart-card') return <ChartCardView node={node} />
   *   return null
   * }}
   */
  renderCustomNodeView?: (id: NodeId) => ReactNode
  /** Extra content rendered inside the canvas absolute container. */
  children?: ReactNode
}

/**
 * Mounts the canvas surface (static + interactive layers + DOM overlay
 * for custom-node views + in-place editor mount). Owns the renderer
 * lifecycle, gesture hooks, resize observer.
 *
 * Use inside a {@link CanvasProvider} (or pass `store` directly).
 *
 * @example
 * function App() {
 *   const store = useRef(createCanvasStore()).current
 *   const [tool, setTool] = useState('select')
 *   return (
 *     <CanvasProvider store={store}>
 *       <Canvas
 *         tool={tool}
 *         onClick={e => console.log('click at', e.world)}
 *         onCreateDrag={e => {
 *           store.addNode({ id: asNodeId(store.generateId()), type: e.tool, ...e.rect, angle: 0, z: 0, groups: [] })
 *         }}
 *       />
 *       <Toolbar onSelect={setTool} />
 *     </CanvasProvider>
 *   )
 * }
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

/** Minimum pointer-drag (screen px) below which a drag-create falls
 *  through to `onClick`. Same heuristic tldraw uses. */
const DRAG_CREATE_MIN_SIZE_PX = 5

function CanvasSurface({
  tool,
  theme,
  editorAdapter,
  onRenderer,
  onClick,
  onDoubleClick,
  onCreateDrag,
  arrowDefaults,
  background,
  selectionColor,
  maxDpr,
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
  usePanZoom(wrapRef, store, tool)
  useInteractionGesture(wrapRef, store, tool as InteractionTool)
  const interactionMode = useInteractionMode()
  useArrowTool(wrapRef, store, tool === 'arrow', arrowDefaults)

  const { mountedIds, setMountedIds } = useOverlayHost()

  // Camera follows pan/zoom on the overlay div via a direct
  // style.transform write — keeps the React render tree out of the
  // hot path. Reconciling Canvas + OverlayItems on every pan was the
  // single largest per-frame cost at 3k+ nodes.
  useEffect(() => {
    const el = overlayRef.current
    if (!el) return
    const apply = (c: { x: number; y: number; z: number }) => {
      el.style.transform = `translate(${-c.x * c.z}px, ${-c.y * c.z}px) scale(${c.z})`
    }
    apply(store.getCamera())
    return store.subscribe('camera', apply)
  }, [store])

  // Renderer lifecycle. Creates on first mount + size>0; disposes on
  // unmount. `background` and `selectionColor` are intentionally
  // omitted from the dep array — their updates flow through the
  // separate setBackground / setSelectionColor effects below so the
  // renderer isn't torn down on every prop change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above
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
      background,
      selectionColor,
      maxDpr,
      onOverlayChange: ids => setMountedIds(ids),
    })
    r.start()
    rendererRef.current = r
    onRenderer?.(r)
    return () => {
      r.dispose()
      rendererRef.current = null
    }
    // `background` + `selectionColor` intentionally omitted — we
    // forward updates via the separate setBackground /
    // setSelectionColor effects below so the renderer isn't torn down
    // on every prop change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, theme, w, h, maxDpr, onRenderer, setMountedIds])

  // Forward background prop updates without re-creating the renderer.
  useEffect(() => {
    rendererRef.current?.setBackground(background)
  }, [background])

  // Forward selectionColor updates the same way — runtime swap, no rebuild.
  useEffect(() => {
    if (selectionColor !== undefined) rendererRef.current?.setSelectionColor(selectionColor)
  }, [selectionColor])

  // Surface-level click — fires for any unhandled click (gesture hooks
  // consume their own). Consumer uses this to implement shape-tool /
  // text-tool create.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const dispatch = (e: MouseEvent, cb: ((ev: CanvasPointerEvent) => void) | undefined): void => {
      if (!cb) return
      const rect = el.getBoundingClientRect()
      const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top }
      const world = screenToWorld(screen, store.getCamera())
      cb({ screen, world, tool: toolRef.current, native: e })
    }
    const onClickHandler = (e: MouseEvent) => dispatch(e, onClick)
    const onDoubleClickHandler = (e: MouseEvent) => {
      // Built-in: dbl-click a node body OR an edge label → beginEdit.
      // Consumer's onDoubleClick fires too if provided (e.g. for the
      // "dbl-click empty board to create a text node" pattern).
      if (toolRef.current === 'select') {
        const rect = el.getBoundingClientRect()
        const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top }
        const camera = store.getCamera()
        const world = screenToWorld(screen, camera)
        const hit = hitTestAny(store, world, camera.z)
        if (hit && hit.kind === 'body' && 'nodeId' in hit) {
          store.beginEdit(hit.nodeId)
        } else if (hit && hit.kind === 'body' && 'edgeId' in hit) {
          store.beginEdit(hit.edgeId)
        } else if (hit && hit.kind === 'label') {
          store.beginEdit(hit.edgeId)
        } else if (hit && hit.kind === 'midpoint-handle') {
          // Dbl-click the midpoint → restore auto-route.
          store.updateEdge(hit.edgeId, { control: undefined })
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

  // `justCommittedRef` lives at component scope (not inside the
  // gesture useEffect) so it survives effect remounts triggered by
  // any `onCreateDrag` reference change. Otherwise: a setState from
  // anywhere in the tree between pointerup and the synthetic click
  // would remount the effect, reset the flag, and let the click
  // through — producing a phantom tap-to-create node at the drop
  // point. See README / regression note (May 2026).
  const justCommittedRef = useRef(false)

  // Drag-to-create for non-select tools. tldraw/excalidraw style:
  // press at corner-A, drag to corner-B, release → shape sized to the
  // dragged rect. Sub-threshold drags fall through to onClick so a
  // tap still creates a default-size shape.
  useEffect(() => {
    const el = wrapRef.current
    if (!el || !onCreateDrag) return
    let startWorld: { x: number; y: number } | null = null
    let startScreen: { x: number; y: number } | null = null
    let activePointerId: number | null = null
    let committed = false

    const screenFromEvent = (e: PointerEvent): { x: number; y: number } => {
      const rect = el.getBoundingClientRect()
      return { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }
    const worldFromEvent = (e: PointerEvent): { x: number; y: number } =>
      screenToWorld(screenFromEvent(e), store.getCamera())

    const isShapeTool = (t: string): boolean => t !== 'select' && t !== 'arrow' && t !== 'text'

    const onPointerDown = (e: PointerEvent): void => {
      if (e.button !== 0) return
      if (!isShapeTool(toolRef.current)) return
      if (store.getInteractionState().mode === 'editing') return
      // Only engage on empty surface — clicks on existing nodes should
      // not initiate a create. Cheap broad-phase: hit-test the world point.
      const camera = store.getCamera()
      const world = screenToWorld(screenFromEvent(e), camera)
      if (hitTestAny(store, world, camera.z)) return

      startWorld = world
      startScreen = screenFromEvent(e)
      activePointerId = e.pointerId
      committed = false
      el.setPointerCapture(e.pointerId)
    }

    const onPointerMove = (e: PointerEvent): void => {
      if (startWorld === null || startScreen === null) return
      if (e.pointerId !== activePointerId) return
      const screen = screenFromEvent(e)
      const dx = screen.x - startScreen.x
      const dy = screen.y - startScreen.y
      if (
        !committed &&
        Math.abs(dx) < DRAG_CREATE_MIN_SIZE_PX &&
        Math.abs(dy) < DRAG_CREATE_MIN_SIZE_PX
      ) {
        return
      }
      // Cross the threshold → enter creating-shape mode + paint preview.
      if (!committed) committed = true
      const world = worldFromEvent(e)
      const rect = {
        x: Math.min(startWorld.x, world.x),
        y: Math.min(startWorld.y, world.y),
        w: Math.abs(world.x - startWorld.x),
        h: Math.abs(world.y - startWorld.y),
      }
      store.setInteractionState({
        mode: 'creating-shape',
        createDraftRect: rect,
        createTool: toolRef.current,
      })
    }

    const onPointerUp = (e: PointerEvent): void => {
      if (activePointerId !== e.pointerId) return
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
      const wasCommitted = committed
      activePointerId = null
      if (!wasCommitted || !startWorld) {
        startWorld = null
        startScreen = null
        return
      }
      const world = worldFromEvent(e)
      const rect = {
        x: Math.min(startWorld.x, world.x),
        y: Math.min(startWorld.y, world.y),
        w: Math.abs(world.x - startWorld.x),
        h: Math.abs(world.y - startWorld.y),
      }
      startWorld = null
      startScreen = null
      // Reset interaction state before firing the callback so consumer
      // sees an idle store.
      store.resetInteractionState()
      // Suppress the synthetic click that browsers fire after a successful drag.
      justCommittedRef.current = true
      setTimeout(() => {
        justCommittedRef.current = false
      }, 0)
      onCreateDrag({ rect, tool: toolRef.current, native: e })
    }

    const onClickCapture = (e: MouseEvent): void => {
      if (justCommittedRef.current) {
        e.stopPropagation()
        e.preventDefault()
      }
    }

    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', onPointerUp)
    el.addEventListener('pointercancel', onPointerUp)
    // Capture phase so we run BEFORE the click dispatcher.
    el.addEventListener('click', onClickCapture, true)
    return () => {
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', onPointerUp)
      el.removeEventListener('pointercancel', onPointerUp)
      el.removeEventListener('click', onClickCapture, true)
    }
  }, [store, onCreateDrag])

  // Cmd/Ctrl+C/X/V — copy/cut/paste. Skip when an input is focused so
  // the editor's native text-clipboard isn't hijacked.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) return
      const meta = e.metaKey || e.ctrlKey
      if (!meta) return
      if (e.key === 'c' || e.key === 'C') {
        e.preventDefault()
        void copy(store)
      } else if (e.key === 'x' || e.key === 'X') {
        e.preventDefault()
        void cut(store)
      } else if (e.key === 'v' || e.key === 'V') {
        e.preventDefault()
        void paste(store)
      } else if (e.key === ']') {
        // Cmd+] = bring forward; Cmd+Shift+] = bring to front.
        const selection = store.getSelection()
        if (selection.length === 0) return
        e.preventDefault()
        if (e.shiftKey) store.bringToFront(selection)
        else store.bringForward(selection)
      } else if (e.key === '[') {
        // Cmd+[ = send backward; Cmd+Shift+[ = send to back.
        const selection = store.getSelection()
        if (selection.length === 0) return
        e.preventDefault()
        if (e.shiftKey) store.sendToBack(selection)
        else store.sendBackward(selection)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [store])

  // Initial transform — subsequent updates are written directly to
  // overlayRef.current.style by the camera-subscription effect above.
  const initialCamera = store.getCamera()
  const overlayTransform = `translate(${-initialCamera.x * initialCamera.z}px, ${-initialCamera.y * initialCamera.z}px) scale(${initialCamera.z})`

  return (
    <div
      ref={wrapRef}
      data-canvas-host=""
      style={{
        position: 'absolute',
        inset: 0,
        background: '#f8fafc',
        overflow: 'hidden',
        cursor:
          tool === 'pan'
            ? interactionMode === 'panning'
              ? 'grabbing'
              : 'grab'
            : tool === 'select'
              ? 'default'
              : 'crosshair',
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
