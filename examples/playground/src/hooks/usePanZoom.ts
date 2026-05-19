import { type CanvasStore, clampZoom, panByScreen, zoomAtScreenPoint } from '@canvas-harness/core'
import { useEffect } from 'react'

/**
 * Wires up mouse-wheel zoom and middle-button / spacebar pan on a target element.
 *
 * Pointermove fires faster than the display refreshes (often 120-240Hz). Calling
 * store.setCamera on every event saturates the main thread at large scene sizes.
 * Instead we accumulate pending deltas and flush once per rAF, so the store sees
 * at most one camera update per frame regardless of input rate.
 *
 * Phase 2 interaction: just enough to navigate at scale. Drag-to-select etc.
 * arrive in phase 3.
 */
export const usePanZoom = (ref: React.RefObject<HTMLElement | null>, store: CanvasStore): void => {
  useEffect(() => {
    const el = ref.current
    if (!el) return

    let panning = false
    let panActivatedBySpace = false
    let lastX = 0
    let lastY = 0

    // Per-frame buffers — flushed in flushPending via rAF.
    let pendingDx = 0
    let pendingDy = 0
    let pendingZoomFactor = 1
    let pendingZoomAnchor: { x: number; y: number } | null = null
    let scheduled = false
    let rafId = 0

    const flushPending = (): void => {
      scheduled = false
      rafId = 0
      // Apply zoom first; pan applies on top of the new camera so order is intuitive.
      if (pendingZoomFactor !== 1 && pendingZoomAnchor) {
        const camera = store.getCamera()
        store.setCamera(
          zoomAtScreenPoint(camera, clampZoom(camera.z * pendingZoomFactor), pendingZoomAnchor),
        )
        pendingZoomFactor = 1
        pendingZoomAnchor = null
      }
      if (pendingDx !== 0 || pendingDy !== 0) {
        const camera = store.getCamera()
        store.setCamera(panByScreen(camera, { x: pendingDx, y: pendingDy }))
        pendingDx = 0
        pendingDy = 0
      }
    }

    const schedule = (): void => {
      if (scheduled) return
      scheduled = true
      rafId = requestAnimationFrame(flushPending)
    }

    const isEditing = (): boolean => store.getInteractionState().mode === 'editing'

    const onWheel = (e: WheelEvent) => {
      // Lock camera while editing — textarea overlay is positioned at a
      // fixed screen rect; letting the camera move would desync it.
      if (isEditing()) return
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) {
        // pinch-zoom signal (trackpads send wheel+ctrl)
        const factor = Math.exp(-e.deltaY * 0.01)
        pendingZoomFactor *= factor
        const rect = el.getBoundingClientRect()
        pendingZoomAnchor = { x: e.clientX - rect.left, y: e.clientY - rect.top }
      } else {
        pendingDx += -e.deltaX
        pendingDy += -e.deltaY
      }
      schedule()
    }

    const onPointerDown = (e: PointerEvent) => {
      if (isEditing()) return
      // middle button = pan; or left button while space held
      if (e.button === 1 || (e.button === 0 && panActivatedBySpace)) {
        panning = true
        lastX = e.clientX
        lastY = e.clientY
        el.setPointerCapture(e.pointerId)
        e.preventDefault()
      }
    }

    const onPointerMove = (e: PointerEvent) => {
      if (!panning) return
      const dx = e.clientX - lastX
      const dy = e.clientY - lastY
      lastX = e.clientX
      lastY = e.clientY
      pendingDx += dx
      pendingDy += dy
      schedule()
    }

    const onPointerUp = (e: PointerEvent) => {
      if (!panning) return
      panning = false
      el.releasePointerCapture(e.pointerId)
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') panActivatedBySpace = true
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') panActivatedBySpace = false
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', onPointerUp)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      if (rafId !== 0) cancelAnimationFrame(rafId)
    }
  }, [ref, store])
}
