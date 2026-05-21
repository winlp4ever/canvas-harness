import { type CanvasStore, getContext } from '@canvas-harness/core'
import { useState } from 'react'

/**
 * Quick test affordance: copy `getContext({ format: 'markdown' })` to
 * the system clipboard so the user can paste it into an LLM chat and
 * see how the scene looks from an agent's perspective.
 */
export function AiContextButton({ store }: { store: CanvasStore }) {
  const [label, setLabel] = useState('Copy AI context')

  const onClick = async (): Promise<void> => {
    const md = getContext(store, { format: 'markdown' }) as string
    try {
      await navigator.clipboard.writeText(md)
      setLabel('Copied!')
    } catch {
      setLabel('Copy failed — see console')
    }
    setTimeout(() => setLabel('Copy AI context'), 1500)
  }

  return (
    <div
      style={{
        position: 'absolute',
        top: 60,
        right: 12,
        background: '#fff',
        border: '1px solid #cbd5e1',
        borderRadius: 8,
        boxShadow: '0 1px 3px rgba(0,0,0,.08)',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 13,
        zIndex: 10,
      }}
    >
      <button
        type="button"
        onClick={onClick}
        style={{
          padding: '6px 12px',
          fontSize: 13,
          background: 'transparent',
          color: '#0f172a',
          border: 'none',
          borderRadius: 5,
          cursor: 'pointer',
        }}
        title="Markdown summary of the current scene (good for pasting into an LLM chat)"
      >
        {label}
      </button>
    </div>
  )
}
