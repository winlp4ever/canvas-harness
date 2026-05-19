import type { Edge } from './edge'
import type { Group } from './group'
import type { Node } from './node'
import type { EdgeId, GroupId, NodeId, SchemaVersion } from './primitives'

/**
 * Camera state — see ARCHITECTURE.md §4 and §13.4 camera API.
 *
 * x/y is the world-space coord that maps to the top-left of the viewport.
 * z is the zoom factor (1 = 1px world per 1px screen).
 */
export type CameraState = {
  x: number
  y: number
  z: number
}

/**
 * In-memory scene shape. Records keyed by id for O(1) lookup.
 * Wire format swaps records for arrays at the codec boundary (see §3.8).
 */
export type Scene = {
  schemaVersion: SchemaVersion
  nodes: Record<NodeId, Node>
  edges: Record<EdgeId, Edge>
  groups: Record<GroupId, Group>
  camera: CameraState
  selection: (NodeId | EdgeId)[]
}

/**
 * On-the-wire serialized form. Arrays gzip smaller and have predictable iteration order.
 * Camera + selection are unchanged.
 */
export type SerializedScene = {
  schemaVersion: SchemaVersion
  nodes: Node[]
  edges: Edge[]
  groups: Group[]
  camera: CameraState
  selection: (NodeId | EdgeId)[]
}
