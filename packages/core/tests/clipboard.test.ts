import { describe, expect, test } from 'vitest'
import {
  asClientId,
  asEdgeId,
  asNodeId,
  createCanvasStore,
  deserializeClipboard,
  exportSelectionSvg,
  isCanvasHarnessClipboard,
  paste,
  serializeSelection,
} from '../src'
import type { Edge, Node } from '../src'

const makeNode = (overrides: Partial<Node> = {}): Node => ({
  id: asNodeId('n1'),
  type: 'rect',
  x: 0,
  y: 0,
  w: 100,
  h: 100,
  angle: 0,
  z: 0,
  groups: [],
  ...overrides,
})

const makeEdge = (overrides: Partial<Edge> = {}): Edge => ({
  id: asEdgeId('e1'),
  source: { nodeId: asNodeId('n1'), localOffset: { x: 100, y: 50 } },
  target: { nodeId: asNodeId('n2'), localOffset: { x: 0, y: 50 } },
  pathStyle: 'bezier',
  z: 0,
  groups: [],
  ...overrides,
})

describe('serializeSelection', () => {
  test('empty selection → empty payload', () => {
    const store = createCanvasStore()
    const clip = serializeSelection(store)
    expect(clip.nodes).toEqual([])
    expect(clip.edges).toEqual([])
    expect(clip.kind).toBe('canvas-harness/clipboard')
  })

  test('captures selected nodes', () => {
    const store = createCanvasStore()
    store.addNode(makeNode({ id: asNodeId('a') }))
    store.addNode(makeNode({ id: asNodeId('b'), x: 200 }))
    store.setSelection([asNodeId('a')])
    const clip = serializeSelection(store)
    expect(clip.nodes.map(n => n.id)).toEqual(['a'])
  })

  test('includes edges between selected nodes; drops crossing edges', () => {
    const store = createCanvasStore()
    store.addNode(makeNode({ id: asNodeId('a') }))
    store.addNode(makeNode({ id: asNodeId('b'), x: 200 }))
    store.addNode(makeNode({ id: asNodeId('c'), x: 400 }))
    store.addEdge(
      makeEdge({
        id: asEdgeId('ab'),
        source: { nodeId: asNodeId('a'), localOffset: { x: 0, y: 0 } },
        target: { nodeId: asNodeId('b'), localOffset: { x: 0, y: 0 } },
      }),
    )
    store.addEdge(
      makeEdge({
        id: asEdgeId('bc'),
        source: { nodeId: asNodeId('b'), localOffset: { x: 0, y: 0 } },
        target: { nodeId: asNodeId('c'), localOffset: { x: 0, y: 0 } },
      }),
    )
    store.setSelection([asNodeId('a'), asNodeId('b')]) // selects a + b, not c
    const clip = serializeSelection(store)
    expect(clip.edges.map(e => e.id).sort()).toEqual(['ab']) // 'bc' dropped (crosses selection)
  })
})

describe('deserializeClipboard', () => {
  test('round-trip: paste produces equivalent nodes with fresh ids and offset', () => {
    const store = createCanvasStore()
    store.addNode(makeNode({ id: asNodeId('a'), x: 10, y: 20 }))
    store.setSelection([asNodeId('a')])
    const clip = serializeSelection(store)
    const newIds = deserializeClipboard(store, clip)
    expect(newIds).toHaveLength(1)
    expect(newIds[0]).not.toBe(asNodeId('a')) // fresh id
    const pasted = store.getNode(newIds[0]!)!
    expect(pasted.x).toBe(30) // 10 + default offset 20
    expect(pasted.y).toBe(40) // 20 + default offset 20
  })

  test('paste rewires edge endpoints to the new node ids', () => {
    const store = createCanvasStore()
    store.addNode(makeNode({ id: asNodeId('a') }))
    store.addNode(makeNode({ id: asNodeId('b'), x: 200 }))
    store.addEdge(
      makeEdge({
        id: asEdgeId('ab'),
        source: { nodeId: asNodeId('a'), localOffset: { x: 0, y: 0 } },
        target: { nodeId: asNodeId('b'), localOffset: { x: 0, y: 0 } },
      }),
    )
    store.setSelection([asNodeId('a'), asNodeId('b'), asEdgeId('ab')])
    const clip = serializeSelection(store)
    const newIds = deserializeClipboard(store, clip)
    expect(newIds).toHaveLength(2)
    // Find the pasted edge.
    const allEdges = store.getAllEdges()
    expect(allEdges).toHaveLength(2) // original + pasted
    const pasted = allEdges.find(e => e.id !== asEdgeId('ab'))!
    const src = pasted.source as { nodeId: string }
    const tgt = pasted.target as { nodeId: string }
    expect(newIds).toContain(src.nodeId)
    expect(newIds).toContain(tgt.nodeId)
  })

  test('paste is one undo step', () => {
    const store = createCanvasStore()
    store.addNode(makeNode({ id: asNodeId('a') }))
    store.setSelection([asNodeId('a')])
    const clip = serializeSelection(store)
    deserializeClipboard(store, clip)
    expect(store.getNodeCount()).toBe(2)
    store.undo()
    expect(store.getNodeCount()).toBe(1)
  })

  test('repeated paste increments offsets cleanly', () => {
    const store = createCanvasStore()
    store.addNode(makeNode({ id: asNodeId('a'), x: 0, y: 0 }))
    store.setSelection([asNodeId('a')])
    const clip = serializeSelection(store)
    const first = deserializeClipboard(store, clip, { offset: { x: 20, y: 20 } })
    const second = deserializeClipboard(store, clip, { offset: { x: 40, y: 40 } })
    expect(store.getNode(first[0]!)?.x).toBe(20)
    expect(store.getNode(second[0]!)?.x).toBe(40)
  })

  test('at: clip bbox center lands on the given world point', () => {
    const store = createCanvasStore()
    // Two nodes — bbox center is (50, 50).
    store.addNode(makeNode({ id: asNodeId('a'), x: 0, y: 0, w: 50, h: 50 }))
    store.addNode(makeNode({ id: asNodeId('b'), x: 50, y: 50, w: 50, h: 50 }))
    store.setSelection([asNodeId('a'), asNodeId('b')])
    const clip = serializeSelection(store)
    const ids = deserializeClipboard(store, clip, { at: { x: 300, y: 200 } })
    expect(ids).toHaveLength(2)
    // Offset = at - center = (300 - 50, 200 - 50) = (250, 150)
    const pastedA = store.getNode(ids[0]!)!
    const pastedB = store.getNode(ids[1]!)!
    // bbox of pasted should be (250..350, 150..250) — center (300, 200).
    const minX = Math.min(pastedA.x, pastedB.x)
    const maxX = Math.max(pastedA.x + pastedA.w, pastedB.x + pastedB.w)
    const minY = Math.min(pastedA.y, pastedB.y)
    const maxY = Math.max(pastedA.y + pastedA.h, pastedB.y + pastedB.h)
    expect((minX + maxX) / 2).toBeCloseTo(300)
    expect((minY + maxY) / 2).toBeCloseTo(200)
  })

  test('explicit offset takes precedence over at', () => {
    const store = createCanvasStore()
    store.addNode(makeNode({ id: asNodeId('a'), x: 10, y: 20, w: 50, h: 50 }))
    store.setSelection([asNodeId('a')])
    const clip = serializeSelection(store)
    const ids = deserializeClipboard(store, clip, {
      offset: { x: 5, y: 5 },
      at: { x: 999, y: 999 },
    })
    // offset wins → pasted x = 10 + 5 = 15.
    expect(store.getNode(ids[0]!)?.x).toBe(15)
  })

  test('free-floating edge endpoint gets the offset applied', () => {
    const store = createCanvasStore()
    store.addNode(makeNode({ id: asNodeId('a'), x: 0, y: 0, w: 100, h: 100 }))
    // Edge with attached source, free-floating target.
    store.addEdge(
      makeEdge({
        id: asEdgeId('e1'),
        source: { nodeId: asNodeId('a'), localOffset: { x: 50, y: 50 } },
        target: { worldPoint: { x: 200, y: 200 } },
      }),
    )
    store.setSelection([asNodeId('a'), asEdgeId('e1')])
    const clip = serializeSelection(store)
    const before = store.getAllEdges().length
    deserializeClipboard(store, clip, { offset: { x: 30, y: 40 } })
    expect(store.getAllEdges()).toHaveLength(before + 1)
    const pasted = store.getAllEdges().find(e => e.id !== asEdgeId('e1'))!
    expect('worldPoint' in pasted.target).toBe(true)
    if ('worldPoint' in pasted.target) {
      expect(pasted.target.worldPoint.x).toBe(230) // 200 + 30
      expect(pasted.target.worldPoint.y).toBe(240) // 200 + 40
    }
  })
})

describe('paste() — cursor-as-default positioning', () => {
  test('pastes centered on cursor when interaction.pointer is set', async () => {
    const store = createCanvasStore({ clientId: asClientId('u') })
    store.addNode(makeNode({ id: asNodeId('a'), x: 0, y: 0, w: 50, h: 50 }))
    store.setSelection([asNodeId('a')])
    const clip = serializeSelection(store)
    // Move the "cursor" to (300, 200) in world coords.
    store.setInteractionState({
      pointer: {
        worldX: 300,
        worldY: 200,
        screenX: 0,
        screenY: 0,
        pointerType: 'mouse',
      },
    })
    const ids = await paste(store, clip)
    expect(ids).not.toBeNull()
    const pasted = store.getNode(ids![0] as Node['id'])!
    // bbox center of source (clip node a) is (25, 25). Cursor is (300, 200).
    // Offset = (275, 175). Pasted x = 0 + 275 = 275, y = 0 + 175 = 175.
    expect(pasted.x).toBe(275)
    expect(pasted.y).toBe(175)
  })

  test('pastes with (20, 20) fallback when no cursor is tracked', async () => {
    const store = createCanvasStore({ clientId: asClientId('u') })
    store.addNode(makeNode({ id: asNodeId('a'), x: 0, y: 0, w: 50, h: 50 }))
    store.setSelection([asNodeId('a')])
    const clip = serializeSelection(store)
    // interaction.pointer is null at this point — never set.
    const ids = await paste(store, clip)
    expect(ids).not.toBeNull()
    const pasted = store.getNode(ids![0] as Node['id'])!
    expect(pasted.x).toBe(20)
    expect(pasted.y).toBe(20)
  })

  test('explicit at on paste() overrides the cursor default', async () => {
    const store = createCanvasStore({ clientId: asClientId('u') })
    store.addNode(makeNode({ id: asNodeId('a'), x: 0, y: 0, w: 50, h: 50 }))
    store.setSelection([asNodeId('a')])
    const clip = serializeSelection(store)
    store.setInteractionState({
      pointer: {
        worldX: 999,
        worldY: 999,
        screenX: 0,
        screenY: 0,
        pointerType: 'mouse',
      },
    })
    const ids = await paste(store, clip, { at: { x: 100, y: 50 } })
    const pasted = store.getNode(ids![0] as Node['id'])!
    // Center (25, 25) → offset (75, 25) → pasted (75, 25).
    expect(pasted.x).toBe(75)
    expect(pasted.y).toBe(25)
  })
})

describe('isCanvasHarnessClipboard', () => {
  test('accepts our payload', () => {
    const store = createCanvasStore()
    store.addNode(makeNode())
    store.setSelection([asNodeId('n1')])
    expect(isCanvasHarnessClipboard(serializeSelection(store))).toBe(true)
  })
  test('rejects arbitrary JSON', () => {
    expect(isCanvasHarnessClipboard({ foo: 'bar' })).toBe(false)
    expect(isCanvasHarnessClipboard(null)).toBe(false)
    expect(isCanvasHarnessClipboard([])).toBe(false)
  })
})

describe('SVG export', () => {
  test('opaque selection emits a background <rect>', () => {
    const store = createCanvasStore()
    store.addNode(makeNode({ id: asNodeId('a') }))
    store.setSelection([asNodeId('a')])
    const svg = exportSelectionSvg(store, { transparentBackground: false })
    expect(svg).toContain('<rect width="100%" height="100%"')
    expect(svg).toContain('<svg')
  })
  test('transparentBackground omits the background rect', () => {
    const store = createCanvasStore()
    store.addNode(makeNode({ id: asNodeId('a') }))
    store.setSelection([asNodeId('a')])
    const svg = exportSelectionSvg(store, { transparentBackground: true })
    expect(svg).not.toContain('width="100%" height="100%"')
  })
  test('strips markdown syntax from text content', () => {
    const store = createCanvasStore()
    store.addNode(makeNode({ id: asNodeId('a'), content: 'hello **world**' }))
    store.setSelection([asNodeId('a')])
    const svg = exportSelectionSvg(store)
    expect(svg).toContain('hello world')
    expect(svg).not.toContain('**world**')
  })
})
