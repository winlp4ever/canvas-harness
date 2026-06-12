import { computeEdgeGeometry, drawEdge } from '../edges'
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
import type { NodeTypeDef, RenderEnv } from '../node-types'
import { inflateRect, nodeAABB } from '../spatial'
import { type CanvasStore, type InteractionState, isMoving as isMovingState } from '../store'
import {
  DEFAULT_HIGHLIGHT_COLOR,
  DEFAULT_TEXT_COLOR,
  FONT_FAMILY_MAP,
  FONT_SIZE_MAP,
  getOrRenderTextBitmap,
  subscribeFontEpoch,
  subscribeMathEpoch,
} from '../text'
import type { CameraState, CanvasBackground, Edge, EdgeId, Node, NodeId, WorldRect } from '../types'
import { type AssetCache, createAssetCache, paintIconNode, paintImageNode } from './assets'
import { paintBackground } from './background'
import { type CanvasSurface, clearSurface, setupSurface, sizeSurface } from './canvas-setup'
import { type FrameLoop, type FrameStats, createFrameLoop } from './frame-loop'
import {
  DEFAULT_SELECTION_COLOR,
  drawEdgeEndpointHandles,
  drawEdgeMidpointHandle,
  drawMarquee,
  drawResizeHandles,
  drawRotateHandle,
  drawSelectionOutline,
} from './overlay'
import { paintFrameNode } from './paint-frame'
import { ROUGH_MAX_NODES, ROUGH_MIN_ZOOM, drawCompositeRough, drawRoughShape } from './rough'
import {
  ROUGH_FILL_MISREGISTER_X,
  ROUGH_FILL_MISREGISTER_Y,
  ROUGH_MAX_MOVING_NODES,
} from './rough/constants'
import { getRoughCanvasCtor, onRoughReady } from './rough/loader'
import {
  type ThemeResolver,
  contentBounds,
  drawShape,
  isCompositePrimitive,
  isDrawablePrimitive,
} from './shapes'
import { applyCameraTransform, drawWithNodeTransform, worldViewport } from './transform'

/**
 * The static scene is rendered into an offscreen cache sized to the
 * viewport plus this margin (CSS px) on every side. The on-screen
 * canvas is presented from that cache: a sub-margin pan blits, a pan
 * past the margin shifts + repaints only the exposed strip, and only a
 * content/zoom change re-renders the whole scene. The margin is the
 * pan distance reused before a strip extend is needed. See
 * ARCHITECTURE.md §4.4.
 */
const SCENE_CACHE_MARGIN_PX = 256

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
   * Color for all selection chrome: selection outlines, resize +
   * rotate handles, edge endpoint + midpoint handles, marquee rect,
   * and the drag-create preview. Defaults to `#3b82f6` (the standard
   * canvas-app blue). Update at runtime via `Renderer.setSelectionColor`.
   *
   * Accepts any CSS color literal (hex, rgb(), named). The marquee
   * fill tints via globalAlpha — no parsing needed.
   */
  selectionColor?: string
  /**
   * Cap on the canvas backing-store DPR (device-pixel ratio). At
   * native DPR on hi-DPI displays, the backing buffer can hit
   * 20-30 megapixels per frame; the GPU-upload step alone dominates
   * the frame budget. Defaults to `1` for consistent perf across
   * hardware. Bump to `2` (or `window.devicePixelRatio`) for
   * pixel-crisp rendering at the cost of FPS on hi-DPI displays.
   *
   * Text is unaffected — the text bitmap cache renders glyphs at
   * its own DPR-aware scale.
   */
  maxDpr?: number
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
  /** Update the selection chrome color. Triggers an interactive repaint. */
  setSelectionColor(color: string): void
  /**
   * Toggle frame-node paint. Use during a presentation flow to drop
   * the slide border + label so only the frame contents are visible.
   * Triggers a static repaint.
   */
  setHideFrames(hidden: boolean): void
  /** Per-frame timing (FPS, lastMs, avgMs, frames). */
  stats(): FrameStats
  /** Number of items the most recent paint actually drew. */
  lastDrawCount(): number
  /** Current overlay-mounted custom-node ids. */
  getOverlaySet(): NodeId[]
  /**
   * Renderer-owned asset cache (decoded image bitmaps + rasterized
   * SVG icons). Pass to {@link exportSelection} / {@link exportViewport}
   * so PNG export paints image + icon nodes from the same bitmaps the
   * live canvas uses.
   */
  getAssetCache(): AssetCache
  /** Detach event listeners. The store is left untouched. */
  dispose(): void
}

export const createRenderer = (opts: RendererOptions): Renderer => {
  const { store, theme, onOverlayChange } = opts
  const maxDpr = opts.maxDpr
  const staticSurface = setupSurface(opts.staticCanvas, maxDpr)
  const interactiveSurface = setupSurface(opts.interactiveCanvas, maxDpr)
  let background: CanvasBackground | undefined = opts.background
  let selectionColor: string = opts.selectionColor ?? DEFAULT_SELECTION_COLOR
  let hideFrames = false
  sizeSurface(staticSurface, opts.width, opts.height, maxDpr)
  sizeSurface(interactiveSurface, opts.width, opts.height, maxDpr)

  let staticDirty = true
  let interactiveDirty = false
  /** Custom nodes whose React view is currently mounted in the overlay. */
  let overlaySet: ReadonlySet<NodeId> = new Set()
  let lastDrawn = 0

  // Offscreen scene cache (viewport + margin). Rendered by
  // `renderFullCache`, blitted to the on-screen static surface by
  // `presentStatic`. `cacheCam*` records the camera the cache is valid
  // for — used by the present blit to compute the source offset (and,
  // from Phase 2 on, to decide whether a re-render is needed at all).
  let cacheSurface: CanvasSurface | null = null
  let cacheCamX = 0
  let cacheCamY = 0
  let cacheCamZ = 1
  // True when the cache's *content* is stale (a scene/zoom/size change,
  // anything but a pure pan). Pan leaves it false so `paintStatic` can
  // present by blitting alone. `renderFullCache` clears it.
  let cacheStale = true

  /**
   * Lazily allocates / resizes the offscreen cache to `viewport + 2·margin`
   * at the static surface's DPR. The DPR is copied from `staticSurface`
   * (not recomputed from the cache's larger size) so the cache↔screen blit
   * stays a 1:1 device-pixel copy.
   */
  const ensureCacheSurface = (): CanvasSurface => {
    const dpr = staticSurface.dpr
    const cssW = staticSurface.cssWidth + 2 * SCENE_CACHE_MARGIN_PX
    const cssH = staticSurface.cssHeight + 2 * SCENE_CACHE_MARGIN_PX
    if (!cacheSurface) {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Canvas 2d context unavailable')
      cacheSurface = { canvas, ctx, cssWidth: 0, cssHeight: 0, dpr: 1 }
    }
    if (
      cacheSurface.cssWidth !== cssW ||
      cacheSurface.cssHeight !== cssH ||
      cacheSurface.dpr !== dpr
    ) {
      cacheSurface.cssWidth = cssW
      cacheSurface.cssHeight = cssH
      cacheSurface.dpr = dpr
      cacheSurface.canvas.width = Math.max(1, Math.round(cssW * dpr))
      cacheSurface.canvas.height = Math.max(1, Math.round(cssH * dpr))
    }
    return cacheSurface
  }

  // Sorted-by-(z, id) caches of ALL scene nodes / edges. Rebuilt
  // lazily on first access and invalidated on every `'change'` op.
  // Lets `visibleNodes` / `visibleEdges` skip per-frame Array.sort —
  // during pan, the scene doesn't mutate so these stay valid for the
  // whole gesture. At 10k nodes this saves ~1ms / frame.
  let sortedNodeIdsCache: NodeId[] | null = null
  let sortedEdgeIdsCache: EdgeId[] | null = null
  const invalidateSortedCaches = (): void => {
    sortedNodeIdsCache = null
    sortedEdgeIdsCache = null
  }

  // Asset cache for image + icon node types. The `onReady` hook fires
  // when a pending decode lands so the next frame blits the bitmap.
  // `loop` is created later in this scope, so we wrap the request in a
  // closure that resolves it at call time.
  const requestRepaint = (): void => {
    staticDirty = true
    cacheStale = true
    loop.requestFrame()
  }
  const assetCache = createAssetCache({ onReady: requestRepaint })

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

  /**
   * Paints the full static scene (background + frames + nodes + edges)
   * into `surface` in world coordinates. The caller is responsible for
   * having cleared the surface and applied the world→device transform;
   * `viewport` is the world rect to cull against (it may extend beyond
   * the on-screen viewport when painting into the oversized cache).
   */
  const paintSceneBody = (
    surface: CanvasSurface,
    camera: CameraState,
    viewport: WorldRect,
    // Strip renders (Phase 3 cache extension) paint only a sliver of
    // the scene, so they must NOT publish the draw count or the
    // React-overlay mount set — those describe the whole viewport and
    // are owned by full renders. Same contract as the blit-only path,
    // which doesn't run this body at all.
    fullRender = true,
  ): void => {
    const scale = camera.z * surface.dpr
    const interaction = store.getInteractionState()
    // Per ARCHITECTURE.md §4.2: nodes currently being dragged or resized,
    // AND edges incident to them, are excluded from static and drawn on
    // the interactive canvas at their uncommitted positions instead.
    const excludedNodes =
      interaction.mode === 'dragging' || interaction.mode === 'resizing'
        ? new Set(interaction.draggedIds)
        : null
    // An edge being mid-point-dragged is excluded too — the interactive
    // layer paints it with the in-progress control from `midpointDraft`.
    const baseExcludedEdges = excludedNodes ? incidentEdgeIds(excludedNodes) : null
    const midpointEdgeId = interaction.midpointDraft?.edgeId ?? null
    const excludedEdges: ReadonlySet<EdgeId> | null =
      midpointEdgeId !== null
        ? new Set<EdgeId>([...(baseExcludedEdges ?? []), midpointEdgeId])
        : baseExcludedEdges

    // ---- background (page color + dot/grid pattern) ----
    paintBackground(surface.ctx, { viewport, zoom: camera.z, background })

    // ---- nodes ----
    const visible = visibleNodes(camera, viewport)
    const isMoving = isMovingState(interaction)
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
    const cameraIsMoving = interaction.mode === 'panning' || interaction.mode === 'zooming'
    const movingNodeCount = excludedNodes?.size ?? 0
    const roughEnabled =
      !cameraIsMoving &&
      movingNodeCount <= ROUGH_MAX_MOVING_NODES &&
      camera.z >= ROUGH_MIN_ZOOM &&
      visible.length <= ROUGH_MAX_NODES

    // First pass: frames. They render behind everything else so the
    // slide chrome reads as a background region. The main loop below
    // skips `type === 'frame'`. `hideFrames` (set by a present-mode
    // flow) skips painting them entirely.
    if (!hideFrames) {
      for (const node of visible) {
        if (node.type !== 'frame') continue
        if (excludedNodes?.has(node.id)) continue
        drawWithNodeTransform(surface.ctx, node, () => {
          paintFrameNode(surface.ctx, node, scale, theme)
        })
        drawn++
      }
    }

    for (const node of visible) {
      if (node.type === 'frame') continue
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
        const composite = isCompositePrimitive(node.type)
        drawWithNodeTransform(surface.ctx, node, () => {
          if (useRough && roughReady) {
            if (composite) {
              // Composites paint each sub fully (misregistered fill +
              // rough stroke) before moving to the next sub. Crucial
              // so the back layer's stroke is covered by the front
              // layer's fill in the overlap region.
              drawCompositeRough(surface.ctx, node, camera.z, theme)
            } else {
              // Atomic: misregistered fill in one pass, rough stroke
              // in a second pass. Print-misregistration shifts fill
              // up-and-left a few pixels from the rough stroke. See
              // ROUGH_FILL_MISREGISTER_X/Y in rough/constants.
              surface.ctx.translate(ROUGH_FILL_MISREGISTER_X, ROUGH_FILL_MISREGISTER_Y)
              drawShape(surface.ctx, node, scale, theme, { skipStroke: true })
              surface.ctx.translate(-ROUGH_FILL_MISREGISTER_X, -ROUGH_FILL_MISREGISTER_Y)
              drawRoughShape(surface.ctx, node, camera.z, theme)
            }
          } else {
            // Plain fill + stroke at native origin — also the fallback
            // for the one frame before rough.js finishes loading.
            // Rough auto-disable during pan/zoom (via the interaction
            // mode propagation set up in `use-pan-zoom`) is what keeps
            // layered shapes smooth here; no special LOD fast-path
            // needed for composites at the count cap.
            drawShape(surface.ctx, node, scale, theme)
            if (useRough && !roughReady) {
              onRoughReady(() => {
                staticDirty = true
                cacheStale = true
                loop.requestFrame()
              })
            }
          }
          if (!isEditingThis) paintNodeContent(surface.ctx, node, renderEnv)
        })
        drawn++
        continue
      }
      // Image node: blit cached bitmap (or placeholder if still loading).
      if (node.type === 'image') {
        drawWithNodeTransform(surface.ctx, node, () => {
          paintImageNode(surface.ctx, node, assetCache, theme)
        })
        drawn++
        continue
      }
      // Icon node: rasterized SVG with optional `style.iconColor` tint.
      if (node.type === 'icon') {
        drawWithNodeTransform(surface.ctx, node, () => {
          paintIconNode(surface.ctx, node, assetCache, scale, theme)
        })
        drawn++
        continue
      }
      // Text-only shape: no fill/stroke, just content (or placeholder).
      if (node.type === 'text') {
        drawWithNodeTransform(surface.ctx, node, () => {
          if (isEditingThis) return
          const hasContent = node.content && node.content.trim().length > 0
          if (hasContent) {
            paintNodeContent(surface.ctx, node, renderEnv)
          } else {
            paintEmptyTextPlaceholder(surface.ctx, node, camera.z)
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
        if (paintCustomCanvasFallback(surface.ctx, node, def, scale, renderEnv)) {
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
        // Custom-node drawers get a save/restore scope: built-in
        // drawers honor the "set every state you depend on" contract
        // (see drawWithNodeTransform), but consumer code can't be
        // assumed to. Cost is one extra save/restore per visible
        // custom node — negligible since custom nodes are rare.
        drawWithNodeTransform(surface.ctx, node, () => {
          surface.ctx.save()
          def.renderCanvas!(surface.ctx, node, renderEnv)
          surface.ctx.restore()
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
      paintOneEdge(surface.ctx, edge, scale, edgeRoughEnabled, camera.z, isMoving)
      drawn++
    }
    if (!fullRender) return
    lastDrawn = drawn

    // Emit overlay event if the React-mount set changed.
    if (!setsEqual(nextOverlaySet, overlaySet)) {
      overlaySet = nextOverlaySet
      onOverlayChange?.([...overlaySet])
    }
  }

  /**
   * Renders the whole scene into the offscreen cache at `camera`, with a
   * margin offset so the cache covers the viewport inflated by
   * SCENE_CACHE_MARGIN_PX on every side. Records `cacheCam*` so a
   * subsequent `presentStatic` knows where the viewport sits inside it.
   */
  /**
   * Sets the cache's world→device transform centered on (`centerX`,
   * `centerY`) at zoom `z`, shifted by the margin so the world point at
   * screen (-margin, -margin) maps to cache device (0, 0).
   */
  const applyCacheTransform = (
    cache: CanvasSurface,
    centerX: number,
    centerY: number,
    z: number,
  ): void => {
    const s = z * cache.dpr
    const m = SCENE_CACHE_MARGIN_PX * cache.dpr
    cache.ctx.setTransform(s, 0, 0, s, -centerX * s + m, -centerY * s + m)
  }

  const renderFullCache = (camera: CameraState): void => {
    const cache = ensureCacheSurface()
    clearSurface(cache)
    applyCacheTransform(cache, camera.x, camera.y, camera.z)
    const marginWorld = SCENE_CACHE_MARGIN_PX / camera.z
    const viewport = inflateRect(worldViewport(staticSurface, camera), marginWorld)
    paintSceneBody(cache, camera, viewport)
    cacheCamX = camera.x
    cacheCamY = camera.y
    cacheCamZ = camera.z
    cacheStale = false
  }

  /**
   * True when a pan past the margin still overlaps the cache enough to
   * be worth extending (vs a full re-render). False on big jumps
   * (minimap click, programmatic teleport) where nothing can be reused.
   */
  const canExtend = (camera: CameraState): boolean => {
    if (!cacheSurface) return false
    const s = camera.z * staticSurface.dpr
    const dx = Math.abs((cacheCamX - camera.x) * s)
    const dy = Math.abs((cacheCamY - camera.y) * s)
    return dx < cacheSurface.canvas.width && dy < cacheSurface.canvas.height
  }

  /**
   * Repaints one device-space strip of the cache: clip + clear it, then
   * render the scene clipped to that strip under the cache transform
   * centered on (`centerX`, `centerY`).
   */
  const renderCacheStrip = (
    cache: CanvasSurface,
    centerX: number,
    centerY: number,
    z: number,
    px: number,
    py: number,
    pw: number,
    ph: number,
  ): void => {
    const ctx = cache.ctx
    const s = z * cache.dpr
    const m = SCENE_CACHE_MARGIN_PX * cache.dpr
    ctx.save()
    // Clip + clear in device space; the clip persists across setTransform.
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.beginPath()
    ctx.rect(px, py, pw, ph)
    ctx.clip()
    ctx.clearRect(px, py, pw, ph)
    applyCacheTransform(cache, centerX, centerY, z)
    // device → world for the strip rect (inverse of the cache transform).
    const viewport: WorldRect = {
      x: (px - m) / s + centerX,
      y: (py - m) / s + centerY,
      w: pw / s,
      h: ph / s,
    }
    paintSceneBody(cache, { x: centerX, y: centerY, z }, viewport, false)
    ctx.restore()
  }

  /**
   * Reuses the cache across a pan that left the margin: shifts the
   * existing pixels to recenter on `camera` (integer device-px copy, so
   * no resample / no accumulating blur), then repaints only the
   * L-shaped strip the shift exposed. Pre: cache valid, same zoom,
   * `canExtend(camera)` true.
   */
  const extendCache = (camera: CameraState): void => {
    const cache = ensureCacheSurface()
    const s = camera.z * cache.dpr
    const cacheW = cache.canvas.width
    const cacheH = cache.canvas.height
    // Integer device-px shift that recenters old content on `camera`,
    // and the exact world center that integer shift implies (keeps the
    // transform consistent with the rounded copy).
    const dx = Math.round((cacheCamX - camera.x) * s)
    const dy = Math.round((cacheCamY - camera.y) * s)
    const newCamX = cacheCamX - dx / s
    const newCamY = cacheCamY - dy / s

    // 1. Shift existing pixels. Self-copy is spec-safe (source snapshot).
    cache.ctx.setTransform(1, 0, 0, 1, 0, 0)
    cache.ctx.drawImage(cache.canvas, 0, 0, cacheW, cacheH, dx, dy, cacheW, cacheH)
    cacheCamX = newCamX
    cacheCamY = newCamY
    cacheCamZ = camera.z

    // 2. Repaint the vacated L-shape as two disjoint rects. Horizontal
    //    strip spans full height; vertical strip takes the remaining
    //    width so the corner is painted exactly once.
    const hw = Math.abs(dx)
    const vh = Math.abs(dy)
    const hx = dx > 0 ? 0 : cacheW - hw
    const vy = dy > 0 ? 0 : cacheH - vh
    const vx = dx > 0 ? hw : 0
    const vw = cacheW - hw
    if (hw > 0) renderCacheStrip(cache, newCamX, newCamY, camera.z, hx, 0, hw, cacheH)
    if (vh > 0 && vw > 0) renderCacheStrip(cache, newCamX, newCamY, camera.z, vx, vy, vw, vh)
  }

  /**
   * The viewport's top-left offset inside the cache, in cache device
   * pixels, given the pan since `cacheCam*`. Rounded so the present blit
   * and the fits-in-cache test agree on the same integer rect.
   */
  const cacheSourceOffset = (camera: CameraState): { x: number; y: number } => {
    const dpr = staticSurface.dpr
    return {
      x: Math.round(((camera.x - cacheCamX) * cacheCamZ + SCENE_CACHE_MARGIN_PX) * dpr),
      y: Math.round(((camera.y - cacheCamY) * cacheCamZ + SCENE_CACHE_MARGIN_PX) * dpr),
    }
  }

  /**
   * True when the current viewport lies entirely within the cached
   * region — i.e. the pan since the last full render stayed inside the
   * margin, so we can present by blitting alone.
   */
  const viewportFitsInCache = (camera: CameraState): boolean => {
    if (!cacheSurface) return false
    const { x, y } = cacheSourceOffset(camera)
    return (
      x >= 0 &&
      y >= 0 &&
      x + staticSurface.canvas.width <= cacheSurface.canvas.width &&
      y + staticSurface.canvas.height <= cacheSurface.canvas.height
    )
  }

  /**
   * Blits the viewport-sized sub-rect of the cache onto the on-screen
   * static surface. The source offset is the viewport's position inside
   * the cache, derived from the pan since `cacheCam*`.
   */
  const presentStatic = (camera: CameraState): void => {
    const cache = ensureCacheSurface()
    const w = staticSurface.canvas.width
    const h = staticSurface.canvas.height
    const { x: srcX, y: srcY } = cacheSourceOffset(camera)
    staticSurface.ctx.setTransform(1, 0, 0, 1, 0, 0)
    staticSurface.ctx.clearRect(0, 0, w, h)
    staticSurface.ctx.drawImage(cache.canvas, srcX, srcY, w, h, 0, 0, w, h)
  }

  /**
   * Static-layer paint entry point. Three tiers, cheapest first:
   *   1. cache valid + viewport inside the margin → blit only (Phase 2)
   *   2. cache valid + panned past the margin but still overlapping →
   *      shift + repaint the exposed strip, then blit (Phase 3)
   *   3. otherwise (stale content, zoom, big jump) → full re-render
   */
  const paintStatic = (): void => {
    const camera = store.getCamera()
    if (!cacheStale && camera.z === cacheCamZ) {
      if (viewportFitsInCache(camera)) {
        presentStatic(camera)
        return
      }
      if (canExtend(camera)) {
        extendCache(camera)
        presentStatic(camera)
        return
      }
    }
    renderFullCache(camera)
    presentStatic(camera)
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
      // Consumer-supplied drawer — wrap in save/restore so any state
      // it leaves behind doesn't bleed into the next node.
      drawWithNodeTransform(ctx, node, () => {
        ctx.save()
        def.drawPlaceholder!(ctx, node, env)
        ctx.restore()
      })
      return true
    }
    if (def.renderCanvas) {
      drawWithNodeTransform(ctx, node, () => {
        ctx.save()
        def.renderCanvas!(ctx, node, env)
        ctx.restore()
      })
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
    // Layout the text within the shape's visible interior (capsule's
    // rect body excluding the accent circle, diamond's inscribed rect,
    // ellipse's inscribed rect, thought-cloud's body below the dome,
    // tag's body past the notch). Rect/text fall through to full bbox.
    const bounds = contentBounds(node)
    if (bounds.w <= 0 || bounds.h <= 0) return
    const bitmap = getOrRenderTextBitmap({
      id: node.id,
      text: content,
      width: bounds.w,
      height: bounds.h,
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
    ctx.drawImage(bitmap.canvas, bounds.x, bounds.y, bounds.w, bounds.h)
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
    // Resolve the font *token* (e.g. 'handwriting') to its real CSS stack,
    // same as content paint — and default to 'handwriting' to match
    // paintNodeContent, so the placeholder uses the node's current font.
    ctx.font = `italic ${fontPx}px ${FONT_FAMILY_MAP[node.style?.fontFamily ?? 'handwriting']}`
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
    zoom: number,
    isMoving: boolean,
  ): void => {
    const geom = store.getEdgeGeometry(edge.id)
    if (!geom) return
    const sourceNode = geom.sourceNodeId ? (store.getNode(geom.sourceNodeId) ?? null) : null
    const targetNode = geom.targetNodeId ? (store.getNode(geom.targetNodeId) ?? null) : null
    drawEdge(ctx, edge, geom, sourceNode, targetNode, scale, theme, {
      roughEnabled,
      zoom,
      dpr: staticSurface.dpr,
      isMoving,
    })
  }

  const getSortedEdgeIds = (): EdgeId[] => {
    if (sortedEdgeIdsCache) return sortedEdgeIdsCache
    const all = store.getAllEdges()
    sortedEdgeIdsCache = all
      .slice()
      .sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : 1))
      .map(e => e.id)
    return sortedEdgeIdsCache
  }

  const visibleEdges = (viewport: WorldRect): Edge[] => {
    const ids = store.querySpatial({ rect: viewport }).edges as EdgeId[]
    if (ids.length === 0) return []
    const visibleSet = new Set<EdgeId>(ids)
    const sorted = getSortedEdgeIds()
    const result: Edge[] = []
    for (const id of sorted) {
      if (!visibleSet.has(id)) continue
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
        if (
          !isDrawablePrimitive(node.type) &&
          node.type !== 'text' &&
          node.type !== 'image' &&
          node.type !== 'icon' &&
          node.type !== 'frame'
        )
          continue
        drawWithNodeTransform(ctx, node, () => {
          if (node.type === 'frame') {
            paintFrameNode(ctx, node, scale, theme)
            return
          }
          if (node.type === 'image') {
            paintImageNode(ctx, node, assetCache, theme)
            return
          }
          if (node.type === 'icon') {
            paintIconNode(ctx, node, assetCache, scale, theme)
            return
          }
          if (isDrawablePrimitive(node.type)) {
            const useRough = dragRoughEnabled && (node.style?.roughness ?? 0) > 0
            const roughReady = useRough ? getRoughCanvasCtor() !== null : false
            if (useRough && roughReady) {
              if (isCompositePrimitive(node.type)) {
                drawCompositeRough(ctx, node, camera.z, theme)
              } else {
                ctx.translate(ROUGH_FILL_MISREGISTER_X, ROUGH_FILL_MISREGISTER_Y)
                drawShape(ctx, node, scale, theme, { skipStroke: true })
                ctx.translate(-ROUGH_FILL_MISREGISTER_X, -ROUGH_FILL_MISREGISTER_Y)
                drawRoughShape(ctx, node, camera.z, theme)
              }
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
          drawEdge(ctx, edge, geom, sourceNode, targetNode, scale, theme, {
            zoom: camera.z,
            dpr: interactiveSurface.dpr,
            isMoving: true,
          })
        }
      }
    }

    // 1b. Edge being mid-point-dragged. Excluded from the static layer
    //     via excludedEdges; painted here with the draft cubic controls.
    //     Bypasses the edge-geometry cache (keyed on edge.version, which
    //     doesn't bump during the gesture).
    if (interaction.midpointDraft) {
      const { edgeId, control } = interaction.midpointDraft
      const edge = store.getEdge(edgeId)
      if (edge) {
        const draftEdge: Edge = { ...edge, control }
        const geom = computeEdgeGeometry(draftEdge, id => store.getNode(id))
        if (geom) {
          const sourceNode = geom.sourceNodeId ? (store.getNode(geom.sourceNodeId) ?? null) : null
          const targetNode = geom.targetNodeId ? (store.getNode(geom.targetNodeId) ?? null) : null
          drawEdge(ctx, draftEdge, geom, sourceNode, targetNode, scale, theme, {
            zoom: camera.z,
            dpr: interactiveSurface.dpr,
            isMoving: true,
          })
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
        drawSelectionOutline(ctx, node, scale, selectionColor)
      }
      // Resize + rotate handles only for non-dragging selection. (During
      // a drag, the handles would jitter with the dragged geometry —
      // Excalidraw hides them mid-drag for the same reason.)
      if (interaction.mode !== 'dragging' && selectedNodeIds.length === 1) {
        const node = inDragMap.get(selectedNodeIds[0]!) ?? store.getNode(selectedNodeIds[0]!)
        if (node) {
          drawResizeHandles(ctx, node, scale, selectionColor)
          drawRotateHandle(ctx, node, scale, camera.z, selectionColor)
        }
      }
    }
    // Edge endpoint handles on selected edges.
    for (const id of selectedEdgeIds) {
      const geom = store.getEdgeGeometry(id)
      if (geom) {
        drawEdgeEndpointHandles(ctx, geom.source, geom.target, scale, selectionColor)
        // Midpoint handle — drag to reshape (Phase 12.6). Only on
        // bezier; polyline / straight don't have a meaningful curve to
        // sculpt with one drag point.
        const edge = store.getEdge(id)
        if (edge && edge.pathStyle === 'bezier') {
          const mid = getPointAndTangentAtArcLength(geom.samples, 0.5).point
          drawEdgeMidpointHandle(ctx, mid, scale, selectionColor)
        }
      }
    }

    // 3. Marquee rect.
    if (interaction.mode === 'marqueeing' && interaction.marqueeRect) {
      drawMarquee(ctx, interaction.marqueeRect, scale, selectionColor)
    }

    // 3.5 Drag-create preview — dashed outline matching the active
    // shape tool's intended footprint.
    if (interaction.mode === 'creating-shape' && interaction.createDraftRect) {
      drawMarquee(ctx, interaction.createDraftRect, scale, selectionColor)
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
        style: { strokeColor: selectionColor },
      }
      const geom = computeEdgeGeometry(draft, id => store.getNode(id))
      if (geom) {
        const sNode = geom.sourceNodeId ? (store.getNode(geom.sourceNodeId) ?? null) : null
        const tNode = geom.targetNodeId ? (store.getNode(geom.targetNodeId) ?? null) : null
        drawEdge(ctx, draft, geom, sNode, tNode, scale, theme, {
          zoom: camera.z,
          dpr: interactiveSurface.dpr,
          isMoving: true,
        })
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
        // Resize: the store still holds the original geometry until
        // pointer-up. Overlay the in-progress geometry from resizeDraft
        // so the interactive layer (and incident-edge re-routing
        // through this same map) paints the live shape.
        const d = interaction.resizeDraft
        if (d) {
          m.set(orig.id, { ...live, x: d.x, y: d.y, w: d.w, h: d.h, angle: d.angle })
        } else {
          m.set(orig.id, live)
        }
      }
    }
    return m
  }

  const getSortedNodeIds = (): NodeId[] => {
    if (sortedNodeIdsCache) return sortedNodeIdsCache
    const all = store.getAllNodes()
    sortedNodeIdsCache = all
      .slice()
      .sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : 1))
      .map(n => n.id)
    return sortedNodeIdsCache
  }

  const visibleNodes = (camera: CameraState, viewport: WorldRect): Node[] => {
    const ids = store.querySpatial({ rect: viewport }).nodes as NodeId[]
    if (ids.length === 0) return []
    // Build a Set of broad-phase-visible ids (the spatial query is
    // bucket-based, so this is a superset of the true visible set).
    const visibleSet = new Set<NodeId>(ids)
    // Walk the cached sorted list in order and emit those in the
    // visible set after the exact-AABB intersection check. No
    // per-frame Array.sort.
    const sorted = getSortedNodeIds()
    const result: Node[] = []
    const minWorldSize = MIN_ON_SCREEN_SIZE_PX / camera.z
    for (const id of sorted) {
      if (!visibleSet.has(id)) continue
      const n = store.getNode(id)
      if (!n) continue
      if (n.w < minWorldSize && n.h < minWorldSize) continue
      if (intersectsViewport(n, viewport)) result.push(n)
    }
    return result
  }

  const loop: FrameLoop = createFrameLoop({ draw: drawFrame })

  const onStoreChange = (): void => {
    // Any commit may have added / removed / re-z-ordered an entity,
    // so the sorted caches must rebuild on next paint. Camera /
    // selection / interaction events do NOT invalidate (z-order is
    // independent of viewport + selection state).
    invalidateSortedCaches()
    staticDirty = true
    cacheStale = true
    interactiveDirty = true
    loop.requestFrame()
  }
  // Camera is the one static-dirtying event that does NOT stale the
  // cache content: a pure pan reuses the cache (blit-only), and a zoom
  // is caught by the `z !== cacheCamZ` check in `paintStatic`.
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
    // Mode transitions that affect what the static surface paints:
    //   - dragging/resizing toggle the excluded set
    //   - rotating/panning/zooming flip motion-LOD on for layered
    //   - idle restores full-quality after any of the above
    // Any of these need a static repaint at the transition boundary
    // so the LOD changes (motion fast-path, rough auto-disable, text
    // bitmap downscale) take effect on the very next frame.
    if (
      state.mode === 'dragging' ||
      state.mode === 'resizing' ||
      state.mode === 'rotating' ||
      state.mode === 'panning' ||
      state.mode === 'zooming' ||
      state.mode === 'idle'
    ) {
      staticDirty = true
      // A mode transition changes the excluded set and/or motion-LOD,
      // so the cache content must be rebuilt. This also guarantees the
      // first frame of a pan does a full render — which is what swaps
      // custom-node React overlays to their canvas fallback.
      cacheStale = true
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
    cacheStale = true
    loop.requestFrame()
  })
  // Math formula compile → math-bearing bitmaps get a new cache key
  // via the math-epoch; repaint to pick up the real glyphs.
  const unsubMathEpoch = subscribeMathEpoch(() => {
    staticDirty = true
    cacheStale = true
    loop.requestFrame()
  })

  return {
    start() {
      loop.start()
      staticDirty = true
      cacheStale = true
      interactiveDirty = isInteractive(store.getInteractionState())
      loop.requestFrame()
    },
    stop() {
      loop.stop()
    },
    invalidate() {
      staticDirty = true
      cacheStale = true
      interactiveDirty = true
      loop.requestFrame()
    },
    setSize(cssW, cssH) {
      const a = sizeSurface(staticSurface, cssW, cssH, maxDpr)
      const b = sizeSurface(interactiveSurface, cssW, cssH, maxDpr)
      if (a || b) {
        staticDirty = true
        cacheStale = true
        interactiveDirty = true
        loop.requestFrame()
      }
    },
    setBackground(bg) {
      background = bg
      staticDirty = true
      cacheStale = true
      loop.requestFrame()
    },
    setSelectionColor(color) {
      selectionColor = color
      // Selection chrome lives on the interactive surface; static doesn't
      // need to repaint. The draft-edge stroke is also interactive-only.
      interactiveDirty = true
      loop.requestFrame()
    },
    setHideFrames(hidden) {
      hideFrames = hidden
      staticDirty = true
      cacheStale = true
      loop.requestFrame()
    },
    stats: () => loop.stats(),
    lastDrawCount: () => lastDrawn,
    getOverlaySet: () => [...overlaySet],
    getAssetCache: () => assetCache,
    dispose() {
      loop.stop()
      unsubChange()
      unsubCamera()
      unsubSelection()
      unsubInteraction()
      unsubFontEpoch()
      unsubMathEpoch()
      assetCache.dispose()
      if (cacheSurface) {
        // Drop the backing store so the GPU buffer is freed promptly.
        cacheSurface.canvas.width = 0
        cacheSurface.canvas.height = 0
        cacheSurface = null
      }
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
