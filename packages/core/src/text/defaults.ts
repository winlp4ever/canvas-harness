/**
 * Font + line-height defaults — matches `dim0/webui/.../canvas-lite-markdown.tsx`
 * and `dim0/backend/topix/datatypes/note/style.py`.
 *
 * The maps below are the canonical contract between consumer style tokens
 * and concrete typography. Custom fonts live in the consumer's @font-face;
 * the library only renames them.
 */
import type { FontFamily, FontSize } from '../types'

/**
 * Mirrors the font stacks defined in dim0's index.css so canvas measurement
 * matches DOM text. Custom fonts must be loaded by the consumer (via
 * @font-face / Google Fonts); the font-epoch reactivity (see font-epoch.ts)
 * invalidates the bitmap cache when fonts finish loading.
 */
export const FONT_FAMILY_MAP: Record<FontFamily, string> = {
  handwriting: '"Architects Daughter", cursive',
  'sans-serif':
    '"Atkinson Hyperlegible Next", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", ui-sans-serif, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"',
  serif: '"Lora", "Source Serif 4", ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
  monospace:
    '"Inconsolata", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  informal: '"Shantell Sans", ui-handwriting, cursive',
}

export const FONT_SIZE_MAP: Record<FontSize, number> = {
  S: 14,
  M: 16,
  L: 24,
  XL: 36,
}

export const LINE_HEIGHT_MAP: Record<FontSize, number> = {
  S: 20,
  M: 24,
  L: 32,
  XL: 40,
}

// Layout-time visual constants. Match dim0 canvas-lite-markdown.
export const CODE_BLOCK_PADDING_X = 6
export const CODE_BLOCK_MARGIN_Y = 4
export const CONTENT_HEIGHT_BUFFER = 4
export const CONTENT_PADDING = 6

export const DEFAULT_TEXT_COLOR = '#1f2937'
export const DEFAULT_HIGHLIGHT_COLOR = '#fde047'
export const DEFAULT_HIGHLIGHT_COLOR_DARK = '#6b5a23'
export const LINK_COLOR = '#2563eb'
export const CODE_BG_COLOR = 'rgba(148, 163, 184, 0.18)'
