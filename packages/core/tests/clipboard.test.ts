import { describe, expect, test } from 'vitest'
import {
  asEdgeId,
  asNodeId,
  createCanvasStore,
  deserializeClipboard,
  exportSelectionSvg,
  isCanvasHarnessClipboard,
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
