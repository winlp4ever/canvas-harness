/**
 * @canvas-harness/react
 *
 * React bindings: `<Canvas>` component + data/interaction/presence/history hooks.
 * See ARCHITECTURE.md §13 and IMPLEMENTATION.md Phase 9.
 */
export const VERSION = '0.0.0'

export { Canvas } from './Canvas'
export type { CanvasCreateDragEvent, CanvasPointerEvent, CanvasProps } from './Canvas'
export type { ArrowToolDefaults } from './internal/use-arrow-tool'
export { CanvasProvider, useCanvasStore } from './context'
export type { CanvasProviderProps } from './context'
export type { ThemeResolver } from './types'

// Data hooks
export { useNode, useNodes } from './hooks/use-node'
export { useEdge, useEdges } from './hooks/use-edge'
export { useSelection } from './hooks/use-selection'
export { useCamera } from './hooks/use-camera'

// Interaction hooks
export {
  useCursor,
  useDraggedIds,
  useInteractionMode,
  useInteractionState,
  useIsMoving,
  useIsPenActive,
} from './hooks/use-interaction'

// Presence hooks
export { useLocalPresence, usePresence } from './hooks/use-presence'

// History hooks
export { useCanRedo, useCanUndo } from './hooks/use-history'

// Re-export the per-tool gesture type so consumers can type their tool state.
export type { InteractionTool } from './internal/use-interaction-gesture'
