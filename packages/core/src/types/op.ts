import type { Edge } from './edge'
import type { Group } from './group'
import type { Node } from './node'
import type { BatchId, ClientId, EdgeId, NodeId } from './primitives'

/**
 * Operations — see ARCHITECTURE.md §10.2.
 *
 * Every committed scene mutation is one Op. `prev` slices capture the
 * fields touched by an update so undo can apply the inverse without a diff.
 */
export type Op =
  | { type: 'node.add'; node: Node }
  | { type: 'node.update'; id: NodeId; patch: Partial<Node>; prev: Partial<Node> }
  | { type: 'node.remove'; node: Node }
  | { type: 'edge.add'; edge: Edge }
  | { type: 'edge.update'; id: EdgeId; patch: Partial<Edge>; prev: Partial<Edge> }
  | { type: 'edge.remove'; edge: Edge }
  | { type: 'group.upsert'; group: Group; prev?: Group }
  | { type: 'group.remove'; group: Group }

/**
 * A batch is the atomic unit of mutation (also the unit of undo/redo and sync).
 */
export type OpBatch = {
  id: BatchId
  clientId: ClientId
  ts: number
  origin: 'local' | 'remote' | 'history'
  ops: Op[]
}
