import type { CanvasStore, ClientId, PresenceState } from '@canvas-harness/core'
import { useEffect, useRef, useState } from 'react'

/**
 * Phase 8 demo overlay: paints each remote client's cursor and selection
 * tag in their color so the user can see who else is in the room. Used
 * to validate the SyncAdapter wiring end-to-end with the
 * BroadcastChannel adapter.
 *
 * Updates the local cursor presence on mousemove (throttled to rAF) so
 * peers see this user's cursor too.
 *
 * Per-frame strategy: React re-renders only when the *set* of peers (or
 * their color/name) changes. Cursor positions are written directly to
 * the DOM via refs on every camera or presence event — sidesteps
 * reconciliation during pan, which fires this subscription at vsync.
 */
const peerListChanged = (a: PresenceState[], b: PresenceState[]): boolean => {
  if (a.length !== b.length) return true
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!
    const y = b[i]!
    if (x.clientId !== y.clientId || x.color !== y.color || x.name !== y.name) return true
  }
  return false
}

export function PresenceOverlay({ store }: { store: CanvasStore }) {
  const [remotes, setRemotes] = useState<PresenceState[]>([])
  const dotRefs = useRef(new Map<ClientId, HTMLDivElement>())

  useEffect(() => {
    const reposition = () => {
      const camera = store.getCamera()
      const presences = store.presence.getAll()
      for (const [id, el] of dotRefs.current) {
        const p = presences.get(id)
        if (!p?.cursor) {
          el.style.display = 'none'
          continue
        }
        el.style.display = 'flex'
        const x = (p.cursor.x - camera.x) * camera.z - 2
        const y = (p.cursor.y - camera.y) * camera.z - 2
        el.style.transform = `translate(${x}px, ${y}px)`
      }
    }
    const sync = () => {
      const latest = [...store.presence.getAll().values()]
      setRemotes(prev => (peerListChanged(prev, latest) ? latest : prev))
      reposition()
    }
    sync()
    const offPresence = store.subscribe('presence', sync)
    const offCamera = store.subscribe('camera', reposition)
    return () => {
      offPresence()
      offCamera()
    }
  }, [store])

  // Track local cursor → presence so peers see it. Throttle to rAF to
  // avoid spamming the broadcast channel on every mousemove.
  const rafScheduled = useRef(false)
  const pendingCursor = useRef<{ x: number; y: number } | null>(null)
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
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

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 15,
      }}
    >
      {remotes.map(p => (
        <div
          key={p.clientId}
          ref={el => {
            if (el) dotRefs.current.set(p.clientId, el)
            else dotRefs.current.delete(p.clientId)
          }}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            display: 'none',
            alignItems: 'flex-start',
            gap: 4,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            willChange: 'transform',
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
      ))}
    </div>
  )
}
