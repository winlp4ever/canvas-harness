import type { Tool } from './Canvas'

type ToolDef = { id: Tool; label: string; enabled: boolean }

const TOOLS: ToolDef[] = [
  { id: 'select', label: 'Select', enabled: true },
  { id: 'pan', label: 'Pan', enabled: true },
  { id: 'rect', label: 'Rect', enabled: true },
  { id: 'ellipse', label: 'Ellipse', enabled: true },
  { id: 'diamond', label: 'Diamond', enabled: true },
  { id: 'tag', label: 'Tag', enabled: true },
  { id: 'capsule', label: 'Capsule', enabled: true },
  { id: 'thought-cloud', label: 'Cloud', enabled: true },
  { id: 'layered-rect', label: 'Lyr Rect', enabled: true },
  { id: 'layered-ellipse', label: 'Lyr Ell', enabled: true },
  { id: 'layered-diamond', label: 'Lyr Dmnd', enabled: true },
  { id: 'soft-diamond', label: 'Sft Dmnd', enabled: true },
  { id: 'arrow', label: 'Arrow', enabled: true },
  { id: 'text', label: 'Text', enabled: true },
  { id: 'frame', label: 'Frame', enabled: true },
]

export function Toolbar({
  active,
  onSelect,
}: {
  active: Tool
  onSelect: (tool: Tool) => void
}) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        left: '50%',
        transform: 'translateX(-50%)',
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
      {TOOLS.map(t => {
        const isActive = active === t.id
        const disabled = !t.enabled
        return (
          <button
            key={t.id}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(t.id)}
            style={{
              padding: '6px 12px',
              fontSize: 13,
              fontWeight: isActive ? 600 : 400,
              background: isActive ? '#0f172a' : 'transparent',
              color: disabled ? '#94a3b8' : isActive ? '#fff' : '#0f172a',
              border: 'none',
              borderRadius: 5,
              cursor: disabled ? 'not-allowed' : 'pointer',
            }}
            title={disabled ? `${t.label} — phase 3+` : t.label}
          >
            {t.label}
          </button>
        )
      })}
    </div>
  )
}
