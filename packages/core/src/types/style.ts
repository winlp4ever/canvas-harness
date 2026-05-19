/**
 * Style tokens — see ARCHITECTURE.md §3.4. All fields optional;
 * missing values fall back to theme resolver, then built-in defaults.
 */
export type StrokeStyle = 'solid' | 'dashed' | 'dotted'
export type FillStyle = 'solid' | 'hachure' | 'cross-hatch' | 'zigzag' | 'dots'
export type FontFamily = 'handwriting' | 'sans-serif' | 'serif' | 'monospace' | 'informal'
export type FontSize = 'S' | 'M' | 'L' | 'XL'
export type TextAlign = 'left' | 'center' | 'right'
export type TextStyle = 'normal' | 'bold' | 'italic'
export type Arrowhead = 'none' | 'arrow' | 'barb' | 'arrow-filled'

export type Style = {
  strokeColor?: string
  strokeWidth?: number
  strokeStyle?: StrokeStyle

  backgroundColor?: string
  fillStyle?: FillStyle

  roughness?: number
  roundness?: number
  opacity?: number

  fontFamily?: FontFamily
  fontSize?: FontSize
  textAlign?: TextAlign
  textColor?: string
  textStyle?: TextStyle

  /**
   * When true, the node's height auto-adjusts to fit `content` on add /
   * edit-commit / resize-commit. Defaults to true for any node type.
   * See ARCHITECTURE.md §8 (autofit lives on commit boundaries, never
   * per-keystroke).
   */
  autoFit?: boolean
}

export type EdgeStyle = Style & {
  sourceArrowhead?: Arrowhead
  targetArrowhead?: Arrowhead
  /**
   * Position of `edge.content` (the edge label) along the polyline,
   * expressed as arc-length `[0..1]`. Default `0.5` (midpoint).
   */
  labelArcLength?: number
  /**
   * When true, the label rotates to follow the tangent of the edge at
   * its anchor. Default false — labels stay upright. See
   * ARCHITECTURE.md §6.11.
   */
  labelFollowsTangent?: boolean
}
