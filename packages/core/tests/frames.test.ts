/**
 * Frame node behavior — order maintenance, containment query,
 * setFrameOrder + undo, codec round-trip, and minimap exclusion.
 */
import { describe, expect, test } from 'vitest'
import { fromSerialized, toSerialized } from '../src/codec'
import { sceneBounds } from '../src/render/minimap'
import { createCanvasStore } from '../src/store'
import { type Node, type NodeId, asNodeId } from '../src/types'

const baseNode = (over: Partial<Node>): Node => ({
  id: asNodeId('placeholder'),
  type: 'rect',
  x: 0,
  y: 0,
  w: 100,
  h: 100,
  angle: 0,
  z: 0,
  groups: [],
  ...over,
})

const addFrame = (
  store: ReturnType<typeof createCanvasStore>,
  over: Partial<Node> = {},
): NodeId => {
  const id = asNodeId(store.generateId())
  store.addNode(baseNode({ ...over, id, type: 'frame' }))
  return id
}

describe('frame order maintenance', () => {
  test('addNode appends frame ids to frameOrder', () => {
    const store = createCanvasStore()
    const a = addFrame(store)
    const b = addFrame(store)
    const c = addFrame(store)
    expect(store.getFrames().map(n => n.id)).toEqual([a, b, c])
  })

  test('removeNode filters the frame id out', () => {
    const store = createCanvasStore()
    const a = addFrame(store)
    const b = addFrame(store)
    const c = addFrame(store)
    store.removeNode(b)
    expect(store.getFrames().map(n => n.id)).toEqual([a, c])
  })

  test('non-frame nodes do not appear in getFrames', () => {
    const store = createCanvasStore()
    const f = addFrame(store)
    store.addNode(baseNode({ id: asNodeId(store.generateId()), type: 'rect' }))
    store.addNode(baseNode({ id: asNodeId(store.generateId()), type: 'ellipse' }))
    expect(store.getFrames().map(n => n.id)).toEqual([f])
  })
})

describe('setFrameOrder', () => {
  test('reorders frames as specified', () => {
    const store = createCanvasStore()
    const a = addFrame(store)
    const b = addFrame(store)
    const c = addFrame(store)
    store.setFrameOrder([c, a, b])
    expect(store.getFrames().map(n => n.id)).toEqual([c, a, b])
  })

  test('appends any missing frame ids (preserves invariant)', () => {
    const store = createCanvasStore()
    const a = addFrame(store)
    const b = addFrame(store)
    const c = addFrame(store)
    // Caller forgot `b` — should be appended.
    store.setFrameOrder([c, a])
    expect(store.getFrames().map(n => n.id)).toEqual([c, a, b])
  })

  test('drops unknown ids', () => {
    const store = createCanvasStore()
    const a = addFrame(store)
    const b = addFrame(store)
    store.setFrameOrder([b, asNodeId('not-a-frame'), a])
    expect(store.getFrames().map(n => n.id)).toEqual([b, a])
  })

  test('drops non-frame ids', () => {
    const store = createCanvasStore()
    const a = addFrame(store)
    const rect = asNodeId(store.generateId())
    store.addNode(baseNode({ id: rect, type: 'rect' }))
    store.setFrameOrder([rect, a])
    expect(store.getFrames().map(n => n.id)).toEqual([a])
  })

  test('reorder is undoable', () => {
    const store = createCanvasStore()
    const a = addFrame(store)
    const b = addFrame(store)
    const c = addFrame(store)
    store.setFrameOrder([c, a, b])
    expect(store.getFrames().map(n => n.id)).toEqual([c, a, b])
    store.undo()
    expect(store.getFrames().map(n => n.id)).toEqual([a, b, c])
    store.redo()
    expect(store.getFrames().map(n => n.id)).toEqual([c, a, b])
  })

  test('no-op when order already matches', () => {
    const store = createCanvasStore()
    addFrame(store)
    addFrame(store)
    const before = store.canUndo()
    store.setFrameOrder(store.getFrames().map(n => n.id))
    // Should not have created an undoable batch.
    expect(store.canUndo()).toBe(before)
  })
})

describe('getNodesInFrame', () => {
  test('returns nodes whose AABB is fully inside the frame', () => {
    const store = createCanvasStore()
    const frameId = addFrame(store, { x: 0, y: 0, w: 500, h: 400 })
    const inside = asNodeId(store.generateId())
    const partial = asNodeId(store.generateId())
    const outside = asNodeId(store.generateId())
    store.addNode(baseNode({ id: inside, x: 50, y: 50, w: 100, h: 100 }))
    store.addNode(baseNode({ id: partial, x: 450, y: 350, w: 200, h: 200 })) // overlaps but not inside
    store.addNode(baseNode({ id: outside, x: 700, y: 700, w: 100, h: 100 }))
    const ids = store.getNodesInFrame(frameId).map(n => n.id)
    expect(ids).toContain(inside)
    expect(ids).not.toContain(partial)
    expect(ids).not.toContain(outside)
  })

  test('excludes the frame itself + other frames', () => {
    const store = createCanvasStore()
    const outer = addFrame(store, { x: 0, y: 0, w: 1000, h: 1000 })
    const inner = addFrame(store, { x: 100, y: 100, w: 200, h: 200 })
    const rect = asNodeId(store.generateId())
    store.addNode(baseNode({ id: rect, x: 150, y: 150, w: 50, h: 50 }))
    const ids = store.getNodesInFrame(outer).map(n => n.id)
    expect(ids).toContain(rect)
    expect(ids).not.toContain(outer)
    expect(ids).not.toContain(inner)
  })

  test('returns [] when called with a non-frame id', () => {
    const store = createCanvasStore()
    const rect = asNodeId(store.generateId())
    store.addNode(baseNode({ id: rect, type: 'rect' }))
    expect(store.getNodesInFrame(rect)).toEqual([])
  })
})

describe('codec round-trip', () => {
  test('frameOrder is preserved through toSerialized → fromSerialized', () => {
    const store = createCanvasStore()
    const a = addFrame(store)
    const b = addFrame(store)
    const c = addFrame(store)
    store.setFrameOrder([c, a, b])

    const json = toSerialized({
      schemaVersion: 1,
      nodes: Object.fromEntries(store.getAllNodes().map(n => [n.id, n])),
      edges: {},
      groups: {},
      camera: store.getCamera(),
      selection: [],
      frameOrder: store.getFrames().map(n => n.id),
    })

    expect(json.frameOrder).toEqual([c, a, b])
    const restored = fromSerialized(json)
    expect(restored.frameOrder).toEqual([c, a, b])
  })

  test('loading an old scene without frameOrder still works (defaults to derived)', () => {
    const store = createCanvasStore()
    const a = addFrame(store)
    const b = addFrame(store)

    const json = toSerialized({
      schemaVersion: 1,
      nodes: Object.fromEntries(store.getAllNodes().map(n => [n.id, n])),
      edges: {},
      groups: {},
      camera: store.getCamera(),
      selection: [],
      // frameOrder intentionally omitted
    })

    // Strip frameOrder to simulate older saves.
    json.frameOrder = undefined
    const restored = fromSerialized(json)
    // Store will derive order from node iteration on populate.
    const rehydrated = createCanvasStore({ initial: restored })
    expect(
      rehydrated
        .getFrames()
        .map(n => n.id)
        .sort(),
    ).toEqual([a, b].sort())
  })
})

describe('minimap', () => {
  test('sceneBounds excludes frames', () => {
    const store = createCanvasStore()
    // Off-canvas frame far away — would distort bounds if not excluded.
    addFrame(store, { x: 10000, y: 10000, w: 1000, h: 1000 })
    const rect = asNodeId(store.generateId())
    store.addNode(baseNode({ id: rect, x: 0, y: 0, w: 100, h: 100 }))
    const bounds = sceneBounds(store)
    expect(bounds).not.toBeNull()
    // Bounds should be the rect's box (with no frame influence).
    expect(bounds!.x).toBe(0)
    expect(bounds!.y).toBe(0)
    expect(bounds!.w).toBe(100)
    expect(bounds!.h).toBe(100)
  })

  test('sceneBounds returns null when the only nodes are frames', () => {
    const store = createCanvasStore()
    addFrame(store, { x: 0, y: 0, w: 500, h: 400 })
    expect(sceneBounds(store)).toBeNull()
  })
})
