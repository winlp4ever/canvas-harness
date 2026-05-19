import { describe, expect, test } from 'vitest'
import {
  RESIZE_HANDLE_SIZE_PX,
  ROTATE_HANDLE_OFFSET_PX,
  hitTestHandles,
  hitTestPoint,
  hitTestRotateHandle,
  marqueeNodes,
  nodeIntersectsRect,
  pointInNode,
  rotateHandleWorldPosition,
} from '../src/hit-test'
import { createCanvasStore } from '../src/store'
import { type Node, asClientId, asNodeId } from '../src/types'

const makeNode = (overrides: Partial<Node> = {}): Node => ({
  id: asNodeId('n-1'),
  type: 'rect',
  x: 100,
  y: 100,
  w: 200,
  h: 100,
  angle: 0,
  z: 0,
  groups: [],
  ...overrides,
})

describe('pointInNode', () => {
  test('axis-aligned: inside rect', () => {
    const n = makeNode()
    expect(pointInNode({ x: 200, y: 150 }, n)).toBe(true)
    expect(pointInNode({ x: 100, y: 100 }, n)).toBe(true) // top-left corner
    expect(pointInNode({ x: 300, y: 200 }, n)).toBe(true) // bottom-right
  })

  test('axis-aligned: outside rect', () => {
    const n = makeNode()
    expect(pointInNode({ x: 99, y: 150 }, n)).toBe(false)
    expect(pointInNode({ x: 500, y: 150 }, n)).toBe(false)
  })

  test('hidden nodes always miss', () => {
    expect(pointInNode({ x: 200, y: 150 }, makeNode({ hidden: true }))).toBe(false)
  })

  test('rotated: point at the rotated center is always inside', () => {
    const n = makeNode({ angle: Math.PI / 4 })
    const center = { x: n.x + n.w / 2, y: n.y + n.h / 2 }
    expect(pointInNode(center, n)).toBe(true)
  })

  test('rotated: point in original-local-coords becomes outside post-rotation', () => {
    const n = makeNode({ angle: Math.PI / 2 }) // 90° rotation: w↔h
    // (100, 100) is original top-left; after 90° rotation around center
    // (200,150), the corner moves to (250, 100).
    expect(pointInNode({ x: 100, y: 100 }, n)).toBe(false)
    expect(pointInNode({ x: 250, y: 100 }, n)).toBe(true)
  })
})

describe('nodeIntersectsRect', () => {
  test('node fully inside rect', () => {
    expect(nodeIntersectsRect(makeNode(), { x: 0, y: 0, w: 500, h: 500 })).toBe(true)
  })

  test('node fully outside rect', () => {
    expect(nodeIntersectsRect(makeNode(), { x: 1000, y: 1000, w: 100, h: 100 })).toBe(false)
  })

  test('node overlaps rect edge', () => {
    expect(nodeIntersectsRect(makeNode(), { x: 250, y: 150, w: 200, h: 100 })).toBe(true)
  })

  test('rotated node still detects intersection via SAT', () => {
    const n = makeNode({ angle: Math.PI / 4 })
    expect(nodeIntersectsRect(n, { x: 0, y: 0, w: 500, h: 500 })).toBe(true)
    expect(nodeIntersectsRect(n, { x: 1000, y: 1000, w: 50, h: 50 })).toBe(false)
  })
})

describe('hitTestHandles', () => {
  test('hits NW corner', () => {
    const n = makeNode()
    const cameraZ = 1
    const halfWorld = RESIZE_HANDLE_SIZE_PX / 2 / cameraZ
    expect(hitTestHandles(n, { x: n.x, y: n.y }, cameraZ)).toBe('nw')
    expect(hitTestHandles(n, { x: n.x + halfWorld, y: n.y + halfWorld }, cameraZ)).toBe('nw')
  })

  test('hits SE corner', () => {
    const n = makeNode()
    expect(hitTestHandles(n, { x: n.x + n.w, y: n.y + n.h }, 1)).toBe('se')
  })

  test('hits midpoint handles', () => {
    const n = makeNode()
    expect(hitTestHandles(n, { x: n.x + n.w / 2, y: n.y }, 1)).toBe('n')
    expect(hitTestHandles(n, { x: n.x + n.w, y: n.y + n.h / 2 }, 1)).toBe('e')
  })

  test('returns null for points away from handles', () => {
    expect(hitTestHandles(makeNode(), { x: 200, y: 150 }, 1)).toBeNull()
  })
})

describe('hitTestPoint (store-backed)', () => {
  test('returns null on empty space', () => {
    const store = createCanvasStore({ clientId: asClientId('u-t') })
    store.addNode(makeNode())
    expect(hitTestPoint(store, { x: 50, y: 50 }, 1)).toBeNull()
  })

  test('returns body hit when over a node', () => {
    const store = createCanvasStore({ clientId: asClientId('u-t') })
    store.addNode(makeNode())
    const hit = hitTestPoint(store, { x: 200, y: 150 }, 1)
    expect(hit?.kind).toBe('body')
    expect(hit?.nodeId).toBe('n-1')
  })

  test('handle hit beats body hit when node is selected', () => {
    const store = createCanvasStore({ clientId: asClientId('u-t') })
    store.addNode(makeNode())
    const selected = new Set([asNodeId('n-1')])
    // Top-left corner: NW handle territory AND inside the node body
    const hit = hitTestPoint(store, { x: 100, y: 100 }, 1, selected)
    expect(hit?.kind).toBe('resize-handle')
    if (hit?.kind === 'resize-handle') expect(hit.handle).toBe('nw')
  })

  test('topmost-z wins on overlapping nodes', () => {
    const store = createCanvasStore({ clientId: asClientId('u-t') })
    store.addNode(makeNode({ id: asNodeId('low'), z: 0 }))
    store.addNode(makeNode({ id: asNodeId('high'), z: 5 }))
    const hit = hitTestPoint(store, { x: 200, y: 150 }, 1)
    expect(hit?.nodeId).toBe('high')
  })
})

describe('marqueeNodes', () => {
  test('returns nodes intersecting the rect', () => {
    const store = createCanvasStore({ clientId: asClientId('u-t') })
    store.addNode(makeNode({ id: asNodeId('a'), x: 0, y: 0 }))
    store.addNode(makeNode({ id: asNodeId('b'), x: 500, y: 500 }))
    store.addNode(makeNode({ id: asNodeId('c'), x: 50, y: 50 }))
    const hits = marqueeNodes(store, { x: 0, y: 0, w: 200, h: 200 })
    expect(hits.sort()).toEqual(['a', 'c'])
  })
})

describe('store.interaction', () => {
  test('starts idle', () => {
    const store = createCanvasStore({ clientId: asClientId('u-t') })
    const state = store.getInteractionState()
    expect(state.mode).toBe('idle')
    expect(state.draggedIds).toEqual([])
    expect(state.marqueeRect).toBeNull()
  })

  test('setInteractionState merges and emits', () => {
    const store = createCanvasStore({ clientId: asClientId('u-t') })
    const events: string[] = []
    store.subscribe('interaction', s => events.push(s.mode))
    store.setInteractionState({ mode: 'dragging' })
    store.setInteractionState({ dragDelta: { x: 10, y: 20 } })
    expect(events).toEqual(['dragging', 'dragging'])
    expect(store.getInteractionState().dragDelta).toEqual({ x: 10, y: 20 })
  })

  test('resetInteractionState returns to idle', () => {
    const store = createCanvasStore({ clientId: asClientId('u-t') })
    store.setInteractionState({ mode: 'marqueeing' })
    store.resetInteractionState()
    expect(store.getInteractionState().mode).toBe('idle')
  })
})

describe("rotation handle", () => {
  test("axis-aligned: handle sits above top edge", () => {
    const n = makeNode() // 200×100 at (100,100)
    const cameraZ = 1
    const pos = rotateHandleWorldPosition(n, cameraZ)
    // top edge midpoint is (200, 100); handle is ROTATE_HANDLE_OFFSET_PX above
    expect(pos.x).toBeCloseTo(200, 5)
    expect(pos.y).toBeCloseTo(100 - ROTATE_HANDLE_OFFSET_PX, 5)
  })

  test("hit-test fires within the radius", () => {
    const n = makeNode()
    const center = rotateHandleWorldPosition(n, 1)
    expect(hitTestRotateHandle(n, center, 1)).toBe(true)
    expect(hitTestRotateHandle(n, { x: center.x + 100, y: center.y }, 1)).toBe(false)
  })

  test("90° rotation: handle ends up to the right of node center", () => {
    const n = makeNode({ angle: Math.PI / 2 })
    const pos = rotateHandleWorldPosition(n, 1)
    const cx = n.x + n.w / 2
    const cy = n.y + n.h / 2
    // After 90° clockwise rotation, the formerly-top edge points right;
    // its midpoint is now cx + h/2 from center, plus the screen-px offset.
    expect(pos.x).toBeCloseTo(cx + n.h / 2 + ROTATE_HANDLE_OFFSET_PX, 5)
    expect(pos.y).toBeCloseTo(cy, 5)
  })

  test("hitTestPoint returns rotate-handle when over the handle", () => {
    const store = createCanvasStore({ clientId: asClientId("u-r") })
    const id = asNodeId("n-rot")
    store.addNode(makeNode({ id }))
    const node = store.getNode(id)!
    const handlePos = rotateHandleWorldPosition(node, 1)
    const hit = hitTestPoint(store, handlePos, 1, new Set([id]))
    expect(hit?.kind).toBe("rotate-handle")
  })
})
