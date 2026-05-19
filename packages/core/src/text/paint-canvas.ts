import type { FontFamily, FontSize, TextAlign, TextStyle } from '../types'
/**
 * Paints fully-laid-out markdown into a canvas context — ported from
 * canvas-lite-markdown.tsx with the output-stage simplification noted in
 * ARCHITECTURE.md §8.
 *
 * Caller is responsible for sizing the canvas + applying its own
 * transform. This function just paints content at (0, 0) into a rect of
 * the given (width, height).
 */
import {
  CODE_BG_COLOR,
  CODE_BLOCK_MARGIN_Y,
  CODE_BLOCK_PADDING_X,
  DEFAULT_HIGHLIGHT_COLOR,
  DEFAULT_TEXT_COLOR,
  FONT_SIZE_MAP,
  LINE_HEIGHT_MAP,
  LINK_COLOR,
} from './defaults'
import { getContentHeight } from './estimate-height'
import { type LayoutLine, layoutTokens } from './layout'
import { getCanvasFont, measureText } from './measure'
import { tokenize } from './tokens'
import type { InlineType } from './tokens'

export type DrawTextOptions = {
  text: string
  width: number
  height: number
  align: TextAlign
  fontFamily: FontFamily
  fontSize: FontSize
  textStyle: TextStyle
  textColor: string
  highlightColor: string
}

const getLineAdvance = (line: LayoutLine, lineHeight: number): number => {
  if (line.kind !== 'code-block') return lineHeight
  let advance = lineHeight
  if (line.isFirst) advance += CODE_BLOCK_MARGIN_Y
  if (line.isLast) advance += CODE_BLOCK_MARGIN_Y
  return advance
}

const getTextX = (opts: DrawTextOptions, lineWidth: number): number => {
  if (opts.align === 'center') return Math.floor((opts.width - lineWidth) / 2)
  if (opts.align === 'right') return Math.max(0, opts.width - lineWidth)
  return 0
}

const drawRunDecoration = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  type: InlineType,
  fontSize: number,
): void => {
  if (type === 'underline' || type === 'link') {
    const lineY = y + 2
    ctx.beginPath()
    ctx.moveTo(x, lineY)
    ctx.lineTo(x + width, lineY)
    ctx.lineWidth = 1
    ctx.stroke()
  }

  if (type === 'strike') {
    const lineY = y - Math.floor(fontSize * 0.35)
    ctx.beginPath()
    ctx.moveTo(x, lineY)
    ctx.lineTo(x + width, lineY)
    ctx.lineWidth = 1
    ctx.stroke()
  }
}

/**
 * Paints `text` (markdown) into the canvas at (0..width, 0..height) using
 * the laid-out lines and styled runs. Background chips for inline code +
 * highlight, vertical centering when content shorter than height, dashed
 * decorations for underline/strike/link.
 */
export const drawTextToCanvas = (ctx: CanvasRenderingContext2D, opts: DrawTextOptions): void => {
  const normalizedText = opts.text.trim()
  if (!normalizedText) return

  const lines = layoutTokens(tokenize(opts.text), {
    width: opts.width,
    fontFamily: opts.fontFamily,
    fontSize: opts.fontSize,
    textStyle: opts.textStyle,
  })

  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = opts.textColor || DEFAULT_TEXT_COLOR
  ctx.strokeStyle = opts.textColor || DEFAULT_TEXT_COLOR

  const fontSizePx = FONT_SIZE_MAP[opts.fontSize]
  const lineHeight = LINE_HEIGHT_MAP[opts.fontSize]
  const contentHeight = getContentHeight(lines, lineHeight)
  const availableHeight = Math.max(0, opts.height)
  const shouldCenterVertically = contentHeight <= availableHeight
  const centeredTop = Math.floor((opts.height - contentHeight) / 2)
  const topInset = Math.ceil(fontSizePx * 0.92)
  const startBaseline = shouldCenterVertically
    ? Math.max(topInset, centeredTop + topInset)
    : topInset
  let y = startBaseline

  for (const line of lines) {
    const lineTop = y - fontSizePx
    const lineBottom = lineTop + getLineAdvance(line, lineHeight)

    if (lineBottom <= 0) {
      y += getLineAdvance(line, lineHeight)
      continue
    }
    if (lineTop >= opts.height) break

    if (line.kind === 'code-block') {
      if (line.isFirst) y += CODE_BLOCK_MARGIN_Y

      let lineWidth = 0
      for (const run of line.runs) {
        lineWidth += measureText({
          text: run.text,
          type: run.type,
          fontFamily: opts.fontFamily,
          fontSize: opts.fontSize,
          textStyle: 'normal',
        })
      }

      const blockX = 0
      const blockY = y - fontSizePx + 2
      const blockWidth = Math.max(10, opts.width)
      const blockHeight = lineHeight

      ctx.save()
      ctx.fillStyle = CODE_BG_COLOR
      ctx.fillRect(blockX, blockY, blockWidth, blockHeight)
      ctx.restore()

      let x = blockX + CODE_BLOCK_PADDING_X
      if (opts.align === 'center') {
        x = blockX + Math.max(CODE_BLOCK_PADDING_X, Math.floor((blockWidth - lineWidth) / 2))
      } else if (opts.align === 'right') {
        x = blockX + Math.max(CODE_BLOCK_PADDING_X, blockWidth - CODE_BLOCK_PADDING_X - lineWidth)
      }

      for (const run of line.runs) {
        const runWidth = measureText({
          text: run.text,
          type: run.type,
          fontFamily: opts.fontFamily,
          fontSize: opts.fontSize,
          textStyle: 'normal',
        })
        ctx.font = getCanvasFont({
          type: run.type,
          fontFamily: opts.fontFamily,
          fontSize: opts.fontSize,
          textStyle: 'normal',
        })
        ctx.fillStyle = opts.textColor || DEFAULT_TEXT_COLOR
        ctx.fillText(run.text, x, y)
        x += runWidth
      }

      y += lineHeight
      if (line.isLast) y += CODE_BLOCK_MARGIN_Y
      continue
    }

    if (line.kind === 'rule') {
      ctx.save()
      ctx.globalAlpha = 0.55
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(opts.width, y)
      ctx.lineWidth = 1
      ctx.stroke()
      if (line.double) {
        ctx.beginPath()
        ctx.moveTo(0, y + 3)
        ctx.lineTo(opts.width, y + 3)
        ctx.lineWidth = 1
        ctx.stroke()
      }
      ctx.restore()
      y += lineHeight
      continue
    }

    let lineWidth = 0
    for (const run of line.runs) {
      lineWidth += measureText({
        text: run.text,
        type: run.type,
        fontFamily: opts.fontFamily,
        fontSize: opts.fontSize,
        textStyle: opts.textStyle,
      })
    }

    let x = getTextX(opts, lineWidth)

    for (const run of line.runs) {
      const runWidth = measureText({
        text: run.text,
        type: run.type,
        fontFamily: opts.fontFamily,
        fontSize: opts.fontSize,
        textStyle: opts.textStyle,
      })

      if (run.type === 'highlight') {
        ctx.save()
        ctx.fillStyle = opts.highlightColor || DEFAULT_HIGHLIGHT_COLOR
        ctx.fillRect(x - 1, y - fontSizePx + 2, runWidth + 2, fontSizePx + 2)
        ctx.restore()
      }

      if (run.type === 'code') {
        ctx.save()
        ctx.fillStyle = CODE_BG_COLOR
        ctx.fillRect(x - 2, y - fontSizePx + 2, runWidth + 4, fontSizePx + 3)
        ctx.restore()
      }

      ctx.font = getCanvasFont({
        type: run.type,
        fontFamily: opts.fontFamily,
        fontSize: opts.fontSize,
        textStyle: opts.textStyle,
      })
      const runColor = run.type === 'link' ? LINK_COLOR : opts.textColor || DEFAULT_TEXT_COLOR
      ctx.fillStyle = runColor
      ctx.strokeStyle = runColor
      ctx.fillText(run.text, x, y)
      drawRunDecoration(ctx, x, y, runWidth, run.type, fontSizePx)

      x += runWidth
    }

    y += lineHeight
  }
}
