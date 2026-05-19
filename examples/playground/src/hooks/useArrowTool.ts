/**
 * useArrowTool — Arrow-tool gesture for edge creation.
 *
 * Flow per ARCHITECTURE.md §6.3:
 *   pointerdown over node  → start edge with source attached at the
 *                             clamped boundary point on that node
 *   pointerdown empty      → start edge with free-floating source
 *   pointermove            → target follows pointer; if over a candidate
 *                             node, snap target to that node's boundary
 *   pointerup              → commit (target = node attachment OR worldPoint)
 *
 * The renderer paints the draft edge from interaction.draftEdge while in
 * mode 'creating-edge'.
 */
import {
  type CanvasStore,
  type EdgeEnd,
  type NodeId,
  type Vec2,
  asEdgeId,
  hitTestPoint,
  projectToNodeBoundary,
  screenToWorld,
  worldToNodeLocal,
} from '@canvas-harness/core'
import { useEffect } from 'react'

const CLICK_MAX_PIXELS = 4

export const useArrowTool = (
  ref: React.RefObject<HTMLElement | null>,
  store: CanvasStore,
  enabled: boolean,
): void => {
  useEffect(() => {
    if (!enabled) return
    const el = ref.current
    if (!el) return

    let pointerDownAt: { x: number; y: number } | null = null
    let active = false
    let sourceEnd: EdgeEnd | null = null

    const screenFromEvent = (e: PointerEvent): Vec2 => {
      const rect = el.getBoundingClientRect()
      return { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }
    const worldFromEvent = (e: PointerEvent): Vec2 =>
      screenToWorld(screenFromEvent(e), store.getCamera())

    /**
     * If the world point lies over a node, returns an attached EdgeEnd
     * with localOffset clamped/projected to that node's boundary.
     * Otherwise returns a free-floating worldPoint end.
     */
    const endFromWorldPoint = (world: Vec2): { end: EdgeEnd; nodeId: NodeId | null } => {
      const hit = hitTestPoint(store, world, store.getCamera().z)
      if (hit && hit.kind === 'body') {
        const node = store.getNode(hit.nodeId)!
        const localOffset = projectToNodeBoundary(world, node)
        return { end: { nodeId: node.id, localOffset }, nodeId: node.id }
      }
      return { end: { worldPoint: world }, nodeId: null }
    }

    /** End that just follows the pointer; if over a node, attach via clamped local. */
    const followingEnd = (world: Vec2): { end: EdgeEnd; nodeId: NodeId | null } => {
      const hit = hitTestPoint(store, world, store.getCamera().z)
      if (hit && hit.kind === 'body') {
        const node = store.getNode(hit.nodeId)!
        // For follow-the-pointer, snap to the actual pointer position
        // projected to the node boundary (not "nearest edge").
        const local = worldToNodeLocal(world, node)
        const clamped = {
          x: Math.max(0, Math.min(node.w, local.x)),
          y: Math.max(0, Math.min(node.h, local.y)),
        }
        return { end: { nodeId: node.id, localOffset: clamped }, nodeId: node.id }
      }
      return { end: { worldPoint: world }, nodeId: null }
    }

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      pointerDownAt = screenFromEvent(e)
      const world = worldFromEvent(e)
      const { end } = endFromWorldPoint(world)
      sourceEnd = end
      el.setPointerCapture(e.pointerId)
      e.preventDefault()
    }

    const onPointerMove = (e: PointerEvent) => {
      if (!pointerDownAt || !sourceEnd) return
      const screen = screenFromEvent(e)
      const dx = screen.x - pointerDownAt.x
      const dy = screen.y - pointerDownAt.y
      // Only start showing the draft once the user moves past the click threshold.
      if (!active && Math.abs(dx) < CLICK_MAX_PIXELS && Math.abs(dy) < CLICK_MAX_PIXELS) return
      active = true
      const world = worldFromEvent(e)
      const { end: target, nodeId: snapTargetNodeId } = followingEnd(world)
      store.setInteractionState({
        mode: 'creating-edge',
        draftEdge: {
          source: sourceEnd,
          target,
          reconnectingId: null,
          snapTargetNodeId,
        },
      })
    }

    const onPointerUp = (e: PointerEvent) => {
      if (!pointerDownAt) return
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
      const wasActive = active

      if (wasActive && sourceEnd) {
        const world = worldFromEvent(e)
        const { end: target } = endFromWorldPoint(world)
        store.addEdge({
          id: asEdgeId(store.generateId()),
          source: sourceEnd,
          target,
          pathStyle: 'bezier',
          z: 0,
          groups: [],
        })
      }

      store.resetInteractionState()
      pointerDownAt = null
      active = false
      sourceEnd = null
    }

    const onPointerCancel = (e: PointerEvent) => {
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
      store.resetInteractionState()
      pointerDownAt = null
      active = false
      sourceEnd = null
    }

    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', onPointerUp)
    el.addEventListener('pointercancel', onPointerCancel)
    return () => {
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', onPointerUp)
      el.removeEventListener('pointercancel', onPointerCancel)
    }
  }, [ref, store, enabled])
}
