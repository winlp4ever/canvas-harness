import type { CanvasStore } from '@canvas-harness/core'
import { useState } from 'react'
import {
  type Fixture,
  clearScene,
  fixture1kAtomic,
  fixture1kLabeledEdges,
  fixture1kLayered,
  fixture1kRects,
  fixture1kSvg,
  fixture5kEdges,
  fixture10kRects,
  fixture100Rects,
  fixture200Cards,
  fixtureMarkdownHeavy,
} from '../fixtures'

type Entry = { label: string; fn: Fixture }
const ENTRIES: Entry[] = [
  { label: '+ 100 rects', fn: fixture100Rects },
  { label: '+ 1k rects', fn: fixture1kRects },
  // "Atomic" = rect/ellipse/diamond/capsule. Cheap to paint.
  { label: '+ 1k atomic', fn: fixture1kAtomic },
  // "Layered" = layered-rect/-ellipse/-diamond. 2 sub-drawables per
  // node + per-frame `darkenedStyle` object allocation; the suspect
  // for the pan lag at 1k.
  { label: '+ 1k layered', fn: fixture1kLayered },
  // "SVG" = tag + thought-cloud. Custom union paths with curves.
  { label: '+ 1k svg', fn: fixture1kSvg },
  { label: '+ 10k rects', fn: fixture10kRects },
  { label: '+ 5k edges', fn: fixture5kEdges },
  { label: '+ 1k labeled edges', fn: fixture1kLabeledEdges },
  { label: '+ 200 cards', fn: fixture200Cards },
  { label: '+ markdown-heavy', fn: fixtureMarkdownHeavy },
  { label: 'Clear scene', fn: clearScene },
]

export function StressMenu({ store }: { store: CanvasStore }) {
  const [lastResult, setLastResult] = useState<string>('')

  const handle = (entry: Entry) => {
    const result = entry.fn(store)
    setLastResult(
      `${entry.label}: ${result.added > 0 ? '+' : ''}${result.added} in ${result.ms.toFixed(1)}ms`,
    )
  }

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 12,
        left: 12,
        background: '#fff',
        border: '1px solid #cbd5e1',
        borderRadius: 8,
        padding: 8,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 12,
        boxShadow: '0 1px 3px rgba(0,0,0,.08)',
        zIndex: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>Stress test</div>
      {ENTRIES.map(e => (
        <button
          key={e.label}
          type="button"
          onClick={() => handle(e)}
          style={{
            padding: '4px 8px',
            fontSize: 12,
            background: '#f1f5f9',
            border: '1px solid #cbd5e1',
            borderRadius: 4,
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          {e.label}
        </button>
      ))}
      {lastResult && (
        <div style={{ marginTop: 4, color: '#64748b', fontFamily: 'ui-monospace, monospace' }}>
          {lastResult}
        </div>
      )}
    </div>
  )
}
