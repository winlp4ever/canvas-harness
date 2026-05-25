/**
 * Custom node type definitions — see ARCHITECTURE.md §5.
 *
 * `defineNode` creates a registerable NodeTypeDef. The core doesn't know
 * about React; the `view` field is typed as `unknown` so the React layer
 * (or the playground for phase 5) can stash a component reference there
 * without coupling the core package to React.
 *
 * The library reads:
 *   - kind: 'canvas' | 'react' — which render path applies
 *   - renderCanvas / drawPlaceholder — canvas paint functions
 *   - getSnapshot — optional bitmap fallback for LOD / motion
 *   - hitTest / getOutline — interaction hooks
 *   - lod — zoom thresholds
 *   - lifecycle hooks
 *
 * Consumers register types via `createCanvasStore({ nodeTypes: [...] })`.
 */
import type { Node, Vec2 } from '../types'

export type RenderEnv = {
  zoom: number
  isMoving: boolean
  isSelected: boolean
  isHovered: boolean
  isEditing: boolean
  theme(token: string): string | number | undefined
}

export type SnapshotEnv = {
  width: number
  height: number
  dpr: number
}

export type NodeTypeDefOptions = {
  /** Unique type id, e.g. 'chart-card'. */
  type: string

  // ----- canvas paint paths (one of renderCanvas or react view required) -----
  /**
   * Canvas paint for the node body. Caller has already applied the
   * camera + node transform, so paint at `(0, 0, node.w, node.h)`.
   *
   * Context state contract:
   *   - The renderer wraps this call in `ctx.save()` / `ctx.restore()`
   *     so any state you change (fillStyle, strokeStyle, lineWidth,
   *     setLineDash, globalAlpha, font, …) is automatically rolled
   *     back before the next node draws — set whatever you need
   *     without worrying about cleanup.
   *   - Conversely, **do NOT assume default state on entry.** Always
   *     set the styles you depend on; the previous node's values
   *     may still be in effect.
   *   - The transform is NOT save/restore-protected at this level
   *     (it's managed one frame up by the renderer). Don't leave
   *     `translate` / `rotate` / `scale` calls un-paired.
   */
  renderCanvas?: (ctx: CanvasRenderingContext2D, node: Node, env: RenderEnv) => void
  /**
   * Low-zoom / motion fallback paint — see ARCHITECTURE.md §5.3 LOD.
   * Same context-state contract as `renderCanvas`.
   */
  drawPlaceholder?: (ctx: CanvasRenderingContext2D, node: Node, env: RenderEnv) => void

  // ----- React view (opaque to core; the React layer / playground knows what to do) -----
  /**
   * The React view component reference. Stored as `unknown` here because the
   * core package is framework-agnostic. The React layer reads this field
   * when it needs to mount a custom node in the DOM overlay.
   */
  view?: unknown

  // ----- LOD config (defaults applied in normalizeNodeTypeDef) -----
  lod?: {
    /** Below this zoom, prefer drawPlaceholder over the React view. Default 0.7. */
    minZoomForReact?: number
    /** Below this zoom, skip the node entirely. Default 0.3. */
    minZoomForPlaceholder?: number
    /** ms; default Infinity. After this age, the snapshot is regenerated. */
    snapshotMaxAge?: number
  }

  /**
   * Author-provided rasterized fallback. Library calls this when it needs a
   * fast paint (motion, low zoom) and uses `drawImage` to blit. Returns null
   * to fall back to `drawPlaceholder`.
   */
  getSnapshot?: (
    node: Node,
    env: SnapshotEnv,
  ) => CanvasImageSource | null | Promise<CanvasImageSource | null>

  // ----- behavior -----
  /**
   * Custom hit-test. Receives the world point pre-transformed into the node's
   * pre-rotation local frame, origin top-left. Default: AABB.
   */
  hitTest?: (node: Node, localPoint: Vec2) => boolean
  /**
   * Custom outline polygon (in node-local coords). Default: rect AABB.
   * Used by the edge auto-clip system when an edge attaches to this node.
   */
  getOutline?: (node: Node) => Vec2[] | null

  // ----- lifecycle -----
  /** Called when the node enters the viewport / mounts a live React view. */
  onEnter?: (node: Node) => void
  /** Called when the node exits the viewport / unmounts. */
  onExit?: (node: Node) => void
  /**
   * If true, the React view stays mounted (hidden via visibility:hidden) when
   * off-screen instead of unmounting. Use sparingly — defeats viewport culling.
   * Default false.
   */
  keepMounted?: boolean

  /** Validation / migration on scene load. */
  parse?: (raw: unknown) => Node['data']
  migrate?: (data: unknown, fromVersion: number) => Node['data']
}

/**
 * Normalized form of a node type definition. The `kind` field is derived
 * from which render paths are provided so the renderer dispatch is one
 * `switch` away.
 */
export type NodeTypeDef = NodeTypeDefOptions & {
  kind: 'canvas-only' | 'react-only' | 'mixed' | 'invalid'
  lod: {
    minZoomForReact: number
    minZoomForPlaceholder: number
    snapshotMaxAge: number
  }
}

const DEFAULT_LOD = {
  minZoomForReact: 0.7,
  minZoomForPlaceholder: 0.3,
  snapshotMaxAge: Number.POSITIVE_INFINITY,
} as const

/**
 * Defines a custom node type. Register the returned def via
 * `createCanvasStore({ nodeTypes: [myDef, ...] })`; then any `Node`
 * with `type === opts.type` will be dispatched to your renderers + hit
 * test + lifecycle hooks.
 *
 * A type must supply at least one render path: `renderCanvas` (paints
 * via the 2D context), `view` (React component reference — used by
 * `<Canvas renderCustomNodeView>`), or both (`mixed` — canvas at low
 * zoom, React at high zoom).
 *
 * @example
 * // Canvas-only — fastest path, paints with the 2D context.
 * export const sparklineDef = defineNode({
 *   type: 'sparkline',
 *   renderCanvas(ctx, node, env) {
 *     ctx.strokeStyle = env.theme('node.stroke') as string ?? '#000'
 *     // ...draw a sparkline...
 *   },
 *   hitTest: (node, p) => p.x >= 0 && p.x <= node.w && p.y >= 0 && p.y <= node.h,
 * })
 *
 * @example
 * // React view — full UI; library mounts it in the DOM overlay above
 * // the canvas at high zoom, falls back to drawPlaceholder below.
 * export const chartCardDef = defineNode({
 *   type: 'chart-card',
 *   view: ChartCardComponent,
 *   drawPlaceholder(ctx, node) {
 *     ctx.fillStyle = '#e0e7ff'
 *     ctx.fillRect(0, 0, node.w, node.h)
 *   },
 *   lod: { minZoomForReact: 0.7, minZoomForPlaceholder: 0.3 },
 * })
 */
export const defineNode = (opts: NodeTypeDefOptions): NodeTypeDef => {
  const hasCanvas = !!opts.renderCanvas
  const hasView = !!opts.view
  let kind: NodeTypeDef['kind']
  if (hasCanvas && hasView) kind = 'mixed'
  else if (hasCanvas) kind = 'canvas-only'
  else if (hasView) kind = 'react-only'
  else kind = 'invalid'

  return {
    ...opts,
    kind,
    lod: {
      minZoomForReact: opts.lod?.minZoomForReact ?? DEFAULT_LOD.minZoomForReact,
      minZoomForPlaceholder: opts.lod?.minZoomForPlaceholder ?? DEFAULT_LOD.minZoomForPlaceholder,
      snapshotMaxAge: opts.lod?.snapshotMaxAge ?? DEFAULT_LOD.snapshotMaxAge,
    },
  }
}
