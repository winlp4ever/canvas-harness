import type { CanvasStore } from '@canvas-harness/core'
import { useEffect, useState } from 'react'

/**
 * Phase 8 deliverable: Undo / Redo buttons in the tray. Reflects
 * canUndo/canRedo and re-renders on any 'change' event.
 */
export function HistoryControls({ store }: { store: CanvasStore }) {
  const [, force] = useState(0)
  useEffect(() => {
    // Either stack flips on every committed batch (local) and every
    // undo/redo, so subscribing to 'change' is sufficient.
    return store.subscribe('change', () => force(n => n + 1))
  }, [store])

  const canUndo = store.canUndo()
  const canRedo = store.canRedo()

  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        left: 12,
        display: 'flex',
        gap: 4,
        padding: 4,
        background: '#fff',
        border: '1px solid #cbd5e1',
        borderRadius: 8,
        boxShadow: '0 1px 3px rgba(0,0,0,.08)',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 13,
        zIndex: 10,
      }}
    >
      <Btn label="Undo" disabled={!canUndo} onClick={() => store.undo()} title="Cmd/Ctrl+Z" />
      <Btn
        label="Redo"
        disabled={!canRedo}
        onClick={() => store.redo()}
        title="Cmd/Ctrl+Shift+Z"
      />
    </div>
  )
}

function Btn({
  label,
  disabled,
  onClick,
  title,
}: {
  label: string
  disabled: boolean
  onClick: () => void
  title: string
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title}
      style={{
        padding: '6px 12px',
        fontSize: 13,
        background: 'transparent',
        color: disabled ? '#94a3b8' : '#0f172a',
        border: 'none',
        borderRadius: 5,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {label}
    </button>
  )
}
