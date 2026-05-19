import { type CanvasStore, exportSelection, exportSelectionSvg } from '@canvas-harness/core'

/**
 * Phase 10 deliverable: export the current selection to PNG (opaque or
 * transparent) or SVG. Files download via blob URLs.
 */
export function ExportControls({ store }: { store: CanvasStore }) {
  const downloadBlob = (blob: Blob, name: string): void => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
  }

  const onPng = async (transparent: boolean): Promise<void> => {
    const blob = await exportSelection(store, { transparentBackground: transparent })
    downloadBlob(blob, transparent ? 'canvas-harness.transparent.png' : 'canvas-harness.png')
  }

  const onSvg = (): void => {
    const svg = exportSelectionSvg(store)
    downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), 'canvas-harness.svg')
  }

  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        right: 12,
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
      <Btn label="PNG" onClick={() => void onPng(false)} title="Export selection as PNG" />
      <Btn
        label="PNG (transparent)"
        onClick={() => void onPng(true)}
        title="Export selection as PNG with transparent background"
      />
      <Btn label="SVG" onClick={onSvg} title="Export selection as SVG (plain text)" />
    </div>
  )
}

function Btn({ label, onClick, title }: { label: string; onClick: () => void; title: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        padding: '6px 12px',
        fontSize: 13,
        background: 'transparent',
        color: '#0f172a',
        border: 'none',
        borderRadius: 5,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  )
}
