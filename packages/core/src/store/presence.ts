import type { ClientId, EdgeId, NodeId, Vec2 } from '../types'

/**
 * Per-client awareness state that other clients see in real time.
 * Synced over the {@link SyncAdapter}; never in the op log; never
 * persisted by `toJSON`.
 *
 * Set the local copy via `store.presence.setLocal({...})`. Read the
 * remote copy via `usePresence()` / `usePresence(clientId)` (React) or
 * `store.presence.get(...)` / `store.presence.getAll()`.
 */
export type PresenceState = {
  /** Stable id of the owning client. */
  clientId: ClientId
  /** Cursor world position; null when the cursor has left the surface. */
  cursor: Vec2 | null
  /** Ids the remote client has selected — for shared-awareness highlights. */
  selection: (NodeId | EdgeId)[]
  /** Node id the remote client is currently editing (or null). */
  editing: NodeId | null
  /** Display color (hex). Used for remote cursors + selection outlines. */
  color: string
  /** Display name. */
  name: string
}

export const emptyPresenceState = (clientId: ClientId): PresenceState => ({
  clientId,
  cursor: null,
  selection: [],
  editing: null,
  color: '#3b82f6',
  name: '',
})

export type PresencePatch = Partial<Omit<PresenceState, 'clientId'>>

/**
 * Returns true if any remote presence has this node currently open in
 * edit mode. Used to enforce the exclusive edit-lock when a SyncAdapter
 * is attached (see ARCHITECTURE.md §9 collab edit semantics).
 */
export const isNodeRemoteEditing = (
  remote: ReadonlyMap<ClientId, PresenceState>,
  nodeId: NodeId,
): boolean => {
  for (const p of remote.values()) {
    if (p.editing === nodeId) return true
  }
  return false
}
