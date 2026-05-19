import type { CanvasBackground, CanvasBackgroundPattern } from '@canvas-harness/core'
import { useEffect, useState } from 'react'

/**
 * Playground UI for editing the page background — color, pattern,
 * gap, pattern color. Persists to localStorage so the choice survives
 * reloads. Returns the current background via the parent's setter.
 */

const STORAGE_KEY = 'canvas-harness-playground:background:v1'

const PATTERNS: { label: string; value: CanvasBackgroundPattern }[] = [
  { label: 'None', value: 'none' },
  { label: 'Dots', value: 'dots' },
  { label: 'Grid', value: 'grid' },
]

const PAGE_COLORS = ['#f8fafc', '#fef9c3', '#dcfce7', '#dbeafe', '#fce7f3', '#0f172a']
const PATTERN_COLORS = ['#cbd5e1', '#94a3b8', '#64748b', '#3b82f6', '#a855f7']

const loadInitial = (): CanvasBackground => {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as CanvasBackground
  } catch {}
  return {}
}

export function BackgroundPanel({
  value,
  onChange,
}: {
  value: CanvasBackground
  onChange: (next: CanvasBackground) => void
}) {
  const apply = (patch: Partial<CanvasBackground>): void => {
    const next = { ...value, ...patch }
    onChange(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {}
  }

  return (
    <div
      style={{
        position: 'absolute',
        top: 60,
        left: 12,
        background: '#fff',
        border: '1px solid #cbd5e1',
        borderRadius: 8,
        padding: 10,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 12,
        boxShadow: '0 1px 3px rgba(0,0,0,.08)',
        zIndex: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        minWidth: 180,
      }}
    >
      <div style={{ fontWeight: 600, color: '#475569' }}>Background</div>

      <Field label="Page color">
        <Palette
          colors={PAGE_COLORS}
          value={value.color}
          onChange={c => apply({ color: c })}
        />
      </Field>

      <Field label="Pattern">
        <div style={{ display: 'flex', gap: 4 }}>
          {PATTERNS.map(p => (
            <button
              key={p.value}
              type="button"
              onClick={() => apply({ pattern: p.value })}
              style={{
                padding: '4px 8px',
                fontSize: 11,
                background: (value.pattern ?? 'none') === p.value ? '#0f172a' : '#f1f5f9',
                color: (value.pattern ?? 'none') === p.value ? '#fff' : '#0f172a',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                flex: 1,
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </Field>

      {value.pattern && value.pattern !== 'none' && (
        <>
          <Field label="Pattern color">
            <Palette
              colors={PATTERN_COLORS}
              value={value.patternColor}
              onChange={c => apply({ patternColor: c })}
            />
          </Field>
          <Field label={`Gap ${value.gap ?? 20}px`}>
            <input
              type="range"
              min={8}
              max={80}
              step={4}
              value={value.gap ?? 20}
              onChange={e => apply({ gap: Number(e.target.value) })}
              style={{ width: '100%' }}
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
  onChange: (c: string) => void
}) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {colors.map(c => {
        const isActive = value === c
        return (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            style={{
              width: 22,
              height: 22,
              padding: 0,
              borderRadius: 4,
              background: c,
              border: isActive ? '2px solid #0f172a' : '1px solid #cbd5e1',
              cursor: 'pointer',
            }}
          />
        )
      })}
    </div>
  )
}

/**
 * Convenience host: holds the state, restores from localStorage, hands
 * the value back to the App so it can pass to `<Canvas background>`.
 */
export function useBackgroundState(): {
  background: CanvasBackground
  setBackground: (next: CanvasBackground) => void
} {
  const [background, setBackground] = useState<CanvasBackground>(() => loadInitial())
  useEffect(() => {
    // Persist on every change (apply() already does, but this catches
    // any future imperative setBackground calls).
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(background))
    } catch {}
  }, [background])
  return { background, setBackground }
}
