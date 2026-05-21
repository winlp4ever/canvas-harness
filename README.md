# canvas-harness

A canvas-rendered node-graph library — React Flow's API, Excalidraw's perf ceiling, TipTap's extensibility. Headless and styleless.

```
┌─────────────────────────────────────────────────────────────────┐
│ Node-graph diagrams, mind-maps, whiteboards, flow editors,      │
│ visual scripting tools — anywhere you'd reach for React Flow    │
│ but the scene grows past a few thousand nodes.                  │
└─────────────────────────────────────────────────────────────────┘
```

## Why

- **Canvas-rendered**: built-in shapes paint directly into a canvas with bitmap-cached static + live interactive surfaces. No React reconciliation on the per-frame critical path. **10k visible nodes pan at ~70fps** on a MacBook M1 — where React Flow gets sluggish around 1-2k and Excalidraw struggles past 5k.
- **DOM overlays for custom nodes**: when a node needs iframes, charts, videos, or arbitrary React, register a custom node type and the renderer mounts your React component in an overlay synced to the camera transform. LOD ladder swaps in a canvas placeholder at low zoom.
- **Hand-drawn aesthetic, opt-in**: per-shape `style.roughness` enables rough.js outlines and freehand brushy edges (perfect-freehand). Auto-disables during pan/zoom and at high node counts so the wobble never costs perf.
- **Headless**: the library owns geometry, hit-testing, transforms, caching. Every color, font, corner radius is a theme token your app resolves.
- **Collab-ready**: typed `Op` log, presence slice, `SyncAdapter` interface. Ships no transport — bring your own (Yjs, WebSocket, BroadcastChannel).
- **AI-friendly**: `api.getContext({ format: 'markdown' })` returns scene state for direct LLM injection; the op log doubles as the tool-call schema for write-side mutations.

## Install

```bash
pnpm add @canvas-harness/core @canvas-harness/react
```

Peer-deps: React ≥ 18, react-dom ≥ 18.

## Quick start

```tsx
import { createCanvasStore, asNodeId } from '@canvas-harness/core'
import { Canvas, CanvasProvider } from '@canvas-harness/react'

const store = createCanvasStore()

// Drop in a couple of shapes
store.addNode({
  id: asNodeId(store.generateId()),
  type: 'rect',
  x: 100, y: 100, w: 160, h: 80,
  angle: 0, z: 0, groups: [],
  content: 'Hello',
  style: { backgroundColor: '#dbeafe', roughness: 1 },
})

store.addNode({
  id: asNodeId(store.generateId()),
  type: 'ellipse',
  x: 320, y: 100, w: 120, h: 80,
  angle: 0, z: 0, groups: [],
  content: 'World',
  style: { backgroundColor: '#bbf7d0', roughness: 1 },
})

export function App() {
  return (
    <CanvasProvider store={store}>
      <Canvas tool="select" />
    </CanvasProvider>
  )
}
```

That's enough to get a pannable, zoomable canvas with two selectable shapes. Middle-button (or space+drag) to pan. Cmd+scroll or pinch to zoom. Click to select, drag to move, handles to resize.

## A slightly bigger example

Custom toolbar, click-to-create, undo/redo, a simple style binding:

```tsx
import { useState } from 'react'
import { createCanvasStore, asNodeId, type NodeId } from '@canvas-harness/core'
import {
  Canvas,
  CanvasProvider,
  useCanvasStore,
  useSelection,
  useCanUndo,
  useCanRedo,
} from '@canvas-harness/react'

type Tool = 'select' | 'rect' | 'ellipse' | 'arrow'

function Toolbar({ tool, onTool }: { tool: Tool; onTool: (t: Tool) => void }) {
  const store = useCanvasStore()
  const canUndo = useCanUndo()
  const canRedo = useCanRedo()
  return (
    <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 10 }}>
      {(['select', 'rect', 'ellipse', 'arrow'] as const).map(t => (
        <button key={t} onClick={() => onTool(t)} disabled={tool === t}>
          {t}
        </button>
      ))}
      <button onClick={() => store.undo()} disabled={!canUndo}>undo</button>
      <button onClick={() => store.redo()} disabled={!canRedo}>redo</button>
    </div>
  )
}

function SelectionInfo() {
  const selection = useSelection()
  return <div style={{ position: 'absolute', bottom: 12, left: 12 }}>
    selected: {selection.length}
  </div>
}

export function App() {
  const [store] = useState(() => createCanvasStore())
  const [tool, setTool] = useState<Tool>('select')

  return (
    <CanvasProvider store={store}>
      <Canvas
        tool={tool}
        onClick={e => {
          if (tool === 'rect' || tool === 'ellipse') {
            store.addNode({
              id: asNodeId(store.generateId()),
              type: tool,
              x: e.world.x - 60,
              y: e.world.y - 40,
              w: 120, h: 80,
              angle: 0, z: 0, groups: [],
              style: { roughness: 1 },
            })
          }
        }}
      />
      <Toolbar tool={tool} onTool={setTool} />
      <SelectionInfo />
    </CanvasProvider>
  )
}
```

## Custom node types

Built-in shapes are `rect`, `ellipse`, `diamond`, `tag`, `capsule`, `thought-cloud`, `layered-rect`, `layered-ellipse`, `layered-diamond`, `text`. For anything else — a chart card, a Kanban column, a video tile — register a `NodeTypeDef`:

```tsx
import { defineNode, createCanvasStore } from '@canvas-harness/core'

const chartCard = defineNode({
  type: 'chart-card',
  // React view shown above the React-LOD zoom threshold:
  renderReact: ({ node }) => <ChartCardComponent data={node.data} />,
  // Canvas placeholder shown at low zoom / during motion:
  renderCanvas: (ctx, node, env) => {
    ctx.fillStyle = node.data?.fill ?? '#ddd'
    ctx.fillRect(0, 0, node.w, node.h)
  },
  // LOD thresholds — swap-in zooms:
  lod: { minZoomForReact: 0.6, minZoomForPlaceholder: 0.2 },
})

const store = createCanvasStore({ nodeTypes: [chartCard] })
```

Custom nodes participate in selection, drag/resize/rotate, undo, copy/paste, hit-testing, and the spatial index just like built-ins.

## API surface

### `@canvas-harness/core`

**Store**
- `createCanvasStore(opts?)` → `CanvasStore` — the single source of truth for a canvas. Holds nodes, edges, camera, selection, interaction state. All mutations go through typed ops.

**Mutations** (each emits a `change` event with the op batch)
- `addNode(node)`, `updateNode(id, patch)`, `removeNode(id)` (cascade-removes incident edges)
- `addEdge(edge)`, `updateEdge(id, patch)`, `removeEdge(id)`
- `upsertGroup(group)`, `removeGroup(id)`
- `batch(fn)` — coalesce multiple mutations into one undoable batch
- `bringToFront(ids)`, `sendToBack(ids)`, `bringForward(ids)`, `sendBackward(ids)`

**Reads**
- `getNode(id)`, `getEdge(id)`, `getGroup(id)`
- `getAllNodes()`, `getAllEdges()`, `getAllGroups()`
- `querySpatial({ rect | point })` — viewport visibility / hit candidates
- `getCamera()`, `getSelection()`, `getInteractionState()`

**History**
- `canUndo()`, `canRedo()`, `undo()`, `redo()`, `clearHistory()`

**Editing**
- `beginEdit(id)`, `commitEdit(text)`, `cancelEdit()` — drives the inline-text editor lifecycle

**Presence + sync**
- `store.presence` — local + remote presence state (per-client cursor / selection / metadata)
- `applyOp(op, opts?)` / `applyBatch(batch)` — adapter-facing entry for remote ops

**Events**
- `subscribe(event, handler)` — events: `'change' | 'camera' | 'selection' | 'interaction' | 'presence' | 'conflict'`

**Built-in renderer + hit-test**
- `createRenderer(...)` — wires the store to a pair of canvases. The React `<Canvas>` calls this internally; standalone consumers can use it directly.

### `@canvas-harness/react`

**Components**
- `<CanvasProvider store={...}>` — context wrapper
- `<Canvas tool="..." onClick={...} onCreateDrag={...} arrowDefaults={...} background={...} theme={...} renderCustomNodeView={...} />` — mounts canvas + interactive surface + DOM overlay + editor adapter
- `<Minimap />` — overview overlay

**Data hooks**
- `useCanvasStore()` — store from context
- `useNode(id)`, `useNodes()` — subscribed reads
- `useEdge(id)`, `useEdges()`
- `useSelection()`, `useCamera()`

**Interaction hooks**
- `useInteractionState()`, `useInteractionMode()`, `useCursor()`
- `useIsMoving()`, `useDraggedIds()`, `useIsPenActive()`

**Presence + history**
- `useLocalPresence()`, `usePresence()`
- `useCanUndo()`, `useCanRedo()`

## Performance

Why "10k visible nodes at 70fps active pan" is achievable:

| Lever | What |
|---|---|
| Two-surface architecture | Static surface bitmap-cached; only dragged/edited nodes repaint per frame |
| Visibility culling | Uniform-grid spatial index drops off-viewport nodes early |
| LOD ladder | Render-scale, motion-LOD on text bitmaps, custom-node React-vs-canvas swap |
| Path cache | Rough.js drawables LRU-cached by geometry+style signature |
| Idle-only rough | Hand-drawn outline auto-disables during pan/zoom and at >800 visible nodes |
| Auto-fit on commit | Text height computed at commit, never per-keystroke |

Roughly:
- Idle scene: static bitmap blit, ~120fps on ProMotion regardless of node count.
- Active pan: ~70fps at 10k visible (mixed primitives), ~120fps under 1k.
- Drag: only the dragged node repaints on the interactive surface; static cache untouched.

## License

[MIT](./LICENSE)
