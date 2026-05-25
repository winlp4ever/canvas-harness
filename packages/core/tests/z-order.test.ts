/**
 * Z-order semantics — see ARCHITECTURE.md §3.6.
 *
 * Covers:
 *   - addNode auto-top when z is omitted; literal z when provided
 *   - sendToBack uses the bottomZ counter (negative monotonic)
 *   - paste/duplicate-with-explicit-z doesn't get re-bumped (the
 *     pre-2026-05 sentinel bug)
 *   - Order is preserved through serialize → fromSerialized → store
 */
import { describe, expect, test } from 'vitest'
import { fromSerialized, storeToJSON } from '../src/codec'
import { createCanvasStore } from '../src/store'
import { type Edge, type Node, asEdgeId, asNodeId } from '../src/types'

const baseNode = (over: Partial<Omit<Node, 'z'> & { z?: number }> = {}) => ({
  id: asNodeId('placeholder'),
  type: 'rect' as const,
  x: 0,
  y: 0,
  w: 100,
  h: 100,
  angle: 0,
  groups: [],
  ...over,
})

const add = (
  store: ReturnType<typeof createCanvasStore>,
  over: Partial<Omit<Node, 'z'> & { z?: number }> = {},
) => {
  const id = asNodeId(store.generateId())
  return store.addNode(baseNode({ ...over, id }))
}

describe('addNode auto-top semantics', () => {
  test('omitting z lands the node on top of the stack', () => {
    const store = createCanvasStore()
    const a = add(store)
    const b = add(store)
    const c = add(store)
    const za = store.getNode(a)!.z
    const zb = store.getNode(b)!.z
    const zc = store.getNode(c)!.z
    expect(zb).toBeGreaterThan(za)
    expect(zc).toBeGreaterThan(zb)
  })

  test('explicit z = 0 stays at z = 0 (no auto-bump)', () => {
    const store = createCanvasStore()
    const id = add(store, { z: 0 })
    expect(store.getNode(id)!.z).toBe(0)
  })

  test('explicit negative z stays negative', () => {
    const store = createCanvasStore()
    const id = add(store, { z: -5 })
    expect(store.getNode(id)!.z).toBe(-5)
  })

  test('explicit positive z is honored', () => {
    const store = createCanvasStore()
    const id = add(store, { z: 42 })
    expect(store.getNode(id)!.z).toBe(42)
  })

  test('topZ tracks an explicitly-high z; next auto-add lands above it', () => {
    const store = createCanvasStore()
    add(store, { z: 100 })
    const next = add(store) // omit z
    expect(store.getNode(next)!.z).toBeGreaterThan(100)
  })
})

describe('sendToBack uses --bottomZ', () => {
  test('produces a negative z', () => {
    const store = createCanvasStore()
    const a = add(store)
    const b = add(store)
    store.sendToBack([b])
    expect(store.getNode(b)!.z).toBeLessThan(0)
    // a is unchanged, still on top
    expect(store.getNode(a)!.z).toBeGreaterThan(store.getNode(b)!.z)
  })

  test('multi-call sendToBack keeps pushing lower (monotonic)', () => {
    const store = createCanvasStore()
    const a = add(store)
    const b = add(store)
    store.sendToBack([a])
    const za1 = store.getNode(a)!.z
    store.sendToBack([b])
    const zb = store.getNode(b)!.z
    store.sendToBack([a])
    const za2 = store.getNode(a)!.z
    expect(za1).toBeLessThan(0)
    expect(zb).toBeLessThan(za1) // b went below a's first position
    expect(za2).toBeLessThan(zb) // a went below b
  })

  test('multi-target sendToBack preserves relative order', () => {
    const store = createCanvasStore()
    const a = add(store)
    const b = add(store)
    const c = add(store)
    store.sendToBack([a, b, c])
    // a was passed first → sits one above b → one above c
    expect(store.getNode(a)!.z).toBeGreaterThan(store.getNode(b)!.z)
    expect(store.getNode(b)!.z).toBeGreaterThan(store.getNode(c)!.z)
  })

  test('bottomZ persists through serialize → rehydrate', () => {
    const store = createCanvasStore()
    const a = add(store)
    store.sendToBack([a]) // a.z = -1
    const za1 = store.getNode(a)!.z

    const wire = storeToJSON(store)
    const restored = fromSerialized(wire)
    const next = createCanvasStore({ initial: restored })

    const b = add(next) // omit z, auto-top — should still be > a
    const za2 = next.getNode(a)!.z
    const zb = next.getNode(b)!.z
    expect(za2).toBe(za1)
    expect(zb).toBeGreaterThan(za2)
    // sendToBack again should produce something below the existing minimum
    next.sendToBack([b])
    expect(next.getNode(b)!.z).toBeLessThan(za2)
  })
})

describe('regression: sendToBack-then-paste no longer re-promotes', () => {
  test('round-tripping a z=0 node through addNode preserves z=0', () => {
    // The pre-fix bug: addNode treated z === 0 as "please auto-top",
    // so any node with z=0 (whether sendToBack'd there or pasted) got
    // re-bumped to the top on re-add. Now z=0 is literal.
    const store = createCanvasStore()
    const id = asNodeId(store.generateId())
    store.addNode(baseNode({ id, z: 0 }))
    expect(store.getNode(id)!.z).toBe(0)
  })

  test('paste-style flow: serialize one node, re-add via addNode, z is preserved', () => {
    const store = createCanvasStore()
    const a = add(store)
    store.sendToBack([a])
    const za = store.getNode(a)!.z // negative

    // Simulate paste: remove + re-add with the same z.
    const snapshot = store.getNode(a)!
    store.removeNode(a)
    const newId = asNodeId(store.generateId())
    store.addNode({ ...snapshot, id: newId })

    expect(store.getNode(newId)!.z).toBe(za)
  })
})

describe('paint order via z values', () => {
  test('lower z paints behind higher z (renderer-style sort)', () => {
    const store = createCanvasStore()
    const back = add(store, { z: -10 })
    const middle = add(store, { z: 0 })
    const front = add(store, { z: 10 })

    const sorted = [...store.getAllNodes()].sort((l, r) => l.z - r.z || (l.id < r.id ? -1 : 1))
    expect(sorted.map(n => n.id)).toEqual([back, middle, front])
  })
})

describe('edges follow the same semantics', () => {
  const addEdge = (
    store: ReturnType<typeof createCanvasStore>,
    over: Partial<Omit<Edge, 'z'> & { z?: number }> = {},
  ) =>
    store.addEdge({
      id: asEdgeId(store.generateId()),
      source: { nodeId: asNodeId('na'), localOffset: { x: 0, y: 0 } },
      target: { nodeId: asNodeId('nb'), localOffset: { x: 0, y: 0 } },
      pathStyle: 'bezier',
      groups: [],
      ...over,
    })

  test('omitted z auto-tops; explicit z = 0 stays 0', () => {
    const store = createCanvasStore()
    const auto = addEdge(store)
    const literal = addEdge(store, { z: 0 })
    expect(store.getEdge(auto)!.z).toBeGreaterThan(0)
    expect(store.getEdge(literal)!.z).toBe(0)
  })
})
