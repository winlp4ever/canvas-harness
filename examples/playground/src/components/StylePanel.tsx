import type { CanvasStore, NodeId, Style } from '@canvas-harness/core'
import { useEffect, useState } from 'react'

/**
 * Per ARCHITECTURE.md §3.4 + IMPLEMENTATION.md §3.1 phase-3 deliverable:
 * starts with stroke color + background color + stroke width + opacity.
 * Additional fields land in later phases as their library support arrives.
 */
const FILL_PALETTE = [
  '#dbeafe',
  '#fef08a',
  '#fde68a',
  '#fecaca',
  '#bbf7d0',
  '#e9d5ff',
  '#fed7aa',
  '#ffffff',
]
const STROKE_PALETTE = [
  '#1f2937',
  '#dc2626',
  '#ea580c',
  '#16a34a',
  '#0284c7',
  '#9333ea',
  '#00000000',
]
const STROKE_WIDTH_PRESETS: Array<{ label: string; width: number }> = [
  { label: 'S', width: 1 },
  { label: 'M', width: 2 },
  { label: 'L', width: 4 },
]

export function StylePanel({ store }: { store: CanvasStore }) {
  const [selectionIds, setSelectionIds] = useState<NodeId[]>(() => store.getSelection() as NodeId[])
  const [, setTick] = useState(0)

  useEffect(() => {
    const unsubSel = store.subscribe('selection', sel => setSelectionIds(sel as NodeId[]))
    const unsubChange = store.subscribe('change', () => setTick(t => t + 1))
    return () => {
      unsubSel()
      unsubChange()
    }
  }, [store])

  if (selectionIds.length === 0) return null

  const nodes = selectionIds
    .map(id => store.getNode(id))
    .filter((n): n is NonNullable<typeof n> => Boolean(n))
  if (nodes.length === 0) return null

  // Show the first selection's current values; if mixed, show the first one
  // and let any edit apply to the whole selection.
  const sample = nodes[0]!.style ?? {}

  const apply = (patch: Partial<Style>) => {
    store.batch(() => {
      for (const id of selectionIds) {
        const n = store.getNode(id)
        if (!n) continue
        store.updateNode(id, { style: { ...n.style, ...patch } })
      }
    })
  }

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 12,
        right: 12,
        background: '#fff',
        border: '1px solid #cbd5e1',
        borderRadius: 8,
        padding: 12,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 12,
        boxShadow: '0 1px 3px rgba(0,0,0,.08)',
        zIndex: 11, // above perf overlay
        minWidth: 240,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ fontWeight: 600, color: '#475569' }}>
        Selection: {selectionIds.length} {selectionIds.length === 1 ? 'node' : 'nodes'}
      </div>

      <Field label="Fill">
        <Palette
          colors={FILL_PALETTE}
          value={sample.backgroundColor}
          onChange={color => apply({ backgroundColor: color })}
        />
      </Field>

      <Field label="Stroke">
        <Palette
          colors={STROKE_PALETTE}
          value={sample.strokeColor}
          onChange={color => apply({ strokeColor: color })}
        />
      </Field>

      <Field label="Stroke width">
        <SegmentedControl
          options={STROKE_WIDTH_PRESETS.map(p => ({ label: p.label, value: p.width }))}
          value={sample.strokeWidth ?? 2}
          onChange={w => apply({ strokeWidth: w })}
        />
      </Field>

      <Field label={`Opacity ${sample.opacity ?? 100}`}>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={sample.opacity ?? 100}
          onChange={e => apply({ opacity: Number(e.target.value) })}
          style={{ width: '100%' }}
        />
      </Field>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ color: '#64748b', fontSize: 11 }}>{label}</div>
      {children}
    </div>
  )
}

function Palette({
  colors,
  value,
  onChange,
}: {
  colors: string[]
  value: string | undefined
  onChange: (color: string) => void
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {colors.map(c => {
        const isTransparent = c === '#00000000'
        const isActive = (value ?? '').toLowerCase() === c.toLowerCase()
        return (
          <button
            type="button"
            key={c}
            onClick={() => onChange(c)}
            title={c}
            style={{
              width: 22,
              height: 22,
              padding: 0,
              borderRadius: 4,
              border: isActive ? '2px solid #0f172a' : '1px solid #cbd5e1',
              background: isTransparent
                ? 'repeating-conic-gradient(#cbd5e1 0% 25%, #fff 0% 50%) 50% / 8px 8px'
                : c,
              cursor: 'pointer',
            }}
          />
        )
      })}
    </div>
  )
}

function SegmentedControl<T>({
  options,
  value,
  onChange,
}: {
  options: Array<{ label: string; value: T }>
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div style={{ display: 'flex', gap: 2, background: '#f1f5f9', padding: 2, borderRadius: 4 }}>
      {options.map(o => {
        const isActive = o.value === value
        return (
          <button
            type="button"
            key={o.label}
            onClick={() => onChange(o.value)}
            style={{
              flex: 1,
              padding: '4px 8px',
              fontSize: 12,
              background: isActive ? '#0f172a' : 'transparent',
              color: isActive ? '#fff' : '#0f172a',
              border: 'none',
              borderRadius: 3,
              cursor: 'pointer',
            }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
