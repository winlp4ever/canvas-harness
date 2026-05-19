import type { CanvasStore } from '@canvas-harness/core'
import type { ThemeMode } from './useThemeMode'

/**
 * Playground-only "demo" mass color swap on theme toggle. Walks every
 * node + edge; for each color field whose current value is in the
 * known palette map, replaces with the opposite mode's pair. Colors
 * not in the map (user-picked customs) stay untouched.
 *
 * Wrapped in one `store.batch` so undo restores in a single step.
 *
 * Architecturally the library treats theme as fallback-only (per-node
 * style wins). This helper deliberately violates that for demo
 * fidelity — see IMPROVEMENTS.md.
 */

// Fill colors: light → dark.
const FILL_L2D: Record<string, string> = {
  '#dbeafe': '#1e3a5f', // blue
  '#fef08a': '#5b4500', // yellow
  '#fde68a': '#6b4226', // amber
  '#fecaca': '#601717', // red
  '#bbf7d0': '#0d3b1f', // green
  '#e9d5ff': '#3b1e6b', // purple
  '#fed7aa': '#5a2a0a', // orange
  '#ffffff': '#1e293b', // white
}

// Stroke colors: light → dark.
const STROKE_L2D: Record<string, string> = {
  '#1f2937': '#e2e8f0',
  '#dc2626': '#fca5a5',
  '#ea580c': '#fdba74',
  '#16a34a': '#86efac',
  '#0284c7': '#7dd3fc',
  '#9333ea': '#d8b4fe',
  '#00000000': '#00000000', // transparent stays transparent
}

const TEXT_L2D: Record<string, string> = {
  '#1f2937': '#f1f5f9',
  '#ffffff': '#0f172a',
  '#dc2626': '#fca5a5',
  '#0284c7': '#7dd3fc',
  '#16a34a': '#86efac',
  '#9333ea': '#d8b4fe',
}

const invert = (map: Record<string, string>): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(map)) out[v] = k
  return out
}
const FILL_D2L = invert(FILL_L2D)
const STROKE_D2L = invert(STROKE_L2D)
const TEXT_D2L = invert(TEXT_L2D)

export const swapSceneColors = (store: CanvasStore, fromMode: ThemeMode, toMode: ThemeMode): void => {
  if (fromMode === toMode) return
  const fillMap = toMode === 'dark' ? FILL_L2D : FILL_D2L
  const strokeMap = toMode === 'dark' ? STROKE_L2D : STROKE_D2L
  const textMap = toMode === 'dark' ? TEXT_L2D : TEXT_D2L

  store.batch(() => {
    for (const node of store.getAllNodes()) {
      const style = node.style
      if (!style) continue
      const patch: Partial<NonNullable<typeof style>> = {}
      let touched = false
      if (style.backgroundColor && fillMap[style.backgroundColor]) {
        patch.backgroundColor = fillMap[style.backgroundColor]
        touched = true
      }
      if (style.strokeColor && strokeMap[style.strokeColor]) {
        patch.strokeColor = strokeMap[style.strokeColor]
        touched = true
      }
      if (style.textColor && textMap[style.textColor]) {
        patch.textColor = textMap[style.textColor]
        touched = true
      }
      if (touched) store.updateNode(node.id, { style: { ...style, ...patch } })
    }
    for (const edge of store.getAllEdges()) {
      const style = edge.style
      if (!style) continue
      const patch: Partial<NonNullable<typeof style>> = {}
      let touched = false
      if (style.strokeColor && strokeMap[style.strokeColor]) {
        patch.strokeColor = strokeMap[style.strokeColor]
        touched = true
      }
      if (style.textColor && textMap[style.textColor]) {
        patch.textColor = textMap[style.textColor]
        touched = true
      }
      if (touched) store.updateEdge(edge.id, { style: { ...style, ...patch } })
    }
  })
}
