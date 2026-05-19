import {
  type CanvasStore,
  type Renderer,
  attachSync,
  createCanvasStore,
} from '@canvas-harness/core'
import { CanvasProvider } from '@canvas-harness/react'
import { createBroadcastSyncAdapter } from '@canvas-harness/sync-broadcast'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Canvas, type Tool } from './components/Canvas'
import { ExportControls } from './components/ExportControls'
import { HistoryControls } from './components/HistoryControls'
import { PerfOverlay } from './components/PerfOverlay'
import { PresenceOverlay } from './components/PresenceOverlay'
import { StressMenu } from './components/StressMenu'
import { StylePanel } from './components/StylePanel'
import { Toolbar } from './components/Toolbar'
import { chartCardDef } from './custom-nodes/chart-card'

const PRESENCE_COLORS = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#a855f7', '#ec4899']
const pickColor = () => PRESENCE_COLORS[Math.floor(Math.random() * PRESENCE_COLORS.length)]!
const pickName = () => `user-${Math.floor(Math.random() * 1000)}`

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

  // Phase 8: attach the BroadcastChannel adapter so two playground tabs
  // see each other's mutations + cursors + selections in real time.
  useEffect(() => {
    const color = pickColor()
    const name = pickName()
    store.presence.setLocal({ color, name })
    const adapter = createBroadcastSyncAdapter({
      channelName: 'canvas-harness-playground',
      clientId: store.clientId,
      initialPresence: store.presence.getLocal(),
    })
    const detach = attachSync(store, adapter)
    return () => {
      detach()
    }
  }, [store])

  // Cmd/Ctrl+Z and Cmd+Shift+Z global shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      // Don't steal undo/redo from text inputs (incl. the editor textarea).
      if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) return
      const meta = e.metaKey || e.ctrlKey
      if (!meta) return
      if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault()
        if (e.shiftKey) store.redo()
        else store.undo()
      }
      if (e.key === 'y' || e.key === 'Y') {
        e.preventDefault()
        store.redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [store])

  return (
    <CanvasProvider store={store}>
      <div style={{ position: 'fixed', inset: 0 }}>
        <Canvas tool={tool} onRenderer={onRenderer} />
        <Toolbar active={tool} onSelect={setTool} />
        <HistoryControls store={store} />
        <ExportControls store={store} />
        <StressMenu store={store} />
        <StylePanel store={store} />
        <PresenceOverlay store={store} />
        <PerfOverlay store={store} renderer={renderer} />
      </div>
    </CanvasProvider>
  )
}
