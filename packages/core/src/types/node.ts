import type { GroupId, NodeId } from './primitives'
import type { Style } from './style'

/**
 * Built-in node types — see ARCHITECTURE.md §3.5.
 * Custom node types are arbitrary strings registered via defineNode.
 */
export type BuiltInNodeType =
  | 'rect'
  | 'ellipse'
  | 'diamond'
  | 'capsule'
  | 'text'
  | 'image'
  | 'icon'
  | 'frame'

export type NodeType = BuiltInNodeType | (string & { readonly __nodeType?: never })

/**
 * Scene node — see ARCHITECTURE.md §3.2.
 *
 * Coordinates are top-left world coords pre-rotation; `angle` is radians
 * around node center. `content` is lite-markdown for text-bearing built-in
 * shapes; `data` is type-specific payload for everything else.
 */
export type Node = {
  id: NodeId
  type: NodeType

  x: number
  y: number
  w: number
  h: number
  angle: number

  z: number
  groups: GroupId[]
  locked?: boolean
  hidden?: boolean

  content?: string
  style?: Style
  data?: unknown
}
