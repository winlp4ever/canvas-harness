import type { ClientId, PresenceState } from '@canvas-harness/core'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { useCanvasStore } from '../context'

/**
 * useLocalPresence — this client's presence (cursor / selection /
 * editing / color / name). Re-renders on any local presence change.
 */
export function useLocalPresence(): PresenceState {
  const store = useCanvasStore()
  return useSyncExternalStore(
    cb =>
      store.subscribe('presence', e => {
        if ('removed' in e && e.removed) return
        if (e.state.clientId === store.clientId) cb()
      }),
    () => store.presence.getLocal(),
  )
}

/**
 * usePresence(clientId) — one remote client's presence, or undefined
 * if they've left.
 */
export function usePresence(clientId: ClientId): PresenceState | undefined
/**
 * usePresence() — map of all remote clients' presence. Re-renders on
 * any remote presence change (join / leave / update).
 */
export function usePresence(): ReadonlyMap<ClientId, PresenceState>
export function usePresence(clientId?: ClientId): unknown {
  const store = useCanvasStore()
  // Map view — re-renders on every remote change. Fresh Map reference
  // each call, so we use state + effect (not useSyncExternalStore).
  const [, force] = useState(0)
  useEffect(() => {
    if (clientId !== undefined) return // single-client path below handles its own subscription
    return store.subscribe('presence', e => {
      if ('removed' in e && e.removed) return force(n => n + 1)
      if (e.state.clientId !== store.clientId) force(n => n + 1)
    })
  }, [store, clientId])

  // Single-client path — atom-like stable reference from the map.
  // We still need to re-render when this client's record changes.
  // Implementing via state for simplicity.
  const [snap, setSnap] = useState<PresenceState | undefined>(() =>
    clientId === undefined ? undefined : store.presence.get(clientId),
  )
  useEffect(() => {
    if (clientId === undefined) return
    return store.subscribe('presence', e => {
      if ('removed' in e && e.removed && e.clientId === clientId) setSnap(undefined)
      else if (!('removed' in e) && e.state.clientId === clientId) setSnap(e.state)
    })
  }, [store, clientId])

  if (clientId !== undefined) return snap
  return store.presence.getAll()
}
