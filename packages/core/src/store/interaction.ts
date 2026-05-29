import type { ResizeHandle } from '../hit-test/handle'
/**
 * InteractionState — see ARCHITECTURE.md §10.11.
 *
 * Per-client ephemeral state: what's the user doing right now. Drives the
 * interactive canvas paint, status bars, AI-mode gating, custom-node
 * `env.isMoving`. NOT in the op log; not synced; not in undo stack.
 *
 * Phase 3 ships dragging / resizing / marqueeing modes. Pan/zoom/edit
 * arrive later but the type covers them now to avoid breaking changes.
 */
import type { EdgeEnd, EdgeId, NodeId, Vec2, WorldRect } from '../types'

export type InteractionMode =
  | 'idle'
  | 'panning'
  | 'zooming'
  | 'dragging'
  | 'resizing'
  | 'rotating'
  | 'marqueeing'
  | 'creating-shape'
  | 'creating-edge'
  | 'reconnecting-edge'
  | 'editing'

export type PointerInfo = {
  worldX: number
  worldY: number
  screenX: number
  screenY: number
  pointerType: 'mouse' | 'touch' | 'pen'
  pressure?: number
}

/**
 * The frozen geometry of a node at drag-start, used to compute the
 * uncommitted display position during drag (= original + delta).
 */
export type DragOriginal = {
  id: NodeId
  x: number
  y: number
  w: number
  h: number
  angle: number
}

export type InteractionState = {
  mode: InteractionMode
  pointer: PointerInfo | null

  // Drag state — populated when mode is 'dragging' or 'resizing'.
  draggedIds: NodeId[]
  dragOriginals: DragOriginal[]
  /** World-space delta from drag start; renderer applies this to draw the dragged set. */
  dragDelta: Vec2

  // Resize state — populated when mode is 'resizing'.
  resizeHandle: ResizeHandle | null
  /** Whether the user is holding Shift during a resize (aspect-lock). */
  resizeLockAspect: boolean
  /** Whether the user is holding Alt during a resize (resize from center). */
  resizeFromCenter: boolean
  /**
   * Live in-progress geometry of the resized node — written every
   * pointermove, committed to the store once on pointer-up. While
   * present, `store.getNode(id)` still returns the original geometry;
   * the renderer overlays this draft via `mapDragPositions` for the
   * interactive layer paint. Mirrors how `dragDelta` works for drag.
   */
  resizeDraft: { x: number; y: number; w: number; h: number; angle: number } | null

  // Marquee state — populated when mode is 'marqueeing'.
  marqueeRect: WorldRect | null
  /** Whether the marquee should add to (true, shift held) or replace selection. */
  marqueeAdditive: boolean

  // Edge-creation state — populated when mode is 'creating-edge' or
  // 'reconnecting-edge'. `draftEdge` is the source/target the renderer
  // should paint as a preview.
  draftEdge: {
    source: EdgeEnd
    target: EdgeEnd
    /** When reconnecting an existing edge, the id; null for new edges. */
    reconnectingId: import('../types').EdgeId | null
    /** Snap candidate (a node id the target endpoint is hovering over). */
    snapTargetNodeId: NodeId | null
  } | null

  // Edit state — populated when mode is 'editing' (phase 7 + 12.5).
  // Phase 7 only edited node content; phase 12.5 generalizes to edge
  // labels too, so the field is `editingTarget: { kind, id } | null`.
  editingTarget: EditTarget | null

  // Drag-create state — populated while mode is 'creating-shape'.
  // The renderer paints `createDraftRect` as a preview on the
  // interactive canvas; `<Canvas onCreateDrag>` consumes the rect on
  // commit.
  createDraftRect: WorldRect | null
  createTool: string | null
}

/** Identifies what's currently being edited — a node (text content) or
 *  an edge (label content). See `store.beginEdit`. */
export type EditTarget = { kind: 'node'; id: NodeId } | { kind: 'edge'; id: EdgeId }

export const idleInteractionState = (): InteractionState => ({
  mode: 'idle',
  pointer: null,
  draggedIds: [],
  dragOriginals: [],
  dragDelta: { x: 0, y: 0 },
  resizeHandle: null,
  resizeLockAspect: false,
  resizeFromCenter: false,
  resizeDraft: null,
  marqueeRect: null,
  marqueeAdditive: false,
  draftEdge: null,
  editingTarget: null,
  createDraftRect: null,
  createTool: null,
})

/**
 * Convenience: any of panning/zooming/dragging/resizing/rotating is "moving".
 */
export const isMoving = (state: InteractionState): boolean => {
  const m = state.mode
  return (
    m === 'panning' || m === 'zooming' || m === 'dragging' || m === 'resizing' || m === 'rotating'
  )
}
