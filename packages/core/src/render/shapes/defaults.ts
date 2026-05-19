/**
 * Built-in style defaults — see ARCHITECTURE.md §3.4.
 *
 * Each render call resolves style via:
 *   1. node.style[token] if set
 *   2. theme(token) if a theme resolver is provided
 *   3. the value here
 */
import type { Style } from '../../types'

export const DEFAULT_STYLE: Required<
  Pick<
    Style,
    | 'strokeColor'
    | 'strokeWidth'
    | 'strokeStyle'
    | 'backgroundColor'
    | 'fillStyle'
    | 'opacity'
    | 'roundness'
  >
> = {
  strokeColor: '#1f2937',
  strokeWidth: 2,
  strokeStyle: 'solid',
  backgroundColor: '#dbeafe',
  fillStyle: 'solid',
  opacity: 100,
  roundness: 2,
}

/**
 * Resolves a style field with the precedence above.
 * `theme` lookup is optional and returns `undefined` if no override.
 *
 * Stable token catalog (consumer maps these to its design system):
 *   - `strokeColor`            edge + shape stroke
 *   - `strokeWidth`            shape + edge stroke width
 *   - `backgroundColor`        shape fill
 *   - `textColor`              shape text color
 *   - `opacity`                shape opacity (0-100)
 *   - `selection.outline`      selection outline color (overlay)
 *   - `handle.fill`            resize/rotate handle fill
 *   - `handle.stroke`          resize/rotate handle stroke
 *   - `text.highlight`         markdown ==highlight== chip color
 *   - `text.codeBackground`    markdown `code` chip color
 *
 * Tokens not in this list are passed through unchanged; consumers can
 * extend with their own (e.g. `node.shadow.color`).
 */
export type ThemeResolver = (token: string) => string | number | undefined

export const resolveColor = (
  style: Style | undefined,
  key: 'strokeColor' | 'backgroundColor' | 'textColor',
  fallback: string,
  theme?: ThemeResolver,
): string => {
  const fromStyle = style?.[key]
  if (typeof fromStyle === 'string') return fromStyle
  const fromTheme = theme?.(key)
  if (typeof fromTheme === 'string') return fromTheme
  return fallback
}

export const resolveStrokeWidth = (style: Style | undefined, theme?: ThemeResolver): number => {
  if (typeof style?.strokeWidth === 'number') return style.strokeWidth
  const fromTheme = theme?.('strokeWidth')
  if (typeof fromTheme === 'number') return fromTheme
  return DEFAULT_STYLE.strokeWidth
}

export const resolveOpacity = (style: Style | undefined, theme?: ThemeResolver): number => {
  if (typeof style?.opacity === 'number') return style.opacity / 100
  const fromTheme = theme?.('opacity')
  if (typeof fromTheme === 'number') return fromTheme / 100
  return DEFAULT_STYLE.opacity / 100
}

/**
 * Maps the `strokeStyle` token to a canvas `setLineDash` argument.
 * Width-aware so dashes look right at different stroke widths.
 */
export const dashPatternFor = (
  strokeStyle: Style['strokeStyle'] | undefined,
  width: number,
): number[] => {
  switch (strokeStyle) {
    case 'dashed':
      return [width * 4, width * 2]
    case 'dotted':
      return [width, width * 2]
    default:
      return []
  }
}
