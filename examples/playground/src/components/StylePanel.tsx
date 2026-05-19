import type {
  Arrowhead,
  CanvasStore,
  EdgeId,
  EdgeStyle,
  NodeId,
  PathStyle,
  Style,
} from '@canvas-harness/core'
import { useEffect, useState } from 'react'

/**
 * Per ARCHITECTURE.md §3.4 + IMPLEMENTATION.md §3.1 phase-3/4 deliverable.
 * Node selection: fill / stroke / stroke width / opacity.
 * Edge selection: stroke / stroke width / opacity / arrowheads / path style.
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
const ARROWHEAD_OPTIONS: Array<{ label: string; value: Arrowhead }> = [
  { label: 'none', value: 'none' },
  { label: 'arrow', value: 'arrow' },
  { label: 'barb', value: 'barb' },
  { label: 'filled', value: 'arrow-filled' },
]
const PATH_STYLE_OPTIONS: Array<{ label: string; value: PathStyle }> = [
  { label: 'straight', value: 'straight' },
  { label: 'bezier', value: 'bezier' },
  { label: 'polyline', value: 'polyline' },
]

export function StylePanel({ store }: { store: CanvasStore }) {
  const [selectionIds, setSelectionIds] = useState<(NodeId | EdgeId)[]>(() => store.getSelection())
  const [, setTick] = useState(0)

  useEffect(() => {
    const unsubSel = store.subscribe('selection', sel => setSelectionIds(sel))
    const unsubChange = store.subscribe('change', () => setTick(t => t + 1))
    return () => {
      unsubSel()
      unsubChange()
    }
  }, [store])

  if (selectionIds.length === 0) return null

  const selectedNodeIds: NodeId[] = []
  const selectedEdgeIds: EdgeId[] = []
  for (const id of selectionIds) {
    if (store.getNode(id as NodeId)) selectedNodeIds.push(id as NodeId)
    else if (store.getEdge(id as EdgeId)) selectedEdgeIds.push(id as EdgeId)
  }
  const totalCount = selectedNodeIds.length + selectedEdgeIds.length
  if (totalCount === 0) return null

  const nodesOnly = selectedEdgeIds.length === 0 && selectedNodeIds.length > 0
  const edgesOnly = selectedNodeIds.length === 0 && selectedEdgeIds.length > 0

  // Pick a sample style from whichever set we have.
  const sampleNode = selectedNodeIds[0] ? store.getNode(selectedNodeIds[0]) : null
  const sampleEdge = selectedEdgeIds[0] ? store.getEdge(selectedEdgeIds[0]) : null
  const sampleStyle: Style | EdgeStyle = (sampleNode?.style ?? sampleEdge?.style ?? {}) as
    | Style
    | EdgeStyle

  const applyNodeStyle = (patch: Partial<Style>) => {
    store.batch(() => {
      for (const id of selectedNodeIds) {
        const n = store.getNode(id)
        if (!n) continue
        store.updateNode(id, { style: { ...n.style, ...patch } })
      }
    })
  }
  const applyEdgeStyle = (patch: Partial<EdgeStyle>) => {
    store.batch(() => {
      for (const id of selectedEdgeIds) {
        const e = store.getEdge(id)
        if (!e) continue
        store.updateEdge(id, { style: { ...e.style, ...patch } })
      }
    })
  }
  const applyAny = (patch: Partial<EdgeStyle>) => {
    applyNodeStyle(patch as Partial<Style>)
    applyEdgeStyle(patch)
  }
  const applyEdgePath = (pathStyle: PathStyle) => {
    store.batch(() => {
      for (const id of selectedEdgeIds) store.updateEdge(id, { pathStyle })
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
        zIndex: 11,
        minWidth: 240,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ fontWeight: 600, color: '#475569' }}>
        Selection: {selectedNodeIds.length}n {selectedEdgeIds.length}e
      </div>

      {nodesOnly && (
        <Field label="Fill">
          <Palette
            colors={FILL_PALETTE}
            value={(sampleStyle as Style).backgroundColor}
            onChange={color => applyNodeStyle({ backgroundColor: color })}
          />
        </Field>
      )}

      <Field label="Stroke">
        <Palette
          colors={STROKE_PALETTE}
          value={sampleStyle.strokeColor}
          onChange={color => applyAny({ strokeColor: color })}
        />
      </Field>

      <Field label="Stroke width">
        <SegmentedControl
          options={STROKE_WIDTH_PRESETS.map(p => ({ label: p.label, value: p.width }))}
          value={sampleStyle.strokeWidth ?? 2}
          onChange={w => applyAny({ strokeWidth: w })}
        />
      </Field>

      <Field label={`Opacity ${sampleStyle.opacity ?? 100}`}>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={sampleStyle.opacity ?? 100}
          onChange={e => applyAny({ opacity: Number(e.target.value) })}
          style={{ width: '100%' }}
        />
      </Field>

      {edgesOnly && (
        <>
          <Field label="Path style">
            <SegmentedControl
              options={PATH_STYLE_OPTIONS}
              value={sampleEdge?.pathStyle ?? 'bezier'}
              onChange={ps => applyEdgePath(ps)}
            />
          </Field>
          <Field label="Source arrow">
            <SegmentedControl
              options={ARROWHEAD_OPTIONS}
              value={(sampleStyle as EdgeStyle).sourceArrowhead ?? 'none'}
              onChange={ah => applyEdgeStyle({ sourceArrowhead: ah })}
            />
          </Field>
          <Field label="Target arrow">
            <SegmentedControl
              options={ARROWHEAD_OPTIONS}
              value={(sampleStyle as EdgeStyle).targetArrowhead ?? 'arrow-filled'}
              onChange={ah => applyEdgeStyle({ targetArrowhead: ah })}
            />
          </Field>
        </>
      )}
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
