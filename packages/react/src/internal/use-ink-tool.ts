/**
 * Built-in pressure-aware ink/eraser gesture.
 *
 * Coalesced `pointermove` events are the single sampling stream. Samples
 * stay in interaction-draft state until pointer-up, when one node (or one
 * batched whole-stroke erase) is committed for clean sync and undo.
 */
import {
  type CanvasStore,
  type InkGeometry,
  type InkSample,
  type Node,
  type NodeId,
  type Style,
  type Vec2,
  asNodeId,
  createInkGeometry,
  createPalmRejectionState,
  hitTestInkSegmentWorld,
  hitTestInkWorld,
  notePenActive,
  notePenInactive,
  screenToWorld,
  shouldRejectTouch,
} from '@canvas-harness/core'
import { useEffect, useRef } from 'react'

const DEFAULT_INK_SIZE = 5
const DEFAULT_INK_COLOR = '#1f2937'
const DEFAULT_ERASER_RADIUS_SCREEN = 14
const MIN_SAMPLE_DISTANCE_SCREEN = 1.5
const MAX_INK_POINTS_PER_NODE = 600
const INK_SEGMENT_OVERLAP_POINTS = 3

type ValueOrFactory<T> = T | (() => T | undefined)
type AddableNode = Omit<Node, 'z'> & { z?: number }

export type InkNodeFactoryInput = {
  id: NodeId
  geometry: InkGeometry
  samples: ReadonlyArray<InkSample>
  size: number
  style: Style
  data?: Record<string, unknown>
}

export type InkToolDefaults = {
  /** World-space base width for newly drawn strokes. Defaults to 5. */
  size?: ValueOrFactory<number>
  /** Stroke color stamped at gesture start. Defaults to `style.strokeColor`. */
  color?: ValueOrFactory<string>
  /** Style stamped into the same node.add op as the completed stroke. */
  style?: ValueOrFactory<Style>
  /** Consumer metadata merged next to the engine-owned `data.ink` field. */
  data?: ValueOrFactory<Record<string, unknown>>
  /**
   * Optional product integration seam. Products with their own node payload
   * (for example a Note envelope) can build it here while the engine retains
   * ownership of sampling, geometry, preview, palm rejection, and erasing.
   */
  createNode?: (input: InkNodeFactoryInput) => AddableNode | null
  /** Whole-stroke eraser radius in screen pixels. Defaults to 14. */
  eraserRadius?: number
}

const resolveValue = <T>(value: ValueOrFactory<T> | undefined): T | undefined =>
  typeof value === 'function' ? (value as () => T | undefined)() : value

/** Pointer Events reserves button 5 / buttons bit 32 for a pen eraser. */
const isPenEraserContact = (event: PointerEvent): boolean =>
  event.pointerType === 'pen' && (event.button === 5 || (event.buttons & 32) !== 0)

export const useInkTool = (
  ref: React.RefObject<HTMLElement | null>,
  store: CanvasStore,
  tool: string,
  defaults?: InkToolDefaults,
): void => {
  const defaultsRef = useRef(defaults)
  defaultsRef.current = defaults

  useEffect(() => {
    const enabled = tool === 'ink' || tool === 'eraser'
    const el = ref.current
    if (!enabled || !el) return

    let activePointerId: number | null = null
    let activeMode: 'ink' | 'eraser' | null = null
    let sampleSegments: InkSample[][] = [[]]
    let erasedIds = new Set<NodeId>()
    let activeSize = DEFAULT_INK_SIZE
    let activeStyle: Style = { strokeColor: DEFAULT_INK_COLOR }
    let draftRaf = 0
    let lastEraserWorld: Vec2 | null = null
    let suppressNextClick = false
    const palm = createPalmRejectionState()

    const screenFromEvent = (event: PointerEvent): Vec2 => {
      const rect = el.getBoundingClientRect()
      return { x: event.clientX - rect.left, y: event.clientY - rect.top }
    }

    const eventSamples = (event: PointerEvent): PointerEvent[] => {
      const coalesced =
        typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : []
      return coalesced.length > 0 ? [...coalesced, event] : [event]
    }

    const flushDraft = (): void => {
      draftRaf = 0
      if (activeMode === 'ink') {
        store.setInteractionState({
          mode: 'creating-ink',
          draftInk: {
            segments: sampleSegments.map(segment => [...segment]),
            size: activeSize,
            color: activeStyle.strokeColor ?? DEFAULT_INK_COLOR,
            opacity: activeStyle.opacity ?? 100,
          },
          draftEraser: null,
        })
      } else if (activeMode === 'eraser' && lastEraserWorld) {
        const radius =
          (defaultsRef.current?.eraserRadius ?? DEFAULT_ERASER_RADIUS_SCREEN) /
          Math.max(0.01, store.getCamera().z)
        store.setInteractionState({
          mode: 'erasing-ink',
          draftInk: null,
          draftEraser: { point: lastEraserWorld, radius, erasedIds: [...erasedIds] },
        })
      }
    }

    const scheduleDraft = (): void => {
      if (draftRaf !== 0) return
      draftRaf = requestAnimationFrame(flushDraft)
    }

    const appendInkSamples = (event: PointerEvent, forceFinal = false): void => {
      const camera = store.getCamera()
      const minDistanceWorld = MIN_SAMPLE_DISTANCE_SCREEN / Math.max(0.01, camera.z)
      const events = eventSamples(event)
      for (let index = 0; index < events.length; index++) {
        const sample = events[index]
        if (!sample) continue
        const world = screenToWorld(screenFromEvent(sample), camera)
        let segment = sampleSegments[sampleSegments.length - 1]
        if (!segment) {
          segment = []
          sampleSegments.push(segment)
        }
        const previous = segment[segment.length - 1]
        if (previous && previous.x === world.x && previous.y === world.y) continue
        const isForcedFinal = forceFinal && index === events.length - 1
        if (
          previous &&
          !isForcedFinal &&
          Math.hypot(world.x - previous.x, world.y - previous.y) < minDistanceWorld
        ) {
          continue
        }
        const pressure =
          sample.pointerType === 'pen' ? Math.max(0.05, Math.min(1, sample.pressure || 0.5)) : 0.5
        const next = { ...world, pressure }
        if (segment.length >= MAX_INK_POINTS_PER_NODE && previous) {
          sampleSegments.push([...segment.slice(-INK_SEGMENT_OVERLAP_POINTS), next])
        } else {
          segment.push(next)
        }
      }
      scheduleDraft()
    }

    const collectErasedNodes = (event: PointerEvent): void => {
      const camera = store.getCamera()
      const radius =
        (defaultsRef.current?.eraserRadius ?? DEFAULT_ERASER_RADIUS_SCREEN) /
        Math.max(0.01, camera.z)
      for (const sample of eventSamples(event)) {
        const world = screenToWorld(screenFromEvent(sample), camera)
        const previous = lastEraserWorld
        const candidates = store.querySpatial({
          rect: {
            x: Math.min(previous?.x ?? world.x, world.x) - radius,
            y: Math.min(previous?.y ?? world.y, world.y) - radius,
            w: Math.abs(world.x - (previous?.x ?? world.x)) + radius * 2,
            h: Math.abs(world.y - (previous?.y ?? world.y)) + radius * 2,
          },
        }).nodes
        for (const id of candidates) {
          if (erasedIds.has(id)) continue
          const node = store.getNode(id)
          if (
            node?.type === 'ink' &&
            (previous
              ? hitTestInkSegmentWorld(node, previous, world, radius)
              : hitTestInkWorld(node, world, radius))
          ) {
            erasedIds.add(id)
          }
        }
        lastEraserWorld = world
      }
      scheduleDraft()
    }

    const onPointerDown = (event: PointerEvent): void => {
      if (event.pointerType === 'pen') notePenActive(palm)
      if (event.pointerType === 'touch') {
        if (shouldRejectTouch(palm, Date.now())) event.preventDefault()
        return
      }
      if (event.pointerType !== 'pen' && event.pointerType !== 'mouse') return
      if (event.pointerType === 'mouse' && event.button !== 0) return
      if (store.getInteractionState().mode === 'editing') return

      const resolvedSize = resolveValue(defaultsRef.current?.size)
      const resolvedStyle = resolveValue(defaultsRef.current?.style)
      const resolvedColor = resolveValue(defaultsRef.current?.color)
      activeSize = Math.max(0.1, resolvedSize ?? DEFAULT_INK_SIZE)
      activeStyle = {
        ...resolvedStyle,
        strokeColor: resolvedColor ?? resolvedStyle?.strokeColor ?? DEFAULT_INK_COLOR,
      }
      activePointerId = event.pointerId
      activeMode = isPenEraserContact(event) ? 'eraser' : (tool as 'ink' | 'eraser')
      sampleSegments = [[]]
      erasedIds = new Set<NodeId>()
      lastEraserWorld = null
      el.setPointerCapture(event.pointerId)
      event.preventDefault()
      if (activeMode === 'ink') appendInkSamples(event)
      else collectErasedNodes(event)
    }

    const onPointerMove = (event: PointerEvent): void => {
      if (event.pointerId !== activePointerId || activeMode === null) return
      if (event.pointerType === 'pen') notePenActive(palm)
      event.preventDefault()
      if (activeMode === 'ink') appendInkSamples(event)
      else collectErasedNodes(event)
    }

    const resetGesture = (): void => {
      const pointerId = activePointerId
      if (pointerId !== null && el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId)
      activePointerId = null
      activeMode = null
      sampleSegments = [[]]
      erasedIds.clear()
      lastEraserWorld = null
      if (draftRaf !== 0) cancelAnimationFrame(draftRaf)
      draftRaf = 0
      store.resetInteractionState()
    }

    const commitGesture = (): void => {
      const nonEmptySegments = sampleSegments.filter(segment => segment.length > 0)
      if (activeMode === 'ink' && nonEmptySegments.length > 0) {
        const data = resolveValue(defaultsRef.current?.data)
        const createNode = defaultsRef.current?.createNode
        store.batch(() => {
          for (const segment of nonEmptySegments) {
            const geometry = createInkGeometry(segment, activeSize)
            if (!geometry) continue
            const id = asNodeId(store.generateId())
            const input: InkNodeFactoryInput = {
              id,
              geometry,
              samples: segment,
              size: activeSize,
              style: activeStyle,
              ...(data ? { data } : {}),
            }
            const node = createNode
              ? createNode(input)
              : {
                  id,
                  type: 'ink',
                  x: geometry.x,
                  y: geometry.y,
                  w: geometry.w,
                  h: geometry.h,
                  angle: 0,
                  groups: [],
                  style: {
                    ...activeStyle,
                    backgroundColor: 'transparent',
                    autoFit: false,
                  },
                  data: { ...data, ink: geometry.ink },
                }
            if (node) store.addNode(node)
          }
        })
      } else if (activeMode === 'eraser' && erasedIds.size > 0) {
        store.batch(() => {
          for (const id of erasedIds) {
            if (store.getNode(id)?.type === 'ink') store.removeNode(id)
          }
        })
      }
    }

    const onPointerUp = (event: PointerEvent): void => {
      if (event.pointerType === 'pen') notePenInactive(palm, Date.now())
      if (event.pointerId !== activePointerId) return
      event.preventDefault()
      try {
        if (activeMode === 'ink') appendInkSamples(event, true)
        else collectErasedNodes(event)
        commitGesture()
        suppressNextClick = true
      } finally {
        resetGesture()
      }
    }

    const onPointerCancel = (event: PointerEvent): void => {
      if (event.pointerType === 'pen') notePenInactive(palm, Date.now())
      if (event.pointerId !== activePointerId) return
      event.preventDefault()
      resetGesture()
    }

    const onClick = (event: MouseEvent): void => {
      if (!suppressNextClick) return
      suppressNextClick = false
      event.preventDefault()
      event.stopImmediatePropagation()
    }

    el.addEventListener('pointerdown', onPointerDown, { passive: false })
    el.addEventListener('pointermove', onPointerMove, { passive: false })
    el.addEventListener('pointerup', onPointerUp, { passive: false })
    el.addEventListener('pointercancel', onPointerCancel, { passive: false })
    el.addEventListener('click', onClick)
    return () => {
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', onPointerUp)
      el.removeEventListener('pointercancel', onPointerCancel)
      el.removeEventListener('click', onClick)
      if (activePointerId !== null) resetGesture()
    }
  }, [ref, store, tool])
}
