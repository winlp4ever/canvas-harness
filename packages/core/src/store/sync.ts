import type { ClientId, OpBatch } from '../types'
import type { PresencePatch, PresenceState } from './presence'
import type { CanvasStore, Unsubscribe } from './types'

/**
 * SyncAdapter — see ARCHITECTURE.md §10.6.
 *
 * Pluggable transport contract for collab. The library never ships a
 * concrete adapter (transport is consumer territory: WebSocket, Yjs,
 * Automerge, BroadcastChannel, …). v1 ships:
 *
 *   - This interface
 *   - `attachSync(store, adapter)` — wires local commits → adapter and
 *     remote batches → store with `origin: 'remote'`
 *   - A separate package `@canvas-harness/sync-broadcast` providing a
 *     BroadcastChannel-backed adapter for single-machine demos
 *
 * **v1 sync is experimental.** Conflict semantics assume causally-ordered
 * op delivery from the adapter. Adapters without causal ordering must
 * advertise `capabilities.crdt: true` and own merge themselves.
 */
export type SyncAdapterCapabilities = {
  /**
   * Adapter guarantees ops arrive in the same causal order all clients
   * see. Required for the default LWW path.
   */
  causalOrdering?: boolean
  /**
   * Adapter merges via CRDT (Yjs / Automerge / ...). Skips library-side
   * LWW because the adapter has already resolved conflicts.
   */
  crdt?: boolean
}

/**
 * Pluggable collab transport. Implementations forward op batches +
 * presence patches between peers. The library is transport-agnostic;
 * see `@canvas-harness/sync-broadcast` for a reference adapter using
 * `BroadcastChannel`.
 *
 * Authors typically wrap a WebSocket / Yjs / Automerge instance.
 *
 * @example
 * const myAdapter: SyncAdapter = {
 *   capabilities: { causalOrdering: true },
 *   sendBatch: b => ws.send(JSON.stringify({ kind: 'op', batch: b })),
 *   sendPresence: p => ws.send(JSON.stringify({ kind: 'presence', patch: p })),
 *   onBatch(cb) {
 *     const h = (e: MessageEvent) => { const m = JSON.parse(e.data); if (m.kind === 'op') cb(m.batch) }
 *     ws.addEventListener('message', h)
 *     return () => ws.removeEventListener('message', h)
 *   },
 *   onPresence(cb) { … },
 *   destroy() { ws.close() },
 * }
 * const detach = attachSync(store, myAdapter)
 */
export type SyncAdapter = {
  capabilities: SyncAdapterCapabilities

  /** Send a locally-committed (or history) batch to peers. */
  sendBatch(batch: OpBatch): void
  /** Send a local presence patch to peers. */
  sendPresence(patch: PresencePatch): void

  /** Receive remote batches. Subscription persists until `destroy()`. */
  onBatch(cb: (batch: OpBatch) => void): Unsubscribe
  /**
   * Receive remote presence patches. `state === null` means the remote
   * client has left and should be removed from the presence map.
   */
  onPresence(cb: (clientId: ClientId, state: PresenceState | null) => void): Unsubscribe

  /** Optional teardown — closes sockets, clears buffers, etc. */
  destroy?(): void
}

/**
 * Wires a {@link SyncAdapter} to a {@link CanvasStore}. Returns a
 * `detach()` function that disconnects everything (including the
 * adapter's own `destroy()`).
 *
 * Throws if the adapter advertises neither `causalOrdering` nor
 * `crdt` — the default LWW path requires causal order.
 *
 * After attach:
 *   - Local + history batches forward to peers via `adapter.sendBatch`.
 *   - Local presence updates forward via `adapter.sendPresence`.
 *   - Remote batches apply to the store with `origin: 'remote'`
 *     (don't enter undo stack; conflict event fires on `prev` mismatch).
 *   - Remote presence updates merge into `store.presence`.
 *
 * @example
 * import { createBroadcastSyncAdapter } from '@canvas-harness/sync-broadcast'
 * const adapter = createBroadcastSyncAdapter({
 *   channelName: 'my-board',
 *   clientId: store.clientId,
 * })
 * const detach = attachSync(store, adapter)
 * // ...later, on unmount:
 * detach()
 */
export const attachSync = (store: CanvasStore, adapter: SyncAdapter): Unsubscribe => {
  if (!adapter.capabilities.causalOrdering && !adapter.capabilities.crdt) {
    throw new Error(
      'SyncAdapter must advertise capabilities.causalOrdering or capabilities.crdt. ' +
        'See ARCHITECTURE.md §10.6.',
    )
  }

  const unsubChange = store.subscribe('change', batch => {
    // Forward local mutations AND history batches (undo/redo). Remote
    // batches are echoes from peers and must not be re-broadcast.
    if (batch.origin !== 'remote') adapter.sendBatch(batch)
  })

  const unsubPresence = store.subscribe('presence', e => {
    if ('removed' in e && e.removed) return
    if (e.state.clientId !== store.clientId) return
    // Strip clientId from the patch — peers know who it's from from the channel.
    const { clientId: _id, ...patch } = e.state
    adapter.sendPresence(patch)
  })

  const unsubRemoteBatch = adapter.onBatch(batch => {
    // Bypass undo stack; apply with origin: 'remote' (origin is in the
    // batch itself for applyBatch). Conflict detection lives in
    // applyRemoteBatch (see conflict.ts).
    store.applyBatch({ ...batch, origin: 'remote' })
  })

  const unsubRemotePresence = adapter.onPresence((clientId, state) => {
    store.presence.applyRemote(clientId, state)
  })

  return () => {
    unsubChange()
    unsubPresence()
    unsubRemoteBatch()
    unsubRemotePresence()
    adapter.destroy?.()
  }
}
