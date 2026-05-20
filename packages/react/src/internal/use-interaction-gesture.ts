/**
 * useInteraction — owns the gesture state machine for the Select tool.
 *
 * Handles click-select, shift-toggle, marquee, drag, resize. Talks to the
 * store via setInteractionState (transient) and applyOp/updateNode (commits).
 *
 * The pan/zoom hook (usePanZoom) handles middle-button pan and wheel/pinch
 * zoom; this hook handles primary-button gestures only.
 */
import {
  type CanvasStore,
  type DragOriginal,
  type EdgeEnd,
  type EdgeId,
  type NodeId,
  type ResizeHandle,
  type Vec2,
  type WorldRect,
  computeAutoFitHeight,
  createPalmRejectionState,
  hitTestAny,
  marqueeNodes,
  midpointToCubicControls,
  notePenActive,
  notePenInactive,
  projectToNodeBoundary,
  screenToWorld,
  shouldAutoFit,
  shouldRejectTouch,
  worldToNodeLocal,
} from '@canvas-harness/core'
import { useEffect } from 'react'

const CLICK_MAX_PIXELS = 4 // pointerup within this many pixels of pointerdown = click

/** Touch hold time (ms) before a stationary pointerdown promotes to drag. */
const LONG_PRESS_MS = 500
/** Max pixel movement during the long-press window without canceling it. */
const LONG_PRESS_MAX_MOVE_PX = 10

export type InteractionTool =
  | 'select'
  | 'rect'
  | 'ellipse'
  | 'diamond'
  | 'capsule'
  | 'arrow'
  | 'text'

export const useInteractionGesture = (
  ref: React.RefObject<HTMLElement | null>,
  store: CanvasStore,
  tool: InteractionTool,
): void => {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (tool !== 'select') return // shape tools handle their own clicks in Canvas.tsx

    let pointerDownAt: { x: number; y: number } | null = null
    let activeGesture:
      | 'idle'
      | 'click-pending'
      | 'drag'
      | 'resize'
      | 'rotate'
      | 'marquee'
      | 'reconnect-edge'
      | 'edge-midpoint' = 'idle'
    let resizeHandle: ResizeHandle | null = null
    let dragOriginals: DragOriginal[] = []
    let marqueeStartWorld: Vec2 | null = null
    let marqueeShift = false
    let reconnectEdgeId: EdgeId | null = null
    let reconnectEnd: 'source' | 'target' | null = null
    let midpointEdgeId: EdgeId | null = null
    // Rotation gesture state.
    let rotateNodeId: NodeId | null = null
    let rotateOriginAngle = 0 // node.angle at gesture start
    let rotatePointerStartAngle = 0 // pointer angle from node center at gesture start

    // Phase 11 — palm rejection + long-press.
    const palm = createPalmRejectionState()
    let longPressTimer: ReturnType<typeof setTimeout> | null = null
    const clearLongPress = (): void => {
      if (longPressTimer !== null) {
        clearTimeout(longPressTimer)
        longPressTimer = null
      }
    }

    const screenFromEvent = (e: PointerEvent): Vec2 => {
      const rect = el.getBoundingClientRect()
      return { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }

    const worldFromEvent = (e: PointerEvent): Vec2 =>
      screenToWorld(screenFromEvent(e), store.getCamera())

    const snapshotOriginals = (ids: NodeId[]): DragOriginal[] => {
      const result: DragOriginal[] = []
      for (const id of ids) {
        const n = store.getNode(id)
        if (n) result.push({ id, x: n.x, y: n.y, w: n.w, h: n.h, angle: n.angle })
      }
      return result
    }

    const beginDrag = (ids: NodeId[]): void => {
      dragOriginals = snapshotOriginals(ids)
      store.setInteractionState({
        mode: 'dragging',
        draggedIds: ids,
        dragOriginals,
        dragDelta: { x: 0, y: 0 },
      })
    }

    const beginResize = (id: NodeId, handle: ResizeHandle): void => {
      dragOriginals = snapshotOriginals([id])
      store.setInteractionState({
        mode: 'resizing',
        draggedIds: [id],
        dragOriginals,
        resizeHandle: handle,
        resizeLockAspect: false,
        resizeFromCenter: false,
      })
    }

    const pointerAngleFromCenter = (node: { x: number; y: number; w: number; h: number }, world: Vec2): number => {
      const cx = node.x + node.w / 2
      const cy = node.y + node.h / 2
      return Math.atan2(world.y - cy, world.x - cx)
    }

    const beginRotate = (id: NodeId, worldAtStart: Vec2): void => {
      const node = store.getNode(id)
      if (!node) return
      rotateNodeId = id
      rotateOriginAngle = node.angle
      rotatePointerStartAngle = pointerAngleFromCenter(node, worldAtStart)
      store.setInteractionState({
        mode: 'rotating',
        draggedIds: [id],
      })
    }

    /** Snap angle to 15° increments when Shift is held. */
    const ROTATE_SNAP_RAD = (15 * Math.PI) / 180
    const updateRotate = (worldPoint: Vec2, shift: boolean): void => {
      if (!rotateNodeId) return
      const node = store.getNode(rotateNodeId)
      if (!node) return
      const pointerAngle = pointerAngleFromCenter(node, worldPoint)
      const delta = pointerAngle - rotatePointerStartAngle
      let next = rotateOriginAngle + delta
      if (shift) next = Math.round(next / ROTATE_SNAP_RAD) * ROTATE_SNAP_RAD
      store.updateNode(rotateNodeId, { angle: next })
    }

    const commitRotate = (): void => {
      rotateNodeId = null
      store.resetInteractionState()
    }

    const updateDrag = (delta: Vec2): void => {
      store.setInteractionState({ dragDelta: delta })
    }

    const updateResize = (worldPoint: Vec2, modifiers: { shift: boolean; alt: boolean }): void => {
      const orig = dragOriginals[0]
      if (!orig || !resizeHandle) return
      const next = computeResizeGeometry(orig, resizeHandle, worldPoint, modifiers)
      // Commit live to the store so the static canvas reflects it; phase 3
      // single-node resize. Multi-select group resize is similar but scales
      // each member proportionally — left for §11.6 follow-up.
      store.updateNode(orig.id, next)
      store.setInteractionState({
        resizeLockAspect: modifiers.shift,
        resizeFromCenter: modifiers.alt,
      })
    }

    const commitDrag = (): void => {
      const interaction = store.getInteractionState()
      const delta = interaction.dragDelta
      if (delta.x !== 0 || delta.y !== 0) {
        store.batch(() => {
          for (const orig of dragOriginals) {
            store.updateNode(orig.id, { x: orig.x + delta.x, y: orig.y + delta.y })
          }
        })
      }
      store.resetInteractionState()
    }

    const commitResize = (): void => {
      // updateResize already committed via store.updateNode each pointermove;
      // we only need to clear the interaction state. The history-aware
      // version (phase 8 undo) will collapse these into one OpBatch.
      // Refit autofit nodes now that the resize stream is over (we
      // suppress mid-stream refit so the user's drag isn't overridden).
      const selected = store.getSelection()
      for (const id of selected) {
        const node = store.getNode(id as NodeId)
        if (!node) continue
        if (!shouldAutoFit(node)) continue
        const fitted = computeAutoFitHeight(node)
        // Grow-only — preserve a user's deliberately-tall node.
        if (fitted > node.h) store.updateNode(node.id, { h: fitted })
      }
      store.resetInteractionState()
    }

    const beginMarquee = (start: Vec2, shift: boolean): void => {
      marqueeStartWorld = start
      marqueeShift = shift
      store.setInteractionState({
        mode: 'marqueeing',
        marqueeRect: { x: start.x, y: start.y, w: 0, h: 0 },
        marqueeAdditive: shift,
      })
    }

    const updateMarquee = (current: Vec2): void => {
      if (!marqueeStartWorld) return
      const rect: WorldRect = {
        x: Math.min(marqueeStartWorld.x, current.x),
        y: Math.min(marqueeStartWorld.y, current.y),
        w: Math.abs(current.x - marqueeStartWorld.x),
        h: Math.abs(current.y - marqueeStartWorld.y),
      }
      store.setInteractionState({ marqueeRect: rect })
    }

    const commitMarquee = (): void => {
      const interaction = store.getInteractionState()
      const rect = interaction.marqueeRect
      if (rect && (rect.w > 0 || rect.h > 0)) {
        const hits = marqueeNodes(store, rect)
        if (marqueeShift) {
          const existing = new Set(store.getSelection() as NodeId[])
          for (const id of hits) existing.add(id)
          store.setSelection([...existing])
        } else {
          store.setSelection(hits)
        }
      }
      store.resetInteractionState()
    }

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      if (e.pointerType === 'pen') notePenActive(palm)
      else if (e.pointerType === 'touch' && shouldRejectTouch(palm, Date.now())) return
      pointerDownAt = screenFromEvent(e)
      const world = worldFromEvent(e)
      const camera = store.getCamera()
      const selection = store.getSelection()
      const selectedNodeIds = new Set<NodeId>()
      const selectedEdgeIds = new Set<EdgeId>()
      for (const id of selection) {
        if (store.getNode(id as NodeId)) selectedNodeIds.add(id as NodeId)
        else if (store.getEdge(id as EdgeId)) selectedEdgeIds.add(id as EdgeId)
      }
      const hit = hitTestAny(store, world, camera.z, selectedNodeIds, selectedEdgeIds)

      if (hit?.kind === 'rotate-handle') {
        activeGesture = 'rotate'
        beginRotate(hit.nodeId, world)
        el.setPointerCapture(e.pointerId)
        e.preventDefault()
        return
      }

      if (hit?.kind === 'resize-handle') {
        resizeHandle = hit.handle
        activeGesture = 'resize'
        beginResize(hit.nodeId, hit.handle)
        el.setPointerCapture(e.pointerId)
        e.preventDefault()
        return
      }

      if (hit?.kind === 'midpoint-handle') {
        midpointEdgeId = hit.edgeId
        activeGesture = 'edge-midpoint'
        el.setPointerCapture(e.pointerId)
        e.preventDefault()
        return
      }

      if (hit?.kind === 'source-handle' || hit?.kind === 'target-handle') {
        reconnectEdgeId = hit.edgeId
        reconnectEnd = hit.kind === 'source-handle' ? 'source' : 'target'
        activeGesture = 'reconnect-edge'
        const edge = store.getEdge(hit.edgeId)
        if (edge) {
          store.setInteractionState({
            mode: 'reconnecting-edge',
            draftEdge: {
              source: edge.source,
              target: edge.target,
              reconnectingId: hit.edgeId,
              snapTargetNodeId: null,
            },
          })
        }
        el.setPointerCapture(e.pointerId)
        e.preventDefault()
        return
      }

      if (hit?.kind === 'body' && 'nodeId' in hit) {
        const alreadySelected = selectedNodeIds.has(hit.nodeId)
        if (e.shiftKey) {
          const next = new Set(selectedNodeIds)
          if (alreadySelected) next.delete(hit.nodeId)
          else next.add(hit.nodeId)
          store.setSelection([...next])
        } else if (!alreadySelected) {
          store.setSelection([hit.nodeId])
        }
        activeGesture = 'click-pending'
        el.setPointerCapture(e.pointerId)
        // Touch can't hover, so a stationary press should promote to
        // drag after LONG_PRESS_MS. Mouse / pen rely on the existing
        // pixel-threshold path.
        if (e.pointerType === 'touch') {
          const targetIds = e.shiftKey
            ? ([...selectedNodeIds, hit.nodeId] as NodeId[])
            : [hit.nodeId]
          clearLongPress()
          longPressTimer = setTimeout(() => {
            longPressTimer = null
            if (activeGesture !== 'click-pending') return
            activeGesture = 'drag'
            beginDrag(targetIds)
          }, LONG_PRESS_MS)
        }
        e.preventDefault()
        return
      }

      // Edge body hit.
      if (hit?.kind === 'body' && 'edgeId' in hit) {
        if (e.shiftKey) {
          const next = new Set(selectedEdgeIds)
          if (selectedEdgeIds.has(hit.edgeId)) next.delete(hit.edgeId)
          else next.add(hit.edgeId)
          store.setSelection([...selectedNodeIds, ...next])
        } else {
          store.setSelection([hit.edgeId])
        }
        activeGesture = 'click-pending'
        el.setPointerCapture(e.pointerId)
        e.preventDefault()
        return
      }

      // Click on empty space.
      if (!e.shiftKey) store.setSelection([])
      activeGesture = 'click-pending'
      el.setPointerCapture(e.pointerId)
    }

    const onPointerMove = (e: PointerEvent) => {
      if (!pointerDownAt) return
      const screen = screenFromEvent(e)
      const dx = screen.x - pointerDownAt.x
      const dy = screen.y - pointerDownAt.y

      // Movement past LONG_PRESS_MAX_MOVE_PX cancels the long-press
      // promotion (user is dragging, not holding still).
      if (longPressTimer !== null && (Math.abs(dx) > LONG_PRESS_MAX_MOVE_PX || Math.abs(dy) > LONG_PRESS_MAX_MOVE_PX)) {
        clearLongPress()
      }

      // First time pointermove crosses click threshold: decide gesture.
      if (activeGesture === 'click-pending') {
        if (Math.abs(dx) < CLICK_MAX_PIXELS && Math.abs(dy) < CLICK_MAX_PIXELS) return
        const startWorld = screenToWorld(pointerDownAt, store.getCamera())
        const camera = store.getCamera()
        const selectedIds = new Set(
          store.getSelection().filter(id => store.getNode(id as NodeId)) as NodeId[],
        )
        // re-test at the down-position; if it was over a node body, drag it
        const hit = hitTestAny(store, startWorld, camera.z, selectedIds, new Set())
        if (hit?.kind === 'body' && 'nodeId' in hit && selectedIds.has(hit.nodeId)) {
          activeGesture = 'drag'
          beginDrag([...selectedIds])
        } else {
          activeGesture = 'marquee'
          beginMarquee(startWorld, e.shiftKey)
        }
      }

      if (activeGesture === 'drag') {
        const camera = store.getCamera()
        updateDrag({ x: dx / camera.z, y: dy / camera.z })
      } else if (activeGesture === 'resize') {
        const world = worldFromEvent(e)
        updateResize(world, { shift: e.shiftKey, alt: e.altKey })
      } else if (activeGesture === 'rotate') {
        updateRotate(worldFromEvent(e), e.shiftKey)
      } else if (activeGesture === 'marquee') {
        updateMarquee(worldFromEvent(e))
      } else if (activeGesture === 'reconnect-edge' && reconnectEdgeId && reconnectEnd) {
        updateReconnect(worldFromEvent(e))
      } else if (activeGesture === 'edge-midpoint' && midpointEdgeId) {
        updateEdgeMidpoint(worldFromEvent(e))
      }
    }

    const updateEdgeMidpoint = (world: Vec2): void => {
      if (!midpointEdgeId) return
      const geom = store.getEdgeGeometry(midpointEdgeId)
      if (!geom) return
      const { c1, c2 } = midpointToCubicControls(geom.source, world, geom.target)
      store.updateEdge(midpointEdgeId, { control: [c1, c2] })
    }

    const updateReconnect = (world: Vec2): void => {
      if (!reconnectEdgeId || !reconnectEnd) return
      const edge = store.getEdge(reconnectEdgeId)
      if (!edge) return
      const camera = store.getCamera()
      // Follow the pointer; if over another node, snap to that node's
      // boundary (clamped).
      const newEnd = followingEnd(world, camera.z)
      const draftSource = reconnectEnd === 'source' ? newEnd.end : edge.source
      const draftTarget = reconnectEnd === 'target' ? newEnd.end : edge.target
      store.setInteractionState({
        mode: 'reconnecting-edge',
        draftEdge: {
          source: draftSource,
          target: draftTarget,
          reconnectingId: reconnectEdgeId,
          snapTargetNodeId: newEnd.nodeId,
        },
      })
    }

    const followingEnd = (
      world: Vec2,
      cameraZ: number,
    ): { end: EdgeEnd; nodeId: NodeId | null } => {
      const hit = hitTestAny(store, world, cameraZ)
      if (hit?.kind === 'body' && 'nodeId' in hit) {
        const node = store.getNode(hit.nodeId)
        if (node) {
          const local = worldToNodeLocal(world, node)
          const clamped = {
            x: Math.max(0, Math.min(node.w, local.x)),
            y: Math.max(0, Math.min(node.h, local.y)),
          }
          return { end: { nodeId: node.id, localOffset: clamped }, nodeId: node.id }
        }
      }
      return { end: { worldPoint: world }, nodeId: null }
    }

    const commitReconnect = (e: PointerEvent): void => {
      if (!reconnectEdgeId || !reconnectEnd) return
      const world = worldFromEvent(e)
      // For commit, snap to the boundary (so endpoint isn't inside the rect).
      const hit = hitTestAny(store, world, store.getCamera().z)
      let newEnd: EdgeEnd
      if (hit?.kind === 'body' && 'nodeId' in hit) {
        const node = store.getNode(hit.nodeId)
        if (node) {
          const localOffset = projectToNodeBoundary(world, node)
          newEnd = { nodeId: node.id, localOffset }
        } else {
          newEnd = { worldPoint: world }
        }
      } else {
        newEnd = { worldPoint: world }
      }
      store.updateEdge(
        reconnectEdgeId,
        reconnectEnd === 'source' ? { source: newEnd } : { target: newEnd },
      )
      store.resetInteractionState()
    }

    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerType === 'pen') notePenInactive(palm, Date.now())
      clearLongPress()
      if (!pointerDownAt) return
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
      switch (activeGesture) {
        case 'drag':
          commitDrag()
          break
        case 'resize':
          commitResize()
          break
        case 'rotate':
          commitRotate()
          break
        case 'marquee':
          commitMarquee()
          break
        case 'reconnect-edge':
          commitReconnect(e)
          break
        case 'edge-midpoint':
          // updateEdgeMidpoint already wrote each move via store.updateEdge;
          // pointerup just clears the gesture state.
          break
        // 'click-pending' was already handled in pointerdown (selection set);
        // nothing more to do.
      }
      pointerDownAt = null
      activeGesture = 'idle'
      resizeHandle = null
      dragOriginals = []
      marqueeStartWorld = null
      reconnectEdgeId = null
      midpointEdgeId = null
      reconnectEnd = null
    }

    const onKeyDown = (e: KeyboardEvent) => {
      // Skip when focus is in an editor (built-in textarea, consumer's
      // <input>, or any contenteditable surface). Otherwise Backspace
      // typed inside the edit overlay bubbles to window and triggers
      // `removeNode` on the selected node — the user types a typo,
      // hits Backspace, and the node they're editing vanishes behind
      // the still-open textarea. Bug surfaces on Escape because that's
      // when the overlay closes and the user sees the empty canvas.
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable)
      )
        return
      if (e.key === 'Escape') {
        store.setSelection([])
        store.resetInteractionState()
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && store.getSelection().length > 0) {
        const ids = store.getSelection()
        store.batch(() => {
          for (const id of ids) {
            if (store.getNode(id as NodeId)) store.removeNode(id as NodeId)
            else if (store.getEdge(id as EdgeId)) store.removeEdge(id as EdgeId)
          }
        })
        store.setSelection([])
      }
    }

    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', onPointerUp)
    el.addEventListener('pointercancel', onPointerUp)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', onPointerUp)
      el.removeEventListener('pointercancel', onPointerUp)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [ref, store, tool])
}

/**
 * Computes the new node geometry given a resize gesture.
 * Phase 3: single-node resize. Multi-select group resize is similar but
 * scales each member proportionally — left for §11.6 follow-up.
 */
const computeResizeGeometry = (
  orig: DragOriginal,
  handle: ResizeHandle,
  pointer: Vec2,
  modifiers: { shift: boolean; alt: boolean },
): { x: number; y: number; w: number; h: number } => {
  // For phase 3 we only support axis-aligned resize (no rotation handling
  // in the gesture math yet). Rotated resize is a §11.6 follow-up.
  let x = orig.x
  let y = orig.y
  let w = orig.w
  let h = orig.h

  const rightFixed = handle === 'nw' || handle === 'w' || handle === 'sw'
  const leftFixed = handle === 'ne' || handle === 'e' || handle === 'se'
  const bottomFixed = handle === 'nw' || handle === 'n' || handle === 'ne'
  const topFixed = handle === 'sw' || handle === 's' || handle === 'se'

  if (rightFixed) {
    const right = orig.x + orig.w
    w = Math.max(1, right - pointer.x)
    x = right - w
  } else if (leftFixed) {
    w = Math.max(1, pointer.x - orig.x)
  }
  if (bottomFixed) {
    const bottom = orig.y + orig.h
    h = Math.max(1, bottom - pointer.y)
    y = bottom - h
  } else if (topFixed) {
    h = Math.max(1, pointer.y - orig.y)
  }

  if (modifiers.shift) {
    // Lock aspect ratio. Compare the requested w/h ratio to the original
    // and pick whichever dimension produces the smaller change.
    const targetAspect = orig.w / orig.h
    const currentAspect = w / h
    if (currentAspect > targetAspect) {
      w = h * targetAspect
      if (rightFixed) x = orig.x + orig.w - w
    } else {
      h = w / targetAspect
      if (bottomFixed) y = orig.y + orig.h - h
    }
  }

  if (modifiers.alt) {
    // Resize from center: mirror the delta across the original center.
    const cx = orig.x + orig.w / 2
    const cy = orig.y + orig.h / 2
    if (handle !== 'n' && handle !== 's') {
      w = Math.max(1, w * 2 - orig.w + (orig.w - Math.abs(orig.w - w * 0)))
      // Simpler: recompute by mirroring whichever side moved
      const newW = Math.abs(pointer.x - cx) * 2
      w = Math.max(1, newW)
      x = cx - w / 2
    }
    if (handle !== 'e' && handle !== 'w') {
      const newH = Math.abs(pointer.y - cy) * 2
      h = Math.max(1, newH)
      y = cy - h / 2
    }
  }

  return { x, y, w, h }
}
