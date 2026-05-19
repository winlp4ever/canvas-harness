import type { EdgeId, GroupId, NodeId, Vec2 } from './primitives'
import type { EdgeStyle } from './style'

export type PathStyle = 'straight' | 'bezier' | 'polyline'

/**
 * Edge endpoint — see ARCHITECTURE.md §6.1.
 *
 * Attached: `localOffset` is in the node's pre-rotation local frame,
 *   top-left origin, absolute pixels. Endpoint follows the node
 *   automatically via projection at render time.
 * Free-floating: `worldPoint` is in world coordinates.
 */
export type EdgeEnd = { nodeId: NodeId; localOffset: Vec2 } | { worldPoint: Vec2 }

export const isAttached = (e: EdgeEnd): e is { nodeId: NodeId; localOffset: Vec2 } => 'nodeId' in e

/**
 * Scene edge — see ARCHITECTURE.md §3.3.
 */
export type Edge = {
  id: EdgeId

  source: EdgeEnd
  target: EdgeEnd
  pathStyle: PathStyle
  control?: Vec2[]

  z: number
  groups: GroupId[]
  locked?: boolean
  hidden?: boolean

  content?: string
  style?: EdgeStyle
  data?: unknown
}
