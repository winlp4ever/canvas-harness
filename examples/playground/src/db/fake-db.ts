/**
 * Stand-in for a real database / API. Logs the save and resolves
 * after a short delay so the playground can demo the realistic
 * shape (debounce → async flush → status update) without a server.
 *
 * Swap this with `fetch('/api/scene', { method: 'PUT', body: ... })`
 * — the hook contract (returning a Promise) doesn't change.
 */
import type { Edge, Group, Node } from '@canvas-harness/core'

export type PersistedScene = {
  nodes: Node[]
  edges: Edge[]
  groups: Group[]
}

const NETWORK_LATENCY_MS = 150

export const fakeSave = async (scene: PersistedScene): Promise<void> => {
  const payload = JSON.stringify(scene)
  await new Promise(resolve => setTimeout(resolve, NETWORK_LATENCY_MS))
  console.info(
    `[fake-db] saved: ${scene.nodes.length} nodes, ${scene.edges.length} edges, ${scene.groups.length} groups (${(payload.length / 1024).toFixed(1)} KB)`,
  )
}
