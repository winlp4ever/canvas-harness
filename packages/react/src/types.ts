import type { Node } from '@canvas-harness/core'

/**
 * Theme resolver — see ARCHITECTURE.md §13.10. Returns a color string
 * (or undefined to fall back to the built-in defaults) for a given
 * design-system token + context.
 */
export type ThemeResolver = (
  token: string,
  ctx?: { node?: Node; state?: 'idle' | 'hover' | 'selected' | 'drag' },
) => string | undefined
