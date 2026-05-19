/**
 * Renderer — see ARCHITECTURE.md §4.
 *
 * Owns two canvases (static + interactive) and one DOM overlay div; reads
 * from a CanvasStore; redraws in response to store changes, camera changes,
 * and viewport resizes. Phase 2 ships static-only painting; interactive
 * stays empty until phase 3 (drag/select) and phase 4 (edge draw-in-progress).
 */
import { inflateRect, nodeAABB } from '../spatial'
import type { CanvasStore } from '../store'
import type { CameraState, Node, NodeId } from '../types'
import { clearSurface, setupSurface, sizeSurface } from './canvas-setup'
import { type FrameLoop, type FrameStats, createFrameLoop } from './frame-loop'
import { type ThemeResolver, drawShape, isDrawablePrimitive } from './shapes'
import { applyCameraTransform, drawWithNodeTransform, worldViewport } from './transform'

/** A small overscan keeps shapes near the viewport edge from popping. */
const VIEWPORT_OVERSCAN_PX = 64

/**
 * Minimum on-screen size (in logical CSS pixels) for a shape to be worth drawing.
 * Below this both dimensions, the shape can't be perceived anyway; skipping it
 * saves the entire path build + fill/stroke for that node. Single biggest win
 * for zoomed-out scenes with many shapes.
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
  let lastDrawn = 0

  const drawFrame = (): void => {
    if (!staticDirty) return
    paintStatic()
    staticDirty = false
  }

  const paintStatic = (): void => {
    const camera = store.getCamera()
    clearSurface(staticSurface)
    applyCameraTransform(staticSurface, camera)
    const visible = visibleNodes(camera)
    let drawn = 0
    for (const node of visible) {
      if (!isDrawablePrimitive(node.type)) continue
      drawWithNodeTransform(staticSurface.ctx, node, () => {
        drawShape(staticSurface.ctx, node, theme)
      })
      drawn++
    }
    lastDrawn = drawn
  }

  const visibleNodes = (camera: CameraState): Node[] => {
    const viewport = inflateRect(worldViewport(staticSurface, camera), VIEWPORT_OVERSCAN_PX)
    const ids = store.querySpatial({ rect: viewport }).nodes
    const result: Node[] = []
    // World size that maps to MIN_ON_SCREEN_SIZE_PX on screen at current zoom.
    // Smaller than this in BOTH dimensions → skip the draw entirely.
    const minWorldSize = MIN_ON_SCREEN_SIZE_PX / camera.z
    for (const id of ids as NodeId[]) {
      const n = store.getNode(id)
      if (!n) continue
      // Cheap zoom-aware LOD: skip shapes that would be sub-pixel on screen.
      if (n.w < minWorldSize && n.h < minWorldSize) continue
      // Narrow phase: confirm the rotated node AABB still intersects the
      // (overscanned) viewport — handles index stale-ness from coarse
      // updates without forcing a reindex on every camera change.
      if (intersectsViewport(n, viewport)) result.push(n)
    }
    return result
  }

  const loop: FrameLoop = createFrameLoop({ draw: drawFrame })

  const onStoreChange = (): void => {
    staticDirty = true
    loop.requestFrame()
  }
  const onCameraChange = (): void => {
    staticDirty = true
    loop.requestFrame()
  }

  const unsubChange = store.subscribe('change', onStoreChange)
  const unsubCamera = store.subscribe('camera', onCameraChange)

  return {
    start() {
      loop.start()
      staticDirty = true
      loop.requestFrame()
    },
    stop() {
      loop.stop()
    },
    invalidate() {
      staticDirty = true
      loop.requestFrame()
    },
    setSize(cssW, cssH) {
      const a = sizeSurface(staticSurface, cssW, cssH)
      const b = sizeSurface(interactiveSurface, cssW, cssH)
      if (a || b) {
        staticDirty = true
        loop.requestFrame()
      }
    },
    stats: () => loop.stats(),
    lastDrawCount: () => lastDrawn,
    dispose() {
      loop.stop()
      unsubChange()
      unsubCamera()
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
