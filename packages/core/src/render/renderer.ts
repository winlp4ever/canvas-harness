import { inflateRect, nodeAABB } from '../spatial'
import type { CanvasStore, InteractionState } from '../store'
import type { CameraState, EdgeId, Node, NodeId } from '../types'
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
import { drawMarquee, drawResizeHandles, drawSelectionOutline } from './overlay'
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
    // Per ARCHITECTURE.md §4.2: nodes currently being dragged or resized are
    // excluded from static and drawn on interactive instead.
    const excluded =
      interaction.mode === 'dragging' || interaction.mode === 'resizing'
        ? new Set(interaction.draggedIds)
        : null
    const visible = visibleNodes(camera)
    let drawn = 0
    for (const node of visible) {
      if (!isDrawablePrimitive(node.type)) continue
      if (excluded?.has(node.id)) continue
      drawWithNodeTransform(staticSurface.ctx, node, () => {
        drawShape(staticSurface.ctx, node, scale, theme)
      })
      drawn++
    }
    lastDrawn = drawn
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
      const inDrag = computeDragPositions(interaction)
      for (const node of inDrag) {
        if (!isDrawablePrimitive(node.type)) continue
        drawWithNodeTransform(ctx, node, () => {
          drawShape(ctx, node, scale, theme)
        })
      }
    }

    // 2. Selection outlines + handles for selected nodes (uses current /
    //    in-progress geometry).
    const selectedIds = store.getSelection().filter(isNodeId)
    if (selectedIds.length > 0) {
      const inDragMap = mapDragPositions(interaction)
      for (const id of selectedIds) {
        const node = inDragMap.get(id) ?? store.getNode(id)
        if (!node) continue
        drawSelectionOutline(ctx, node, scale)
      }
      // Resize handles only for non-dragging selection. (During a drag, the
      // handles would jitter with the dragged geometry — Excalidraw hides
      // them mid-drag for the same reason.)
      if (interaction.mode !== 'dragging' && selectedIds.length === 1) {
        const node = inDragMap.get(selectedIds[0]!) ?? store.getNode(selectedIds[0]!)
        if (node) drawResizeHandles(ctx, node, scale)
      }
    }

    // 3. Marquee rect.
    if (interaction.mode === 'marqueeing' && interaction.marqueeRect) {
      drawMarquee(ctx, interaction.marqueeRect, scale)
    }
  }

  /**
   * Returns the current (offset-applied) Node values for the set of nodes
   * being dragged or resized. Allocates only when there's a drag in progress.
   */
  const computeDragPositions = (interaction: InteractionState): Node[] => {
    const result: Node[] = []
    if (interaction.mode === 'dragging') {
      const { dragDelta } = interaction
      for (const orig of interaction.dragOriginals) {
        const live = store.getNode(orig.id)
        if (!live) continue
        result.push({ ...live, x: orig.x + dragDelta.x, y: orig.y + dragDelta.y })
      }
    } else if (interaction.mode === 'resizing') {
      // Phase 3 ships dragDelta-driven resize for single-node selection;
      // multi-select resize uses the same originals and adds a scale factor
      // in the playground hook before setting dragDelta.
      for (const orig of interaction.dragOriginals) {
        const live = store.getNode(orig.id)
        if (!live) continue
        result.push(live)
      }
    }
    return result
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

  const visibleNodes = (camera: CameraState): Node[] => {
    const viewport = inflateRect(worldViewport(staticSurface, camera), VIEWPORT_OVERSCAN_PX)
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

/** Heuristic: NodeIds have no specific marker in the union — narrow by membership. */
const isNodeId = (id: NodeId | EdgeId): id is NodeId => {
  // Treat all selection ids as NodeIds for phase 3 (edges are phase 4).
  // Phase 4 will add edge-id detection via the store's lookup.
  void id
  return true
}
