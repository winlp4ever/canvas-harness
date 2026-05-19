import type {
  ClientId,
  OpBatch,
  PresencePatch,
  PresenceState,
  SyncAdapter,
  Unsubscribe,
} from '@canvas-harness/core'

/**
 * BroadcastChannel-backed SyncAdapter — see ARCHITECTURE.md §10.6.
 *
 * The simplest possible adapter: serializes op batches + presence
 * patches to JSON and broadcasts over the BroadcastChannel API. Same
 * machine, multiple tabs of the same origin. Good for demos + dev.
 *
 * Causal-ordering guarantee: BroadcastChannel within a single browser
 * process delivers messages in send order, so we can advertise
 * `capabilities.causalOrdering: true`. For cross-machine / cross-origin
 * collab use a real transport (WebSocket + sequenced server, Yjs, etc.).
 */

type Wire =
  | { kind: 'batch'; batch: OpBatch }
  | { kind: 'presence'; clientId: ClientId; state: PresenceState }
  | { kind: 'presence-leave'; clientId: ClientId }
  | { kind: 'hello'; clientId: ClientId }

export type BroadcastSyncOptions = {
  /** Channel name — peers join by sharing the same name. */
  channelName: string
  /** This client's id. Used to filter self-echoes + announce on attach. */
  clientId: ClientId
  /** Optional initial presence to broadcast on attach. */
  initialPresence?: PresenceState
}

export const createBroadcastSyncAdapter = ({
  channelName,
  clientId,
  initialPresence,
}: BroadcastSyncOptions): SyncAdapter => {
  if (typeof BroadcastChannel === 'undefined') {
    throw new Error('BroadcastChannel is not available in this environment.')
  }
  const channel = new BroadcastChannel(channelName)

  const batchListeners = new Set<(batch: OpBatch) => void>()
  const presenceListeners = new Set<
    (clientId: ClientId, state: PresenceState | null) => void
  >()
  // Latest presence per remote client. We keep a snapshot so when a new
  // peer announces 'hello' we can replay our own presence to them.
  let lastLocalPresence: PresenceState | undefined = initialPresence

  const post = (msg: Wire): void => {
    channel.postMessage(msg)
  }

  channel.addEventListener('message', e => {
    const msg = e.data as Wire
    // BroadcastChannel doesn't echo to the sender, but in case a future
    // transport changes that, defensively drop self-messages.
    if (msg.kind === 'batch') {
      if (msg.batch.clientId === clientId) return
      for (const cb of batchListeners) cb(msg.batch)
      return
    }
    if (msg.kind === 'presence') {
      if (msg.clientId === clientId) return
      for (const cb of presenceListeners) cb(msg.clientId, msg.state)
      return
    }
    if (msg.kind === 'presence-leave') {
      if (msg.clientId === clientId) return
      for (const cb of presenceListeners) cb(msg.clientId, null)
      return
    }
    if (msg.kind === 'hello' && msg.clientId !== clientId && lastLocalPresence) {
      // A new peer joined; replay our presence so they can paint our cursor.
      post({ kind: 'presence', clientId, state: lastLocalPresence })
    }
  })

  // Announce arrival so existing peers can replay their presence to us.
  post({ kind: 'hello', clientId })

  // Best-effort departure: BroadcastChannel doesn't have a leave event,
  // but pagehide is close enough for a demo.
  const onPageHide = (): void => {
    post({ kind: 'presence-leave', clientId })
  }
  if (typeof window !== 'undefined') window.addEventListener('pagehide', onPageHide)

  return {
    capabilities: { causalOrdering: true },

    sendBatch(batch: OpBatch) {
      post({ kind: 'batch', batch })
    },

    sendPresence(patch: PresencePatch) {
      const state: PresenceState = { ...(lastLocalPresence ?? ({} as PresenceState)), ...patch, clientId }
      lastLocalPresence = state
      post({ kind: 'presence', clientId, state })
    },

    onBatch(cb): Unsubscribe {
      batchListeners.add(cb)
      return () => {
        batchListeners.delete(cb)
      }
    },

    onPresence(cb): Unsubscribe {
      presenceListeners.add(cb)
      return () => {
        presenceListeners.delete(cb)
      }
    },

    destroy() {
      if (typeof window !== 'undefined') window.removeEventListener('pagehide', onPageHide)
      post({ kind: 'presence-leave', clientId })
      channel.close()
      batchListeners.clear()
      presenceListeners.clear()
    },
  }
}
