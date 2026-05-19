import { type CanvasStore, clampZoom, panByScreen, zoomAtScreenPoint } from '@canvas-harness/core'
import { useEffect } from 'react'

/**
 * Wires up mouse-wheel zoom and middle-button / spacebar pan on a target element.
 * Updates the camera via store.setCamera; no local state.
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

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const camera = store.getCamera()
      if (e.ctrlKey || e.metaKey) {
        // pinch-zoom signal (trackpads send wheel+ctrl)
        const factor = Math.exp(-e.deltaY * 0.01)
        const rect = el.getBoundingClientRect()
        store.setCamera(
          zoomAtScreenPoint(camera, clampZoom(camera.z * factor), {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
          }),
        )
      } else {
        // wheel = pan
        store.setCamera(panByScreen(camera, { x: -e.deltaX, y: -e.deltaY }))
      }
    }

    const onPointerDown = (e: PointerEvent) => {
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
      store.setCamera(panByScreen(store.getCamera(), { x: dx, y: dy }))
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
    }
  }, [ref, store])
}
