import { asNodeId } from '@canvas-harness/core'
import {
  Canvas as LibCanvas,
  type CanvasCreateDragEvent,
  type CanvasPointerEvent,
  useCanvasStore,
} from '@canvas-harness/react'
import { useCallback } from 'react'
import { ChartCardView } from '../custom-nodes/chart-card'

export type Tool = 'select' | 'rect' | 'ellipse' | 'diamond' | 'capsule' | 'arrow' | 'text'

const SHAPE_TOOLS = new Set<Tool>(['rect', 'ellipse', 'diamond', 'capsule'])
const TOOL_TO_TYPE: Record<
  'rect' | 'ellipse' | 'diamond' | 'capsule',
  'rect' | 'ellipse' | 'diamond' | 'capsule'
> = { rect: 'rect', ellipse: 'ellipse', diamond: 'diamond', capsule: 'capsule' }

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
}: {
  tool: Tool
  onRenderer?: Parameters<typeof LibCanvas>[0]['onRenderer']
}) {
  const store = useCanvasStore()

  // Tap-to-create: places a default-size shape at the click point.
  // Drag-to-create handles the resize-on-create gesture; sub-threshold
  // drags fall through to onClick.
  const handleClick = useCallback(
    (e: CanvasPointerEvent) => {
      const t = e.tool as Tool
      if (SHAPE_TOOLS.has(t)) {
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
        })
        return
      }
      if (t === 'text') {
        const id = asNodeId(store.generateId())
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
          style: { fontSize: 'M', textAlign: 'left' },
        })
        store.beginEdit(id)
      }
    },
    [store],
  )

  // Drag-to-create: shape sized to the dragged rect.
  const handleCreateDrag = useCallback(
    (e: CanvasCreateDragEvent) => {
      const t = e.tool as Tool
      if (!SHAPE_TOOLS.has(t)) return
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
      })
    },
    [store],
  )

  return (
    <LibCanvas
      tool={tool}
      onRenderer={onRenderer}
      onClick={handleClick}
      onCreateDrag={handleCreateDrag}
      renderCustomNodeView={id => {
        const node = store.getNode(id)
        if (!node) return null
        return <ChartCardView node={node} />
      }}
    />
  )
}
