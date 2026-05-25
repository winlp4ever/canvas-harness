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
  angle: 0, groups: [],
  content: 'Hello',
  style: { backgroundColor: '#dbeafe', roughness: 1 },
})

store.addNode({
  id: asNodeId(store.generateId()),
  type: 'ellipse',
  x: 320, y: 100, w: 120, h: 80,
  angle: 0, groups: [],
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
              angle: 0, groups: [],
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

Built-in shapes are `rect`, `ellipse`, `diamond`, `tag`, `capsule`, `thought-cloud`, `layered-rect`, `layered-ellipse`, `layered-diamond`, `soft-diamond`, `text`. For anything else — a chart card, a Kanban column, a video tile — register a `NodeTypeDef`:

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

## Images and icons

Raster images (`image` node type) and SVG icons (`icon` node type) are first-class. Both go through async helpers on the store so the inputs can be validated, sanitized, and downscaled before a node is committed.

```tsx
// PNG / JPEG — File, Blob, or data:image/(png|jpeg) URI. 2 MB hard cap.
// Anything bigger than `maxDimension` on the longer side is downscaled
// via OffscreenCanvas before being stored as a data URI.
const imageId = await store.addImage({
  src: fileFromDropEvent, // or new Blob([...]) or 'data:image/png;base64,...'
  x: 100,
  y: 100,
  maxDimension: 2048, // default
})

// SVG markup — sanitized (script / foreignObject / on* / javascript: stripped)
// and tinted via `style.iconColor` replacing `currentColor` at rasterize time.
const iconId = await store.addSvg({
  src: '<svg viewBox="0 0 24 24"><path d="..." stroke="currentColor"/></svg>',
  x: 200,
  y: 100,
  color: '#8b5cf6', // optional — writes to style.iconColor
})
```

External URLs are rejected on purpose (scenes stay self-contained, no CORS surprises). The renderer keeps an LRU-bounded bitmap cache so per-frame paint is cheap; SVGs rasterize at power-of-two size buckets keyed by `(markup, color, size)` so resizing an icon doesn't churn the rasterizer.

The standalone helpers are also exported if you want to pre-validate during drag-over, build a preview tile, or sanitize before storing somewhere else:

```ts
import {
  validateImageInput, downscaleImageBlob, blobToDataUri,
  validateSvgMarkup, sanitizeSvg, extractSvgDimensions, applySvgColor,
  MAX_IMAGE_BYTES, MAX_SVG_BYTES,
} from '@canvas-harness/core'
```

## Persistence

The library is sync end-to-end. `store.subscribe('change', cb)` fires once per committed `OpBatch`; the read API is sync and returns object references (no clones). The typical persistence flow is: subscribe, debounce, snapshot, await your async save.

```tsx
import { useEffect, useState } from 'react'
import type { CanvasStore, Edge, Group, Node } from '@canvas-harness/core'

type PersistedScene = { nodes: Node[]; edges: Edge[]; groups: Group[] }

export function useDebouncedSave(
  store: CanvasStore,
  save: (scene: PersistedScene) => Promise<void>,
) {
  const [status, setStatus] = useState<'idle' | 'pending' | 'saving' | 'saved'>('idle')

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null

    const flush = async () => {
      timer = null
      setStatus('saving')
      await save({
        nodes: store.getAllNodes(),
        edges: store.getAllEdges(),
        groups: store.getAllGroups(),
      })
      setStatus('saved')
    }

    return store.subscribe('change', () => {
      // Only setState on transition — rapid edits / drag streams just
      // reschedule the timer (microsecond-class).
      if (timer === null) setStatus('pending')
      else clearTimeout(timer)
      timer = setTimeout(flush, 500)
    })
  }, [store, save])

  return status
}
```

A couple of opinions baked in:

- **Don't put camera (pan/zoom) on the save bus.** It's view state, not document state — saving on camera change makes "unsaved" lie, and the per-frame setState during a pan re-renders your tree at frame rate. If you want to remember the viewport across sessions, save it separately on a less aggressive cadence (e.g. localStorage on `visibilitychange`).
- **Selection isn't document state either.** Same reasoning.
- **The OpBatch in the change event carries typed ops with `prev` slices** — if you ever need incremental writes (CRDT-style) instead of full-scene snapshots, the payload is already shaped for it. Most apps never need this.

A working version with a fake async DB + live save-status pill ships in the playground at [`examples/playground/src/hooks/useDebouncedSave.ts`](./examples/playground/src/hooks/useDebouncedSave.ts).

## Frames + present mode

`frame` is a built-in node type for slide regions — drag rectangles over parts of the canvas, name them, then cycle through them as slides. The library ships the data + a couple of helpers; a full presentation UI stays in your app.

```tsx
// Frames are just nodes — create, drag, resize, rename like anything else.
store.addNode({
  id: asNodeId(store.generateId()),
  type: 'frame',
  x: 0, y: 0, w: 600, h: 400,
  angle: 0, groups: [],
  content: 'Slide 1', // shown as the label above the top edge
})

// Read the presentation order:
const slides = store.getFrames() // Node[] in order

// Re-order (undoable, syncs over collab):
store.setFrameOrder([id3, id1, id2])

// "What's on this slide?" — strict AABB containment, backed by the spatial index:
const contents = store.getNodesInFrame(slides[0].id)
```

Three deliberate design calls:

- **Frames are nodes**, not a separate entity. They reuse selection, drag, resize, undo, sync, hit-test, z-order, theming for free. The only added store surface is the three methods above + an internal `frame.reorder` op.
- **Dragging a frame doesn't move its contents.** Children are not parented — containment is purely geometric. If you want grouping, use groups (`upsertGroup`). Frames are presentation chrome.
- **Frames are excluded from the minimap** (both `sceneBounds` and the content paint). They'd otherwise distort scale and add noise — they represent slide boundaries, not content density.

For the slideshow view, `renderer.setHideFrames(true)` drops the frame border + label so only the contents show:

```tsx
const present = () => {
  const slides = store.getFrames()
  if (slides.length === 0) return
  const savedCamera = store.getCamera()
  renderer.setHideFrames(true)
  let i = 0
  fitCameraToFrame(slides[i]) // your zoom-to-fit helper
  // wire ←/→ keys to step `i`, Esc to exit:
  //   renderer.setHideFrames(false)
  //   store.setCamera(savedCamera)
}
```

A working version with keyboard nav, slide counter, and resize-aware refit ships in the playground at [`examples/playground/src/components/PresentMode.tsx`](./examples/playground/src/components/PresentMode.tsx).

## API surface

### `@canvas-harness/core`

**Store**
- `createCanvasStore(opts?)` → `CanvasStore` — the single source of truth for a canvas. Holds nodes, edges, camera, selection, interaction state. All mutations go through typed ops.

**Mutations** (each emits a `change` event with the op batch)
- `addNode(node)`, `updateNode(id, patch)`, `removeNode(id)` (cascade-removes incident edges)
- `addEdge(edge)`, `updateEdge(id, patch)`, `removeEdge(id)`
- `upsertGroup(group)`, `removeGroup(id)`
- `addImage(opts)` / `addSvg(opts)` — async; validate, sanitize, downscale, commit
- `setFrameOrder(ids)` — replace the presentation order; emits a `frame.reorder` op (undoable, syncs)
- `batch(fn)` — coalesce multiple mutations into one undoable batch
- `bringToFront(ids)`, `sendToBack(ids)`, `bringForward(ids)`, `sendBackward(ids)`

**Reads**
- `getNode(id)`, `getEdge(id)`, `getGroup(id)`
- `getAllNodes()`, `getAllEdges()`, `getAllGroups()`
- `getFrames()` — frame-typed nodes in presentation order
- `getNodesInFrame(id)` — non-frame nodes strictly inside a frame's AABB
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
- Runtime knobs on the returned `Renderer`: `setBackground`, `setSelectionColor`, `setHideFrames` (drops frame chrome for present mode).

### `@canvas-harness/react`

**Components**
- `<CanvasProvider store={...}>` — context wrapper
- `<Canvas tool="..." onClick={...} onCreateDrag={...} arrowDefaults={...} background={...} theme={...} selectionColor={...} renderCustomNodeView={...} />` — mounts canvas + interactive surface + DOM overlay + editor adapter. `tool` accepts `'select' | 'pan' | 'rect' | 'ellipse' | … | 'arrow' | 'text' | 'frame'`; the Pan (Hand) tool turns left-button drag into camera pan for single-button-mouse users. `selectionColor` (default `#3b82f6`) drives all selection chrome: outline, resize/rotate handles, edge handles, marquee, drag-create preview.
- `<Minimap viewportColor={...} backgroundColor={...} borderColor={...} />` — overview overlay. Pass the same color as `<Canvas selectionColor>` for `viewportColor` to keep the two visually paired.

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
