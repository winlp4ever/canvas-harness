import { computeEdgeGeometry, drawEdge } from '../edges'
import { inflateRect, nodeAABB } from '../spatial'
import type { CanvasStore, InteractionState } from '../store'
import type { CameraState, Edge, EdgeId, Node, NodeId, WorldRect } from '../types'
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
import {
  drawEdgeEndpointHandles,
  drawMarquee,
  drawResizeHandles,
  drawSelectionOutline,
} from './overlay'
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

export type RendererOptions = {
  store: CanvasStore
  staticCanvas: HTMLCanvasElement
  interactiveCanvas: HTMLCanvasElement
  theme?: ThemeResolver
  /** Initial CSS-pixel size. Use `setSize()` to update on resize. */
  width: number
  height: number
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
  /** Per-frame timing (FPS, lastMs, avgMs, frames). */
  stats(): FrameStats
  /** Number of items the most recent paint actually drew. */
  lastDrawCount(): number
  /** Detach event listeners. The store is left untouched. */
  dispose(): void
}

export const createRenderer = (opts: RendererOptions): Renderer => {
  const { store, theme } = opts
  const staticSurface = setupSurface(opts.staticCanvas)
  const interactiveSurface = setupSurface(opts.interactiveCanvas)
  sizeSurface(staticSurface, opts.width, opts.height)
  sizeSurface(interactiveSurface, opts.width, opts.height)

  let staticDirty = true
  let interactiveDirty = false
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

    // ---- nodes ----
    const visible = visibleNodes(camera, viewport)
    let drawn = 0
    for (const node of visible) {
      if (!isDrawablePrimitive(node.type)) continue
      if (excludedNodes?.has(node.id)) continue
      drawWithNodeTransform(staticSurface.ctx, node, () => {
        drawShape(staticSurface.ctx, node, scale, theme)
      })
      drawn++
    }

    // ---- edges ----
    const visEdges = visibleEdges(viewport)
    for (const edge of visEdges) {
      if (excludedEdges?.has(edge.id)) continue
      paintOneEdge(staticSurface.ctx, edge, scale)
      drawn++
    }
    lastDrawn = drawn
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
   */
  const paintOneEdge = (ctx: CanvasRenderingContext2D, edge: Edge, scale: number): void => {
    const geom = store.getEdgeGeometry(edge.id)
    if (!geom) return
    const sourceNode = geom.sourceNodeId ? (store.getNode(geom.sourceNodeId) ?? null) : null
    const targetNode = geom.targetNodeId ? (store.getNode(geom.targetNodeId) ?? null) : null
    drawEdge(ctx, edge, geom, sourceNode, targetNode, scale, theme)
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
      for (const node of inDragMap.values()) {
        if (!isDrawablePrimitive(node.type)) continue
        drawWithNodeTransform(ctx, node, () => {
          drawShape(ctx, node, scale, theme)
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
      // Resize handles only for non-dragging selection. (During a drag, the
      // handles would jitter with the dragged geometry — Excalidraw hides
      // them mid-drag for the same reason.)
      if (interaction.mode !== 'dragging' && selectedNodeIds.length === 1) {
        const node = inDragMap.get(selectedNodeIds[0]!) ?? store.getNode(selectedNodeIds[0]!)
        if (node) drawResizeHandles(ctx, node, scale)
      }
    }
    // Edge endpoint handles on selected edges.
    for (const id of selectedEdgeIds) {
      const geom = store.getEdgeGeometry(id)
      if (geom) drawEdgeEndpointHandles(ctx, geom.source, geom.target, scale)
    }

    // 3. Marquee rect.
    if (interaction.mode === 'marqueeing' && interaction.marqueeRect) {
      drawMarquee(ctx, interaction.marqueeRect, scale)
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
    stats: () => loop.stats(),
    lastDrawCount: () => lastDrawn,
    dispose() {
      loop.stop()
      unsubChange()
      unsubCamera()
      unsubSelection()
      unsubInteraction()
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
