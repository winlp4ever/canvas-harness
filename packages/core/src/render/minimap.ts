import { nodeAABB } from '../spatial'
import type { CanvasStore } from '../store'
import type { CameraState, WorldRect } from '../types'

/**
 * Minimap rendering — see IMPROVEMENTS.md (UX) and the React layer's
 * `<Minimap />` component.
 *
 * Splits into two paths consumers can compose independently:
 *
 *   - `renderMinimapContent(ctx, store, ...)` — paints every node as a
 *     plain `fillRect` at its scaled AABB. Edge bodies are skipped
 *     (not useful at this scale and would multiply cost). Run on
 *     committed scene change ONLY; cache the result as an
 *     OffscreenCanvas/HTMLCanvasElement and blit.
 *
 *   - `drawMinimapViewport(ctx, camera, sceneBounds, mapSize)` — paints
 *     a tiny rectangle showing the visible viewport. Cheap; run on
 *     every camera change.
 *
 * Cost model:
 *   - content render: O(N) — only fires on committed mutations.
 *   - viewport overlay: O(1) per frame.
 *
 * Hard cap (`maxNodes`) — above which the content render skips
 * entirely and the consumer is expected to show a "minimap disabled"
 * placeholder. Default 5000.
 */

export const DEFAULT_MINIMAP_MAX_NODES = 5000

export type MinimapContentOptions = {
  /** Hard upper bound on node count; above this, content is skipped. */
  maxNodes?: number
  /** Override fill color for nodes (used when node has no style.backgroundColor). */
  defaultNodeColor?: string
  /** Background color drawn first inside the minimap rect. */
  backgroundColor?: string
}

/**
 * Returns the world-space bounding rect that encloses every visible
 * node, or `null` if the scene is empty. Used to scale the minimap so
 * the entire scene fits inside it.
 */
export const sceneBounds = (store: CanvasStore): WorldRect | null => {
  const nodes = store.getAllNodes()
  if (nodes.length === 0) return null
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const n of nodes) {
    if (n.hidden) continue
    const r = nodeAABB(n)
    if (r.x < minX) minX = r.x
    if (r.y < minY) minY = r.y
    if (r.x + r.w > maxX) maxX = r.x + r.w
    if (r.y + r.h > maxY) maxY = r.y + r.h
  }
  if (!Number.isFinite(minX)) return null
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

/**
 * Paints the scene's nodes into the minimap canvas's logical pixel
 * space. Caller has already cleared the target. Returns true on
 * success, false when skipped (empty scene or over the node cap).
 */
export const renderMinimapContent = (
  ctx: CanvasRenderingContext2D,
  store: CanvasStore,
  mapWidth: number,
  mapHeight: number,
  opts: MinimapContentOptions = {},
): boolean => {
  const cap = opts.maxNodes ?? DEFAULT_MINIMAP_MAX_NODES
  const count = store.getNodeCount()
  if (count === 0 || count > cap) return false

  const bounds = sceneBounds(store)
  if (!bounds || bounds.w === 0 || bounds.h === 0) return false

  // Pad the bounds so shapes near the edges aren't clipped.
  const pad = Math.max(bounds.w, bounds.h) * 0.05
  const bx = bounds.x - pad
  const by = bounds.y - pad
  const bw = bounds.w + pad * 2
  const bh = bounds.h + pad * 2
  const scale = Math.min(mapWidth / bw, mapHeight / bh)
  // Center the scaled content in the map rect.
  const offX = (mapWidth - bw * scale) / 2
  const offY = (mapHeight - bh * scale) / 2

  if (opts.backgroundColor) {
    ctx.fillStyle = opts.backgroundColor
    ctx.fillRect(0, 0, mapWidth, mapHeight)
  }

  const defaultColor = opts.defaultNodeColor ?? '#94a3b8'
  for (const node of store.getAllNodes()) {
    if (node.hidden) continue
    const r = nodeAABB(node)
    const x = offX + (r.x - bx) * scale
    const y = offY + (r.y - by) * scale
    const w = Math.max(1, r.w * scale)
    const h = Math.max(1, r.h * scale)
    ctx.fillStyle = node.style?.backgroundColor ?? defaultColor
    ctx.fillRect(x, y, w, h)
  }
  return true
}

/**
 * Paints the camera viewport rectangle on top of the cached minimap
 * content. Cheap; consumers call this on every camera tick.
 *
 * `sceneRect` should be the same bounds used by `renderMinimapContent`
 * for the current cache. `viewportWorld` is the visible world rect
 * (caller derives from camera + screen size).
 */
export const drawMinimapViewport = (
  ctx: CanvasRenderingContext2D,
  viewportWorld: WorldRect,
  sceneRect: WorldRect,
  mapWidth: number,
  mapHeight: number,
  color = '#3b82f6',
): void => {
  // Same scaling math as renderMinimapContent — keeps the viewport
  // overlay perfectly registered with the cached content.
  const pad = Math.max(sceneRect.w, sceneRect.h) * 0.05
  const bx = sceneRect.x - pad
  const by = sceneRect.y - pad
  const bw = sceneRect.w + pad * 2
  const bh = sceneRect.h + pad * 2
  const scale = Math.min(mapWidth / bw, mapHeight / bh)
  const offX = (mapWidth - bw * scale) / 2
  const offY = (mapHeight - bh * scale) / 2

  const x = offX + (viewportWorld.x - bx) * scale
  const y = offY + (viewportWorld.y - by) * scale
  const w = viewportWorld.w * scale
  const h = viewportWorld.h * scale

  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 1.5
  ctx.strokeRect(x, y, w, h)
  ctx.restore()
}

/**
 * Inverse mapping for click-to-pan: a screen point inside the minimap
 * rect → the world point it corresponds to. Returns null when the
 * scene is empty (no bounds to scale against).
 */
export const minimapScreenToWorld = (
  store: CanvasStore,
  screenX: number,
  screenY: number,
  mapWidth: number,
  mapHeight: number,
): { x: number; y: number } | null => {
  const bounds = sceneBounds(store)
  if (!bounds || bounds.w === 0 || bounds.h === 0) return null
  const pad = Math.max(bounds.w, bounds.h) * 0.05
  const bx = bounds.x - pad
  const by = bounds.y - pad
  const bw = bounds.w + pad * 2
  const bh = bounds.h + pad * 2
  const scale = Math.min(mapWidth / bw, mapHeight / bh)
  const offX = (mapWidth - bw * scale) / 2
  const offY = (mapHeight - bh * scale) / 2
  return {
    x: (screenX - offX) / scale + bx,
    y: (screenY - offY) / scale + by,
  }
}

/**
 * World-space viewport rect from the camera + a screen size. Pass to
 * `drawMinimapViewport`. Caller's responsibility to supply the
 * canvas/CSS pixel dimensions.
 */
export const worldViewportFromCamera = (
  camera: CameraState,
  screenW: number,
  screenH: number,
): WorldRect => ({
  x: camera.x,
  y: camera.y,
  w: screenW / camera.z,
  h: screenH / camera.z,
})
