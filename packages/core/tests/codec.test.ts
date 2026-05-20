import { describe, expect, test } from 'vitest'
import { fromSerialized, registerMigrator, storeToJSON, toSerialized } from '../src/codec'
import { createCanvasStore } from '../src/store'
import {
  type Edge,
  type Node,
  SCHEMA_VERSION,
  type Scene,
  type SerializedScene,
  asClientId,
  asEdgeId,
  asGroupId,
  asNodeId,
} from '../src/types'

const makeNode = (overrides: Partial<Node> = {}): Node => ({
  id: asNodeId('n-1'),
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

describe('codec', () => {
  test('toSerialized / fromSerialized round-trips a scene', () => {
    const scene: Scene = {
      schemaVersion: SCHEMA_VERSION,
      nodes: {
        [asNodeId('n-1')]: makeNode(),
        [asNodeId('n-2')]: makeNode({ id: asNodeId('n-2'), x: 50 }),
      },
      edges: {},
      groups: { [asGroupId('g-1')]: { id: asGroupId('g-1'), name: 'Team' } },
      camera: { x: 10, y: 20, z: 1.5 },
      selection: [asNodeId('n-1')],
    }

    const wire = toSerialized(scene)
    expect(wire.nodes).toHaveLength(2)
    expect(wire.groups).toHaveLength(1)

    const round = fromSerialized(wire)
    expect(round.schemaVersion).toBe(SCHEMA_VERSION)
    expect(round.nodes[asNodeId('n-1')]).toEqual(scene.nodes[asNodeId('n-1')])
    expect(round.groups[asGroupId('g-1')]?.name).toBe('Team')
    expect(round.camera).toEqual(scene.camera)
    expect(round.selection).toEqual(scene.selection)
  })

  test('storeToJSON dumps the current store state', () => {
    const store = createCanvasStore({ clientId: asClientId('u-x') })
    store.addNode(makeNode())
    store.addNode(makeNode({ id: asNodeId('n-2'), x: 200 }))
    store.setCamera({ z: 2 })
    store.setSelection([asNodeId('n-1')])

    const wire = storeToJSON(store)
    expect(wire.nodes).toHaveLength(2)
    expect(wire.camera.z).toBe(2)
    expect(wire.selection).toEqual(['n-1'])
  })

  test('fromSerialized → new store has same content', () => {
    const a = createCanvasStore({ clientId: asClientId('u-a') })
    a.addNode(makeNode())
    a.addNode(makeNode({ id: asNodeId('n-2'), x: 200 }))
    const edge: Edge = {
      id: asEdgeId('e-1'),
      source: { nodeId: asNodeId('n-1'), localOffset: { x: 100, y: 50 } },
      target: { nodeId: asNodeId('n-2'), localOffset: { x: 0, y: 50 } },
      pathStyle: 'bezier',
      z: 0,
      groups: [],
    }
    a.addEdge(edge)

    const wire = storeToJSON(a)
    const restored = fromSerialized(wire)
    const b = createCanvasStore({ initial: restored })

    expect(b.getAllNodes()).toHaveLength(2)
    // addEdge auto-assigns z (top of stack) when called with z=0; the
    // restored store hydrates from the post-assignment serialized form.
    const restoredEdge = b.getEdge(asEdgeId('e-1'))
    expect(restoredEdge).toEqual({ ...edge, z: restoredEdge!.z })
    expect(restoredEdge!.z).toBeGreaterThan(0)
  })

  test('migrator runs when version is older', () => {
    registerMigrator(0, (raw: unknown) => {
      const obj = raw as { nodes: Node[]; schemaVersion?: number }
      // pretend v0 lacked groups; add them
      return { ...obj, schemaVersion: 1, groups: [] }
    })

    const v0Scene = {
      schemaVersion: 0,
      nodes: [makeNode()],
      edges: [],
      // groups deliberately missing
      camera: { x: 0, y: 0, z: 1 },
      selection: [],
    }
    const migrated = fromSerialized(v0Scene as unknown as SerializedScene)
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION)
    expect(Object.values(migrated.nodes)).toHaveLength(1)
  })
})
