import {
  type CanvasStore,
  type Renderer,
  attachSync,
  createCanvasStore,
} from '@canvas-harness/core'
import { CanvasProvider, Minimap } from '@canvas-harness/react'
import { createBroadcastSyncAdapter } from '@canvas-harness/sync-broadcast'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AiContextButton } from './components/AiContextButton'
import { BackgroundPanel, useBackgroundState } from './components/BackgroundPanel'
import { Canvas, type Tool } from './components/Canvas'
import { ExportControls } from './components/ExportControls'
import { ExtensionsMenu } from './components/ExtensionsMenu'
import { HistoryControls } from './components/HistoryControls'
import { PerfOverlay } from './components/PerfOverlay'
import { PresenceOverlay } from './components/PresenceOverlay'
import { SaveStatus } from './components/SaveStatus'
import { StatusBar } from './components/StatusBar'
import { StressMenu } from './components/StressMenu'
import { StylePanel } from './components/StylePanel'
import { ThemeToggle } from './components/ThemeToggle'
import { Toolbar } from './components/Toolbar'
import { chartCardDef } from './custom-nodes/chart-card'
import { fakeSave } from './db/fake-db'
import { swapSceneColors } from './hooks/swap-theme-colors'
import { useDebouncedSave } from './hooks/useDebouncedSave'
import { getThemeBackground, useThemeMode } from './hooks/useThemeMode'

const PRESENCE_COLORS = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#a855f7', '#ec4899']
const pickColor = () => PRESENCE_COLORS[Math.floor(Math.random() * PRESENCE_COLORS.length)]!
const pickName = () => `user-${Math.floor(Math.random() * 1000)}`

/**
 * Phase 2 playground:
 *  - top tray for active-tool selection (rect/ellipse/diamond/tag/capsule/
 *    thought-cloud/layered-*; select disabled until phase 3)
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
  const { background, setBackground } = useBackgroundState()
  const themeMode = useThemeMode()
  // Couple the theme toggle to the BackgroundPanel state: flipping
  // mode replaces the user's chosen background with the new preset
  // (user can still re-edit afterward via BackgroundPanel).
  const handleThemeToggle = useCallback(() => {
    const nextMode = themeMode.mode === 'light' ? 'dark' : 'light'
    themeMode.setMode(nextMode)
    setBackground(getThemeBackground(nextMode))
    // Demo-fidelity: swap shape colors that match the playground's
    // known palette. Custom user colors stay untouched.
    swapSceneColors(store, themeMode.mode, nextMode)
  }, [themeMode, setBackground, store])

  const onRenderer = useCallback((r: Renderer) => {
    setRenderer(r)
    if (typeof window !== 'undefined') {
      ;(window as unknown as { renderer: Renderer }).renderer = r
    }
  }, [])

  // Debounced persistence — reference wiring for consumer apps.
  // Subscribes to store commits + camera, batches at 500ms idle,
  // then awaits an async save (a fake DB here; swap for fetch).
  const saveStatus = useDebouncedSave({ store, save: fakeSave })

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

  // Single-key tool shortcuts: V → select, H → hand (pan). Standard
  // across Figma / Sketch / Miro / tldraw. Skipped while a text field
  // is focused so typing in the inline editor doesn't switch tools.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'v' || e.key === 'V') setTool('select')
      else if (e.key === 'h' || e.key === 'H') setTool('pan')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <CanvasProvider store={store}>
      <div style={{ position: 'fixed', inset: 0 }}>
        <Canvas
          tool={tool}
          onRenderer={onRenderer}
          background={background}
          theme={themeMode.theme}
          selectionColor="#8b5cf6"
        />
        <Toolbar active={tool} onSelect={setTool} />
        <HistoryControls store={store} />
        <ThemeToggle mode={themeMode.mode} onToggle={handleThemeToggle} />
        <BackgroundPanel value={background} onChange={setBackground} />
        <ExportControls store={store} />
        <AiContextButton store={store} />
        <StressMenu store={store} />
        <StylePanel store={store} />
        <PresenceOverlay store={store} />
        <ExtensionsMenu store={store} />
        <SaveStatus status={saveStatus} />
        <StatusBar />
        <Minimap
          width={200}
          height={140}
          viewportColor="#8b5cf6"
          backgroundColor={themeMode.mode === 'dark' ? '#1e293b' : '#ffffff'}
          borderColor={themeMode.mode === 'dark' ? '#334155' : '#cbd5e1'}
          defaultNodeColor={themeMode.mode === 'dark' ? '#475569' : '#94a3b8'}
          style={{
            position: 'absolute',
            bottom: 110,
            right: 12,
            width: 200,
            height: 140,
            background: themeMode.mode === 'dark' ? '#1e293b' : '#ffffff',
            border: `1px solid ${themeMode.mode === 'dark' ? '#334155' : '#cbd5e1'}`,
            borderRadius: 6,
            boxShadow: '0 1px 3px rgba(0,0,0,.08)',
            overflow: 'hidden',
            zIndex: 10,
          }}
        />
        <PerfOverlay store={store} renderer={renderer} />
      </div>
    </CanvasProvider>
  )
}
