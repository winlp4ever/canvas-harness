import type { FontFamily, FontSize, TextStyle } from '../types'
/**
 * Height-only probe for autosizing text shapes — ported from
 * canvas-lite-markdown.tsx.
 *
 * Same tokenize + layout pipeline as the paint pass; just skips the
 * actual draw. Used by the edit-mode autosize and by any consumer that
 * needs to compute the height a piece of markdown will take at a given
 * width.
 */
import { CODE_BLOCK_MARGIN_Y, CONTENT_HEIGHT_BUFFER, LINE_HEIGHT_MAP } from './defaults'
import { type LayoutLine, layoutTokens } from './layout'
import { tokenize } from './tokens'

export type EstimateOptions = {
  text: string
  width: number
  fontFamily?: FontFamily
  fontSize?: FontSize
  textStyle?: TextStyle
}

const getLineAdvance = (line: LayoutLine, lineHeight: number): number => {
  if (line.kind !== 'code-block') return lineHeight
  let advance = lineHeight
  if (line.isFirst) advance += CODE_BLOCK_MARGIN_Y
  if (line.isLast) advance += CODE_BLOCK_MARGIN_Y
  return advance
}

export const getContentHeight = (lines: LayoutLine[], lineHeight: number): number =>
  Math.max(
    lineHeight,
    lines.reduce((sum, line) => sum + getLineAdvance(line, lineHeight), 0),
  )

export const estimateMarkdownContentHeight = ({
  text,
  width,
  fontFamily = 'handwriting',
  fontSize = 'M',
  textStyle = 'normal',
}: EstimateOptions): number => {
  const normalizedText = text.trim()
  if (!normalizedText) return 0

  const resolvedWidth = Math.max(40, Math.ceil(width))
  const lines = layoutTokens(tokenize(text), {
    width: resolvedWidth,
    fontFamily,
    fontSize,
    textStyle,
  })
  const lineHeight = LINE_HEIGHT_MAP[fontSize]
  return getContentHeight(lines, lineHeight) + CONTENT_HEIGHT_BUFFER
}

export const getMarkdownLineHeightPx = (fontSize: FontSize): number => LINE_HEIGHT_MAP[fontSize]
