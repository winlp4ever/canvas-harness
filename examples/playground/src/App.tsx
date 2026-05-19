import {
  asEdgeId,
  asGroupId,
  asNodeId,
  VERSION as coreVersion,
  createCanvasStore,
  storeToJSON,
} from '@canvas-harness/core'
import { VERSION as reactVersion } from '@canvas-harness/react'
import { useEffect, useRef, useState } from 'react'

/**
 * Phase 1 demo: a single canvas store exposed on window for console poking.
 * No renderer yet — phase 2 ships the first visible shapes.
 *
 * Open devtools console and try:
 *   store.addNode({ id: 'n-1', type: 'rect', x: 0, y: 0, w: 100, h: 100, angle: 0, z: 0, groups: [] })
 *   store.getAllNodes()
 *   store.subscribe('change', console.log)
 *   storeToJSON(store)
 */
export function App() {
  const storeRef = useRef<ReturnType<typeof createCanvasStore> | null>(null)
  const [nodeCount, setNodeCount] = useState(0)
  const [edgeCount, setEdgeCount] = useState(0)
  const [lastOp, setLastOp] = useState<string>('—')

  // create the store once, expose to window for console access
  if (!storeRef.current) {
    storeRef.current = createCanvasStore()
    if (typeof window !== 'undefined') {
      ;(window as unknown as { store: ReturnType<typeof createCanvasStore> }).store =
        storeRef.current
      ;(window as unknown as { storeToJSON: typeof storeToJSON }).storeToJSON = storeToJSON
    }
  }
  const store = storeRef.current

  useEffect(() => {
    const unsub = store.subscribe('change', batch => {
      setNodeCount(store.getAllNodes().length)
      setEdgeCount(store.getAllEdges().length)
      setLastOp(batch.ops.map(o => o.type).join(', '))
    })
    return unsub
  }, [store])

  const seedDemo = () => {
    store.batch(() => {
      store.upsertGroup({ id: asGroupId('g-team'), name: 'Team Alpha', color: '#fde047' })
      store.addNode({
        id: asNodeId(store.generateId()),
        type: 'rect',
        x: 100,
        y: 100,
        w: 240,
        h: 120,
        angle: 0,
        z: 0,
        groups: [asGroupId('g-team')],
        content: '**Hire** Lara before Q3',
      })
      store.addNode({
        id: asNodeId(store.generateId()),
        type: 'ellipse',
        x: 520,
        y: 140,
        w: 200,
        h: 120,
        angle: 0,
        z: 1,
        groups: [asGroupId('g-team')],
        content: 'Review specs',
      })
    })
  }

  const seedManyRects = (n: number) => {
    store.batch(() => {
      for (let i = 0; i < n; i++) {
        store.addNode({
          id: asNodeId(store.generateId()),
          type: 'rect',
          x: (i % 100) * 30,
          y: Math.floor(i / 100) * 30,
          w: 24,
          h: 24,
          angle: 0,
          z: 0,
          groups: [],
        })
      }
    })
  }

  const seedEdge = () => {
    const nodes = store.getAllNodes()
    if (nodes.length < 2) return
    const a = nodes[0]!
    const b = nodes[1]!
    store.addEdge({
      id: asEdgeId(store.generateId()),
      source: { nodeId: a.id, localOffset: { x: a.w, y: a.h / 2 } },
      target: { nodeId: b.id, localOffset: { x: 0, y: b.h / 2 } },
      pathStyle: 'bezier',
      z: 0,
      groups: [],
      content: 'depends on',
    })
  }

  const clear = () => {
    store.batch(() => {
      for (const e of store.getAllEdges()) store.removeEdge(e.id)
      for (const n of store.getAllNodes()) store.removeNode(n.id)
    })
  }

  return (
    <div
      style={{
        padding: 24,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        color: '#0f172a',
        maxWidth: 720,
      }}
    >
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>canvas-harness playground</h1>
      <p style={{ color: '#64748b', marginBottom: 16 }}>
        @canvas-harness/core v{coreVersion} · @canvas-harness/react v{reactVersion}
      </p>

      <p>
        <strong>Phase 1 demo</strong> — store + spatial index + codec. No renderer yet (phase 2).
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBlock: 16 }}>
        <button type="button" onClick={seedDemo} style={btnStyle}>
          Seed 2 nodes
        </button>
        <button type="button" onClick={() => seedManyRects(100)} style={btnStyle}>
          + 100 rects
        </button>
        <button type="button" onClick={() => seedManyRects(1000)} style={btnStyle}>
          + 1000 rects
        </button>
        <button type="button" onClick={seedEdge} style={btnStyle}>
          Connect first two
        </button>
        <button type="button" onClick={clear} style={btnStyle}>
          Clear
        </button>
      </div>

      <div
        style={{
          padding: 12,
          background: '#f1f5f9',
          borderRadius: 6,
          fontFamily: 'ui-monospace, monospace',
          fontSize: 13,
        }}
      >
        <div>
          nodes: {nodeCount} · edges: {edgeCount}
        </div>
        <div>last op: {lastOp}</div>
        <div style={{ marginTop: 8, color: '#64748b' }}>
          Open the devtools console and try <code>store</code>, <code>storeToJSON(store)</code>.
        </div>
      </div>
    </div>
  )
}

const btnStyle: React.CSSProperties = {
  padding: '6px 12px',
  fontSize: 14,
  borderRadius: 6,
  border: '1px solid #cbd5e1',
  background: '#fff',
  cursor: 'pointer',
}
