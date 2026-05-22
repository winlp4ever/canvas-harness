/**
 * Present-mode demo for the frames feature.
 *
 * Snapshots the frame list on enter, then zooms the camera to fit
 * each frame in turn. Frame chrome (border + label) is hidden via
 * `renderer.setHideFrames(true)` so only the contents show. Saved
 * camera is restored on exit.
 *
 * Keyboard: → / Space → next slide; ← → prev; Esc → exit.
 *
 * This is consumer code, not library code — the library only ships
 * the data (`store.getFrames()`) and the rendering knob
 * (`renderer.setHideFrames`). Everything else lives here.
 */
import type { CameraState, CanvasStore, Node, Renderer } from '@canvas-harness/core'
import { useCallback, useEffect, useRef, useState } from 'react'

/** Padding between the frame edge and the viewport edge, in screen pixels. */
const PRESENT_PADDING_PX = 32

const fitCameraToFrame = (
  viewportW: number,
  viewportH: number,
  frame: Node,
  paddingPx: number,
): CameraState => {
  const scaleX = (viewportW - paddingPx * 2) / Math.max(1, frame.w)
  const scaleY = (viewportH - paddingPx * 2) / Math.max(1, frame.h)
  const z = Math.min(scaleX, scaleY)
  // Center the frame in the viewport.
  const cx = frame.x - (viewportW - frame.w * z) / (2 * z)
  const cy = frame.y - (viewportH - frame.h * z) / (2 * z)
  return { x: cx, y: cy, z }
}

export function PresentMode({
  store,
  renderer,
}: {
  store: CanvasStore
  renderer: Renderer | null
}) {
  const [isPresenting, setIsPresenting] = useState(false)
  const [index, setIndex] = useState(0)
  // Frame list is snapshotted on enter — if the user edits mid-deck,
  // the slideshow keeps the original ordering until they exit + re-enter.
  const slidesRef = useRef<Node[]>([])
  const savedCameraRef = useRef<CameraState | null>(null)

  const fitToCurrent = useCallback(
    (i: number) => {
      const frame = slidesRef.current[i]
      if (!frame) return
      const cam = fitCameraToFrame(window.innerWidth, window.innerHeight, frame, PRESENT_PADDING_PX)
      store.setCamera(cam)
    },
    [store],
  )

  const enter = useCallback(() => {
    const frames = store.getFrames()
    if (frames.length === 0) return
    slidesRef.current = frames
    savedCameraRef.current = store.getCamera()
    setIndex(0)
    setIsPresenting(true)
    store.setSelection([])
    renderer?.setHideFrames(true)
    // Wait a tick so the renderer paints once with hideFrames=true
    // before we move the camera (avoids a one-frame flash of chrome).
    requestAnimationFrame(() => fitToCurrent(0))
  }, [store, renderer, fitToCurrent])

  const exit = useCallback(() => {
    if (!isPresenting) return
    setIsPresenting(false)
    renderer?.setHideFrames(false)
    if (savedCameraRef.current) store.setCamera(savedCameraRef.current)
  }, [isPresenting, store, renderer])

  const goto = useCallback(
    (next: number) => {
      const total = slidesRef.current.length
      if (total === 0) return
      const clamped = ((next % total) + total) % total
      setIndex(clamped)
      fitToCurrent(clamped)
    },
    [fitToCurrent],
  )

  // Keyboard nav while presenting.
  useEffect(() => {
    if (!isPresenting) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        exit()
      } else if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault()
        goto(index + 1)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        goto(index - 1)
      } else if (e.key === 'Home') {
        e.preventDefault()
        goto(0)
      } else if (e.key === 'End') {
        e.preventDefault()
        goto(slidesRef.current.length - 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isPresenting, index, goto, exit])

  // Refit on viewport resize so the slide stays centered.
  useEffect(() => {
    if (!isPresenting) return
    const onResize = () => fitToCurrent(index)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [isPresenting, index, fitToCurrent])

  if (!isPresenting) {
    return (
      <button
        type="button"
        onClick={enter}
        title="Present (fit camera to each frame in turn)"
        style={{
          position: 'absolute',
          bottom: 12,
          left: '50%',
          transform: 'translateX(-50%)',
          background: '#0f172a',
          color: '#fff',
          border: 'none',
          padding: '6px 14px',
          borderRadius: 6,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontSize: 13,
          fontWeight: 500,
          cursor: 'pointer',
          boxShadow: '0 1px 3px rgba(0,0,0,.08)',
          zIndex: 10,
        }}
      >
        ▶ Present
      </button>
    )
  }

  const total = slidesRef.current.length
  const current = slidesRef.current[index]
  const label = current?.content?.trim() || `Frame ${index + 1}`

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        background: 'rgba(15, 23, 42, 0.92)',
        color: '#fff',
        borderRadius: 999,
        padding: '6px 12px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 13,
        boxShadow: '0 4px 12px rgba(0,0,0,.18)',
        zIndex: 100,
      }}
    >
      <button
        type="button"
        onClick={() => goto(index - 1)}
        aria-label="Previous slide"
        style={navButtonStyle}
      >
        ←
      </button>
      <span style={{ minWidth: 120, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
        {label} · {index + 1} / {total}
      </span>
      <button
        type="button"
        onClick={() => goto(index + 1)}
        aria-label="Next slide"
        style={navButtonStyle}
      >
        →
      </button>
      <button
        type="button"
        onClick={exit}
        aria-label="Exit present mode (Esc)"
        style={{ ...navButtonStyle, marginLeft: 4 }}
      >
        ✕
      </button>
    </div>
  )
}

const navButtonStyle: React.CSSProperties = {
  background: 'rgba(255, 255, 255, 0.1)',
  color: '#fff',
  border: 'none',
  borderRadius: 999,
  width: 28,
  height: 28,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 14,
  cursor: 'pointer',
}
