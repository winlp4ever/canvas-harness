import type { Edge, Node, Op, OpBatch } from '../types'

/**
 * LWW conflict detection — see ARCHITECTURE.md §10.6.
 *
 * For remote `node.update` / `edge.update` ops, the `prev` slice
 * captures what the *remote* client thought the value was before its
 * change. If our local current value differs, two clients touched the
 * same field concurrently: LWW says higher `batch.ts` wins (we still
 * apply the remote op), but we surface a 'conflict' event for
 * telemetry / consumer UX (e.g. "your background color was just
 * overwritten by Alice").
 */
export type ConflictRecord = { op: Op; field: string }

export type GetCurrentNode = (id: Node['id']) => Node | undefined
export type GetCurrentEdge = (id: Edge['id']) => Edge | undefined

/**
 * Walks a remote OpBatch and returns the set of `(op, field)` pairs
 * where the local current value disagrees with the op's `prev` slice.
 * No state is mutated.
 */
export const detectConflicts = (
  batch: OpBatch,
  getNode: GetCurrentNode,
  getEdge: GetCurrentEdge,
): ConflictRecord[] => {
  const out: ConflictRecord[] = []
  for (const op of batch.ops) {
    if (op.type === 'node.update') {
      const current = getNode(op.id)
      if (!current) continue
      for (const key of Object.keys(op.prev) as (keyof Node)[]) {
        if (!sameValue(current[key], op.prev[key])) {
          out.push({ op, field: String(key) })
        }
      }
      continue
    }
    if (op.type === 'edge.update') {
      const current = getEdge(op.id)
      if (!current) continue
      for (const key of Object.keys(op.prev) as (keyof Edge)[]) {
        if (!sameValue(current[key], op.prev[key])) {
          out.push({ op, field: String(key) })
        }
      }
    }
  }
  return out
}

/**
 * Field-equality used by the conflict check. Numbers / strings /
 * booleans by value; objects by JSON.stringify (small / bounded data).
 */
const sameValue = (a: unknown, b: unknown): boolean => {
  if (a === b) return true
  // null and undefined are equivalent for our wire/diff purposes —
  // they both mean "field unset" to the render and hit-test code.
  // Without this clause, JSON round-trips that turn undefined into
  // null (see normalizeUndefinedToNull in store.ts) would flag every
  // forward edit of a previously-unset field as a conflict.
  if (a == null && b == null) return true
  if (a == null || b == null) return false
  if (typeof a !== typeof b) return false
  if (typeof a === 'object') return JSON.stringify(a) === JSON.stringify(b)
  return false
}
