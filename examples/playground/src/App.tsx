import { VERSION as coreVersion } from '@canvas-harness/core'
import { VERSION as reactVersion } from '@canvas-harness/react'

export function App() {
  return (
    <div
      style={{
        padding: 24,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        color: '#0f172a',
        maxWidth: 640,
      }}
    >
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>canvas-harness playground</h1>
      <p style={{ color: '#64748b', marginBottom: 16 }}>
        @canvas-harness/core v{coreVersion} · @canvas-harness/react v{reactVersion}
      </p>
      <p>
        Phase 0: scaffolding only. The renderer arrives in phase 2, edges in phase 4, edit mode in
        phase 7. See <code>IMPLEMENTATION.md</code> for the full plan.
      </p>
    </div>
  )
}
