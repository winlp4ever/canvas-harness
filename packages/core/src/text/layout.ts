import type { FontFamily, FontSize, TextStyle } from '../types'
/**
 * Wrap engine — ported from canvas-lite-markdown.tsx.
 *
 * Takes a stream of tokens + the wrap width + font settings; produces
 * an array of LayoutLines (text lines, code-block lines, rule lines).
 * Each text line is a sequence of StyledRuns (text + inline type).
 *
 * Code blocks wrap by character width using monospace metrics so they
 * fit precisely. Text lines wrap by word, falling back to char-wrap
 * for words longer than `width`.
 */
import { CODE_BLOCK_PADDING_X, DEFAULT_TEXT_COLOR, FONT_SIZE_MAP } from './defaults'
import { getMathBitmap } from './math'
import { measureText } from './measure'
import type { InlineType, Token } from './tokens'

export type StyledRun = {
  text: string
  type: InlineType
}

export type LayoutLine =
  | { kind: 'text'; runs: StyledRun[] }
  | { kind: 'code-block'; runs: StyledRun[]; isFirst: boolean; isLast: boolean }
  | { kind: 'rule'; double: boolean }

export type LayoutOptions = {
  width: number
  fontFamily: FontFamily
  fontSize: FontSize
  textStyle: TextStyle
  /**
   * Used to key the math bitmap cache. Both layout (for measured dims)
   * and paint (for the actual bitmap) need to query the same cache
   * entry. Defaults to `#000000` for estimate-only callers.
   */
  textColor?: string
}

const splitChunks = (text: string): string[] => text.split(/(\s+)/g).filter(Boolean)

/**
 * Wraps one fenced-code line by character width using monospace metrics.
 * Preserves whitespace and guarantees fit within `maxWidth`.
 */
const wrapCodeLine = (line: string, opts: LayoutOptions, maxWidth: number): string[] => {
  const normalized = line.replace(/\t/g, '  ')
  if (!normalized) return ['']

  const wrapped: string[] = []
  let part = ''

  for (const ch of normalized) {
    const next = part + ch
    const nextWidth = measureText({
      text: next,
      type: 'code',
      fontFamily: opts.fontFamily,
      fontSize: opts.fontSize,
      textStyle: 'normal',
    })

    if (part && nextWidth > maxWidth) {
      wrapped.push(part)
      part = ch
    } else {
      part = next
    }
  }

  if (part) wrapped.push(part)
  return wrapped
}

/**
 * Turns tokens into drawable lines. Output consumed by the canvas paint pass.
 */
export const layoutTokens = (tokens: Token[], opts: LayoutOptions): LayoutLine[] => {
  const maxWidth = Math.max(40, opts.width)

  const lines: LayoutLine[] = []
  let currentRuns: StyledRun[] = []
  let cursorX = 0

  const pushLine = (): void => {
    lines.push({ kind: 'text', runs: currentRuns })
    currentRuns = []
    cursorX = 0
  }

  const pushRule = (double: boolean): void => {
    if (currentRuns.length > 0) pushLine()
    lines.push({ kind: 'rule', double })
  }

  const pushCodeBlock = (content: string): void => {
    if (currentRuns.length > 0) pushLine()
    const rawLines = content.split('\n')
    const visualRuns: StyledRun[][] = []
    const codeMaxWidth = Math.max(20, maxWidth - CODE_BLOCK_PADDING_X * 2)

    for (const raw of rawLines) {
      for (const part of wrapCodeLine(raw, opts, codeMaxWidth)) {
        visualRuns.push([{ text: part, type: 'code' }])
      }
    }

    if (visualRuns.length === 0) {
      lines.push({ kind: 'code-block', runs: [], isFirst: true, isLast: true })
      return
    }

    for (let index = 0; index < visualRuns.length; index++) {
      const runs = visualRuns[index]!
      lines.push({
        kind: 'code-block',
        runs,
        isFirst: index === 0,
        isLast: index === visualRuns.length - 1,
      })
    }
  }

  const pushChunk = (chunk: string, type: InlineType): void => {
    if (!chunk) return

    const chunkWidth = measureText({
      text: chunk,
      type,
      fontFamily: opts.fontFamily,
      fontSize: opts.fontSize,
      textStyle: opts.textStyle,
    })

    if (!chunk.trim()) {
      if (cursorX === 0) return
      currentRuns.push({ text: chunk, type })
      cursorX += chunkWidth
      return
    }

    if (cursorX > 0 && cursorX + chunkWidth > maxWidth) {
      pushLine()
    }

    if (chunkWidth > maxWidth && chunk.length > 1) {
      let part = ''
      for (const ch of chunk) {
        const next = part + ch
        const nextWidth = measureText({
          text: next,
          type,
          fontFamily: opts.fontFamily,
          fontSize: opts.fontSize,
          textStyle: opts.textStyle,
        })
        if (cursorX > 0 && nextWidth > maxWidth) {
          if (part) {
            currentRuns.push({ text: part, type })
            cursorX += measureText({
              text: part,
              type,
              fontFamily: opts.fontFamily,
              fontSize: opts.fontSize,
              textStyle: opts.textStyle,
            })
          }
          pushLine()
          part = ch
        } else {
          part = next
        }
      }

      if (part) {
        currentRuns.push({ text: part, type })
        cursorX += measureText({
          text: part,
          type,
          fontFamily: opts.fontFamily,
          fontSize: opts.fontSize,
          textStyle: opts.textStyle,
        })
      }
      return
    }

    currentRuns.push({ text: chunk, type })
    cursorX += chunkWidth
  }

  const fontSizePx = FONT_SIZE_MAP[opts.fontSize]
  // Must match paint-canvas's fallback so the math cache lookup keys
  // align between layout (measuring) and paint (drawing). The cache
  // is keyed by (source, color, size); a mismatch means paint never
  // hits the bitmap layout compiled, and the placeholder sticks.
  const mathColor = opts.textColor || DEFAULT_TEXT_COLOR

  for (const token of tokens) {
    if (token.type === 'code-block') {
      pushCodeBlock(token.content)
      continue
    }
    if (token.type === 'br') {
      pushLine()
      continue
    }
    if (token.type === 'hr') {
      pushRule(false)
      continue
    }
    if (token.type === 'hr-double') {
      pushRule(true)
      continue
    }
    if (token.type === 'math') {
      // Math is an inline atom — never whitespace-split. Width comes
      // from the cached bitmap (if compiled) or a length-based
      // placeholder. When the cache resolves later, the math-epoch
      // bump invalidates this layout's bitmap cache entry.
      const bitmap = getMathBitmap(token.content, mathColor, fontSizePx)
      const width = bitmap
        ? bitmap.width
        : // Placeholder: roughly proportional to source length so wrap
          // doesn't dramatically shift on resolve. Capped at maxWidth.
          Math.min(maxWidth, token.content.length * fontSizePx * 0.55 + fontSizePx)
      if (cursorX > 0 && cursorX + width > maxWidth) pushLine()
      currentRuns.push({ text: token.content, type: 'math' })
      cursorX += width
      continue
    }
    for (const chunk of splitChunks(token.content)) pushChunk(chunk, token.type)
  }

  if (currentRuns.length > 0 || lines.length === 0) {
    lines.push({ kind: 'text', runs: currentRuns })
  }

  return lines
}
