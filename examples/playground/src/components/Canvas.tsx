import {
  type CanvasStore,
  type Renderer,
  asNodeId,
  createRenderer,
  screenToWorld,
} from '@canvas-harness/core'
import { useEffect, useRef } from 'react'
import { useArrowTool } from '../hooks/useArrowTool'
import { useInteraction } from '../hooks/useInteraction'
import { usePanZoom } from '../hooks/usePanZoom'
import { useResizeObserver } from '../hooks/useResizeObserver'

export type CanvasProps = {
  store: CanvasStore
  tool: Tool
  onRenderer?: (r: Renderer) => void
}

export type Tool = 'select' | 'rect' | 'ellipse' | 'diamond' | 'capsule' | 'arrow'

const SHAPE_TOOLS = new Set(['rect', 'ellipse', 'diamond', 'capsule'])
const TOOL_TO_TYPE: Record<
  'rect' | 'ellipse' | 'diamond' | 'capsule',
  'rect' | 'ellipse' | 'diamond' | 'capsule'
> = {
  rect: 'rect',
  ellipse: 'ellipse',
  diamond: 'diamond',
  capsule: 'capsule',
}

export function Canvas({ store, tool, onRenderer }: CanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const staticRef = useRef<HTMLCanvasElement>(null)
  const interactiveRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<Renderer | null>(null)
  const toolRef = useRef(tool)
  toolRef.current = tool

  const { w, h } = useResizeObserver(wrapRef)
  usePanZoom(wrapRef, store)
  useInteraction(wrapRef, store, tool)
  useArrowTool(wrapRef, store, tool === 'arrow')

  // create the renderer once both canvases mount
  useEffect(() => {
    if (!staticRef.current || !interactiveRef.current || w === 0 || h === 0) return
    if (rendererRef.current) {
      rendererRef.current.setSize(w, h)
      return
    }
    const r = createRenderer({
      store,
      staticCanvas: staticRef.current,
      interactiveCanvas: interactiveRef.current,
      width: w,
      height: h,
    })
    r.start()
    rendererRef.current = r
    onRenderer?.(r)
    return () => {
      r.dispose()
      rendererRef.current = null
    }
  }, [store, w, h, onRenderer])

  // click-to-create when a shape tool is active
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const onClick = (e: MouseEvent) => {
      const t = toolRef.current
      if (!SHAPE_TOOLS.has(t)) return
      const rect = el.getBoundingClientRect()
      const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top }
      const world = screenToWorld(screen, store.getCamera())
      store.addNode({
        id: asNodeId(store.generateId()),
        type: TOOL_TO_TYPE[t as keyof typeof TOOL_TO_TYPE],
        x: world.x - 60,
        y: world.y - 40,
        w: 120,
        h: 80,
        angle: 0,
        z: 0,
        groups: [],
      })
    }
    el.addEventListener('click', onClick)
    return () => el.removeEventListener('click', onClick)
  }, [store])

  return (
    <div
      ref={wrapRef}
      style={{
        position: 'absolute',
        inset: 0,
        background: '#f8fafc',
        overflow: 'hidden',
        cursor: tool === 'select' ? 'default' : 'crosshair',
        touchAction: 'none',
      }}
    >
      <canvas ref={staticRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
      <canvas
        ref={interactiveRef}
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      />
    </div>
  )
}
