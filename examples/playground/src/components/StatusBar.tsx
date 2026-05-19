import { useCursor, useInteractionMode, useSelection } from '@canvas-harness/react'

/**
 * Phase 12 deliverable: validates that `useInteractionState` /
 * `useCursor` / `useSelection` are cheap to call from many places.
 *
 * Each line subscribes to one signal — re-renders on mode change /
 * cursor move / selection delta independently.
 */
export function StatusBar() {
  const mode = useInteractionMode()
  const cursor = useCursor()
  const selection = useSelection()
  const cursorText = cursor
    ? `(${cursor.worldX.toFixed(1)}, ${cursor.worldY.toFixed(1)}) ${cursor.pointerType}`
    : '—'

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 56,
        left: '50%',
        transform: 'translateX(-50%)',
        padding: '6px 10px',
        background: '#fff',
        border: '1px solid #cbd5e1',
        borderRadius: 8,
        boxShadow: '0 1px 3px rgba(0,0,0,.08)',
        fontFamily: 'ui-monospace, "SFMono-Regular", Menlo, monospace',
        fontSize: 11,
        color: '#475569',
        zIndex: 10,
        display: 'flex',
        gap: 14,
        whiteSpace: 'nowrap',
      }}
    >
      <span>
        mode: <strong style={{ color: '#0f172a' }}>{mode}</strong>
      </span>
      <span>cursor: {cursorText}</span>
      <span>selected: {selection.length}</span>
    </div>
  )
}
