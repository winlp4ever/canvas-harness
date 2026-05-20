import {
  type CanvasStore,
  clampZoom,
  createPalmRejectionState,
  notePenActive,
  notePenInactive,
  panByScreen,
  shouldRejectTouch,
  zoomAtScreenPoint,
} from '@canvas-harness/core'
import { useEffect } from 'react'

/**
 * Wires up wheel zoom, middle-button / spacebar pan, and (phase 11)
 * touch pinch-zoom + two-finger pan + pointer-type write-through.
 *
 * Pointermove fires faster than the display refreshes (often 120-240Hz).
 * Calling `store.setCamera` on every event saturates the main thread at
 * large scene sizes. Instead we accumulate pending deltas and flush
 * once per rAF, so the store sees at most one camera update per frame
 * regardless of input rate.
 *
 * Phase 11 additions:
 *   - Two simultaneous `pointerType: 'touch'` pointers → pinch zoom +
 *     two-finger pan (no wheel involved).
 *   - Pen pressure / pointerType written to `interaction.pointer` so
 *     consumers can read via `useCursor()`.
 *   - Palm rejection: touch events ignored while pen is active or for
 *     PALM_REJECTION_GRACE_MS after pen-up.
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

    // Mode-propagation: the canvas wraps every gesture in a `panning`
    // closure flag but never reflected it into the store's interaction
    // mode — which meant `isMoving` stayed false during pan/zoom and
    // none of the motion-LOD optimisations (rough auto-disable, text
    // bitmap downscale, layered fast-path) ever fired.
    //
    // Pointer-driven gestures have explicit start/end events. Wheel
    // events don't — so we keep a deadline and poll it from rAF.
    // (Original implementation used setTimeout per wheel event; on
    // Chrome that's ~5-10µs per clearTimeout+setTimeout pair from
    // timer-heap bookkeeping, which at 120Hz trackpad scroll added
    // ~1ms/frame measurable cost. rAF-poll runs at display rate
    // regardless of input rate — same correctness, ~zero overhead.)
    const MOTION_RESET_MS = 150
    let motionEndDeadline = 0
    let motionEndPolling = false
    const setMotion = (mode: 'panning' | 'zooming' | null): void => {
      const current = store.getInteractionState().mode
      if (mode === null) {
        if (current === 'panning' || current === 'zooming') {
          store.setInteractionState({ mode: 'idle' })
        }
        return
      }
      // Don't overwrite editing or any other deliberate mode.
      if (current !== 'idle' && current !== 'panning' && current !== 'zooming') return
      if (current !== mode) store.setInteractionState({ mode })
    }
    const pollMotionEnd = (): void => {
      if (performance.now() >= motionEndDeadline) {
        motionEndPolling = false
        setMotion(null)
        return
      }
      requestAnimationFrame(pollMotionEnd)
    }
    const pulseMotion = (mode: 'panning' | 'zooming'): void => {
      motionEndDeadline = performance.now() + MOTION_RESET_MS
      // Only fire `setMotion` (which can emit an interaction event)
      // when the mode actually needs to change. Guards inside
      // `setMotion` already do this, but checking here saves the
      // function call entirely for the 99% of wheel events where
      // we're already in the target mode.
      const current = store.getInteractionState().mode
      if (current !== mode) setMotion(mode)
      if (!motionEndPolling) {
        motionEndPolling = true
        requestAnimationFrame(pollMotionEnd)
      }
    }

    // Active touch pointers for pinch + two-finger pan. Keyed by
    // pointerId. Only `pointerType: 'touch'` participates here.
    type ActiveTouch = { id: number; x: number; y: number }
    const activeTouches = new Map<number, ActiveTouch>()
    let lastPinchDistance = 0
    let lastPinchMidpoint: { x: number; y: number } | null = null

    const palm = createPalmRejectionState()

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

    const screenFromClient = (clientX: number, clientY: number): { x: number; y: number } => {
      const rect = el.getBoundingClientRect()
      return { x: clientX - rect.left, y: clientY - rect.top }
    }

    const updatePointerInfo = (e: PointerEvent): void => {
      // Write pointer info to the store so `useCursor()` reads include
      // pointerType + pressure. Cheap — InteractionState is one atom.
      const { x: sx, y: sy } = screenFromClient(e.clientX, e.clientY)
      const camera = store.getCamera()
      store.setInteractionState({
        pointer: {
          worldX: sx / camera.z + camera.x,
          worldY: sy / camera.z + camera.y,
          screenX: sx,
          screenY: sy,
          pointerType: e.pointerType as 'mouse' | 'touch' | 'pen',
          pressure: e.pointerType === 'pen' ? e.pressure : undefined,
        },
      })
    }

    const onWheel = (e: WheelEvent) => {
      // Lock camera while editing — textarea overlay is positioned at a
      // fixed screen rect; letting the camera move would desync it.
      if (isEditing()) return
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) {
        // pinch-zoom signal (trackpads send wheel+ctrl)
        const factor = Math.exp(-e.deltaY * 0.01)
        pendingZoomFactor *= factor
        pendingZoomAnchor = screenFromClient(e.clientX, e.clientY)
        pulseMotion('zooming')
      } else {
        pendingDx += -e.deltaX
        pendingDy += -e.deltaY
        pulseMotion('panning')
      }
      schedule()
    }

    const resetPinchTracking = (): void => {
      lastPinchDistance = 0
      lastPinchMidpoint = null
    }

    const recomputePinchSeed = (): void => {
      // Recompute the seed (distance + midpoint) from the current two
      // touches. Called when entering pinch mode and whenever one of the
      // two touches changes identity (e.g. a third lifted, leaving two).
      const pts = [...activeTouches.values()]
      if (pts.length !== 2) {
        resetPinchTracking()
        return
      }
      const [a, b] = pts
      lastPinchDistance = Math.hypot(a!.x - b!.x, a!.y - b!.y)
      lastPinchMidpoint = { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 }
    }

    const onPointerDown = (e: PointerEvent) => {
      if (isEditing()) return

      if (e.pointerType === 'pen') {
        notePenActive(palm)
      } else if (e.pointerType === 'touch' && shouldRejectTouch(palm, Date.now())) {
        return
      }

      // Track touch pointers for pinch.
      if (e.pointerType === 'touch') {
        const pt = screenFromClient(e.clientX, e.clientY)
        activeTouches.set(e.pointerId, { id: e.pointerId, x: pt.x, y: pt.y })
        if (activeTouches.size === 2) {
          recomputePinchSeed()
          el.setPointerCapture(e.pointerId)
          setMotion('zooming')
          e.preventDefault()
        }
        return
      }

      // middle button = pan; or left button while space held
      if (e.button === 1 || (e.button === 0 && panActivatedBySpace)) {
        panning = true
        lastX = e.clientX
        lastY = e.clientY
        el.setPointerCapture(e.pointerId)
        setMotion('panning')
        e.preventDefault()
      }
    }

    const onPointerMove = (e: PointerEvent) => {
      updatePointerInfo(e)

      // Pinch path — two touches active.
      if (e.pointerType === 'touch' && activeTouches.has(e.pointerId)) {
        const pt = screenFromClient(e.clientX, e.clientY)
        activeTouches.set(e.pointerId, { id: e.pointerId, x: pt.x, y: pt.y })
        if (activeTouches.size === 2 && lastPinchMidpoint && lastPinchDistance > 0) {
          const pts = [...activeTouches.values()]
          const [a, b] = pts
          const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y)
          const mid = { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 }
          const factor = dist / lastPinchDistance
          if (Number.isFinite(factor) && factor > 0) {
            pendingZoomFactor *= factor
            pendingZoomAnchor = mid
          }
          pendingDx += mid.x - lastPinchMidpoint.x
          pendingDy += mid.y - lastPinchMidpoint.y
          lastPinchDistance = dist
          lastPinchMidpoint = mid
          schedule()
        }
        return
      }

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
      if (e.pointerType === 'pen') notePenInactive(palm, Date.now())

      if (e.pointerType === 'touch' && activeTouches.has(e.pointerId)) {
        activeTouches.delete(e.pointerId)
        if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
        // Dropped from 2 → 1: leave pinch mode but keep the remaining
        // touch as a no-op (the gesture hook handles single-touch).
        // Reseed in case three touches collapsed to two.
        if (activeTouches.size === 2) recomputePinchSeed()
        else {
          resetPinchTracking()
          setMotion(null)
        }
        return
      }

      if (!panning) return
      panning = false
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
      setMotion(null)
    }

    const onPointerCancel = (e: PointerEvent) => {
      // Browser canceled the gesture (e.g. user pulled-to-refresh). Clean up.
      if (e.pointerType === 'touch') {
        activeTouches.delete(e.pointerId)
        if (activeTouches.size < 2) {
          resetPinchTracking()
          setMotion(null)
        }
      }
      if (panning) {
        panning = false
        setMotion(null)
      }
      if (e.pointerType === 'pen') notePenInactive(palm, Date.now())
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
    el.addEventListener('pointercancel', onPointerCancel)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', onPointerUp)
      el.removeEventListener('pointercancel', onPointerCancel)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      // motion-end rAF poll exits on its own when motionEndPolling
      // becomes false; no explicit cancel needed.
      if (rafId !== 0) cancelAnimationFrame(rafId)
    }
  }, [ref, store])
}
