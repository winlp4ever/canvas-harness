import type { CanvasBackground } from '@canvas-harness/core'
import type { ThemeResolver } from '@canvas-harness/react'
import { useCallback, useEffect, useMemo, useState } from 'react'

/**
 * Playground-only "light / dark" preset toggle. Demonstrates the
 * pattern; the library stays headless (no opinion on what "dark"
 * means — consumers compose their own palettes).
 *
 * Two outputs:
 *   - `theme`: a `ThemeResolver` that returns dark variants for
 *     affordance tokens that fall through `node.style` (default
 *     stroke / fill / text + edge stroke + edge label chip).
 *   - `background`: a suggested `CanvasBackground` preset. The App
 *     pipes this into the existing `BackgroundPanel` state on toggle.
 *
 * Per-node `style.backgroundColor` etc. stay untouched — those are
 * user data. Theme provides the fallback for nodes without an
 * explicit color (matches the library's resolveColor precedence).
 *
 * Selection outline + handle colors are intentionally NOT theme-driven
 * (the library hardcodes `#3b82f6`) — selection is brand/affordance,
 * same blue in both modes. Tracked as a follow-up in IMPROVEMENTS.md
 * if a consumer needs theme-driven selection color.
 */

export type ThemeMode = 'light' | 'dark'

const STORAGE_KEY = 'canvas-harness-playground:theme-mode:v1'

const loadInitial = (): ThemeMode => {
  if (typeof window === 'undefined') return 'light'
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === 'dark' || raw === 'light') return raw
  } catch {}
  return 'light'
}

const LIGHT_BACKGROUND: CanvasBackground = {
  color: '#f8fafc',
  pattern: 'none',
  patternColor: '#cbd5e1',
  gap: 20,
  minZoom: 0.4,
}

const DARK_BACKGROUND: CanvasBackground = {
  color: '#0f172a',
  pattern: 'none',
  patternColor: '#334155',
  gap: 20,
  minZoom: 0.4,
}

const LIGHT_TOKENS: Record<string, string> = {
  strokeColor: '#1f2937',
  backgroundColor: '#dbeafe',
  textColor: '#1f2937',
  'edge.strokeColor': '#475569',
  'edge.label.background': '#ffffff',
}

const DARK_TOKENS: Record<string, string> = {
  strokeColor: '#e2e8f0',
  backgroundColor: '#1e293b',
  textColor: '#f1f5f9',
  'edge.strokeColor': '#cbd5e1',
  'edge.label.background': '#1e293b',
}

const makeResolver =
  (tokens: Record<string, string>): ThemeResolver =>
  (token: string) =>
    tokens[token]

/** Background preset for the given mode. Exported so App can replace
 *  the user's panel choice on toggle. */
export const getThemeBackground = (mode: ThemeMode): CanvasBackground =>
  mode === 'dark' ? DARK_BACKGROUND : LIGHT_BACKGROUND

export function useThemeMode(): {
  mode: ThemeMode
  toggle: () => void
  setMode: (next: ThemeMode) => void
  theme: ThemeResolver
} {
  const [mode, setMode] = useState<ThemeMode>(loadInitial)

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, mode)
    } catch {}
  }, [mode])

  const toggle = useCallback(() => {
    setMode(m => (m === 'light' ? 'dark' : 'light'))
  }, [])

  // Memoize the resolver — otherwise every render produces a fresh
  // closure, which trips <Canvas>'s renderer-recreate effect on every
  // pass (and resets the perf-overlay stats to 0 before they can
  // accumulate).
  const theme: ThemeResolver = useMemo(
    () => (mode === 'dark' ? makeResolver(DARK_TOKENS) : makeResolver(LIGHT_TOKENS)),
    [mode],
  )

  return { mode, toggle, setMode, theme }
}
