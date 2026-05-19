import type { GroupId } from './primitives'

/**
 * Group metadata — see ARCHITECTURE.md §3.6.
 *
 * Membership is NOT stored here; each node/edge has its own `groups: GroupId[]`.
 * A Group is just optional name/color metadata for the id.
 */
export type Group = {
  id: GroupId
  name?: string
  color?: string
}
