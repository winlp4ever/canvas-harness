import {
  DEFAULT_MINIMAP_MAX_NODES,
  drawMinimapViewport,
  minimapScreenToWorld,
  renderMinimapContent,
  sceneBounds,
  worldViewportFromCamera,
} from '@canvas-harness/core'
import { type CSSProperties, useEffect, useRef, useState } from 'react'
import { useCanvasStore } from './context'

/**
 * Bird's-eye overview of the entire scene + a viewport rectangle
 * showing where the camera is. Click or drag inside to pan.
 *
 * Perf model — see IMPROVEMENTS.md and core/render/minimap.ts:
 *   - Scene content is rendered into an offscreen-canvas cache **once
 *     per committed batch** (`'change'` event). Cost: O(N) per
 *     commit, not per frame.
 *   - On camera changes (pan/zoom), only the viewport rectangle is
 *     redrawn over the cached image. Cost: O(1) per frame.
 *   - Above `maxNodes`, the content render is skipped and a small
 *     placeholder text is shown instead.
 *
 * @example
 * <Minimap width={200} height={150} position="bottom-right" />
 */
export type MinimapProps = {
  /** Map width in CSS px. Default 200. */
  width?: number
  /** Map height in CSS px. Default 150. */
  height?: number
  /** Above this many nodes, content render is skipped (placeholder
   *  shown instead). Default 5000. */
  maxNodes?: number
  /** Fixed-position corner shortcut. Use `style` for custom placement. */
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  /** Override container styles entirely (skip `position`). */
  style?: CSSProperties
  /** Color of the viewport rect overlay. Default brand blue. */
  viewportColor?: string
  /** Background color drawn behind the cached content + applied to the
   *  default container background. Default white. */
  backgroundColor?: string
  /** Container border color (the surrounding chip). Default light slate. */
  borderColor?: string
  /** Fallback node color when a node has no `style.backgroundColor`.
   *  Default neutral slate. */
  defaultNodeColor?: string
}

const POSITION_STYLES: Record<NonNullable<MinimapProps['position']>, CSSProperties> = {
  'top-left': { top: 12, left: 12 },
  'top-right': { top: 12, right: 12 },
  'bottom-left': { bottom: 12, left: 12 },
  'bottom-right': { bottom: 12, right: 12 },
}

export function Minimap({
  width = 200,
  height = 150,
  maxNodes = DEFAULT_MINIMAP_MAX_NODES,
  position = 'bottom-right',
  style,
  viewportColor = '#3b82f6',
  backgroundColor = '#ffffff',
  borderColor = '#cbd5e1',
  defaultNodeColor = '#94a3b8',
}: MinimapProps) {
  const store = useCanvasStore()
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cacheRef = useRef<HTMLCanvasElement | null>(null)
  const cachedBoundsRef = useRef<ReturnType<typeof sceneBounds>>(null)
  // Set on 'change' — repaint regenerates the cache the next tick.
  // Camera-only ticks reuse the cache (just blit + draw viewport).
  const dirtyRef = useRef(true)
  const rafRef = useRef(0)
  const [overCap, setOverCap] = useState(false)

  // Build the offscreen cache canvas once per size.
  useEffect(() => {
    const c = document.createElement('canvas')
    const dpr = window.devicePixelRatio || 1
    c.width = Math.ceil(width * dpr)
    c.height = Math.ceil(height * dpr)
    cacheRef.current = c
    dirtyRef.current = true
  }, [width, height])

  // Schedule a repaint (rAF-coalesced).
  const schedule = (): void => {
    if (rafRef.current !== 0) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0
      repaint()
    })
  }

  /**
   * Approach C — scene content cached on every committed mutation;
   * camera ticks reuse the cache + draw a fresh viewport rect on top.
   *
   *   - `dirty?` regen cache (O(N), once per `'change'` event) + blit.
   *   - `clean?` blit cache + draw viewport rect (O(1) per camera tick).
   *
   * Drops per-pan-frame work from ~0.5ms to ~0.02ms at 5k nodes. The
   * differentiator over react-flow's per-frame-O(N) approach.
   */
  const repaint = (): void => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1

    if (dirtyRef.current) {
      const cache = cacheRef.current
      if (cache) {
        const cctx = cache.getContext('2d')
        if (cctx) {
          cctx.setTransform(dpr, 0, 0, dpr, 0, 0)
          cctx.clearRect(0, 0, width, height)
          cctx.fillStyle = backgroundColor
          cctx.fillRect(0, 0, width, height)
          const ok = renderMinimapContent(cctx, store, width, height, {
            maxNodes,
            defaultNodeColor,
          })
          cachedBoundsRef.current = ok ? sceneBounds(store) : null
          setOverCap(!ok && store.getNodeCount() > maxNodes)
        }
      }
      dirtyRef.current = false
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    if (cacheRef.current) {
      // Cache canvas is dpr-sized in physical pixels; drawn at logical
      // (width × height) under the current dpr transform → 1:1 mapping.
      ctx.drawImage(cacheRef.current, 0, 0, width, height)
    } else {
      ctx.fillStyle = backgroundColor
      ctx.fillRect(0, 0, width, height)
    }

    const bounds = cachedBoundsRef.current
    if (bounds && bounds.w > 0 && bounds.h > 0) {
      const camera = store.getCamera()
      const wrap = containerRef.current?.closest<HTMLElement>('[data-canvas-host]')
      const screenW = wrap?.clientWidth ?? window.innerWidth
      const screenH = wrap?.clientHeight ?? window.innerHeight
      drawMinimapViewport(
        ctx,
        worldViewportFromCamera(camera, screenW, screenH),
        bounds,
        width,
        height,
        viewportColor,
      )
    }
  }

  // Subscribe to relevant store events.
  useEffect(() => {
    const onChange = (): void => {
      // Committed mutation — cache needs to regen on next tick.
      dirtyRef.current = true
      schedule()
    }
    const onCamera = (): void => {
      // Pan/zoom — cache is fine, just re-blit + redraw the viewport.
      schedule()
    }
    const unsubChange = store.subscribe('change', onChange)
    const unsubCamera = store.subscribe('camera', onCamera)
    // Initial paint.
    schedule()
    return () => {
      unsubChange()
      unsubCamera()
      if (rafRef.current !== 0) {
        cancelAnimationFrame(rafRef.current)
        // Must reset to 0; otherwise schedule() short-circuits on the
        // next mount thinking an rAF is still pending (it's not — we
        // just cancelled it). Surfaces under React StrictMode.
        rafRef.current = 0
      }
    }
    // schedule + repaint are stable; eslint can't see that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store])

  // Click + drag to pan the camera.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let dragging = false
    const move = (e: PointerEvent): void => {
      const rect = canvas.getBoundingClientRect()
      const worldCenter = minimapScreenToWorld(
        store,
        e.clientX - rect.left,
        e.clientY - rect.top,
        width,
        height,
      )
      if (!worldCenter) return
      const wrap = containerRef.current?.closest<HTMLElement>('[data-canvas-host]')
      const screenW = wrap?.clientWidth ?? window.innerWidth
      const screenH = wrap?.clientHeight ?? window.innerHeight
      const camera = store.getCamera()
      // Center the viewport on the clicked world point.
      store.setCamera({
        x: worldCenter.x - screenW / camera.z / 2,
        y: worldCenter.y - screenH / camera.z / 2,
      })
    }
    const down = (e: PointerEvent): void => {
      if (e.button !== 0) return
      dragging = true
      canvas.setPointerCapture(e.pointerId)
      move(e)
    }
    const drag = (e: PointerEvent): void => {
      if (!dragging) return
      move(e)
    }
    const up = (e: PointerEvent): void => {
      if (!dragging) return
      dragging = false
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId)
    }
    canvas.addEventListener('pointerdown', down)
    canvas.addEventListener('pointermove', drag)
    canvas.addEventListener('pointerup', up)
    canvas.addEventListener('pointercancel', up)
    return () => {
      canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('pointermove', drag)
      canvas.removeEventListener('pointerup', up)
      canvas.removeEventListener('pointercancel', up)
    }
  }, [store, width, height])

  // Default container styling — uses backgroundColor + borderColor
  // props. When the consumer passes a custom `style`, bg + border come
  // from there (escape hatch).
  const containerStyle: CSSProperties = style ?? {
    position: 'absolute',
    ...POSITION_STYLES[position],
    width,
    height,
    background: backgroundColor,
    border: `1px solid ${borderColor}`,
    borderRadius: 6,
    boxShadow: '0 1px 3px rgba(0,0,0,.08)',
    overflow: 'hidden',
    zIndex: 10,
  }

  return (
    <div ref={containerRef} style={containerStyle}>
      <canvas
        ref={canvasRef}
        width={Math.ceil(width * (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1))}
        height={Math.ceil(
          height * (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1),
        )}
        style={{ width, height, display: 'block', cursor: 'crosshair' }}
      />
      {overCap && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#64748b',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            fontSize: 11,
            textAlign: 'center',
            padding: 8,
            pointerEvents: 'none',
          }}
        >
          Minimap disabled
          <br />({store.getNodeCount()} &gt; {maxNodes})
        </div>
      )}
    </div>
  )
}
