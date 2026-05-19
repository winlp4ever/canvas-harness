import type { CanvasStore } from '../store'
/**
 * Scene serialization codec — see ARCHITECTURE.md §3.8.
 *
 * In-memory uses Record<Id, T> for O(1) lookup; the wire format uses
 * arrays (smaller JSON, gzips better, deterministic iteration order).
 * Cost is one O(n) pass at the codec boundary, paid only on load/save.
 *
 * Schema migration: registered migrators run on `fromJSON` when the
 * incoming `schemaVersion` is lower than the current one.
 */
import { SCHEMA_VERSION, asEdgeId, asGroupId, asNodeId } from '../types'
import type { Scene, SerializedScene } from '../types'

export type Migrator = (raw: unknown) => unknown

const migrators = new Map<number, Migrator>()

/**
 * Register a migrator that runs when loading data at version `fromVersion`.
 * The migrator should return data shaped for `fromVersion + 1`.
 */
export const registerMigrator = (fromVersion: number, fn: Migrator): void => {
  migrators.set(fromVersion, fn)
}

/**
 * Serializes a scene to its wire form.
 */
export const toSerialized = (scene: Scene): SerializedScene => ({
  schemaVersion: scene.schemaVersion,
  nodes: Object.values(scene.nodes),
  edges: Object.values(scene.edges),
  groups: Object.values(scene.groups),
  camera: scene.camera,
  selection: scene.selection,
})

/**
 * Deserializes from wire form into the in-memory Scene shape.
 * Runs migrators if the version is older than current.
 */
export const fromSerialized = (raw: SerializedScene | unknown): Scene => {
  let working: unknown = raw
  let version = (working as { schemaVersion?: number }).schemaVersion ?? 0

  while (version < SCHEMA_VERSION) {
    const fn = migrators.get(version)
    if (!fn) {
      throw new Error(
        `Cannot migrate scene from schemaVersion ${version} to ${SCHEMA_VERSION}; no migrator registered`,
      )
    }
    working = fn(working)
    version++
  }

  const ser = working as SerializedScene

  return {
    schemaVersion: SCHEMA_VERSION,
    nodes: Object.fromEntries(ser.nodes.map(n => [asNodeId(n.id), n])) as Scene['nodes'],
    edges: Object.fromEntries(ser.edges.map(e => [asEdgeId(e.id), e])) as Scene['edges'],
    groups: Object.fromEntries(ser.groups.map(g => [asGroupId(g.id), g])) as Scene['groups'],
    camera: ser.camera,
    selection: ser.selection,
  }
}

/**
 * Convenience: dump a store's current state to wire form.
 */
export const storeToJSON = (store: CanvasStore): SerializedScene => ({
  schemaVersion: SCHEMA_VERSION,
  nodes: store.getAllNodes(),
  edges: store.getAllEdges(),
  groups: store.getAllGroups(),
  camera: store.getCamera(),
  selection: store.getSelection(),
})
