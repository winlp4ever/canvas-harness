import type { CanvasStore, Renderer } from '@canvas-harness/core'
import { useEffect, useState } from 'react'

/**
 * Minimal perf overlay — FPS + frame time + node/edge counts.
 * Upgraded to detailed view in phase 13 (cache hit rates, memory, etc.).
 */
export function PerfOverlay({
  store,
  renderer,
}: {
  store: CanvasStore
  renderer: Renderer | null
}) {
  const [tick, setTick] = useState(0)

  // Drive a 4Hz refresh — enough to read, cheap on the renderer.
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 250)
    return () => clearInterval(id)
  }, [])

  const stats = renderer?.stats() ?? { lastMs: 0, avgMs: 0, frames: 0, fps: 0 }
  const drawCount = renderer?.lastDrawCount() ?? 0
  const camera = store.getCamera()

  return (
    <div
      data-tick={tick}
      style={{
        position: 'absolute',
        bottom: 12,
        right: 12,
        background: '#0f172a',
        color: '#f1f5f9',
        padding: '8px 12px',
        borderRadius: 6,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 11,
        lineHeight: 1.5,
        zIndex: 10,
        minWidth: 220,
      }}
    >
      <div>
        FPS <strong>{stats.fps}</strong> · last <strong>{stats.lastMs.toFixed(1)}ms</strong> · avg{' '}
        <strong>{stats.avgMs.toFixed(1)}ms</strong>
      </div>
      <div>
        drew <strong>{drawCount}</strong> / total {store.getAllNodes().length}n{' '}
        {store.getAllEdges().length}e
      </div>
      <div>
        cam{' '}
        <strong>
          {camera.x.toFixed(0)}, {camera.y.toFixed(0)}
        </strong>{' '}
        · zoom <strong>{camera.z.toFixed(2)}</strong>
      </div>
    </div>
  )
}
