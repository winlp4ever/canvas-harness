import { type CanvasBackground, asNodeId, hitTestAny } from '@canvas-harness/core'
import {
  type ArrowToolDefaults,
  type CanvasCreateDragEvent,
  type CanvasPointerEvent,
  Canvas as LibCanvas,
  type ThemeResolver,
  useCanvasStore,
} from '@canvas-harness/react'
import { useCallback, useMemo } from 'react'
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

export type Tool = 'select' | ShapeTool | 'arrow' | 'text'

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
export function Canvas({
  tool,
  onRenderer,
  background,
  theme,
}: {
  tool: Tool
  onRenderer?: Parameters<typeof LibCanvas>[0]['onRenderer']
  background?: CanvasBackground
  theme?: ThemeResolver
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
        const remembered = styleMemory.getNodeStyle()
        // Default to roughness:1 so first-time creation has the
        // hand-drawn look; user-remembered style wins if present.
        const style = { roughness: 1, ...remembered }
        store.addNode({
          id: asNodeId(store.generateId()),
          type: TOOL_TO_TYPE[t as keyof typeof TOOL_TO_TYPE],
          x: e.world.x - 60,
          y: e.world.y - 40,
          w: 120,
          h: 80,
          angle: 0,
          z: 0,
          groups: [],
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
          z: 0,
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
        z: 0,
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
      const remembered = styleMemory.getNodeStyle()
      const style = { roughness: 1, ...remembered }
      store.addNode({
        id: asNodeId(store.generateId()),
        type: TOOL_TO_TYPE[t as keyof typeof TOOL_TO_TYPE],
        x: e.rect.x,
        y: e.rect.y,
        w: Math.max(8, e.rect.w),
        h: Math.max(8, e.rect.h),
        angle: 0,
        z: 0,
        groups: [],
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

  return (
    <LibCanvas
      tool={tool}
      onRenderer={onRenderer}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onCreateDrag={handleCreateDrag}
      arrowDefaults={arrowDefaults}
      background={background}
      theme={theme}
      renderCustomNodeView={id => {
        const node = store.getNode(id)
        if (!node) return null
        return <ChartCardView node={node} />
      }}
    />
  )
}
