/**
 * Font + line-height defaults, plus the runtime font registry.
 *
 * The library is headless: it only *names* fonts. Custom faces must be
 * loaded by the consumer (via @font-face / Google Fonts); the
 * font-epoch reactivity (see font-epoch.ts) invalidates the measure +
 * bitmap caches when fonts finish loading — and when `configureFonts()`
 * changes a stack.
 *
 * Consumers customize typography with `configureFonts({...})`; everything
 * inside the library resolves through the getters below, so measurement,
 * painting, the DOM editor, and export all stay consistent.
 */
import type { FontFamily, FontSize, FontSizePreset } from '../types'
import { bumpFontEpoch } from './font-epoch'

/**
 * Built-in font stacks. Each token's first face is the intended font;
 * the rest are generic fallbacks. Override any subset via
 * `configureFonts({ family: {...} })`.
 */
export const DEFAULT_FONT_STACKS: Record<FontFamily, string> = {
  handwriting: '"Architects Daughter", cursive',
  'sans-serif':
    '"Atkinson Hyperlegible Next", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", ui-sans-serif, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"',
  serif: '"Lora", "Source Serif 4", ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
  monospace:
    '"Inconsolata", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  informal: '"Shantell Sans", ui-handwriting, cursive',
}

/** Built-in font sizes (px) per size token. */
export const DEFAULT_FONT_SIZES: Record<FontSizePreset, number> = { S: 14, M: 16, L: 24, XL: 36 }

/** Built-in line heights (px) per size token. */
export const DEFAULT_LINE_HEIGHTS: Record<FontSizePreset, number> = { S: 20, M: 24, L: 32, XL: 40 }

/**
 * @deprecated Read via `getFontStack()`; kept for back-compat. Reflects
 * the built-in defaults, NOT runtime `configureFonts()` overrides.
 */
export const FONT_FAMILY_MAP = DEFAULT_FONT_STACKS
/** @deprecated Read via `getFontSizePx()`; reflects the built-in defaults. */
export const FONT_SIZE_MAP = DEFAULT_FONT_SIZES
/** @deprecated Read via `getLineHeightPx()`; reflects the built-in defaults. */
export const LINE_HEIGHT_MAP = DEFAULT_LINE_HEIGHTS

// Live registry — the values the library actually resolves through.
// Seeded from the defaults; mutated (merged) by configureFonts().
let fontStacks: Record<FontFamily, string> = { ...DEFAULT_FONT_STACKS }
let fontSizes: Record<FontSizePreset, number> = { ...DEFAULT_FONT_SIZES }
let lineHeights: Record<FontSizePreset, number> = { ...DEFAULT_LINE_HEIGHTS }

/** Resolve a font-family token to its current CSS stack. */
export const getFontStack = (family: FontFamily): string => fontStacks[family]
/** Resolve a size token to its current pixel size. */
export const getFontSizePx = (size: FontSize): number =>
  typeof size === 'number' ? size : fontSizes[size]
/** Resolve a size token to its current line height (px). */
export const getLineHeightPx = (size: FontSize): number =>
  typeof size === 'number' ? size * 1.25 : lineHeights[size]

/** Overrides for `configureFonts()`. Any subset; unspecified keys keep their current value. */
export type FontConfig = {
  /** Map a family token to a CSS font stack (e.g. `{ 'sans-serif': '"Inter", sans-serif' }`). */
  family?: Partial<Record<FontFamily, string>>
  /** Override a size token's pixel size. Affects newly measured/laid-out text (see note on reflow). */
  size?: Partial<Record<FontSizePreset, number>>
  /** Override a size token's line height (px). */
  lineHeight?: Partial<Record<FontSizePreset, number>>
}

// Merge only *defined* override values over the base — a caller building
// config dynamically may pass `undefined` (e.g. `{ M: cfg.customM }`),
// which must not overwrite a real default with undefined (→ NaN geometry).
const mergeDefined = <K extends string, V>(
  base: Record<K, V>,
  over: Partial<Record<K, V>>,
): Record<K, V> => {
  const out = { ...base }
  for (const k of Object.keys(over) as K[]) {
    const v = over[k]
    if (v !== undefined) out[k] = v
  }
  return out
}

/**
 * Customize the fonts the canvas renders with. Partial + merges over the
 * current values, so overriding one token leaves the rest at their
 * defaults (`undefined` override values are ignored, never applied).
 * Bumps the font epoch, so the measure + bitmap caches invalidate and
 * mounted canvases repaint.
 *
 * App-global (last call wins) — fonts are loaded document-globally, so a
 * per-canvas stack override wouldn't correspond to a real face. Load the
 * actual faces yourself (@font-face / Google Fonts); the library only
 * names them.
 *
 * **Call at startup, before nodes are created/loaded.** Overrides apply
 * to text measured/laid out *after* the call; nodes already sized in the
 * document keep their persisted `w`/`h` — this does not reflow them.
 *
 * @example
 * configureFonts({ family: { 'sans-serif': '"Inter", system-ui, sans-serif' } })
 */
export const configureFonts = (config: FontConfig): void => {
  if (config.family) fontStacks = mergeDefined(fontStacks, config.family)
  if (config.size) fontSizes = mergeDefined(fontSizes, config.size)
  if (config.lineHeight) lineHeights = mergeDefined(lineHeights, config.lineHeight)
  bumpFontEpoch()
}

/** Restore the built-in font defaults (bumps the epoch). Mainly for tests. */
export const resetFonts = (): void => {
  fontStacks = { ...DEFAULT_FONT_STACKS }
  fontSizes = { ...DEFAULT_FONT_SIZES }
  lineHeights = { ...DEFAULT_LINE_HEIGHTS }
  bumpFontEpoch()
}

// Layout-time visual constants. Match dim0's canvas-lite-markdown.
export const CODE_BLOCK_PADDING_X = 6
export const CODE_BLOCK_MARGIN_Y = 4
export const CONTENT_HEIGHT_BUFFER = 4
export const CONTENT_PADDING = 6

export const DEFAULT_TEXT_COLOR = '#1f2937'
export const DEFAULT_HIGHLIGHT_COLOR = '#fde047'
export const DEFAULT_HIGHLIGHT_COLOR_DARK = '#6b5a23'
export const LINK_COLOR = '#2563eb'
export const CODE_BG_COLOR = 'rgba(148, 163, 184, 0.18)'
