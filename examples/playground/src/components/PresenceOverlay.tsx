import type { CanvasStore, PresenceState } from '@canvas-harness/core'
import { useEffect, useRef, useState } from 'react'

/**
 * Phase 8 demo overlay: paints each remote client's cursor and selection
 * tag in their color so the user can see who else is in the room. Used
 * to validate the SyncAdapter wiring end-to-end with the
 * BroadcastChannel adapter.
 *
 * Updates the local cursor presence on mousemove (throttled to rAF) so
 * peers see this user's cursor too.
 */
export function PresenceOverlay({ store }: { store: CanvasStore }) {
  const [remotes, setRemotes] = useState<PresenceState[]>([])

  useEffect(() => {
    const snapshot = () => setRemotes([...store.presence.getAll().values()])
    snapshot()
    return store.subscribe('presence', () => snapshot())
  }, [store])

  // Track local cursor → presence so peers see it. Throttle to rAF to
  // avoid spamming the broadcast channel on every mousemove.
  const rafScheduled = useRef(false)
  const pendingCursor = useRef<{ x: number; y: number } | null>(null)
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      // Convert screen → world via the current camera.
      const camera = store.getCamera()
      pendingCursor.current = {
        x: e.clientX / camera.z + camera.x,
        y: e.clientY / camera.z + camera.y,
      }
      if (rafScheduled.current) return
      rafScheduled.current = true
      requestAnimationFrame(() => {
        rafScheduled.current = false
        if (pendingCursor.current) store.presence.setLocal({ cursor: pendingCursor.current })
      })
    }
    const onLeave = () => store.presence.setLocal({ cursor: null })
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseleave', onLeave)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseleave', onLeave)
    }
  }, [store])

  // Re-render on camera change so the overlay tracks pan/zoom.
  const [, force] = useState(0)
  useEffect(() => store.subscribe('camera', () => force(n => n + 1)), [store])

  const camera = store.getCamera()
  const toScreen = (wx: number, wy: number) => ({
    x: (wx - camera.x) * camera.z,
    y: (wy - camera.y) * camera.z,
  })

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 15,
      }}
    >
      {remotes.map(p => {
        if (!p.cursor) return null
        const pt = toScreen(p.cursor.x, p.cursor.y)
        return (
          <div
            key={p.clientId}
            style={{
              position: 'absolute',
              left: pt.x,
              top: pt.y,
              transform: 'translate(-2px, -2px)',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 4,
              fontFamily: 'system-ui, -apple-system, sans-serif',
            }}
          >
            <div
              style={{
                width: 10,
                height: 10,
                background: p.color,
                borderRadius: '50%',
                border: '1px solid #fff',
                boxShadow: '0 0 0 1px rgba(0,0,0,0.12)',
              }}
            />
            <div
              style={{
                background: p.color,
                color: '#fff',
                padding: '2px 6px',
                borderRadius: 4,
                fontSize: 11,
                whiteSpace: 'nowrap',
              }}
            >
              {p.name || p.clientId.slice(0, 6)}
            </div>
          </div>
        )
      })}
    </div>
  )
}
