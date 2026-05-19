import type { ClientId, EdgeId, NodeId, Vec2 } from '../types'

/**
 * Presence — see ARCHITECTURE.md §10.5.
 *
 * Per-client ephemeral state that's *synced* (unlike InteractionState,
 * which is local-only). Cursor position, selection, color, name, and
 * which node the user is currently editing.
 *
 * Presence is NOT in the op log; it never enters undo/redo or
 * `toJSON`. The SyncAdapter delivers presence patches alongside op
 * batches but on its own channel.
 */
export type PresenceState = {
  clientId: ClientId
  /** Cursor world position; null when the cursor has left the surface. */
  cursor: Vec2 | null
  /** Selected node + edge ids — surfaces to other clients for shared awareness. */
  selection: (NodeId | EdgeId)[]
  /** Node id currently being edited (Phase 7 edit-mode); null when idle. */
  editing: NodeId | null
  /** Display color (hex, e.g. '#ef4444') — used for remote cursors/outlines. */
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
