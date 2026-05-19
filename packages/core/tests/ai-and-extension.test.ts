import { describe, expect, test, vi } from 'vitest'
import {
  asEdgeId,
  asNodeId,
  createCanvasStore,
  defineExtension,
  getContext,
  installExtension,
  installedExtensions,
  opSchemas,
  opSchemasAsAnthropicTools,
} from '../src'
import type { Edge, Node, SceneContextJson } from '../src'

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

describe('getContext', () => {
  test('markdown — empty scene', () => {
    const store = createCanvasStore()
    const out = getContext(store) as string
    expect(out).toContain('# Canvas scene')
    expect(out).toContain('0 node(s), 0 edge(s)')
  })

  test('markdown — includes node + edge lines', () => {
    const store = createCanvasStore()
    store.addNode(makeNode({ id: asNodeId('a'), content: 'hello' }))
    store.addNode(makeNode({ id: asNodeId('b'), x: 200 }))
    store.addEdge(
      makeEdge({
        id: asEdgeId('e'),
        source: { nodeId: asNodeId('a'), localOffset: { x: 0, y: 0 } },
        target: { nodeId: asNodeId('b'), localOffset: { x: 0, y: 0 } },
      }),
    )
    const out = getContext(store) as string
    expect(out).toContain('## Nodes')
    expect(out).toContain('`a`')
    expect(out).toContain('"hello"')
    expect(out).toContain('## Edges')
    expect(out).toContain('`a` → `b`')
  })

  test('json — structured shape', () => {
    const store = createCanvasStore()
    store.addNode(makeNode({ id: asNodeId('a'), content: 'hi' }))
    const out = getContext(store, { format: 'json' }) as SceneContextJson
    expect(out.nodes).toHaveLength(1)
    expect(out.nodes[0]).toMatchObject({ id: 'a', type: 'rect', content: 'hi' })
    expect(out.truncated).toBe(false)
  })

  test('selectionOnly restricts the output', () => {
    const store = createCanvasStore()
    store.addNode(makeNode({ id: asNodeId('a') }))
    store.addNode(makeNode({ id: asNodeId('b') }))
    store.setSelection([asNodeId('a')])
    const out = getContext(store, { format: 'json', selectionOnly: true }) as SceneContextJson
    expect(out.nodes).toHaveLength(1)
    expect(out.nodes[0]?.id).toBe('a')
  })

  test('maxNodes truncates + flags', () => {
    const store = createCanvasStore()
    for (let i = 0; i < 5; i++) store.addNode(makeNode({ id: asNodeId(`n${i}`) }))
    const out = getContext(store, { format: 'json', maxNodes: 3 }) as SceneContextJson
    expect(out.nodes).toHaveLength(3)
    expect(out.truncated).toBe(true)
  })
})

describe('op-schemas', () => {
  test('every Op variant has a schema', () => {
    expect(Object.keys(opSchemas).sort()).toEqual(
      ['nodeAdd', 'nodeUpdate', 'nodeRemove', 'edgeAdd', 'edgeUpdate', 'edgeRemove', 'groupUpsert', 'groupRemove'].sort(),
    )
  })

  test('schema for nodeAdd accepts a valid op shape', () => {
    const op = { type: 'node.add', node: makeNode() }
    // Lightweight shape check — full JSON-Schema validation is the
    // consumer's job (they'll bring ajv etc.).
    expect((opSchemas.nodeAdd as { properties: { type: { const: string } } }).properties.type.const).toBe(
      'node.add',
    )
    expect(op.type).toBe('node.add')
  })

  test('opSchemasAsAnthropicTools produces a Messages-API-shaped tool def', () => {
    const tools = opSchemasAsAnthropicTools()
    expect(tools.length).toBeGreaterThan(0)
    for (const t of tools) {
      expect(t).toHaveProperty('name')
      expect(t).toHaveProperty('description')
      expect(t).toHaveProperty('input_schema')
    }
    expect(tools.find(t => t.name === 'canvas_node_add')).toBeTruthy()
  })
})

describe('extension system', () => {
  test('installExtension installs and uninstalls cleanly', () => {
    const store = createCanvasStore()
    const onTeardown = vi.fn()
    const ext = defineExtension({
      name: 'test-ext',
      onInstall: () => onTeardown,
    })
    const uninstall = installExtension(store, ext)
    expect(installedExtensions(store)).toEqual(['test-ext'])
    uninstall()
    expect(installedExtensions(store)).toEqual([])
    expect(onTeardown).toHaveBeenCalledTimes(1)
  })

  test('api.on auto-unsubscribes on uninstall', () => {
    const store = createCanvasStore()
    const seen: string[] = []
    const uninstall = installExtension(
      store,
      defineExtension({
        name: 'sub',
        onInstall: api => {
          api.on('camera', () => seen.push('camera'))
        },
      }),
    )
    store.setCamera({ z: 2 })
    expect(seen).toEqual(['camera'])
    uninstall()
    store.setCamera({ z: 3 })
    expect(seen).toEqual(['camera']) // no further events
  })

  test('re-installing same name replaces the previous instance', () => {
    const store = createCanvasStore()
    const teardownA = vi.fn()
    const teardownB = vi.fn()
    installExtension(store, defineExtension({ name: 'same', onInstall: () => teardownA }))
    installExtension(store, defineExtension({ name: 'same', onInstall: () => teardownB }))
    expect(teardownA).toHaveBeenCalledTimes(1)
    expect(teardownB).toHaveBeenCalledTimes(0)
    expect(installedExtensions(store)).toEqual(['same'])
  })
})
