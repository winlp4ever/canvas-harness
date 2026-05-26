import type { PointerInfo } from '@canvas-harness/core'
import { useCanvasStore } from '@canvas-harness/react'
import { useEffect, useRef } from 'react'

/**
 * Subscribes directly to the store and mutates text nodes via refs —
 * bypasses React reconciliation entirely on pointermove / mode flip,
 * which fire at the monitor refresh rate during pan.
 */
const formatCursor = (p: PointerInfo | null): string =>
  p ? `(${p.worldX.toFixed(1)}, ${p.worldY.toFixed(1)}) ${p.pointerType}` : '—'

export function StatusBar() {
  const store = useCanvasStore()
  const modeRef = useRef<HTMLElement>(null)
  const cursorRef = useRef<HTMLSpanElement>(null)
  const selectionRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const s = store.getInteractionState()
    if (modeRef.current) modeRef.current.textContent = s.mode
    if (cursorRef.current) cursorRef.current.textContent = formatCursor(s.pointer)
    if (selectionRef.current) selectionRef.current.textContent = String(store.getSelection().length)

    const offInteraction = store.subscribe('interaction', state => {
      if (modeRef.current) modeRef.current.textContent = state.mode
      if (cursorRef.current) cursorRef.current.textContent = formatCursor(state.pointer)
    })
    const offSelection = store.subscribe('selection', sel => {
      if (selectionRef.current) selectionRef.current.textContent = String(sel.length)
    })
    return () => {
      offInteraction()
      offSelection()
    }
  }, [store])

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
        mode: <strong ref={modeRef} style={{ color: '#0f172a' }} />
      </span>
      <span>
        cursor: <span ref={cursorRef} />
      </span>
      <span>
        selected: <span ref={selectionRef} />
      </span>
    </div>
  )
}
