/**
 * useOverlayHost — tracks the renderer's overlay-mounted custom-node ids.
 *
 * The renderer fires `onOverlayChange` with the new mount set every time
 * LOD or visibility shifts which custom nodes should be in React-rendered
 * land. This hook just keeps a state list of ids; the Canvas component
 * then renders one positioned div per id with the corresponding view.
 *
 * Phase 5 keeps this in the playground; phase 9 formalizes a similar hook
 * in `@canvas-harness/react`.
 */
import type { NodeId } from '@canvas-harness/core'
import { useEffect, useState } from 'react'

export const useOverlayHost = (): {
  mountedIds: NodeId[]
  setMountedIds: (ids: NodeId[]) => void
} => {
  const [mountedIds, setMountedIds] = useState<NodeId[]>([])
  // Stable reference for the renderer callback so the renderer doesn't re-emit.
  useEffect(() => {}, [])
  return { mountedIds, setMountedIds }
}
