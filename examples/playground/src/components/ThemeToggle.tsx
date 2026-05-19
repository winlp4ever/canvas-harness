import type { ThemeMode } from '../hooks/useThemeMode'

/**
 * Tiny toggle button — flips between the playground's light / dark
 * presets. Demonstrates that dark mode is composable on top of the
 * library's theme resolver + background prop.
 */
export function ThemeToggle({
  mode,
  onToggle,
}: {
  mode: ThemeMode
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={`Switch to ${mode === 'light' ? 'dark' : 'light'} mode`}
      style={{
        position: 'absolute',
        top: 12,
        left: 220,
        padding: '6px 10px',
        background: '#fff',
        border: '1px solid #cbd5e1',
        borderRadius: 8,
        boxShadow: '0 1px 3px rgba(0,0,0,.08)',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 13,
        cursor: 'pointer',
        zIndex: 10,
      }}
    >
      {mode === 'light' ? 'Dark' : 'Light'}
    </button>
  )
}
