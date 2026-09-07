import type { InkToolDefaults } from '@canvas-harness/react'
import { useEffect, useState } from 'react'

/**
 * Playground UI for the built-in ink (pen) tool — stroke color, base width,
 * and the three perfect-freehand shape knobs exposed via `inkDefaults`
 * (thinning / smoothing / streamline). Shown only while the ink tool is
 * active. Persists to localStorage so the settings survive reloads.
 *
 * The library resolves `inkDefaults` at each gesture start, so slider edits
 * apply to the very next stroke.
 */

const STORAGE_KEY = 'canvas-harness-playground:ink:v1'

export type InkSettings = {
  color: string
  size: number
  thinning: number
  smoothing: number
  streamline: number
}

// Mirrors the library defaults (DEFAULT_INK_STROKE_OPTIONS + size/color).
const DEFAULT_INK_SETTINGS: InkSettings = {
  color: '#1f2937',
  size: 5,
  thinning: 0.68,
  smoothing: 0.58,
  streamline: 0.42,
}

// Light-mode palette colors that the playground's theme swap knows about, so
// strokes drawn with these flip to their dark variant on a theme toggle (a
// custom color picked below is treated as a user custom and stays put).
const PEN_COLORS = ['#1f2937', '#dc2626', '#ea580c', '#16a34a', '#0284c7', '#9333ea']

const loadInitial = (): InkSettings => {
  if (typeof window === 'undefined') return DEFAULT_INK_SETTINGS
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...DEFAULT_INK_SETTINGS, ...(JSON.parse(raw) as Partial<InkSettings>) }
  } catch {}
  return DEFAULT_INK_SETTINGS
}

/** Convert panel settings into the library's `inkDefaults` shape. */
export const inkDefaultsFromSettings = (s: InkSettings): InkToolDefaults => ({
  color: s.color,
  size: s.size,
  thinning: s.thinning,
  smoothing: s.smoothing,
  streamline: s.streamline,
})

export function InkPanel({
  value,
  onChange,
}: {
  value: InkSettings
  onChange: (next: InkSettings) => void
}) {
  const apply = (patch: Partial<InkSettings>): void => {
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
        left: 210,
        background: '#fff',
        border: '1px solid #cbd5e1',
        borderRadius: 8,
        padding: 10,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 12,
        boxShadow: '0 1px 3px rgba(0,0,0,.08)',
        zIndex: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        width: 210,
      }}
    >
      <div style={{ fontWeight: 600, color: '#475569' }}>Ink tool</div>

      <Field label="Color">
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {PEN_COLORS.map(c => (
            <button
              key={c}
              type="button"
              onClick={() => apply({ color: c })}
              style={{
                width: 22,
                height: 22,
                padding: 0,
                borderRadius: 4,
                background: c,
                border: value.color === c ? '2px solid #0f172a' : '1px solid #cbd5e1',
                cursor: 'pointer',
              }}
            />
          ))}
          <input
            type="color"
            value={value.color}
            onChange={e => apply({ color: e.target.value })}
            style={{ width: 24, height: 24, padding: 0, border: 'none', background: 'none' }}
            title="Custom color"
          />
        </div>
      </Field>

      <Slider
        label="Width"
        value={value.size}
        min={1}
        max={40}
        step={1}
        format={v => `${v}px`}
        onChange={v => apply({ size: v })}
      />
      <Slider
        label="Thinning"
        title="Pressure → width sensitivity. Higher = pressure changes width more; negative inverts it."
        value={value.thinning}
        min={-1}
        max={1}
        step={0.02}
        onChange={v => apply({ thinning: v })}
      />
      <Slider
        label="Smoothing"
        title="Outline smoothing. Higher = softer, rounder edges."
        value={value.smoothing}
        min={0}
        max={1}
        step={0.02}
        onChange={v => apply({ smoothing: v })}
      />
      <Slider
        label="Streamline"
        title="Input jitter smoothing. Higher = steadier line, more lag behind the cursor."
        value={value.streamline}
        min={0}
        max={1}
        step={0.02}
        onChange={v => apply({ streamline: v })}
      />

      <button
        type="button"
        onClick={() => apply(DEFAULT_INK_SETTINGS)}
        style={{
          marginTop: 2,
          padding: '4px 8px',
          fontSize: 11,
          background: '#f1f5f9',
          color: '#0f172a',
          border: 'none',
          borderRadius: 4,
          cursor: 'pointer',
        }}
      >
        Reset to defaults
      </button>
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

function Slider({
  label,
  title,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string
  title?: string
  value: number
  min: number
  max: number
  step: number
  format?: (v: number) => string
  onChange: (v: number) => void
}) {
  return (
    <Field label={`${label} — ${format ? format(value) : value.toFixed(2)}`}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: '100%' }}
        title={title}
      />
    </Field>
  )
}

/** State host — restores from localStorage, hands settings back to the App. */
export function useInkSettings(): {
  inkSettings: InkSettings
  setInkSettings: (next: InkSettings) => void
} {
  const [inkSettings, setInkSettings] = useState<InkSettings>(() => loadInitial())
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(inkSettings))
    } catch {}
  }, [inkSettings])
  return { inkSettings, setInkSettings }
}
