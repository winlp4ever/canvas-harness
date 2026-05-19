/**
 * Op inversion — see ARCHITECTURE.md §10.2.
 *
 * Every committed `Op` carries enough state (full snapshot for add/remove,
 * `prev` slice for updates) to derive its inverse with no diffing. Undo
 * applies `inverseBatch(batch)` with `origin: 'history'`; redo re-applies
 * the original batch.
 *
 * Inverse rules:
 *   - add ↔ remove (full snapshot retained)
 *   - update.patch ↔ update.prev
 *   - group.upsert with `prev` ↔ group.upsert with prev fields swapped; if
 *     `prev` is absent, the upsert was a fresh insert → invert to remove.
 */
import type { Op, OpBatch } from '../types'

export const inverseOp = (op: Op): Op => {
  switch (op.type) {
    case 'node.add':
      return { type: 'node.remove', node: op.node }
    case 'node.remove':
      return { type: 'node.add', node: op.node }
    case 'node.update':
      return { type: 'node.update', id: op.id, patch: op.prev, prev: op.patch }
    case 'edge.add':
      return { type: 'edge.remove', edge: op.edge }
    case 'edge.remove':
      return { type: 'edge.add', edge: op.edge }
    case 'edge.update':
      return { type: 'edge.update', id: op.id, patch: op.prev, prev: op.patch }
    case 'group.upsert':
      if (op.prev) return { type: 'group.upsert', group: op.prev, prev: op.group }
      return { type: 'group.remove', group: op.group }
    case 'group.remove':
      return { type: 'group.upsert', group: op.group }
  }
}

/**
 * Inverse batch: reverse op order, invert each op. Reversing preserves
 * "later ops depended on earlier ones" semantics — e.g. a batch that
 * (1) adds a node and (2) updates it must undo (2) first, then (1).
 */
export const inverseBatch = (batch: OpBatch): Op[] => {
  const inv: Op[] = []
  for (let i = batch.ops.length - 1; i >= 0; i--) {
    inv.push(inverseOp(batch.ops[i]!))
  }
  return inv
}
