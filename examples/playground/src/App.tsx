import { type CanvasStore, type Renderer, createCanvasStore } from '@canvas-harness/core'
import { useCallback, useRef, useState } from 'react'
import { Canvas, type Tool } from './components/Canvas'
import { PerfOverlay } from './components/PerfOverlay'
import { StressMenu } from './components/StressMenu'
import { StylePanel } from './components/StylePanel'
import { Toolbar } from './components/Toolbar'
import { chartCardDef } from './custom-nodes/chart-card'

/**
 * Phase 2 playground:
 *  - top tray for active-tool selection (rect/ellipse/diamond/capsule;
 *    select disabled until phase 3)
 *  - perf overlay (FPS, frame time, drawn count, camera state)
 *  - stress menu (100 / 1k / 10k rect fixtures + clear)
 *  - pan (middle button or space+drag) + zoom (cmd/ctrl+scroll, pinch)
 *  - click-to-create with the active shape tool
 *
 * Store exposed on window.store for console inspection.
 */
export function App() {
  const storeRef = useRef<CanvasStore | null>(null)
  if (!storeRef.current) {
    storeRef.current = createCanvasStore({ nodeTypes: [chartCardDef] })
    if (typeof window !== 'undefined') {
      ;(window as unknown as { store: CanvasStore }).store = storeRef.current
    }
  }
  const store = storeRef.current

  const [tool, setTool] = useState<Tool>('select')
  const [renderer, setRenderer] = useState<Renderer | null>(null)

  const onRenderer = useCallback((r: Renderer) => {
    setRenderer(r)
    if (typeof window !== 'undefined') {
      ;(window as unknown as { renderer: Renderer }).renderer = r
    }
  }, [])

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Canvas store={store} tool={tool} onRenderer={onRenderer} />
      <Toolbar active={tool} onSelect={setTool} />
      <StressMenu store={store} />
      <StylePanel store={store} />
      <PerfOverlay store={store} renderer={renderer} />
    </div>
  )
}
