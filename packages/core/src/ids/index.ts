/**
 * ID generation — see ARCHITECTURE.md §10.8.
 *
 * Default scheme: `${clientId}-${counter}`. Collision-free across clients
 * without coordination, human-readable in dev tools, monotonic per client.
 *
 * Consumers may override via `createCanvasStore({ idGenerator })`.
 */
import type { ClientId } from '../types'

export type IdGenerator = () => string

/**
 * Generates a random short client id like "u-7f3a".
 * Used when no `clientId` is passed and no `sync` adapter is attached.
 */
export const randomClientId = (): ClientId => {
  const hex = Math.floor(Math.random() * 0xffff)
    .toString(16)
    .padStart(4, '0')
  return `u-${hex}` as ClientId
}

/**
 * Builds an id generator that prefixes a stable client id with an
 * incrementing counter. Each call returns a fresh, never-recycled id.
 */
export const makeIdGenerator = (clientId: ClientId): IdGenerator => {
  let counter = 0
  return () => `${clientId}-${counter++}`
}
