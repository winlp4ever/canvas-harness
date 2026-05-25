import { type CanvasBackground, asNodeId, hitTestAny, screenToWorld } from '@canvas-harness/core'
import {
  type ArrowToolDefaults,
  type CanvasCreateDragEvent,
  type CanvasPointerEvent,
  Canvas as LibCanvas,
  type ThemeResolver,
  useCanvasStore,
} from '@canvas-harness/react'
import { type DragEvent, useCallback, useMemo, useRef, useState } from 'react'
import { ChartCardView } from '../custom-nodes/chart-card'
import { useStyleMemory } from '../hooks/useStyleMemory'

type ShapeTool =
  | 'rect'
  | 'ellipse'
  | 'diamond'
  | 'tag'
  | 'capsule'
  | 'thought-cloud'
  | 'layered-rect'
  | 'layered-ellipse'
  | 'layered-diamond'
  | 'soft-diamond'
  | 'frame'

export type Tool = 'select' | 'pan' | ShapeTool | 'arrow' | 'text'

const SHAPE_TOOLS = new Set<Tool>([
  'rect',
  'ellipse',
  'diamond',
  'tag',
  'capsule',
  'thought-cloud',
  'layered-rect',
  'layered-ellipse',
  'layered-diamond',
  'soft-diamond',
  'frame',
])
// Tool name === node type for all shape tools today.
const TOOL_TO_TYPE: Record<ShapeTool, ShapeTool> = {
  rect: 'rect',
  ellipse: 'ellipse',
  diamond: 'diamond',
  tag: 'tag',
  capsule: 'capsule',
  'thought-cloud': 'thought-cloud',
  'layered-rect': 'layered-rect',
  'layered-ellipse': 'layered-ellipse',
  'layered-diamond': 'layered-diamond',
  'soft-diamond': 'soft-diamond',
  frame: 'frame',
}

/**
 * Phase 9: the playground's Canvas is now a thin shell over the
 * `<Canvas>` component from `@canvas-harness/react`. All renderer
 * mounting / resize / gesture / overlay / editor wiring is internal to
 * the library now.
 *
 * The playground only ships:
 *   - tool-aware click → create-shape / create-text node policy
 *   - the registered ChartCard custom-node React view
 */
const isSvgFile = (file: File): boolean =>
  file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg')

export function Canvas({
  tool,
  onRenderer,
  background,
  theme,
  selectionColor,
}: {
  tool: Tool
  onRenderer?: Parameters<typeof LibCanvas>[0]['onRenderer']
  background?: CanvasBackground
  theme?: ThemeResolver
  selectionColor?: string
}) {
  const store = useCanvasStore()
  const styleMemory = useStyleMemory(store)

  // Tap-to-create: places a default-size shape at the click point.
  // Drag-to-create handles the resize-on-create gesture; sub-threshold
  // drags fall through to onClick.
  const handleClick = useCallback(
    (e: CanvasPointerEvent) => {
      const t = e.tool as Tool
      if (SHAPE_TOOLS.has(t)) {
        const isFrame = t === 'frame'
        const remembered = styleMemory.getNodeStyle()
        // Frames are organizational chrome — no rough wobble, no
        // remembered fill/stroke. Other shapes default to roughness:1
        // with the user's last-used style merged in.
        const style = isFrame ? undefined : { roughness: 1, ...remembered }
        // Frames default to slide-shaped 600x400; other shapes 120x80.
        const w = isFrame ? 600 : 120
        const h = isFrame ? 400 : 80
        const frameIndex = isFrame ? store.getFrames().length + 1 : 0
        store.addNode({
          id: asNodeId(store.generateId()),
          type: TOOL_TO_TYPE[t as keyof typeof TOOL_TO_TYPE],
          x: e.world.x - w / 2,
          y: e.world.y - h / 2,
          w,
          h,
          angle: 0,
          groups: [],
          ...(isFrame ? { content: `Frame ${frameIndex}` } : {}),
          style,
        })
        return
      }
      if (t === 'text') {
        const id = asNodeId(store.generateId())
        const remembered = styleMemory.getNodeStyle()
        store.addNode({
          id,
          type: 'text',
          x: e.world.x - 100,
          y: e.world.y - 16,
          w: 200,
          h: 32,
          angle: 0,
          groups: [],
          content: '',
          style: { fontSize: 'M', textAlign: 'left', ...remembered },
        })
        store.beginEdit(id)
      }
    },
    [store, styleMemory],
  )

  // Double-click on empty board → spawn an empty text node and enter
  // edit mode (excalidraw-style). On a node, the library already calls
  // beginEdit internally; here we cover the "miss" case.
  const handleDoubleClick = useCallback(
    (e: CanvasPointerEvent) => {
      if (e.tool !== 'select') return
      const camera = store.getCamera()
      if (hitTestAny(store, e.world, camera.z)) return
      const id = asNodeId(store.generateId())
      const remembered = styleMemory.getNodeStyle()
      store.addNode({
        id,
        type: 'text',
        x: e.world.x - 100,
        y: e.world.y - 16,
        w: 200,
        h: 32,
        angle: 0,
        groups: [],
        content: '',
        style: { fontSize: 'M', textAlign: 'left', ...remembered },
      })
      store.beginEdit(id)
    },
    [store, styleMemory],
  )

  // Drag-to-create: shape sized to the dragged rect.
  const handleCreateDrag = useCallback(
    (e: CanvasCreateDragEvent) => {
      const t = e.tool as Tool
      if (!SHAPE_TOOLS.has(t)) return
      const isFrame = t === 'frame'
      const remembered = styleMemory.getNodeStyle()
      const style = isFrame ? undefined : { roughness: 1, ...remembered }
      const frameIndex = isFrame ? store.getFrames().length + 1 : 0
      store.addNode({
        id: asNodeId(store.generateId()),
        type: TOOL_TO_TYPE[t as keyof typeof TOOL_TO_TYPE],
        x: e.rect.x,
        y: e.rect.y,
        w: Math.max(8, e.rect.w),
        h: Math.max(8, e.rect.h),
        angle: 0,
        groups: [],
        ...(isFrame ? { content: `Frame ${frameIndex}` } : {}),
        style,
      })
    },
    [store, styleMemory],
  )

  // Threaded to the arrow tool so new edges pick up the last-used
  // path style / arrowheads / stroke etc. We seed `roughness: 1` so
  // the very first arrow the user creates already has the hand-drawn
  // look; once they edit the edge style, sticky memory takes over.
  const arrowDefaults = useMemo<ArrowToolDefaults>(
    () => ({
      pathStyle: styleMemory.getEdgePathStyle(),
      style: { roughness: 1, ...styleMemory.getEdgeStyle() },
    }),
    [styleMemory],
  )

  // ---- drag-and-drop of image / SVG files ---------------------------
  // PNG/JPEG → store.addImage. SVG (image/svg+xml or .svg) → text → store.addSvg.
  // Files outside that set are ignored silently. Errors surface via a
  // short-lived toast so the user sees why a drop was rejected.
  const dropZoneRef = useRef<HTMLDivElement>(null)
  const [dropError, setDropError] = useState<string | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)

  const handleDropError = useCallback((message: string) => {
    setDropError(message)
    // Auto-clear after 4s so the toast doesn't linger.
    window.setTimeout(() => setDropError(null), 4000)
  }, [])

  const worldFromDragEvent = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      const el = dropZoneRef.current
      if (!el) return { x: 0, y: 0 }
      const rect = el.getBoundingClientRect()
      return screenToWorld({ x: e.clientX - rect.left, y: e.clientY - rect.top }, store.getCamera())
    },
    [store],
  )

  const handleDrop = useCallback(
    async (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      setIsDragOver(false)
      const files = Array.from(e.dataTransfer.files ?? [])
      if (files.length === 0) return
      const world = worldFromDragEvent(e)
      // Layout dropped files in a small row offset from the drop point
      // so multi-file drops don't stack on top of each other.
      let offsetX = 0
      const GAP = 20
      for (const file of files) {
        try {
          if (isSvgFile(file)) {
            const text = await file.text()
            const id = await store.addSvg({
              src: text,
              x: world.x + offsetX,
              y: world.y,
              alt: file.name,
            })
            const node = store.getNode(id)
            offsetX += (node?.w ?? 64) + GAP
          } else if (file.type === 'image/png' || file.type === 'image/jpeg') {
            const id = await store.addImage({
              src: file,
              x: world.x + offsetX,
              y: world.y,
              alt: file.name,
            })
            const node = store.getNode(id)
            offsetX += (node?.w ?? 120) + GAP
          } else {
            handleDropError(`Skipped "${file.name}": only PNG, JPEG, and SVG are supported.`)
          }
        } catch (err) {
          handleDropError(err instanceof Error ? err.message : String(err))
        }
      }
    },
    [store, worldFromDragEvent, handleDropError],
  )

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    // Only flag as droppable when the drag carries files.
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
      setIsDragOver(true)
    }
  }, [])

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    // Only clear when the drag leaves the wrapper entirely. Child-cross
    // dragleave events fire on every nested element, so we check that
    // the related target isn't inside our zone.
    const related = e.relatedTarget as Node | null
    if (!related || !dropZoneRef.current?.contains(related)) {
      setIsDragOver(false)
    }
  }, [])

  return (
    <div
      ref={dropZoneRef}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      style={{
        position: 'absolute',
        inset: 0,
        outline: isDragOver ? '3px dashed #3b82f6' : 'none',
        outlineOffset: -3,
      }}
    >
      <LibCanvas
        tool={tool}
        onRenderer={onRenderer}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onCreateDrag={handleCreateDrag}
        arrowDefaults={arrowDefaults}
        background={background}
        theme={theme}
        selectionColor={selectionColor}
        renderCustomNodeView={id => {
          const node = store.getNode(id)
          if (!node) return null
          return <ChartCardView node={node} />
        }}
      />
      {dropError && (
        <div
          role="alert"
          style={{
            position: 'absolute',
            bottom: 12,
            right: 12,
            background: '#fee2e2',
            border: '1px solid #fca5a5',
            color: '#7f1d1d',
            borderRadius: 8,
            padding: '8px 12px',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            fontSize: 12,
            maxWidth: 360,
            boxShadow: '0 1px 3px rgba(0,0,0,.08)',
            zIndex: 100,
          }}
        >
          {dropError}
        </div>
      )}
    </div>
  )
}
