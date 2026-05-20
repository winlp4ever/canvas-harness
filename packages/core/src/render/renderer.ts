import { computeEdgeGeometry, drawEdge } from '../edges'
import type { NodeTypeDef, RenderEnv } from '../node-types'
import { inflateRect, nodeAABB } from '../spatial'
import type { CanvasStore, InteractionState } from '../store'
import {
  DEFAULT_HIGHLIGHT_COLOR,
  DEFAULT_TEXT_COLOR,
  FONT_SIZE_MAP,
  getOrRenderTextBitmap,
  subscribeFontEpoch,
} from '../text'
import type { CameraState, CanvasBackground, Edge, EdgeId, Node, NodeId, WorldRect } from '../types'
import { paintBackground } from './background'
import { clearSurface, setupSurface, sizeSurface } from './canvas-setup'
import { type FrameLoop, type FrameStats, createFrameLoop } from './frame-loop'
/**
 * Renderer — see ARCHITECTURE.md §4.
 *
 * Owns two canvases (static + interactive) and one DOM overlay div; reads
 * from a CanvasStore; redraws in response to store changes, camera changes,
 * interaction-state changes, and viewport resizes.
 *
 * static  — every committed primitive at its committed position. Redraws
 *           only when committed scene state, camera, or selection changes.
 * interactive — selection outlines, resize handles, marquee rect, and any
 *               shape currently being dragged at its uncommitted position.
 *               Redrawn every rAF tick while interaction.mode !== 'idle'.
 */
import { getPointAndTangentAtArcLength } from '../edges/arc-length'
import {
  drawEdgeEndpointHandles,
  drawEdgeMidpointHandle,
  drawMarquee,
  drawResizeHandles,
  drawRotateHandle,
  drawSelectionOutline,
} from './overlay'
import { ROUGH_MAX_NODES, ROUGH_MIN_ZOOM, drawRoughShape } from './rough'
import {
  ROUGH_FILL_MISREGISTER_X,
  ROUGH_FILL_MISREGISTER_Y,
  ROUGH_MAX_MOVING_NODES,
} from './rough/constants'
import { getRoughCanvasCtor, onRoughReady } from './rough/loader'
import { type ThemeResolver, drawShape, isDrawablePrimitive } from './shapes'
import { applyCameraTransform, drawWithNodeTransform, worldViewport } from './transform'

/** A small overscan keeps shapes near the viewport edge from popping. */
const VIEWPORT_OVERSCAN_PX = 64

/**
 * Minimum on-screen size (in logical CSS pixels) for a shape to be worth drawing.
 * Below this both dimensions, the shape can't be perceived anyway; skipping it
 * saves the entire path build + fill/stroke for that node.
 */
const MIN_ON_SCREEN_SIZE_PX = 1.5

/**
 * Minimum on-screen font size (in logical CSS pixels) for text to be worth
 * rasterizing. Below ~3px nothing is readable; skipping the bitmap lookup +
 * blit saves several μs/node and matters at extreme zoom-out with thousands
 * of content-bearing nodes visible.
 */
const MIN_READABLE_FONT_PX = 3

export type RendererOptions = {
  store: CanvasStore
  staticCanvas: HTMLCanvasElement
  interactiveCanvas: HTMLCanvasElement
  theme?: ThemeResolver
  /** Initial CSS-pixel size. Use `setSize()` to update on resize. */
  width: number
  height: number
  /**
   * Optional page background + dot/grid pattern. Local-only (not in
   * the synced scene). Update at runtime via `Renderer.setBackground`.
   */
  background?: CanvasBackground
  /**
   * Fires when the set of custom nodes that should be rendered in the DOM
   * overlay changes. Consumers use this to mount/unmount React subtrees
   * (or whatever framework). See ARCHITECTURE.md §5.2 lifecycle.
   *
   * The callback receives the FULL current set, not a delta — consumers
   * compute the mount/unmount diff themselves.
   */
  onOverlayChange?: (mountedIds: NodeId[]) => void
}

export type Renderer = {
  /** Begin the rAF loop. Idempotent. */
  start(): void
  /** Stop the rAF loop. Idempotent. */
  stop(): void
  /** Force a static repaint on the next rAF tick. */
  invalidate(): void
  /** Resize both canvases to a new CSS-pixel viewport. */
  setSize(cssW: number, cssH: number): void
  /** Update the page background / pattern. Triggers a static repaint. */
  setBackground(bg: CanvasBackground | undefined): void
  /** Per-frame timing (FPS, lastMs, avgMs, frames). */
  stats(): FrameStats
  /** Number of items the most recent paint actually drew. */
  lastDrawCount(): number
  /** Current overlay-mounted custom-node ids. */
  getOverlaySet(): NodeId[]
  /** Detach event listeners. The store is left untouched. */
  dispose(): void
}

export const createRenderer = (opts: RendererOptions): Renderer => {
  const { store, theme, onOverlayChange } = opts
  const staticSurface = setupSurface(opts.staticCanvas)
  const interactiveSurface = setupSurface(opts.interactiveCanvas)
  let background: CanvasBackground | undefined = opts.background
  sizeSurface(staticSurface, opts.width, opts.height)
  sizeSurface(interactiveSurface, opts.width, opts.height)

  let staticDirty = true
  let interactiveDirty = false
  /** Custom nodes whose React view is currently mounted in the overlay. */
  let overlaySet: ReadonlySet<NodeId> = new Set()
  let lastDrawn = 0

  const isInteractive = (state: InteractionState): boolean =>
    state.mode !== 'idle' || store.getSelection().length > 0

  const drawFrame = (): void => {
    if (staticDirty) {
      paintStatic()
      staticDirty = false
    }
    if (interactiveDirty) {
      paintInteractive()
      interactiveDirty = false
    }
  }

  const paintStatic = (): void => {
    const camera = store.getCamera()
    clearSurface(staticSurface)
    applyCameraTransform(staticSurface, camera)
    const scale = camera.z * staticSurface.dpr
    const interaction = store.getInteractionState()
    // Per ARCHITECTURE.md §4.2: nodes currently being dragged or resized,
    // AND edges incident to them, are excluded from static and drawn on
    // the interactive canvas at their uncommitted positions instead.
    const excludedNodes =
      interaction.mode === 'dragging' || interaction.mode === 'resizing'
        ? new Set(interaction.draggedIds)
        : null
    const excludedEdges = excludedNodes ? incidentEdgeIds(excludedNodes) : null
    const viewport = inflateRect(worldViewport(staticSurface, camera), VIEWPORT_OVERSCAN_PX)

    // ---- background (page color + dot/grid pattern) ----
    paintBackground(staticSurface.ctx, { viewport, zoom: camera.z, background })

    // ---- nodes ----
    const visible = visibleNodes(camera, viewport)
    const isMoving =
      interaction.mode === 'panning' ||
      interaction.mode === 'zooming' ||
      interaction.mode === 'dragging' ||
      interaction.mode === 'resizing' ||
      interaction.mode === 'rotating'
    const minOnScreen = MIN_ON_SCREEN_SIZE_PX
    const nextOverlaySet = new Set<NodeId>()
    let drawn = 0

    // Render env shared by built-in content rendering + custom-node dispatch.
    const renderEnv: RenderEnv = {
      zoom: camera.z,
      isMoving,
      isSelected: false,
      isHovered: false,
      isEditing: false,
      theme: token => (theme ? theme(token) : undefined),
    }
    const editingNodeId =
      interaction.editingTarget?.kind === 'node' ? interaction.editingTarget.id : null

    // Rough-stroke gate — paint the wobbly outline only when ALL hold:
    //   - pan/zoom is NOT in progress (whole viewport in motion would
    //     blow the frame budget),
    //   - any drag/resize/rotate affects <= ROUGH_MAX_MOVING_NODES (so a
    //     single-node drag keeps the rough look on its neighbours; a
    //     big marquee move falls back to plain),
    //   - zoom is high enough that the wobble is perceptible,
    //   - visible node count is below the cap.
    // Per-node `style.roughness > 0` is the final per-shape gate inside
    // `drawRoughShape`. When the gate is false, plain strokes only.
    const cameraIsMoving =
      interaction.mode === 'panning' || interaction.mode === 'zooming'
    const movingNodeCount = excludedNodes?.size ?? 0
    const roughEnabled =
      !cameraIsMoving &&
      movingNodeCount <= ROUGH_MAX_MOVING_NODES &&
      camera.z >= ROUGH_MIN_ZOOM &&
      visible.length <= ROUGH_MAX_NODES

    for (const node of visible) {
      if (excludedNodes?.has(node.id)) continue

      // The editing node's content is occluded by the textarea overlay —
      // skip its bitmap paint so the canvas underneath doesn't show stale
      // pixels through the textarea's translucent edges.
      const isEditingThis = editingNodeId === node.id

      // Built-in primitive path: shape paint + optional content paint.
      if (isDrawablePrimitive(node.type)) {
        const useRough = roughEnabled && (node.style?.roughness ?? 0) > 0
        // Peek (and trigger lazy import) — null means rough.js hasn't
        // resolved yet this session.
        const roughReady = useRough ? getRoughCanvasCtor() !== null : false
        drawWithNodeTransform(staticSurface.ctx, node, () => {
          if (useRough && roughReady) {
            // Print-misregistration: shift fill up-and-left a few pixels
            // so it sits offset from the rough stroke (which paints at
            // native origin). Mimics an old CMYK plate that didn't quite
            // line up. See ROUGH_FILL_MISREGISTER_X/Y in rough/constants.
            staticSurface.ctx.translate(ROUGH_FILL_MISREGISTER_X, ROUGH_FILL_MISREGISTER_Y)
            drawShape(staticSurface.ctx, node, scale, theme, { skipStroke: true })
            staticSurface.ctx.translate(-ROUGH_FILL_MISREGISTER_X, -ROUGH_FILL_MISREGISTER_Y)
            drawRoughShape(staticSurface.ctx, node, camera.z, theme)
          } else {
            // Plain fill + stroke at native origin — also the fallback
            // for the one frame before rough.js finishes loading.
            drawShape(staticSurface.ctx, node, scale, theme)
            if (useRough && !roughReady) {
              onRoughReady(() => {
                staticDirty = true
                loop.requestFrame()
              })
            }
          }
          if (!isEditingThis) paintNodeContent(staticSurface.ctx, node, renderEnv)
        })
        drawn++
        continue
      }
      // Text-only shape: no fill/stroke, just content (or placeholder).
      if (node.type === 'text') {
        drawWithNodeTransform(staticSurface.ctx, node, () => {
          if (isEditingThis) return
          const hasContent = node.content && node.content.trim().length > 0
          if (hasContent) {
            paintNodeContent(staticSurface.ctx, node, renderEnv)
          } else {
            paintEmptyTextPlaceholder(staticSurface.ctx, node, camera.z)
          }
        })
        drawn++
        continue
      }

      // Custom-node dispatch (§5.3 LOD ladder).
      const def = store.getNodeTypeDef(node.type)
      if (!def) continue
      // Sub-pixel skip — same threshold as built-ins.
      if (node.w * camera.z < minOnScreen && node.h * camera.z < minOnScreen) continue
      if (camera.z < def.lod.minZoomForPlaceholder) continue

      // Below the React threshold OR currently moving: prefer cheap canvas
      // paths. Order: getSnapshot → drawPlaceholder → renderCanvas → skip.
      const preferCanvas = camera.z < def.lod.minZoomForReact || isMoving
      if (preferCanvas) {
        if (paintCustomCanvasFallback(staticSurface.ctx, node, def, scale, renderEnv)) {
          drawn++
        }
        continue
      }

      // Full quality: prefer React overlay; else renderCanvas; else skip.
      if (def.view) {
        nextOverlaySet.add(node.id)
        continue
      }
      if (def.renderCanvas) {
        drawWithNodeTransform(staticSurface.ctx, node, () => {
          def.renderCanvas!(staticSurface.ctx, node, renderEnv)
        })
        drawn++
      }
    }

    // ---- edges ----
    const visEdges = visibleEdges(viewport)
    // Edges share the same gate as nodes — extra cap protects against
    // mass-labeled scenes where edge counts dominate the budget.
    const edgeRoughEnabled =
      !cameraIsMoving &&
      movingNodeCount <= ROUGH_MAX_MOVING_NODES &&
      camera.z >= ROUGH_MIN_ZOOM &&
      visEdges.length <= ROUGH_MAX_NODES
    for (const edge of visEdges) {
      if (excludedEdges?.has(edge.id)) continue
      paintOneEdge(staticSurface.ctx, edge, scale, edgeRoughEnabled)
      drawn++
    }
    lastDrawn = drawn

    // Emit overlay event if the React-mount set changed.
    if (!setsEqual(nextOverlaySet, overlaySet)) {
      overlaySet = nextOverlaySet
      onOverlayChange?.([...overlaySet])
    }
  }

  /**
   * Tries the cheap canvas paths in order; returns true if anything was
   * painted. Order: getSnapshot → drawPlaceholder → renderCanvas.
   * Async snapshot returns are treated as "no snapshot ready"; consumer's
   * own caching is responsible for the eventual blit.
   */
  const paintCustomCanvasFallback = (
    ctx: CanvasRenderingContext2D,
    node: Node,
    def: NodeTypeDef,
    drawScale: number,
    env: RenderEnv,
  ): boolean => {
    void drawScale
    if (def.getSnapshot) {
      const snap = def.getSnapshot(node, {
        width: node.w,
        height: node.h,
        dpr: staticSurface.dpr,
      })
      // Phase 5 ships sync-only snapshot handling; promise-returning
      // authors get a no-op until v2 adds the cache layer.
      if (snap && !(snap instanceof Promise)) {
        drawWithNodeTransform(ctx, node, () => {
          ctx.drawImage(snap as CanvasImageSource, 0, 0, node.w, node.h)
        })
        return true
      }
    }
    if (def.drawPlaceholder) {
      drawWithNodeTransform(ctx, node, () => def.drawPlaceholder!(ctx, node, env))
      return true
    }
    if (def.renderCanvas) {
      drawWithNodeTransform(ctx, node, () => def.renderCanvas!(ctx, node, env))
      return true
    }
    return false
  }

  /**
   * Paints node.content (lite markdown) via the bitmap cache. Caller is
   * already inside drawWithNodeTransform (origin at node's top-left,
   * rotation applied). No-op when content is empty.
   */
  const paintNodeContent = (ctx: CanvasRenderingContext2D, node: Node, env: RenderEnv): void => {
    const content = node.content
    if (!content || !content.trim()) return
    const style = node.style
    const fontSize = style?.fontSize ?? 'M'
    // Readability skip — text below ~3px on-screen is unreadable noise.
    // Bypasses cache lookup (FNV walk + concat) and the drawImage blit.
    if (FONT_SIZE_MAP[fontSize] * env.zoom < MIN_READABLE_FONT_PX) return
    const bitmap = getOrRenderTextBitmap({
      id: node.id,
      text: content,
      width: node.w,
      height: node.h,
      zoom: env.zoom,
      dpr: staticSurface.dpr,
      isMoving: env.isMoving,
      align: style?.textAlign ?? 'center',
      fontFamily: style?.fontFamily ?? 'handwriting',
      fontSize,
      textStyle: style?.textStyle ?? 'normal',
      textColor: style?.textColor ?? DEFAULT_TEXT_COLOR,
      highlightColor: DEFAULT_HIGHLIGHT_COLOR,
    })
    if (!bitmap) return
    ctx.drawImage(bitmap.canvas, 0, 0, node.w, node.h)
  }

  /**
   * Paints "Type to edit…" centered in a text-typed node that has no
   * content. Hidden during edit (the textarea covers the rect).
   */
  const paintEmptyTextPlaceholder = (
    ctx: CanvasRenderingContext2D,
    node: Node,
    zoom: number,
  ): void => {
    const fontSize = node.style?.fontSize ?? 'M'
    const fontPx = FONT_SIZE_MAP[fontSize]
    if (fontPx * zoom < MIN_READABLE_FONT_PX) return
    ctx.save()
    ctx.fillStyle = '#94a3b8'
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'center'
    ctx.font = `italic ${fontPx}px ${node.style?.fontFamily ?? 'sans-serif'}`
    ctx.fillText('Type to edit…', node.w / 2, node.h / 2)
    ctx.restore()
  }

  const setsEqual = (a: ReadonlySet<NodeId>, b: ReadonlySet<NodeId>): boolean => {
    if (a.size !== b.size) return false
    for (const v of a) if (!b.has(v)) return false
    return true
  }

  /**
   * Union of edge ids incident to any of the given node ids. Used by the
   * "exclude from static during drag" rule (§4.2). O(node count) via the
   * store's internal incidentEdges map.
   */
  const incidentEdgeIds = (nodeIds: ReadonlySet<NodeId>): ReadonlySet<EdgeId> => {
    const result = new Set<EdgeId>()
    for (const nid of nodeIds) {
      for (const eid of store.getIncidentEdges(nid)) result.add(eid)
    }
    return result
  }

  /**
   * Helper: paint a single edge using its cached geometry from the store.
   * `roughEnabled` mirrors the same gate used for nodes — caller threads it in.
   */
  const paintOneEdge = (
    ctx: CanvasRenderingContext2D,
    edge: Edge,
    scale: number,
    roughEnabled: boolean,
  ): void => {
    const geom = store.getEdgeGeometry(edge.id)
    if (!geom) return
    const sourceNode = geom.sourceNodeId ? (store.getNode(geom.sourceNodeId) ?? null) : null
    const targetNode = geom.targetNodeId ? (store.getNode(geom.targetNodeId) ?? null) : null
    drawEdge(ctx, edge, geom, sourceNode, targetNode, scale, theme, { roughEnabled })
  }

  const visibleEdges = (viewport: WorldRect): Edge[] => {
    const ids = store.querySpatial({ rect: viewport }).edges
    const result: Edge[] = []
    for (const id of ids as EdgeId[]) {
      const e = store.getEdge(id)
      if (e) result.push(e)
    }
    return result
  }

  const paintInteractive = (): void => {
    const camera = store.getCamera()
    clearSurface(interactiveSurface)
    applyCameraTransform(interactiveSurface, camera)
    const scale = camera.z * interactiveSurface.dpr
    const interaction = store.getInteractionState()
    const ctx = interactiveSurface.ctx

    // 1. Dragged / resizing nodes at their uncommitted positions.
    if (interaction.mode === 'dragging' || interaction.mode === 'resizing') {
      const inDragMap = mapDragPositions(interaction)
      const dragEnv: RenderEnv = {
        zoom: camera.z,
        isMoving: true,
        isSelected: true,
        isHovered: false,
        isEditing: false,
        theme: token => (theme ? theme(token) : undefined),
      }
      // Mirror the static-surface rough gate so the dragged node keeps
      // its hand-drawn look on small drags. Pan/zoom can't be active in
      // this branch (we're inside dragging/resizing), so the only knobs
      // are the moving-count cap and the zoom floor.
      const dragRoughEnabled =
        inDragMap.size <= ROUGH_MAX_MOVING_NODES && camera.z >= ROUGH_MIN_ZOOM
      for (const node of inDragMap.values()) {
        if (!isDrawablePrimitive(node.type) && node.type !== 'text') continue
        drawWithNodeTransform(ctx, node, () => {
          if (isDrawablePrimitive(node.type)) {
            const useRough = dragRoughEnabled && (node.style?.roughness ?? 0) > 0
            const roughReady = useRough ? getRoughCanvasCtor() !== null : false
            if (useRough && roughReady) {
              ctx.translate(ROUGH_FILL_MISREGISTER_X, ROUGH_FILL_MISREGISTER_Y)
              drawShape(ctx, node, scale, theme, { skipStroke: true })
              ctx.translate(-ROUGH_FILL_MISREGISTER_X, -ROUGH_FILL_MISREGISTER_Y)
              drawRoughShape(ctx, node, camera.z, theme)
            } else {
              drawShape(ctx, node, scale, theme)
            }
          }
          paintNodeContent(ctx, node, dragEnv)
        })
      }

      // Edges incident to a dragged node redraw with the offset applied.
      // We wrap getNode so endpoint projection sees the dragged position.
      const wrapGetNode = (id: NodeId): Node | undefined => inDragMap.get(id) ?? store.getNode(id)
      const drawnEdgeIds = new Set<EdgeId>()
      for (const nodeId of inDragMap.keys()) {
        for (const eid of store.getIncidentEdges(nodeId)) {
          if (drawnEdgeIds.has(eid)) continue
          drawnEdgeIds.add(eid)
          const edge = store.getEdge(eid)
          if (!edge) continue
          // Compute geometry directly — bypass the cache so we get the
          // uncommitted positions. Cheap; samples-per-frame is bounded
          // by drag size, not scene size.
          const geom = computeEdgeGeometry(edge, wrapGetNode)
          if (!geom) continue
          const sourceNode = geom.sourceNodeId ? (wrapGetNode(geom.sourceNodeId) ?? null) : null
          const targetNode = geom.targetNodeId ? (wrapGetNode(geom.targetNodeId) ?? null) : null
          drawEdge(ctx, edge, geom, sourceNode, targetNode, scale, theme)
        }
      }
    }

    // 2. Selection outlines + handles for selected nodes (uses current /
    //    in-progress geometry).
    const selection = store.getSelection()
    const selectedNodeIds: NodeId[] = []
    const selectedEdgeIds: EdgeId[] = []
    for (const id of selection) {
      if (store.getNode(id as NodeId)) selectedNodeIds.push(id as NodeId)
      else if (store.getEdge(id as EdgeId)) selectedEdgeIds.push(id as EdgeId)
    }
    if (selectedNodeIds.length > 0) {
      const inDragMap = mapDragPositions(interaction)
      for (const id of selectedNodeIds) {
        const node = inDragMap.get(id) ?? store.getNode(id)
        if (!node) continue
        drawSelectionOutline(ctx, node, scale)
      }
      // Resize + rotate handles only for non-dragging selection. (During
      // a drag, the handles would jitter with the dragged geometry —
      // Excalidraw hides them mid-drag for the same reason.)
      if (interaction.mode !== 'dragging' && selectedNodeIds.length === 1) {
        const node = inDragMap.get(selectedNodeIds[0]!) ?? store.getNode(selectedNodeIds[0]!)
        if (node) {
          drawResizeHandles(ctx, node, scale)
          drawRotateHandle(ctx, node, scale, camera.z)
        }
      }
    }
    // Edge endpoint handles on selected edges.
    for (const id of selectedEdgeIds) {
      const geom = store.getEdgeGeometry(id)
      if (geom) {
        drawEdgeEndpointHandles(ctx, geom.source, geom.target, scale)
        // Midpoint handle — drag to reshape (Phase 12.6). Only on
        // bezier; polyline / straight don't have a meaningful curve to
        // sculpt with one drag point.
        const edge = store.getEdge(id)
        if (edge && edge.pathStyle === 'bezier') {
          const mid = getPointAndTangentAtArcLength(geom.samples, 0.5).point
          drawEdgeMidpointHandle(ctx, mid, scale)
        }
      }
    }

    // 3. Marquee rect.
    if (interaction.mode === 'marqueeing' && interaction.marqueeRect) {
      drawMarquee(ctx, interaction.marqueeRect, scale)
    }

    // 3.5 Drag-create preview — dashed outline matching the active
    // shape tool's intended footprint.
    if (interaction.mode === 'creating-shape' && interaction.createDraftRect) {
      drawMarquee(ctx, interaction.createDraftRect, scale)
    }

    // 4. Draft edge during creation / reconnection.
    if (
      (interaction.mode === 'creating-edge' || interaction.mode === 'reconnecting-edge') &&
      interaction.draftEdge
    ) {
      const draft: Edge = {
        id: 'draft' as EdgeId,
        source: interaction.draftEdge.source,
        target: interaction.draftEdge.target,
        pathStyle: 'bezier',
        z: 0,
        groups: [],
        style: { strokeColor: '#3b82f6' },
      }
      const geom = computeEdgeGeometry(draft, id => store.getNode(id))
      if (geom) {
        const sNode = geom.sourceNodeId ? (store.getNode(geom.sourceNodeId) ?? null) : null
        const tNode = geom.targetNodeId ? (store.getNode(geom.targetNodeId) ?? null) : null
        drawEdge(ctx, draft, geom, sNode, tNode, scale, theme)
      }
    }
  }

  const mapDragPositions = (interaction: InteractionState): Map<NodeId, Node> => {
    const m = new Map<NodeId, Node>()
    if (interaction.mode !== 'dragging' && interaction.mode !== 'resizing') return m
    for (const orig of interaction.dragOriginals) {
      const live = store.getNode(orig.id)
      if (!live) continue
      if (interaction.mode === 'dragging') {
        m.set(orig.id, {
          ...live,
          x: orig.x + interaction.dragDelta.x,
          y: orig.y + interaction.dragDelta.y,
        })
      } else {
        m.set(orig.id, live)
      }
    }
    return m
  }

  const visibleNodes = (camera: CameraState, viewport: WorldRect): Node[] => {
    const ids = store.querySpatial({ rect: viewport }).nodes
    const result: Node[] = []
    const minWorldSize = MIN_ON_SCREEN_SIZE_PX / camera.z
    for (const id of ids as NodeId[]) {
      const n = store.getNode(id)
      if (!n) continue
      if (n.w < minWorldSize && n.h < minWorldSize) continue
      if (intersectsViewport(n, viewport)) result.push(n)
    }
    return result
  }

  const loop: FrameLoop = createFrameLoop({ draw: drawFrame })

  const onStoreChange = (): void => {
    staticDirty = true
    interactiveDirty = true
    loop.requestFrame()
  }
  const onCameraChange = (): void => {
    staticDirty = true
    interactiveDirty = true
    loop.requestFrame()
  }
  const onSelectionChange = (): void => {
    interactiveDirty = true
    loop.requestFrame()
  }
  const onInteractionChange = (state: InteractionState): void => {
    interactiveDirty = true
    // Drag-start / drag-end transitions toggle the excluded set, which
    // means static needs a repaint to add/remove the dragged shapes.
    if (state.mode === 'dragging' || state.mode === 'resizing' || state.mode === 'idle') {
      staticDirty = true
    }
    loop.requestFrame()
  }

  const unsubChange = store.subscribe('change', onStoreChange)
  const unsubCamera = store.subscribe('camera', onCameraChange)
  const unsubSelection = store.subscribe('selection', onSelectionChange)
  const unsubInteraction = store.subscribe('interaction', onInteractionChange)
  // Custom-font load → bitmap cache clears itself; we just need a repaint.
  const unsubFontEpoch = subscribeFontEpoch(() => {
    staticDirty = true
    loop.requestFrame()
  })

  return {
    start() {
      loop.start()
      staticDirty = true
      interactiveDirty = isInteractive(store.getInteractionState())
      loop.requestFrame()
    },
    stop() {
      loop.stop()
    },
    invalidate() {
      staticDirty = true
      interactiveDirty = true
      loop.requestFrame()
    },
    setSize(cssW, cssH) {
      const a = sizeSurface(staticSurface, cssW, cssH)
      const b = sizeSurface(interactiveSurface, cssW, cssH)
      if (a || b) {
        staticDirty = true
        interactiveDirty = true
        loop.requestFrame()
      }
    },
    setBackground(bg) {
      background = bg
      staticDirty = true
      loop.requestFrame()
    },
    stats: () => loop.stats(),
    lastDrawCount: () => lastDrawn,
    getOverlaySet: () => [...overlaySet],
    dispose() {
      loop.stop()
      unsubChange()
      unsubCamera()
      unsubSelection()
      unsubInteraction()
      unsubFontEpoch()
    },
  }
}

/**
 * Narrow-phase check: does the (rotation-aware) node AABB intersect the viewport?
 */
const intersectsViewport = (
  node: Node,
  viewport: { x: number; y: number; w: number; h: number },
) => {
  const a = nodeAABB(node)
  return (
    a.x < viewport.x + viewport.w &&
    a.x + a.w > viewport.x &&
    a.y < viewport.y + viewport.h &&
    a.y + a.h > viewport.y
  )
}
