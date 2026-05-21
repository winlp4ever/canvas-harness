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
  | 'tag'
  | 'capsule'
  | 'thought-cloud'
  | 'layered-rect'
  | 'layered-ellipse'
  | 'layered-diamond'
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

/**
 * `node.data` shape for `node.type === 'image'`. `src` is a self-
 * contained data URI (we don't accept external URLs to keep scenes
 * portable + CORS-free). `naturalW` / `naturalH` are the post-downscale
 * dimensions used for aspect-ratio preservation on resize.
 */
export type ImageNodeData = {
  src: string
  naturalW: number
  naturalH: number
  alt?: string
}

/**
 * `node.data` shape for `node.type === 'icon'`. `src` is sanitized
 * SVG markup (scripts + event handlers stripped at add time). The
 * recolor knob lives on `style.iconColor`, not here, so theming
 * flows through the same channel as other style tokens.
 */
export type IconNodeData = {
  src: string
  alt?: string
}
