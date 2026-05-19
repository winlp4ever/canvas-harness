# Architecture — canvas-harness

Working design notes for a high-performance, canvas-rendered node-graph library.
Treat this as an RFC, not a spec — every section is meant to be argued with.

---

## 1. Goals & Non-Goals

### Goals
- **Top-tier perf**: 5k–10k nodes in document, 50–200 mounted custom nodes on screen, 60fps pan/zoom at any density.
- **Canvas-first rendering**: primitives (rect, ellipse, arrow, text, image, path) draw directly into a single canvas. Reconciliation is not on the per-frame critical path.
- **tiptap-style extensibility**: developers register custom node types like tiptap NodeViews. A custom node can render as a React component (mounted in an overlay) or as a canvas draw function (best perf).
- **Headless & styleless**: the library owns geometry, hit-testing, transforms, caching, edges. It does not own visual style. Developers theme their nodes; built-in primitives expose style tokens.
- **Simple optimized scene format**: flat, JSON-serializable, version-tagged.
- **React for state, not for nodes**: React orchestrates the store and the overlay; the scene is *not* a React tree.

### Non-Goals (v1)
- Auto-layout / auto-routing around obstacles. Edges are direct (straight or curved) between endpoints.
- Multi-user collab transport (CRDT, presence, etc.) — the store is collab-ready (deltas, deterministic ops) but the wire layer is out of scope.
- SVG fallback or print-quality export. Export is a separate concern.
- Accessibility-first DOM model. Canvas a11y will be a follow-up via an off-screen DOM mirror.
- Plugin marketplace, theming engine, undo UI. The primitives exist (undo stack, extension hooks) but consumer apps own the surface.

---

## 2. Mental Model

```
┌──────────────────────────────────────────────────────────────────────┐
│  <Canvas>                                                            │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  <canvas id="static"/>      committed primitives (rare redraw) │  │
│  │  <div    id="overlay"/>     custom-node React subtrees         │  │
│  │  <canvas id="interactive"/> drag/draw + handles (per-frame)    │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  All three layers share one camera transform:                        │
│    translate(camera.x, camera.y) scale(camera.z)                     │
└──────────────────────────────────────────────────────────────────────┘
```

- **`static` canvas** (bottom): every committed primitive at its committed position. Redraws ONLY when the committed scene changes — never during pan/zoom of a stationary scene, never during in-progress drag. This is the trick that lets us hit 10k+ nodes.
- **`overlay` div** (middle): React subtrees for custom nodes that need DOM (iframes, rich components). Viewport-culled — mounted on enter, unmounted on exit, with overscan. CSS-transformed as a single container by the camera.
- **`interactive` canvas** (top): elements currently being dragged or drawn, selection rects, edge handles, marquee, snap guides. Cleared + fully repainted every frame during interaction; idle when nothing is moving.

The **scene** is a flat data structure (not a tree). Hierarchical concepts (groups, frames) are modeled as `groups: GroupId[]` membership on nodes, not as a literal tree, so any node remains O(1)-addressable.

---

## 3. Scene Data Model

Drawn from `dim0/backend/topix/datatypes/note/{note,style}.py` and adapted toward
"generic, simple, beautiful." The goal: every built-in node speaks the same
shape so one rich-text subsystem, one selection model, one theming hook covers
them all — and custom nodes carry an escape-hatch `data` bag.

### 3.1 Top-level

```ts
type Scene = {
  schemaVersion: 1
  nodes:  Record<NodeId, Node>
  edges:  Record<EdgeId, Edge>
  groups: Record<GroupId, Group>        // optional metadata (name, color) — membership lives on nodes/edges
  camera: { x: number; y: number; z: number }
  selection: (NodeId | EdgeId)[]        // ordered; first = active
}
```

### 3.2 Node

```ts
type Node = {
  // identity
  id: NodeId
  type: NodeType | string               // built-in shape kind, or a custom-node type string

  // geometry (world coords, pre-rotation, top-left origin)
  x: number; y: number
  w: number; h: number
  angle: number                         // radians, around node center

  // graph
  z: number                             // explicit z-order, finer than scene z
  groups: GroupId[]                     // multi-membership (Excalidraw model)
  locked?: boolean
  hidden?: boolean

  // content (built-in nodes)
  content?: string                      // lite markdown — see §8

  // styling
  style?: Style                         // optional; falls back to theme resolver

  // type-specific payload
  data?: unknown                        // images carry { src }, icons carry { name }, custom nodes carry whatever
}
```

### 3.3 Edge

```ts
type Edge = {
  id: EdgeId

  source: EdgeEnd
  target: EdgeEnd
  pathStyle: "straight" | "bezier" | "polyline"
  control?: Vec2[]                      // user-dragged midpoints (bezier/polyline)

  z: number
  groups: GroupId[]
  locked?: boolean
  hidden?: boolean

  content?: string                      // edge label (lite markdown)
  style?: EdgeStyle
  data?: unknown
}

type EdgeEnd =
  | { nodeId: NodeId; localOffset: Vec2 }   // anchored, node-local pre-rotation coords
  | { worldPoint: Vec2 }                     // free-floating

type Vec2 = { x: number; y: number }
```

### 3.4 Style (mirrors `dim0/.../note/style.py`)

```ts
type Style = {
  // stroke
  strokeColor?: string                  // CSS color; "#00000000" = none
  strokeWidth?: number                  // px in world space (scales with zoom)
  strokeStyle?: "solid" | "dashed" | "dotted"

  // fill
  backgroundColor?: string
  fillStyle?: "solid" | "hachure" | "cross-hatch" | "zigzag" | "dots"

  // geometry modifiers
  roughness?: number                    // 0..2, hand-drawn jitter
  roundness?: number                    // 0..2, corner radius factor
  opacity?: number                      // 0..100

  // text — applies to `content`
  fontFamily?: "handwriting" | "sans-serif" | "serif" | "monospace" | "informal"
  fontSize?: "S" | "M" | "L" | "XL"
  textAlign?: "left" | "center" | "right"
  textColor?: string
  textStyle?: "normal" | "bold" | "italic"

  // edit-time geometry (Phase 7)
  autoFit?: boolean                     // grow-only height-to-content on commit boundaries; default true
}

type EdgeStyle = Style & {
  sourceArrowhead?: "none" | "arrow" | "barb" | "arrow-filled"
  targetArrowhead?: "none" | "arrow" | "barb" | "arrow-filled"
}
```

Every field is optional. Resolution order on read:
1. The node's own `style.*` if set.
2. The consumer's `theme(token, ctx)` resolver if provided.
3. The library's built-in defaults (table below).

| Token              | Built-in default              |
|--------------------|-------------------------------|
| `strokeColor`      | `"#00000000"` (transparent)   |
| `strokeWidth`      | `2`                           |
| `strokeStyle`      | `"solid"`                     |
| `backgroundColor`  | `"#dbeafe"` (nodes), transparent (edges) |
| `fillStyle`        | `"solid"`                     |
| `roughness`        | `0.5`                         |
| `roundness`        | `2.0`                         |
| `opacity`          | `100`                         |
| `fontFamily`       | `"handwriting"`               |
| `fontSize`         | `"M"`                         |
| `textAlign`        | `"center"`                    |
| `textColor`        | `"#000000"`                   |
| `textStyle`        | `"normal"`                    |
| `sourceArrowhead`  | `"none"`                      |
| `targetArrowhead`  | `"arrow-filled"`              |

### 3.5 Built-in node types (`NodeType`)

Minimal core ships first; everything else is a custom node defined by the consumer.

| `type`        | Carries `content`? | Notes                                              |
|---------------|--------------------|----------------------------------------------------|
| `"rect"`      | yes                | the workhorse — sticky notes, cards                |
| `"ellipse"`   | yes                |                                                    |
| `"diamond"`   | yes                |                                                    |
| `"capsule"`   | yes                | pill-shaped, useful for tags                       |
| `"text"`      | yes (required)     | no fill/stroke; pure text shape                    |
| `"image"`     | no                 | `data: { src, alt? }`                              |
| `"icon"`      | no                 | `data: { name, color? }` — vector icon by name     |
| `"frame"`     | optional           | visual container; auto-clips children visually (later) |

Out of scope for v1 built-ins (easy custom nodes for consumers): `folder`, `sheet`,
`layered-rectangle`, `thought-cloud`, `layered-diamond`, `soft-diamond`,
`layered-circle`, `tag`, `slide`, `code-sandbox`, `widget`. Most of those are
visual variants of `rect` or `ellipse` — they belong in user code or a separate
preset package, not the core.

### 3.6 Groups

```ts
type Group = {
  id: GroupId
  name?: string
  color?: string
  // members are not listed here; membership lives on each node/edge's `groups[]`
}
```

Multi-membership: a node can be in `["proj-alpha", "frame-3", "selected-by-bob"]`
at once. Group-as-frame is just one `Group` whose id appears in a frame-typed
node's `groups[]`. There is no hierarchical parent — nesting is expressed by
having members of an inner group also carry the outer group's id (e.g.
`["inner", "outer"]`).

### 3.7 Design notes & open questions

These are deliberate choices; reverse any of them on a single discussion.

- **`groups: GroupId[]` over `parentId`.** Mirrors Excalidraw (and dim0) and
  matches how multi-select grouping actually works. A node can belong to a
  semantic group ("characters") AND a visual frame ("scene 3") at once without
  contortion. Strict containment (frames) is a separate UI concern, not a data
  hierarchy. Tradeoff: no fast "give me this node's parent" lookup — but
  that's rarely what code actually wants; "give me all nodes in this group"
  via the spatial/index is.

- **`content: string` at the top level.** Most built-in shapes carry a markdown
  string; keeping it at the top level (rather than nested in `data`) lets the
  rich-text subsystem (§8) operate uniformly across all of them. Image/icon
  shapes don't use it — that's fine, it's optional. Custom nodes don't use it
  either; they store everything in `data`.

- **`data: unknown` only for type-specific extras.** Built-in image stores its
  `src` in `data`; built-in icon stores its `name`. Custom nodes store
  whatever. Library never introspects `data` except by calling
  `defineNode.parse?` during load.

- **Style is a flat optional bag, not nested.** dim0's `Style` uses snake_case
  in Python; the TS shape uses camelCase. Theme resolution + defaults handle
  missing values. Style does NOT include geometry (no `x/y/w/h/angle` in style)
  — those are first-class node properties.

- **Edge style extends node style.** Same tokens (stroke/fill/text), plus
  arrowheads. `pathStyle` is a top-level edge property, not style — because
  it affects geometry/hit-testing, not just appearance.

- **`schemaVersion` enables forward migration.** Bump on breaking changes; ship
  migration functions registered by version. Consumer custom-node `data`
  shapes migrate via opt-in `defineNode({ migrate })`.

- **Open: should `roughness` exist in v1?** It's the Excalidraw signature look
  but it costs CPU (rough.js generates jittered geometry every redraw — caches
  exist but they're nontrivial). If headless ethos wins, drop it; consumers can
  add a rough.js plugin. If we want a beautiful default look out of the box,
  keep it. Leaning toward **keep** but make it opt-in per shape (default
  `roughness: 0` = no jitter, identical to crisp canvas2d).

- **Open: should `content` ever be richer than markdown?** v1: lite-markdown
  string only. If consumers need structured rich text (tables, embedded media
  inside the cell), they reach for a custom node. Don't expand `content`'s
  schema — that path leads to a CMS.

- **Open: serialization size.** Records keyed by id are good for in-memory; on
  the wire we may want arrays (smaller JSON, cheaper to gzip). Library can do
  both: in-memory map, JSON array. Decide at the codec boundary.

### 3.8 Wire format examples

Concrete JSON to make the shape real. All fields not shown default to absent /
fall back to theme / fall back to built-in defaults.

#### Minimal node — the smallest valid built-in shape

```json
{
  "id": "n-bare",
  "type": "rect",
  "x": 0, "y": 0, "w": 100, "h": 100,
  "angle": 0,
  "z": 0,
  "groups": []
}
```

That's it. No `content` (renders as a blank rect), no `style` (uses theme +
defaults — light-blue fill, transparent stroke, etc.), no `data`.

#### Sticky note with markdown content

```json
{
  "id": "n-1",
  "type": "rect",
  "x": 100, "y": 100, "w": 240, "h": 120,
  "angle": 0,
  "z": 0,
  "groups": ["g-team"],
  "content": "**Hire** Lara before _Q3_\n- write JD\n- schedule loop",
  "style": {
    "backgroundColor": "#fef08a",
    "fontFamily": "handwriting",
    "fontSize": "M"
  }
}
```

The rich-text subsystem (§8) tokenizes `content` and renders into the rect.
`textColor`, `textAlign`, etc. fall back to defaults — only the overrides are
written.

#### Image node

```json
{
  "id": "n-img",
  "type": "image",
  "x": 400, "y": 100, "w": 320, "h": 240,
  "angle": 0,
  "z": 1,
  "groups": [],
  "data": { "src": "https://cdn.example.com/photo.jpg", "alt": "team off-site" }
}
```

No `content` — image shapes don't carry markdown. `data` is the type-specific
payload (`src`, optional `alt`).

#### Custom node — chart card

```json
{
  "id": "n-chart",
  "type": "chart-card",
  "x": 200, "y": 360, "w": 480, "h": 320,
  "angle": 0,
  "z": 2,
  "groups": [],
  "data": {
    "title": "Q3 Revenue",
    "series": [120, 180, 220, 310],
    "kind": "bar"
  }
}
```

`type: "chart-card"` is whatever the consumer registered via
`defineNode({ type: "chart-card", renderReact: ... })`. The library doesn't
introspect `data` — only the registered node's `parse?` / `renderReact` see it.
Custom-node authors are free to ship any HTML inside (charts, embedded media,
forms, iframes); the library is content-agnostic. Expensive content is the
author's responsibility — see §5.4 for the performance contract and §5.3 for
the LOD / `getSnapshot` / `drawPlaceholder` toolkit.

#### Bezier edge between two nodes (full scene)

```json
{
  "schemaVersion": 1,
  "camera": { "x": -120, "y": -80, "z": 1 },
  "selection": ["n-2"],

  "groups": {
    "g-team": { "id": "g-team", "name": "Team Alpha", "color": "#fde047" }
  },

  "nodes": {
    "n-1": {
      "id": "n-1",
      "type": "rect",
      "x": 100, "y": 100, "w": 240, "h": 120, "angle": 0, "z": 0,
      "groups": ["g-team"],
      "content": "Spec"
    },
    "n-2": {
      "id": "n-2",
      "type": "ellipse",
      "x": 520, "y": 140, "w": 200, "h": 120, "angle": 0, "z": 1,
      "groups": ["g-team"],
      "content": "Review"
    }
  },

  "edges": {
    "e-1": {
      "id": "e-1",
      "source": { "nodeId": "n-1", "localOffset": { "x": 240, "y": 60 } },
      "target": { "nodeId": "n-2", "localOffset": { "x": 0,   "y": 60 } },
      "pathStyle": "bezier",
      "z": 0,
      "groups": [],
      "content": "blocks",
      "style": {
        "strokeColor": "#475569",
        "targetArrowhead": "arrow-filled"
      }
    }
  }
}
```

What this shows:

- `source.localOffset = { x: 240, y: 60 }` is the right-middle point of n-1's
  240×120 rect (in n-1's pre-rotation local frame, top-left = origin).
- `target.localOffset = { x: 0, y: 60 }` is the left-middle of n-2.
- `pathStyle` is on the edge, not in style — it affects geometry.
- `targetArrowhead` is in `style` (because changing it doesn't change the
  curve, just the cap).
- `content: "blocks"` is the edge label, rendered via the same rich-text engine
  as nodes.
- n-2 omits `style` entirely — theme + defaults fill in.

#### Rotation: edge data doesn't change

Rotate n-2 by 30° (π/6 ≈ 0.5236 rad):

```json
"n-2": { "...": "...", "angle": 0.5236 }
```

The edge JSON is **byte-identical**. The renderer projects `target.localOffset`
through `n-2.angle` each draw, so the endpoint rides the rotation for free.
This is the entire reason endpoints are stored as `(nodeId, localOffset)`.

#### Codec: arrays on the wire

In-memory the library uses records keyed by id for O(1) lookup. Wire format
swaps to arrays (smaller JSON, gzips better, predictable iteration order):

```json
{
  "schemaVersion": 1,
  "camera": { "x": -120, "y": -80, "z": 1 },
  "selection": ["n-2"],
  "groups": [
    { "id": "g-team", "name": "Team Alpha", "color": "#fde047" }
  ],
  "nodes": [
    { "id": "n-1", "type": "rect",    "...": "..." },
    { "id": "n-2", "type": "ellipse", "...": "..." }
  ],
  "edges": [
    { "id": "e-1", "...": "..." }
  ]
}
```

Load: `arr.reduce((acc, x) => (acc[x.id] = x, acc), {})`. Save: `Object.values`.
Cost is one O(n) pass at the codec boundary, paid once per load/save, never
during interaction.

---

## 4. Rendering Pipeline

The single hardest perf constraint: **never redraw 10k nodes inside a 16ms frame.** Everything in this section serves that goal. Excalidraw and tldraw both win by ensuring per-frame work is bounded by *interaction-set size* (a handful of nodes being moved), not *scene size* (thousands sitting still). We adopt the same model.

### 4.1 The static / interactive split

Two canvases, with distinct redraw cadences:

- **`static`** — every committed primitive at its committed position. Redraws ONLY when committed scene state changes (a mutation flushed, undo/redo, paste, load, drag-end commit). During pan/zoom of a stationary scene: 0 redraws. During an in-progress drag of 5 nodes: 0 redraws.
- **`interactive`** — whatever is being actively dragged, drawn, resized, or routed, PLUS selection visuals (resize handles, edge endpoints, marquee, hover indicators, snap guides). Cleared + fully repainted every frame during interaction; idle when nothing is moving.

Z-stack: `static` (bottom) → `overlay` (DOM, middle) → `interactive` (top).

### 4.2 The "exclude moving from static" rule

This is the single most important runtime invariant. When the user starts dragging a node:

1. The set of dragged elements + their incident edges is logically *removed* from the static canvas's draw list.
2. Static redraws once, omitting the moving set.
3. Each frame during drag: `interactive` clears + redraws ONLY `{moving nodes, incident edges, handles, hover, snap guides}`. Static is untouched.
4. On drag end: commit positions to the store, restore the moved set to static's draw list, static redraws once.

Per-frame paint cost during drag is O(dragged elements + incident edges), not O(scene). 5 nodes + 8 edges → typically <1ms paint on a mid-range laptop. Identical to Excalidraw's approach.

The same rule applies to drawing-in-progress (the new shape being created lives on interactive until the user releases), resize, rotate, edge-endpoint drag, and marquee selection.

### 4.3 Frame loop (rAF coalescing)

One `requestAnimationFrame` tick drives all paint:

```
pointer / keyboard / store event
            │
            ▼  schedule
   ┌──────────────────┐
   │ next rAF tick    │
   └────────┬─────────┘
            ▼
   1. drain pending mutations from the frame buffer into the store
   2. update spatial index (deltas only — nodes whose AABB changed)
   3. compute viewport visibility set; diff against previous frame
   4. mount/unmount overlay children at viewport boundary
   5. if static.dirty       → repaint static
      else                  → no-op
   6. always repaint interactive (clear + redraw moving set + UI)
   7. apply CSS transform to overlay container, once
```

Several rules baked in:

- **One frame, one paint per layer.** Multiple mutations in the same tick batch into one frame.
- **During interaction, the store does not see partial state.** Pointer deltas write to a per-frame buffer; commit to the store only at drag-end.
- **Camera changes never touch static.** Pan/zoom = update camera + `ctx.setTransform` on static (no redraw) + CSS transform on overlay + redraw interactive (which is small).
- **Visibility is recomputed per frame, but as a delta.** Spatial-index query returns the current visible set; we compare to the previous set to produce mount/unmount lists for the overlay. The diff is O(visible) not O(scene).

### 4.4 Cache hierarchy

Three caches, each with explicit invalidation triggers:

| Cache                          | Stored on        | Invalidates when                              | Purpose                  |
|--------------------------------|------------------|-----------------------------------------------|--------------------------|
| Geometry (AABB + outline path) | the shape itself | `x/y/w/h/angle/control[]` change              | spatial index, hit test, clipping |
| Bezier polyline samples        | the edge itself  | endpoints, control[], or attached node moves  | hit test + auto-clip      |
| Bitmap (offscreen canvas)      | global LRU map   | content, geometry, style, zoom bucket, DPR bucket, font epoch | text & expensive shapes  |

The bitmap cache key is composed from the fields that affect *visible output*. Missing one causes stale renders; including too many causes cache thrashing. Per shape category:

| Shape category               | Key fields                                                                      |
|------------------------------|---------------------------------------------------------------------------------|
| Geometry-only (rect, ellipse, diamond, capsule with empty `content`) | `${shapeId}:${geomHash}:${styleHash}:${zoomBucket}:${dprBucket}` |
| Text-bearing (any shape with non-empty `content`) | `${shapeId}:${geomHash}:${styleHash}:${contentHash}:${zoomBucket}:${dprBucket}:${fontEpoch}` |
| Image                        | `${shapeId}:${geomHash}:${styleHash}:${srcHash}:${zoomBucket}:${dprBucket}` — `src` is part of the key, not `content` |
| Custom (`renderCanvas`)      | author-controlled — library passes `(node, env)` and the author hashes whatever matters for them, OR opts out of caching |

`contentHash` is the FNV-1a / similar fast hash of `node.content` already implemented in `canvas-lite-markdown.tsx`. `fontEpoch` only participates for text-bearing shapes because non-text rendering doesn't depend on font readiness. `srcHash` for images is the URL or a content hash if loaded.

LRU cap ~500–1000 entries; on miss, regenerate synchronously (text layout + `drawToCanvas` for text; path stroke + fill for geometry); on hit, `ctx.drawImage(cached, x, y, w, h)`.

### 4.5 Level of detail (LOD)

Each visible item picks one of three render regimes based on `zoom` and `isMoving`:

| Zoom band              | Built-in primitives           | Custom React nodes               |
|------------------------|-------------------------------|----------------------------------|
| < 0.3 (very small)     | colored rect placeholder      | `drawPlaceholder` canvas only    |
| 0.3 – 0.7 (medium)     | full draw, lower text scale   | snapshot OR placeholder          |
| > 0.7 (full)           | full draw + cache             | live React mounted               |

Global `isMoving` flag (camera moving OR shape dragging): drop one quality level while true, restore on idle (~80ms after last input). The text subsystem (§8) already implements this via `resolveRenderScale` — same mechanism extends to custom nodes.

### 4.6 Per-frame budget (mid-range laptop)

Measured from rAF tick to compositor handoff. These are targets; CI perf tests assert no regression beyond 20%.

| Phase                              | Idle pan  | Active drag |
|------------------------------------|-----------|-------------|
| Drain mutation buffer              | <1ms      | <1ms        |
| Spatial index delta update         | <0.5ms    | <0.5ms      |
| Visibility diff + overlay decisions| <1ms      | <1ms        |
| Static repaint                     | 0ms       | 0ms         |
| Interactive repaint                | <0.5ms    | <2ms        |
| Overlay CSS transform              | <0.5ms    | <0.5ms      |
| **Total**                          | **<3ms**  | **<5ms**    |

Static repaint worst case, broken down by realistic regime (the "10k nodes" target needs to be honest about LOD):

| Scenario                                                            | Visible items by tier                                                                | Paint cost  |
|---------------------------------------------------------------------|--------------------------------------------------------------------------------------|-------------|
| Working zoom (~1.0×, ~30 nodes fill viewport)                       | ~30 full-quality                                                                     | <3ms        |
| Zoomed out (~0.5×, ~200 nodes fill viewport)                        | ~200 at reduced text scale, bitmap caches warm                                       | <8ms        |
| Fit-all on a 10k-node scene (~0.05× — every node 5px)               | ~9500 below `lod.minZoomForPlaceholder` rendered as colored rects + ~500 within LOD-medium at reduced quality | <15ms       |
| Fit-all worst-with-cold-cache (first commit after load)             | same item counts, but bitmap caches must regenerate ~500 entries                     | 50–80ms (one-time) |

The "10k node ceiling" relies on LOD doing the bulk of the work at small zoom. The renderer never draws 10k full-quality shapes in one frame — and doesn't need to, because nothing is legible at that density anyway. **The 10k claim is correct for committed scene size with LOD; it's NOT a claim that "10k full-quality shapes paint in 16ms."** Calling that out so the budget reads as the targeted, realistic thing it is.

Paid once on commit, never per frame.

### 4.7 What we adopt and from where

- From **Excalidraw**: the static / interactive canvas split, exclusion of moving elements from the static draw list, bitmap caches per shape keyed on geometry + style, rough.js as an opt-in for the hand-drawn aesthetic.
- From **tldraw**: signal-based store (atoms + selector subscriptions), shape-util plug-in surface, geometry cache shared between renderer and hit-tester.
- From **`dim0/webui/.../canvas-lite-markdown.tsx`** (your work): text measurement LRU, font-epoch reactivity, zoom/DPR quantization, moving-vs-idle render-scale resolution.
- **Novel to canvas-harness**: nothing critical. Performance in this space is a *solved problem* — the work is composing the right tricks, not inventing new ones. The novelty is in the API design (tiptap-style NodeViews on canvas) and the headless ethos, not the perf engine.

---

## 5. Custom Node Extension Model

The most-touched part of the public API. A bad design here turns "scales to 10k nodes" into "scales as long as customers behave." Mirrors tiptap NodeViews; performance contract is non-negotiable.

### 5.1 `defineNode` signature

```ts
defineNode({
  type: "chart-card",                    // unique string registered globally

  // --- rendering (at least one of canvas / react required) ---
  renderCanvas?: (ctx: CanvasRenderingContext2D, node: Node, env: RenderEnv) => void,
  renderReact?:   React.ComponentType<{ node: Node; env: RenderEnv }>,
  drawPlaceholder?: (ctx: CanvasRenderingContext2D, node: Node, env: RenderEnv) => void,

  // --- LOD config ---
  lod?: {
    minZoomForReact?: number             // default 0.7; below → use placeholder/snapshot
    minZoomForPlaceholder?: number       // default 0.3; below → skip / rect
    snapshotMaxAge?: number              // ms; default Infinity (snapshot lives until data/style/size changes)
  },

  // Optional: author-provided rasterized fallback used when LOD or motion demands fast paint.
  // Return CanvasImageSource (canvas, ImageBitmap, image) to blit; return null to fall back to drawPlaceholder.
  getSnapshot?: (node: Node, env: SnapshotEnv) => CanvasImageSource | null | Promise<CanvasImageSource | null>,

  // --- behavior ---
  hitTest?: (node: Node, localPoint: Vec2) => boolean,    // default: AABB
  getOutline?: (node: Node) => null | Polygon,            // default: rect (node AABB)

  // --- lifecycle (optional hooks for transient state, fetches, listeners) ---
  onEnter?: (node: Node, env: LifecycleEnv) => void,      // entering viewport
  onExit?:  (node: Node, env: LifecycleEnv) => void,      // leaving viewport
  keepMounted?: boolean,                                  // default false
  parse?:   (raw: unknown) => Node["data"],               // load-time validation/migration
  migrate?: (data: unknown, fromVersion: number) => Node["data"],

  // --- events the node opts into (default: bubble to canvas-level handlers) ---
  on?: {
    pointerDown?: (node, env: EventEnv) => void
    drag?:        (node, env: EventEnv) => void
    dragEnd?:     (node, env: EventEnv) => void
    dblClick?:    (node, env: EventEnv) => void
    keyDown?:     (node, env: EventEnv) => void
  },
})

type RenderEnv = {
  zoom: number
  isMoving: boolean          // camera panning OR shape dragging
  isSelected: boolean
  isHovered: boolean
  isEditing: boolean
  theme(token: string): string
}
```

### 5.2 Lifecycle (the state machine every custom node travels)

```
                    enter viewport (+ overscan)
not-mounted ─────────────────────────────────────────► mounted-placeholder
     ▲                                                       │
     │ exit viewport                                         │ idle 80ms
     │ (state lost unless keepMounted)                       │ AND zoom > minZoomForReact
     │                                                       ▼
     └──────────────────────────────────────────────── mounted-live (renderReact)
```

- **Not-mounted**: spatial index knows the node exists, AABB participates in hit testing. No DOM, no React.
- **Mounted-placeholder**: `drawPlaceholder(ctx)` painted on the static (or interactive) canvas. Used during pan/zoom and at small zoom. No React subtree mounted yet.
- **Mounted-live**: React subtree mounted into the overlay div, positioned in world coords, parent CSS-transformed by camera. `useNode(id)` subscription drives re-renders for this one node.

`keepMounted: true` collapses the machine: once entered, stays at `mounted-live` permanently, hidden via `visibility: hidden` when off-screen. Use ONLY for nodes that hold transient UI state (half-typed forms, mid-video playback). Each `keepMounted` node is a permanent DOM cost, so authors should justify it.

### 5.3 LOD contract (which render path runs when)

Each node MAY provide up to three render paths, with these tradeoffs:

| Path              | Mounted | Cost                  | Use when                                |
|-------------------|---------|-----------------------|------------------------------------------|
| `renderCanvas`    | No DOM  | low (<1ms)            | simple shapes, no DOM needs              |
| `drawPlaceholder` | No DOM  | low — author's budget | LOD fallback when React is too expensive |
| `renderReact`     | DOM     | normal React subtree  | rich, interactive, requires DOM features |

Picking path each frame:

```
zoom < lod.minZoomForPlaceholder  → skip or AABB rect (free)
zoom < lod.minZoomForReact        → drawPlaceholder if provided, else renderCanvas, else AABB
isMoving === true                 → same as above (drop one quality level)
otherwise                         → renderReact if provided, else renderCanvas, else placeholder
```

Snapshot mode (author-owned, optional):

The library does NOT ship a DOM-rasterization implementation. Instead, the author opts in by providing `getSnapshot(node, env)`. Contract:

- The library calls `getSnapshot` when it needs a fast paint: entering `isMoving === true`, dropping below `lod.minZoomForReact`, or pre-warming a node just outside the viewport.
- If the function returns a `CanvasImageSource` (canvas / ImageBitmap / HTMLImageElement), the library blits it via `ctx.drawImage`.
- If it returns `null`, the library falls back to `drawPlaceholder` → then to AABB rect. No crash, no warning — `null` is a valid answer meaning "snapshot doesn't help here."
- Async return is allowed; while the promise is pending, the library uses `drawPlaceholder`.
- Cache: the library holds the returned image per node and reuses it. Invalidates when `node.data`, `node.style`, `node.w`, or `node.h` changes, or after `lod.snapshotMaxAge` ms.

Authors who need DOM rasterization pick their own implementation (`html-to-image`, `html2canvas`, an offscreen render with `foreignObject` → image). Authors who DON'T need true rasterization can hand-build a canvas from the same `node.data` — a chart node whose `data` is a series can draw a sparkline directly into an `OffscreenCanvas` and return that. Often this is far cheaper than rasterizing real DOM.

This puts the heavy/fragile dependency outside the library and gives authors a clean opt-in: ship without `getSnapshot` and use `drawPlaceholder`; add `getSnapshot` later only if profiling demands it.

### 5.4 Performance contract

The 10k-node ceiling is a contract between the library and node authors. Either side breaking it kills scale.

**Library guarantees:**
- Viewport culling: off-screen nodes are unmounted (unless `keepMounted`).
- Stable identity: `node.id` is the React key. Selection / reorder / z-change never remount.
- Bound subscription: `useNode(id)` subscribes to ONE node and re-renders only when that node changes.
- One CSS transform: pan/zoom moves the whole overlay container; children never reflow.
- No re-render during pan: pure camera changes do not invoke React's render cycle for any custom node.

**Authors MUST:**
- Not do expensive synchronous work in `render`. Heavy compute → `useEffect`, web workers, or `onEnter` lifecycle hook.
- Not subscribe to global state inside the component. Use `useNode(id)` for the bound node; cross-node state only via the store's selector hooks (`useNodes(predicate)` is OK but rare).
- Provide `drawPlaceholder` if `renderReact` mounts in >5ms. The library logs a dev warning when a node consistently exceeds 16ms first-paint and has no placeholder.
- Not assume state survives unmount. Lift transient state to your store or accept loss.
- Not mutate the DOM outside the component root. The overlay container manages transform and position.
- Not pass inline-defined components to `renderReact`. Define the component at module scope and reference by import; otherwise memoization breaks every render.
- Not store mutable state on `node.data`. The store is for committed state; transient UI state lives in React or a side store.

Violations cause perf degradation; the library does not police them at runtime. Dev mode emits warnings on the obvious ones.

### 5.5 Hit testing

Default: `hitTest = AABB on local rect`. Author overrides via `hitTest(node, localPoint)`. The point is pre-transformed into the node's pre-rotation local frame (origin top-left of node.w/h), so the function operates on `[0..w] × [0..h]`.

The overlay div is `pointer-events: none` by default. All hit testing flows through the library's spatial index → per-node `hitTest`. DOM hit-testing for custom nodes is enabled ONLY during edit mode for the actively-edited node. Reasoning: hundreds of overlapping transparent DOM elements with native hit-testing burn CPU and produce inconsistent ordering versus canvas primitives. Routing everything through one path keeps z-order deterministic.

### 5.6 Anti-patterns

Concrete things you'll see in code review and should reject:

| Anti-pattern                                       | Why it kills scale                                 | Fix                                  |
|----------------------------------------------------|----------------------------------------------------|--------------------------------------|
| Chart library per node (recharts / chart.js)       | mount = 50–200ms; 100 nodes = 5–20s of compute     | snapshot mode + `drawPlaceholder`    |
| `useEffect(() => fetch(...))` in node component    | re-fetches on every mount; pan-then-back thrashes  | fetch outside, cache in store         |
| `window.addEventListener` inside the component     | mount/unmount churns listeners                     | one delegated handler on overlay     |
| Inline component: `renderReact: ({node}) => <X .../>` | new function each call; defeats `React.memo`    | hoist component to module scope      |
| Storing scroll position on `node.data`             | every drag commits the position to undo stack      | React state or side store            |
| Subscribing to `useNodes(...)` for every render    | every node change re-renders every node            | `useNode(id)` for bound subscription |

### 5.7 Z-order is layered, not fully interleaved

A constraint worth being explicit about because it's easy to misread `node.z` as a unified ordering: **canvas primitives and DOM custom nodes live in separate layer stacks** and the stack ORDER is fixed (`static` canvas → DOM overlay → `interactive` canvas).

What this means in practice:

- `node.z` orders shapes **within their own layer**. Two canvas primitives sort by z; two DOM custom nodes sort by z; but a canvas primitive (e.g. an edge) cannot z-order *through* a DOM custom node.
- An edge stored on the `static` canvas always renders BELOW every committed DOM custom node, regardless of `edge.z` vs `node.z`.
- An edge being actively drawn lives on `interactive` (above the overlay), so it briefly appears ABOVE DOM custom nodes during draw. On commit it moves to `static` and pops behind. This is a real visible transition for the rare "drag-an-edge-across-an-iframe" case.

Why we accept this:

- Truly interleaved z requires either (a) rendering everything to canvas — kills the React-custom-node story — or (b) rendering everything to DOM — kills the canvas-first perf story. Both are non-starters.
- For 99% of use cases edges go to and from custom nodes (not across them), so the constraint is invisible.

Workarounds for the 1%:

| Want                                                | How                                                                |
|-----------------------------------------------------|--------------------------------------------------------------------|
| An HTML node visually above edges                   | use `renderReact` — the default; that's what DOM-overlay-above-static buys |
| Edges visually above an HTML node                   | render the node with `renderCanvas` instead (or via `getSnapshot` + canvas blit) so it sits in the same canvas layer as the edges; z-ordering then works normally |
| Both: edge above HTML node A, below HTML node B     | not supported; promote one node to `renderCanvas` or accept the layer order |

Document this explicitly so consumers don't file bugs against the architecture for behavior that's deliberate.

### 5.8 The escape hatch: `renderCanvas`

For maximum performance, `renderCanvas(ctx, node, env)` lets a custom node draw directly to the canvas like a built-in primitive. No DOM, no React subtree, no LOD swap — also no DOM features (no iframes, no contenteditable, no embedded form fields). Use when:

- The node is fundamentally drawable in canvas (custom shape variant, sparkline, status pip, data-viz badge).
- You're past the 10k-node ceiling and any DOM cost is too much.

A node CAN provide both `renderCanvas` AND `renderReact`: canvas at small zoom, React at large zoom. Highest-effort, highest-perf path. Reserved for power users with measured perf problems, not the default.

---

## 6. Edge System

The edge system is one of the two places (with custom nodes) where most of the library's perceived "feel" lives. Getting attachment semantics, auto-clip, and hit testing right is the difference between a graph editor that *feels* like react-flow / tldraw and one that almost does.

### 6.1 Attachment model

```ts
type EdgeEnd =
  | { nodeId: NodeId; localOffset: Vec2 }   // attached
  | { worldPoint: Vec2 }                     // free-floating
```

`localOffset` is in the node's **pre-rotation local frame**, **top-left origin**, in **absolute pixels** (NOT a 0..1 fraction). Top-left origin matches how the node's `x/y/w/h` are stored; absolute pixels mean a "10px inset from the corner" stays 10px regardless of node size.

Projection to world coordinates (called once per edge per frame):

```ts
function project(end: EdgeEnd, scene: Scene): Vec2 {
  if ('worldPoint' in end) return end.worldPoint
  const n = scene.nodes[end.nodeId]
  const center = { x: n.x + n.w / 2, y: n.y + n.h / 2 }
  // localOffset is top-left-origin; recenter, rotate, re-translate.
  const cx = end.localOffset.x - n.w / 2
  const cy = end.localOffset.y - n.h / 2
  const cos = Math.cos(n.angle), sin = Math.sin(n.angle)
  return { x: center.x + cx * cos - cy * sin, y: center.y + cx * sin + cy * cos }
}
```

What "attached" implies for the rest of the library:

- **No update messages.** The edge stores no world position. Each frame, when an edge is drawn, hit-tested, or its AABB is queried, the projection is recomputed (or read from a cache that's keyed on node version).
- **Node moves / rotates / resizes** → library walks `node.incidentEdges` (an index it maintains) and invalidates each edge's geometry cache. No application code runs.
- **Resize semantics**: because `localOffset` is absolute pixels, a "right-middle" attachment at `{x: 240, y: 60}` on a 240×120 rect becomes a "12px outside on the right at the middle" attachment if the user shrinks the rect to 228×120. Usually fine; the auto-clip stage will pull it back to the new boundary. If a consumer wants proportional behavior, they can store a fraction in `data` and recompute `localOffset` on resize via an extension.
- **Node deletion**: incident edges follow the configured policy. Default: cascade delete. Alternative (opt-in via `edge.data.onSourceDeleted: "detach" | "delete"`): detach to `{ worldPoint: <last known world position> }`. The library never silently leaves dangling references.

### 6.2 The `node.incidentEdges` index

Maintained by the store, not part of the serialized scene. A `Map<NodeId, Set<EdgeId>>` that the library updates on every `addEdge` / `removeEdge` / endpoint reconnection. Two reasons it has to exist:

1. **Frame-time invalidation**: when a node moves, the library needs to invalidate the geometry cache of every incident edge without scanning all edges. O(1) lookup.
2. **Delete cascade**: removing a node tells the library exactly which edges to remove or detach.

Cost: one tiny Set per node, two Set ops per edge mutation. Negligible.

### 6.3 Edge creation

The user flow:

```
1. user mouses over a node               → library shows "edge handles" at cardinal points (top/right/bottom/left)
                                            handles are part of UI canvas, not stored on the node
2. user clicks a handle and drags        → library begins edge-draw mode:
                                            - source = { nodeId, localOffset: handle position }
                                            - target = { worldPoint: current pointer }
                                            - edge lives on the INTERACTIVE canvas (not committed yet)
3. user drags over candidate target node → library shows snap preview:
                                            - highlight the candidate node
                                            - compute predicted attachment point on it
                                            - target temporarily = { nodeId, localOffset: predicted }
4. user releases                         → fire `onEdgeConnect({ source, target })` event
                                            consumer may accept, modify, or reject
                                            on accept: commit edge to store (moves from interactive → static)
                                            on reject: discard
```

The cardinal-handle approach is the most common; we also support **edge-from-empty-space-drag** (alt-click + drag) and **programmatic** creation via `store.addEdge`. All three paths funnel through `onEdgeConnect` so validation is consistent.

### 6.4 Endpoint reconnection (drag-to-rewire)

When an edge is selected, two endpoint handles appear (small circles at source / target world points). Dragging one:

```
1. user grabs source/target handle       → library detaches the endpoint:
                                            previous = { nodeId, localOffset }
                                            becomes  = { worldPoint: <current world pos> }
2. user drags                            → endpoint follows pointer; rest of edge re-routes live
3. user hovers candidate node            → snap preview (same as creation)
4. user releases                         → fire `onEdgeReconnect({ edgeId, end: 'source'|'target', before, after })`
                                            consumer accepts/rejects; on accept the edge is rewritten
```

Throughout the drag, the edge stays on the interactive canvas. Static doesn't redraw until commit.

### 6.5 Auto-clip (the "edge hides inside the attached node" behavior)

Algorithm, per end:

1. Project both endpoints to world coordinates.
2. Compute the curve geometry (see §6.6 for bezier, §6.7 for polyline).
3. Transform the curve into the attached node's **pre-rotation local frame**: subtract node.center, then inverse-rotate by `-node.angle`. The node's AABB in this frame is `[0..w, 0..h]` (after re-translating by `+w/2, +h/2`).
4. Walk the sampled polyline from the endpoint sample *outward*. Each sample is either inside or outside the local AABB. Find the first transition.
5. **Interpolate sub-pixel**: between the last-inside sample and the first-outside sample, linearly solve for the exact crossing of the AABB edge. This eliminates jitter when the boundary sits between samples.
6. Transform the crossing point back to world coordinates (rotate by `+node.angle`, add node.center).
7. The visible edge is the curve between the two crossing points. Arrowheads sit at the crossings; their direction is the **tangent of the unclipped curve at that arc-length position**, not the chord from crossing to crossing.

Failure modes and their handling:

- **Both endpoints inside both rects (overlapping nodes)**: clip ranges don't intersect; render nothing. The edge still exists in the store, just isn't visible until nodes separate.
- **Curve never enters the rect (free-floating endpoint, no clip)**: skip step 3–6 for that end; draw to the endpoint as-is.
- **Self-loop**: special-cased (§6.8), no normal clip.
- **Polyline crossing the rect via multiple segments**: walk all segments; first inside→outside transition from each end wins.

The "rotated rect" math never appears in the hot path — it always collapses to AABB after the coordinate change.

### 6.6 Bezier path

Curve shape: **cubic bezier with two control points** (one near source, one near target). This is the same shape react-flow uses for its default edge.

Auto-routing (when `edge.control` is empty):

```ts
// Outward normal at each endpoint, in node-local space.
// localOffset.x near 0  → normal points left;  near w → right
// localOffset.y near 0  → normal points up;    near h → down
// corners → bias toward whichever side the point is closer to
function attachmentNormalLocal(end: EdgeEnd, n: Node): Vec2 { ... }

// Rotate normal into world space via node.angle, then offset along it.
const d = distance(source.world, target.world)
const k = Math.min(0.4 * d, 200)  // capped so very-long edges don't balloon
sourceControl = source.world + rotate(attachmentNormalLocal(...), n.angle) * k
targetControl = target.world + rotate(attachmentNormalLocal(...), n.angle) * k
```

Manual control: `edge.control` is `[sourceControl, targetControl]`. Either or both can be user-set; the other is auto-computed. Dragging a midpoint handle (visible when edge is selected) sets the corresponding control point.

Sampling: 32–64 evenly-spaced t-values via de Casteljau or direct cubic eval. Cached on the edge until any of `source.world / target.world / edge.control / pathStyle` changes. Same samples power hit testing AND auto-clip — the polyline IS the truth at frame time.

### 6.7 Polyline (orthogonal / Manhattan) path

`pathStyle: "polyline"` interprets `edge.control[]` as the explicit list of midpoints. The edge is straight segments through `[source.world, ...edge.control, target.world]`. No interpolation, no smoothing.

- Auto-clip: walk segments from each end inward; first inside→outside transition wins.
- Hit testing: point-to-polyline distance over the same point list.
- Adding/removing midpoints: when an edge is selected, the library shows "+" handles in the middle of each segment that, when clicked, insert a new midpoint at the click location. Existing midpoints have a small handle the user can drag (or right-click → delete).
- Auto-routing (Manhattan orthogonal): NOT shipped in v1. Polyline is provided as a data shape; an extension can compute orthogonal control[] for an edge whose nodes have rectangular outlines. The core just renders + hit-tests what's there.

### 6.8 Self-loops (`source.nodeId === target.nodeId`)

Default rendering: an arc that exits one side of the rect and re-enters another (default top → right, configurable).

Geometry:
- Pick two endpoints on the rect boundary at the chosen sides (e.g. top-edge midpoint, right-edge midpoint).
- Compute two control points outside the rect to form a smooth bezier loop. Distance proportional to `max(w, h)`.
- Auto-clip applies normally — the loop is just a bezier whose two endpoints happen to share a node.

Hit testing and editing work identically to any bezier. The detection is one equality check.

### 6.9 Hit testing (in depth)

The hit-test request: "what's at world point P, with hit slop S (px in screen space)?"

**Broad phase** (cheap, narrows candidates):

```ts
const aabb = { x: P.x - S/zoom, y: P.y - S/zoom, w: 2*S/zoom, h: 2*S/zoom }
const candidates = edgeSpatialIndex.queryAABB(aabb)  // typically 0–5 edges
```

The spatial index over edges (§7) returns edges whose padded AABB contains the query box. AABBs cached on the edge, padded to include arrowhead extents and label bounds when an edge is selected.

**Narrow phase** (per candidate):

```ts
for each candidate edge, in z-descending order:
  // edge sub-regions, tested in priority order so handles win over body
  if edge is selected:
    test against control-point handles (small AABB per control)  → part: 'control-N'
    test against endpoint handles                                → part: 'source-handle' | 'target-handle'
  test against arrowhead AABBs                                   → part: 'arrow-start' | 'arrow-end'
  if edge.content present:
    test against label AABB                                      → part: 'label'
  test against polyline samples (the same ones used for auto-clip) → part: 'body'
```

**Hit slop**: 8px screen-space for body, 12px for handles/arrowheads. Slop is scaled by `1/zoom` so it feels constant on screen regardless of zoom.

**Z ordering**: within a single edge, parts have an intrinsic priority (handles > arrowheads > label > body). Between edges, higher `edge.z` wins. Edges with the same z are ordered by id (deterministic).

**Result shape**:

```ts
type EdgeHit = {
  edgeId: EdgeId
  part: 'body' | 'arrow-start' | 'arrow-end' | 'label' | 'source-handle' | 'target-handle' | `control-${number}`
  distance: number    // screen-space px to the nearest point of the part
  arcLength?: number  // 0..1, for 'body' hits — useful when adding midpoints / placing labels
}
```

Cost target: <0.2ms per hit-test call on a 10k-edge scene. Achieved by broad-phase narrowing the candidates and the narrow-phase using cached polyline samples (no re-sampling per hover).

### 6.10 Edge rendering: static vs interactive

Edges follow the same static/interactive rule as nodes (§4.2):

- Edges incident to ANY moving node → on interactive canvas during the move.
- Edges with a user-grabbed endpoint or control point → on interactive canvas during the drag.
- All other edges → on static canvas, drawn once per commit.

The library tracks "edges to relocate to interactive" at drag-start by walking `node.incidentEdges` for every moving node, taking the union, and stashing the result on the interaction state. At drag-end the union is restored to static.

### 6.11 Edge labels

`edge.content: string` (lite markdown) renders along the edge near its midpoint. Default placement: arc-length `0.5` (the geometric middle of the polyline sample sequence). Override via `edge.data.labelArcLength: number` in `[0, 1]`.

Rendering:
- Compute label position by walking the sample polyline to the target arc-length.
- Compute tangent at that position for an optional rotated label (default: keep label upright, ignore tangent).
- Measure text via the rich-text subsystem (§8), draw a background chip behind it for legibility, draw the markdown.
- The label is hit-testable as `part: 'label'`.

The background chip is theme-tokenized — it's a visual choice, not a library decision:

| Token                      | Default                                |
|----------------------------|----------------------------------------|
| `edge.label.background`    | scene background color (full opacity)  |
| `edge.label.padding`       | `{ x: 4, y: 2 }` px                    |
| `edge.label.borderRadius`  | `2` px                                 |
| `edge.label.border`        | none                                   |

Consumers can null out the background (`theme("edge.label.background") = null`) for a no-chip look, or restyle to match a design system. The default produces the canonical "graph editor arrow with a label" appearance because it's what users expect when no theme is configured.

For most cases (graph-editor arrows with "blocks", "depends on", "yes/no"), upright + chip behind is what users expect. Following the tangent (text curves along the edge) is an opt-in via `edge.data.labelFollowsTangent: true`.

### 6.12 Performance & scale

Targets on a mid-range laptop:

| Scenario                                    | Budget   |
|---------------------------------------------|----------|
| Hit-test one cursor location, 10k edges     | <0.2ms   |
| Paint one visible edge (bezier + arrowhead) | <0.05ms  |
| Recompute geometry cache for one edge       | <0.1ms   |
| Drag one node with 50 incident edges        | <2ms/frame paint |
| Initial layout of 10k edges (build index)   | <50ms    |

The bottleneck is **never** edge math; it's edge count × spatial-index lookup. Uniform grid (§7) tuned to ~256-unit cells handles 10k–50k edges with sub-ms broad phase.

### 6.13 Design notes & open questions

- **`localOffset` in absolute pixels vs `[0..1]` fraction**: settled on absolute pixels because consistency-with-`node.x/y/w/h` outweighs auto-resize behavior. Consumers who want proportional resize can rewrite `localOffset` in a resize handler — it's just data.
- **Cubic bezier with two controls vs quadratic with one**: cubic. The S-curve look matches react-flow and is what users expect for "smooth graph edges." One extra control point is cheap.
- **Open: orthogonal auto-routing**: polyline is a *data shape*, not a routing engine. Auto-routing around obstacles is an extension's job, not core. v1 ships rendering + manual midpoint editing; consumers add routing if they need it.
- **Open: edge bundling** (drawing multiple parallel edges with curve offsets): not in v1. If multiple edges connect the same pair of nodes, they overlap. Extension territory.
- **Open: arrow-style catalog**: v1 ships `none | arrow | barb | arrow-filled` (matching `dim0/.../style.py`). Custom arrowheads = future extension API; not pressing.

---

## 7. Hit Testing & Spatial Index

A uniform grid over world coords, cells sized ~256 world units. Each cell holds the IDs of nodes/edges whose AABB intersects it. Insert/remove on mutation; query by point or rect for hit testing and viewport culling.

- **Why uniform grid, not R-tree**: simpler, ~50 lines, no balancing, sufficient up to ~50k items. R-tree is a follow-up only if profiling demands it.
- **Two grids** (nodes, edges) so node-only queries don't pay edge-iteration cost.
- **AABBs are rotation-aware**: a node's AABB encloses the rotated rect. For edges, the AABB encloses the curve's bounding box (cheaply approximated as `union(source, target, control)` plus padding).
- **Hit ordering**: hits returned sorted by z descending. Topmost wins.
- **Interactive elements hit-test before background elements** within the same z: edge handles before edge body, resize handles before node body.

---

## 8. Rich Text Subsystem

Ported from `dim0/webui/src/components/markdown/canvas-lite-markdown.tsx` with one architectural change:

### Keep verbatim
- Tokenizer + lite-markdown vocab (bold, italic, underline, strike, highlight, code, inline link, code blocks, hr lines).
- `layoutTokens` wrap engine.
- `measureText` width cache with LRU.
- Font-epoch reactivity (invalidate caches when custom fonts settle).
- Zoom/DPR quantization, moving-vs-idle render-scale resolution (LOD).
- `estimateMarkdownContentHeight` for autosizing text shapes.

### Replace
- The output stage. Drop `canvas.toBlob → URL.createObjectURL → <img>`. Cache to detached `HTMLCanvasElement` (or `OffscreenCanvas`) keyed on `(textHash, w, h, zoomBucket, dprBucket, scale, font, size, style, colors, fontEpoch)`. On miss, draw synchronously into the cached canvas using the existing `drawToCanvas`. On scene draw, `ctx.drawImage(cachedCanvas, x, y, w, h)`. No async queue, no object URLs, no `<img>`.

### Edit mode
Display = canvas. Edit = DOM `<textarea>` overlay positioned over the shape, scaled by camera. The user types raw markdown; on commit the textarea unmounts and the canvas re-renders. The library does NOT ship Lexical/ProseMirror — see §9 for the full edit-mode design and the optional custom-editor adapter interface for power-users who want richer editing per node type.

---

## 9. Edit Mode (DOM Overlay)

When a user double-clicks a text-bearing shape (rect, ellipse, diamond, text, capsule, edge label), the library mounts a DOM editor positioned exactly over the shape's rendered text. The user types raw markdown; on commit the editor unmounts and the canvas re-renders the new `content`. One shape edits at a time.

The v1 editor is a plain `<textarea>`. Not contenteditable, not Lexical, not ProseMirror. The design supports swapping in a richer editor per node type, but we don't ship one.

### 9.1 Why textarea, not contenteditable

This is the call most likely to be relitigated in a code review six months in, so we write the reason down:

| Concern              | `<textarea>`                                  | `contenteditable`                                |
|----------------------|------------------------------------------------|--------------------------------------------------|
| Caret behavior       | Native, identical across browsers              | 20 years of cross-browser quirks                 |
| Selection model      | Native Range, simple                           | Quirky Range with empty-line / boundary bugs     |
| IME (CJK, Korean)    | Native, robust                                 | Native but composition events break in subtle ways|
| Paste                | Plain text, predictable                        | Pastes inline HTML by default; needs sanitizer   |
| Undo                 | Native browser undo                            | Native undo is unreliable; needs custom undo     |
| Inline formatting    | None                                           | Yes (the whole reason people use it)             |
| Accessibility        | Good out of the box                            | Requires aria work                                |

`contenteditable` is only worth it when you NEED inline formatting (bold appearing bold while typing). With our model — show markdown source, render markdown on commit — we don't need it. Lexical / ProseMirror / Tiptap exist precisely because raw contenteditable is so broken; pulling one in costs ~100KB and several weeks of design. Don't pay that bill until a use case demands it.

### 9.2 Lifecycle

```
NOT EDITING
     │ dblclick / Enter / store.beginEdit(id)
     ▼
MOUNTING
     │ position textarea over shape's world rect, scale by camera
     │ initialize value from node.content
     │ apply node.style → textarea CSS (font, size, color, alignment)
     │ focus + select-all (or place caret at end, configurable)
     ▼
EDITING
     │ on input → autosize → temporarily resize the node's display height
     │           → snapshot the in-progress text to a per-edit buffer
     │           → store.content is NOT updated yet
     │ on key handlers → Cmd+B/I/U/etc → wrap selection
     │                 → Enter in list → continue list
     │ on camera move → CSS transform follows so textarea stays over shape
     │
     │ commit (Escape / click outside / programmatic / Tab to next)
     ▼
COMMITTING
     │ apply store.updateNode(id, { content: buffer })
     │ if node.h grew during edit (autosize), apply h change in same OpBatch
     │ unmount textarea
     │ canvas re-renders the shape's rich-text via §8
     ▼
NOT EDITING
```

All transitions go through the store API:

```ts
store.beginEdit(nodeId: NodeId, opts?: { caret?: "start" | "end" | "select-all" }): void
store.endEdit(opts?: { commit?: boolean }): void   // commit defaults to true
store.isEditing(): { nodeId: NodeId } | null
```

Events fire on `subscribe("edit-begin")` and `subscribe("edit-end")` (with the final content).

### 9.3 Triggers

| Action                              | Behavior                                  |
|-------------------------------------|-------------------------------------------|
| Double-click a text-bearing shape   | begin edit on that shape                  |
| Selected + press Enter              | begin edit on the active selection        |
| Selected + press F2                 | begin edit (Excalidraw convention)         |
| Type while shape is selected        | begin edit + insert character (auto-edit) |
| `store.beginEdit(id)`               | programmatic                              |

Auto-edit ("just start typing to edit the selected shape") is the highest-leverage convenience; users discover it once and use it forever. It's free behavior — the canvas-level key handler delegates to the edit subsystem when a printable key arrives with a selection.

### 9.4 Commit / cancel semantics

Three triggers commit:
- **Escape**: commit and stay on the shape (selected).
- **Click outside the shape**: commit and clear selection (unless click hit another shape — then commit, then select that shape, then begin editing it if it's also text-bearing).
- **Tab**: commit and begin editing the next text-bearing shape in z-order (or break out — Shift+Tab reverses). Useful for "type quickly through a row of stickies."

One trigger cancels:
- **`store.endEdit({ commit: false })`**: only via programmatic call. Drops the edit buffer; node.content reverts to its pre-edit value. There's intentionally NO keyboard shortcut for cancel — Excalidraw doesn't have one either, because "Esc cancels" trains users to lose work. Esc commits.

**Auto-commit on store actions**: any mutation other than the in-progress text edit (e.g. user runs undo, switches selection programmatically, opens a side-panel that triggers a store change) auto-commits the current edit first. This is the rule that prevents "edit state leaking into the store" — the store never sees a half-edited document.

### 9.5 Autosize

The textarea grows vertically as the user types:

```ts
function autosize(textarea, node) {
  textarea.style.height = "auto"           // collapse first to remeasure
  const newH = textarea.scrollHeight
  if (newH > node.h) {
    // grow the node optimistically — does NOT enter the store yet
    setDisplayHeight(node.id, newH)
  }
  textarea.style.height = `${newH}px`
}
```

Two heights exist during edit:
- `node.h` — committed height in the store.
- "Display height" — a per-edit overlay value applied to rendering but not the store. The library tracks it on the interaction state.

On commit, if display height differs from `node.h`, the height change is bundled into the commit `OpBatch` so the user gets one undo for "type something AND resize the node."

Width does NOT autogrow — the user explicitly resizes nodes horizontally. Wrapping happens at the fixed width. This matches Excalidraw and is what users expect (otherwise text reflows constantly during typing).

### 9.6 Markdown affordances built-in

Cheap helpers that make the textarea feel "modern enough" without adopting a real editor:

| Key                     | Effect                                                         |
|-------------------------|----------------------------------------------------------------|
| Cmd/Ctrl + B            | wrap selection with `**...**` (toggle if already wrapped)      |
| Cmd/Ctrl + I            | wrap with `*...*`                                              |
| Cmd/Ctrl + U            | wrap with `_..._`                                              |
| Cmd/Ctrl + Shift + X    | wrap with `~~...~~`                                            |
| Cmd/Ctrl + E            | wrap with `` `...` ``                                          |
| Cmd/Ctrl + K            | wrap selection as link: `[selected](url)`, caret in url        |
| Enter on `- ` line       | insert `- ` on the new line (continue list)                   |
| Enter on `1. ` line      | insert `2. ` (auto-increment ordered list)                    |
| Enter on `- ` empty line | remove the bullet (exit list)                                 |
| Tab inside list line    | indent the line by 2 spaces                                    |
| Shift+Tab inside list   | outdent                                                        |
| Tab outside list        | leave to next shape (per §9.4)                                 |

Total: ~80 lines of plain key-handler code. No editor framework. Skipping any of these is fine — Cmd+B/I and auto-list are the high-leverage two.

### 9.7 Visual fidelity (the "no jump on commit" rule)

The single biggest reason simple textareas feel cheap is visual jump on enter/leave edit mode. We avoid it:

- Editor font, size, weight, color, alignment, line-height EXACTLY match what `canvas-lite-markdown` would render (using the same `FONT_FAMILY_MAP` / `FONT_SIZE_MAP` from §8).
- Padding matches the rendered shape's content inset.
- Background: when entering edit mode, briefly show a subtle outline (1px focus ring) and a barely-darker background so the user knows they're in edit mode, but the text positions don't shift.
- On commit, the rendered markdown re-runs through the canvas text engine — and because the textarea showed raw markdown, the text MAY visually change (e.g. `**bold**` becomes bold-formatted). That's expected and what the user wants. The geometric position is unchanged.

### 9.8 Empty content placeholder

A node whose `content` is empty (or only whitespace) renders a faint hint glyph instead of nothing — typically the type's default prompt:

| Node type | Default placeholder |
|-----------|---------------------|
| `text`    | "Click to type"     |
| `rect`, `ellipse`, `diamond`, `capsule` | nothing — empty is a valid look for these shapes |
| Edge label | nothing — empty label is the default for edges |

Placeholder rendering rules:
- Painted at the position the real text would occupy, using the same font tokens at reduced opacity (~30%).
- Never serialized — `content: ""` is the storage state; the placeholder is purely a render decoration.
- Disappears the instant edit mode begins.
- Hit-testable as the shape itself — clicking the placeholder is identical to clicking the shape.

This solves the "new text node looks like nothing was created" problem without the heavier "auto-enter edit mode on create" approach. The user creates a text shape → sees "Click to type" → double-clicks → edits. Same number of clicks as auto-edit-on-create, but the user is in control and accidental shape creation doesn't trap the cursor.

Authors can override per-node-type:
```ts
defineNode({
  type: "rect",
  emptyPlaceholder: "Add a note",      // or null to suppress
})
```

### 9.9 The edit lock (collab interaction)

In v1 single-user, edit mode is purely local state. In a collab world (when a `SyncAdapter` is attached) it becomes an **exclusive lock**:

- `beginEdit(nodeId)` sets local presence `{ editing: nodeId, ... }` and sends via `sendPresence`.
- Other clients observe `editing: nodeId` in remote presence and:
  - Visually mark the node as "Bob is editing" (small avatar / color outline).
  - Block their own `beginEdit` on that node (or queue: "Bob is editing — wait or take over?").
- On `endEdit` the local presence clears `editing`; other clients can now edit.

Edge case: race when two users `beginEdit` near-simultaneously. Resolution: timestamp-based; lower `OpBatch.ts` wins. The "loser" client receives a `subscribe("edit-preempted")` event and exits edit mode without committing its buffer.

Concurrent editing inside one node (Alice and Bob typing in the same node simultaneously) requires CRDT text (`Y.Text` or equivalent). Out of scope for v1; the edit lock is the simpler semantic that doesn't require a CRDT runtime.

### 9.10 Custom editor adapter (the v2 escape hatch)

When a consumer eventually needs a richer editor (slash commands, WYSIWYG, math, inline images), they don't fork the library — they register a custom editor on a node type:

```ts
defineNode({
  type: "rect",
  ...
  editor?: {
    component: React.ComponentType<EditorProps>      // mounts in place of the default textarea
    serialize(editorState): string                    // returns node.content (markdown)
    parse(content: string): EditorState              // initial state from node.content
  },
})

type EditorProps = {
  initialContent: string
  onContentChange(content: string): void   // call on every user keystroke (library buffers)
  onCommit(): void                          // call to trigger commit-and-exit
  onCancel(): void
  env: {
    zoom: number
    cameraTransform: DOMMatrix
    nodeWidth: number
    nodeHeight: number
    style: Style
  }
}
```

The library:
- Mounts the custom editor in the overlay layer at the node's position.
- Routes `Escape` / click-outside / Tab into the editor's `onCommit`.
- Calls `serialize(editorState)` on commit, writes result to `node.content`.
- Calls `parse(content)` on `beginEdit` to seed the editor.

Consumers can ship `@canvas-harness/editor-lexical` or roll their own. Each editor handles its own undo (it sees the buffer; the canvas undo stack only sees the final commit as one op).

This is the same plug-in surface tldraw exposes for custom shape editors. Lets the library stay textarea-shaped without locking out any consumer.

### 9.11 Decided defaults & remaining opens

**Decided:**
- **No auto-edit on create.** New shapes are created in their committed state; user double-clicks to edit. The empty-content placeholder (§9.8) provides the affordance ("Click to type") without trapping the user in edit mode.
- **Double-click to begin edit.** Single-click selects. Configurable per node type, but the default stays dblclick everywhere — it's the safer model and matches Excalidraw/tldraw/Figma.

**Remaining open:**
1. **Edit mode for edge labels**: same textarea, mounted on the edge's label position. Works fine but the geometry is awkward when the label sits on a sharply-curved edge. Acceptable for v1; revisit if it looks bad in real use.
2. **`Tab` behavior**: indent-in-list vs next-shape is mode-dependent. Cursor inside a list-prefix line → indent. Cursor outside any list → next shape. Heuristic is "look at current line's prefix"; usually clear, sometimes ambiguous. Document the rule and move on.
3. **Mobile**: textarea works on mobile but the keyboard takes half the screen. Library should auto-pan camera so the edited node stays visible. ~15 lines of code; ship it.

---

## 10. State, Store, React Integration & Collab-Ready Bones

The library exposes a **store**, not a context tree. The store is the source of truth during interaction, signal-based internally so per-frame work never touches React's reconciler. React components subscribe via selector hooks. The store is framework-agnostic at its core — React is a separate, optional wrapper.

### 10.1 Why a store, not React state

If we held the scene in React state and rendered nodes through React, every node mutation would invalidate at least one component subtree and could trigger reconciliation across thousands of nodes. That's react-flow's actual problem, not its abstract one. A signal-based store lets us:

- Mutate one node and re-render only consumers subscribed to *that one node's signal*.
- Run the canvas paint loop entirely outside React (called from rAF, reads signals directly).
- Subscribe with stable identities — `useNode(id)` is the React key, never changes.
- Keep `@canvas-harness/core` zero-React; `@canvas-harness/react` adds the hooks.

Closest reference: tldraw's `@tldraw/state` package (their atomic/derive primitives). We don't need to ship our own — `solid-js/store`, `nanostores`, or `signia` (tldraw's signal lib) all work. Pick at implementation time; doesn't change the API.

### 10.2 Mutations are operations (the op log)

Every mutation that affects committed scene state is expressed as a typed `Op`. This is what makes the library collab-ready, undo trivial, and the wire format stable.

```ts
type Op =
  | { type: "node.add";    node: Node }
  | { type: "node.update"; id: NodeId; patch: Partial<Node>; prev: Partial<Node> }
  | { type: "node.remove"; node: Node }
  | { type: "edge.add";    edge: Edge }
  | { type: "edge.update"; id: EdgeId; patch: Partial<Edge>; prev: Partial<Edge> }
  | { type: "edge.remove"; edge: Edge }
  | { type: "group.upsert"; group: Group; prev?: Group }  // prev present iff updating, absent iff inserting
  | { type: "group.remove"; group: Group }

type OpBatch = {
  id: BatchId
  clientId: ClientId
  ts: number               // lamport / wall-clock — used for LWW conflict resolution
  origin: "local" | "remote" | "history"
  ops: Op[]
}
```

Key invariants:

- **Every public mutation goes through `applyOp`.** The typed wrappers (`addNode`, `updateNode`, etc.) build the op and call `applyOp` — they exist for ergonomics, not as separate code paths.
- **`update.prev` is captured at apply time.** This is what makes inverse ops cheap (undo doesn't need to diff snapshots).
- **Selection, camera, hover, drag-in-progress are NOT ops.** They are presence (§10.5) — ephemeral, per-client, not synced as document state.
- **Ops are grouped into batches.** A multi-node drag commits as one `OpBatch`; one undo step reverts the whole batch; the wire sends one batch.
- **Origin distinguishes local / remote / replay.** Local ops enter the undo stack; remote ops do not; history replay (undo/redo) doesn't recurse.

### 10.3 Mutation API (typed wrappers)

```ts
// Single ops
store.addNode(node: Node): NodeId
store.updateNode(id: NodeId, patch: Partial<Node>): void
store.removeNode(id: NodeId): void          // cascades to incident edges per policy
store.addEdge(edge: Edge): EdgeId
store.updateEdge(id: EdgeId, patch: Partial<Edge>): void
store.removeEdge(id: EdgeId): void
store.upsertGroup(group: Group): void
store.removeGroup(id: GroupId): void

// Batching — required for multi-op atomicity
store.batch(fn: () => void): void           // all mutations inside fn become one OpBatch

// Raw entry point — used by the sync adapter for remote ops
store.applyOp(op: Op, opts?: { origin?: "local"|"remote"|"history" }): void
store.applyBatch(batch: OpBatch): void

// History
store.undo(): boolean                       // returns true if something was undone
store.redo(): boolean
store.clearHistory(): void

// Persistence
store.toJSON(): SerializedScene             // snapshot, no op log
store.fromJSON(scene: SerializedScene): void  // clears history
```

Anti-pattern: calling `addNode` 100 times in a loop. That's 100 batches, 100 undo entries, 100 wire sends. Wrap in `store.batch(() => { ... })` to coalesce.

### 10.4 Reads & React hooks

Reads come in two flavors: imperative (for non-React or one-off lookups) and signal-subscribed (for React components that should re-render on change).

**Imperative reads** (don't trigger subscriptions):
```ts
store.getNode(id): Node | undefined
store.getEdge(id): Edge | undefined
store.getGroup(id): Group | undefined
store.querySpatial({ rect?, point? }): { nodes: NodeId[]; edges: EdgeId[] }
store.getSelection(): (NodeId | EdgeId)[]
store.getCamera(): CameraState
```

**React hooks** (in `@canvas-harness/react`, subscribe via signals):
```ts
useCanvasApi(): CanvasApi                   // imperative handle: store, camera, selection
useNode(id: NodeId): Node | undefined       // re-renders ONLY when that node changes
useEdge(id: EdgeId): Edge | undefined
useSelection(): (NodeId | EdgeId)[]
useCamera(): CameraState
useNodes(predicate?: (n: Node) => boolean): Node[]   // expensive — re-runs on any node change
useCanvasStore<T>(selector: (s: SceneSnapshot) => T): T   // generic, equality-checked
usePresence(clientId?: ClientId): PresenceState | Map<ClientId, PresenceState>
```

The rule: **inside a custom-node component, only use `useNode(node.id)`**. `useNodes(...)` is fine for sidebars, layer panels, minimaps — anything that *should* see all nodes. Inside a per-node component it's a perf trap.

### 10.5 Presence (ephemeral, per-client state)

Presence is everything that describes "where am I right now" without changing the document: my cursor, my selection, my camera, what I'm hovering, whether I'm currently dragging. It is:

- **Not in the op log.** Presence never enters undo/redo or `toJSON`.
- **Per-client.** The store holds a `Map<ClientId, PresenceState>` for remote clients plus its own local presence.
- **Drawn on the interactive canvas.** Remote cursors and selection outlines paint per-frame alongside local UI.

```ts
type PresenceState = {
  cursor?: { worldX: number; worldY: number }    // pointer in world coords
  selection?: (NodeId | EdgeId)[]
  camera?: CameraState                            // optional: "follow me" mode
  user?: { id: string; name?: string; color?: string }
  // consumer-extensible:
  extras?: Record<string, unknown>
}

store.presence.setLocal(patch: Partial<PresenceState>): void
store.presence.getLocal(): PresenceState
store.presence.get(clientId: ClientId): PresenceState | undefined
store.presence.getAll(): Map<ClientId, PresenceState>
store.presence.subscribe(cb: (state: Map<ClientId, PresenceState>) => void): Unsubscribe
```

The library's interaction layer automatically updates local presence: pointer-move → `cursor`, selection change → `selection`, camera pan → `camera`. Authors can add their own fields via `presence.setLocal({ extras: {...} })` for things like "I'm typing in node X."

### 10.6 Sync adapter (collab-ready, ships no concrete adapter)

> **v1 sync is experimental.** The interface and op format are stable enough to build adapters against, but the conflict semantics described below assume causally-ordered op delivery from the adapter. Adapters without causal ordering (raw WebSocket without sequencing, multi-region replication without vector clocks) WILL produce incorrect state in the default LWW path. For v1, build sync on top of a transport that provides causal order (Yjs, Automerge, sequenced server, BroadcastChannel within one tab); the library will add a reorder buffer for non-ordered transports in v2.

The store is wired for collaboration but ships zero transport. Consumers plug in their own.

```ts
type SyncAdapter = {
  // Outbound — library calls these when local activity happens.
  sendBatch(batch: OpBatch): void | Promise<void>
  sendPresence(state: PresenceState): void

  // Inbound — adapter calls these via the handlers passed to attach().
  attach(handlers: {
    onRemoteBatch(batch: OpBatch): void
    onRemotePresence(clientId: ClientId, state: PresenceState): void
    onPresenceGone(clientId: ClientId): void
  }): void

  detach(): void

  // Optional capabilities the adapter advertises.
  capabilities?: {
    causalOrdering?: boolean   // adapter guarantees ops arrive in causal order
    crdt?: boolean             // adapter merges via CRDT (Yjs/Automerge); skip LWW
  }
}

const store = createCanvasStore({
  initial: scene,
  sync: myAdapter,           // optional
  clientId: "u-7f3a",        // required when sync is set
  idGenerator: () => `${clientId}-${counter++}`,    // override default
})
```

**Conflict policy without CRDT** (the default, library-provided — assumes causally-ordered delivery):
- Per-property LWW based on `OpBatch.ts`.
- A remote `node.update` whose `prev` slice for a property doesn't match local current → still applied (LWW), but flagged in a `store.subscribe("conflict")` event for telemetry.
- Remote `node.remove` of an already-removed node → no-op (idempotent).
- Remote `node.add` with an existing id → log warning, keep local.
- **Remote `node.update` for an unknown id** (the causal-ordering failure case) → drop the op and emit a `"sync-error"` event with `{ kind: "missing-parent", op, reason }`. **The library does NOT buffer the op waiting for the parent.** v1 says "your adapter MUST deliver in causal order." Adapters that can't guarantee this are unsupported in v1; v2 will add a reorder buffer.
- Remote `edge.add` referencing an unknown `source.nodeId` / `target.nodeId` → same: drop + `"sync-error"`.

**Adapters MUST advertise capabilities truthfully.** If `capabilities.causalOrdering` is omitted or `false`, the library refuses to operate in default LWW mode and requires `capabilities.crdt: true` (i.e. adapter owns merge). This forces the choice into the open: either your transport gives causal order, or your adapter implements CRDT.

**With CRDT** (`capabilities.crdt: true`):
- Adapter is responsible for merging; library trusts the adapter's resolved state.
- Adapter receives local op batches, translates to CRDT updates, and on inbound updates emits resolved `onRemoteBatch` calls back to the library.
- This is how a Yjs adapter would work: wraps the store in a Yjs doc, runs Yjs's structural merge, and presents the result as a clean op stream.

Reference adapters to write later (out of scope for v1):
- `@canvas-harness/sync-yjs` — Yjs-backed real-time collab.
- `@canvas-harness/sync-broadcast` — single-tab dev tool using `BroadcastChannel`.
- `@canvas-harness/sync-supabase` / `-firebase` / etc. — backend-of-the-week.

### 10.7 Event subscriptions (non-React, framework-agnostic)

```ts
store.subscribe("change", (batch: OpBatch) => { ... })           // every commit
store.subscribe("selection", (sel) => { ... })
store.subscribe("camera", (cam) => { ... })
store.subscribe("edit-begin", ({ nodeId }) => { ... })
store.subscribe("edit-end", ({ nodeId }) => { ... })
store.subscribe("conflict", ({ batch, conflicts }) => { ... })  // LWW resolution events
store.subscribe("presence", (state) => { ... })
```

These are the public extension points for non-React consumers (telemetry, custom panels, etc.). React consumers use hooks; the events still fire so both can coexist.

### 10.8 ID generation

Default: `${clientId}-${counter++}`. Short, collision-free across clients without coordination, human-readable in dev tools. The `clientId` defaults to a short random string if `sync` isn't set; required when `sync` is set.

Consumers can override:
```ts
createCanvasStore({ idGenerator: () => nanoid() })
createCanvasStore({ idGenerator: () => crypto.randomUUID() })
```

Whatever the function returns is treated as opaque. Must be unique across the document's lifetime (including via sync, including after `fromJSON`).

### 10.9 Persistence vs sync (don't confuse them)

`toJSON` / `fromJSON` are about snapshots — what gets saved to disk or sent on first load. They omit the op log, presence, and undo stack. Loading clears history.

The op log is about *changes since some reference state* — what gets sent on the wire to a peer. Op log entries are not durable beyond the in-memory window (~100 batches by default; configurable). If a peer needs to catch up from far behind, send a snapshot (toJSON) + a tail of recent ops.

Persistence layer is consumer territory; the store gives you both primitives.

### 10.10 Open design questions

1. **Internal signal library**: ship our own (more control, more code) or depend on `signia` / `nanostores` / `solid-js/store`? Lean: depend on something proven. `signia` was extracted from tldraw and is the closest fit semantically.
2. **Presence rate-limiting**: cursor updates can be 60Hz; sending 60 `sendPresence` calls per second to the adapter is wasteful. Library should throttle locally (default ~30Hz for cursor, immediate for selection). Configurable.
3. **`prev` in update ops** captures only the changed slice. For a `Partial<Node>` patch this is exact. For an array reorder (e.g. `groups: ["a","b","c"] → ["b","c","a"]`) the inverse is fine but the "did this conflict" check is ambiguous. Probably accept LWW for array reorders without conflict detection. Open question.
4. **CRDT for `content` (markdown text)**: per-property LWW is fine when only one user edits at a time (edit-mode lock, §9). Real concurrent text editing requires OT / Yjs's `Y.Text`. v1: edit-mode is exclusive (locked while one user edits). v2: optional concurrent text via CRDT adapter.
5. **Backpressure**: what if `sendBatch` returns a rejected promise (server full, rate-limited)? Library buffers outgoing batches and retries; reaches a watermark and emits `subscribe("sync-error")`. Detailed semantics TBD.

### 10.11 Interaction state observability

A consolidated, subscribable view of "what is the user doing right now" — cursor position, current interaction mode, dragged ids, marquee rect. Consumers need this for status bars, conditional UI, AI-mode gating ("don't let the agent mutate during a drag"), custom-node `env.isMoving`. The library already computes everything internally for its own renderer; this section just exposes it as a clean public surface.

```ts
type InteractionMode =
  | "idle"
  | "panning"           // camera pan in progress
  | "zooming"           // wheel/pinch zoom in progress
  | "dragging"          // one or more nodes being moved
  | "resizing"          // resize handle being dragged (§11.6)
  | "rotating"          // rotation handle being dragged
  | "marqueeing"        // marquee-select rectangle being drawn
  | "creating-edge"     // user dragged from a node handle, not yet released
  | "reconnecting-edge" // user grabbed an edge endpoint and is dragging it
  | "editing"           // edit-mode textarea active

type InteractionState = {
  mode: InteractionMode
  isMoving: boolean                            // shortcut: any of panning/zooming/dragging/resizing/rotating
  pointer: {
    worldX: number; worldY: number
    screenX: number; screenY: number
    pointerType: "mouse" | "touch" | "pen"
    pressure?: number                          // pen-only, 0..1
  } | null                                     // null if pointer is outside canvas

  // Populated by mode:
  draggedIds: (NodeId | EdgeId)[]              // dragging / resizing / rotating
  marqueeRect: WorldRect | null                // marqueeing
  resizeHandle: ResizeHandle | null            // resizing
  editingNodeId: NodeId | null                 // editing
  edgeDraftSource: EdgeEnd | null              // creating-edge: the start endpoint
}
```

#### API (imperative + subscribed)

```ts
// Store (framework-agnostic)
store.getInteractionState(): InteractionState
store.subscribe("interaction", (state: InteractionState) => void): Unsubscribe

// React hooks (in @canvas-harness/react)
useInteractionState(): InteractionState                          // full state, fires on any change
useInteractionMode(): InteractionMode                            // narrowed, fires only on mode change
useCursor(): InteractionState["pointer"]                          // shortcut, frame-coalesced
useIsMoving(): boolean                                            // shortcut, derived
useDraggedIds(): (NodeId | EdgeId)[]                              // shortcut
```

#### Frame coalescing

`pointer` updates are written internally on every `pointermove` event (potentially 60-120Hz). Subscribers do NOT fire on every raw event — they're coalesced to one update per rAF tick. So `useCursor()` in a React component re-renders at most once per frame, no matter how fast the pointer moves. Same model as everything else (§4.3).

Mode transitions fire immediately (not coalesced) because they're sparse and consumers usually want to react synchronously ("user just started dragging — disable AI mutations").

#### Relationship to other surfaces

This is the "consumer-facing observability" face of state that already exists internally:

| Field                 | Same data also reachable via             |
|-----------------------|------------------------------------------|
| `pointer`             | `presence.getLocal().cursor` (§10.5)     |
| `editingNodeId`       | `store.isEditing()` (§9.2)               |
| `draggedIds` (during drag) | tracked internally for the static/interactive split (§4.2) |
| `mode`                | derived from interaction-handler state machine |

The library exposes ALL of them through one unified state so consumers don't have to compose three different sources. `presence.cursor` continues to exist (it's specifically about collab broadcast); `store.isEditing()` continues to exist (edit lock semantics); but for "what's happening locally right now," `useInteractionState()` is the one-stop API.

#### Use cases this enables

- **Status bar**: "Dragging 3 nodes" / "Zooming" / "Idle".
- **Conditional UI**: hide a toolbar while marqueeing; show snap guides while resizing.
- **AI-mode gating**: refuse `store.applyOp` from an AI agent when `mode !== "idle"`. Prevents mid-drag mutations from confusing the user.
- **Custom-node decisions**: `env.isMoving` in `renderCanvas` is just this state's `isMoving` field, exposed via the render env.
- **Telemetry**: log mode transitions for product analytics ("median user spends X% of time in `editing`").

#### Cost

Implementation: ~80 LOC. Every interaction handler already mutates a piece of state; this section just makes the existing state machine visible. Zero runtime cost when nobody subscribes.

---

## 11. Interactions & Editing

Subsystems that sit on top of the store and renderer: undo/redo, clipboard, pointer/pen input, screenshot/export. Each is small individually but all four are user-facing features people will judge the library by, so they get an explicit design rather than emerging accidentally.

### 11.1 Undo / Redo (op-based)

Op-based, not snapshot-based. Each `OpBatch` is one undo step.

```ts
store.undo(): boolean       // returns true if something was undone
store.redo(): boolean
store.clearHistory(): void
```

**How it works:**

- The store keeps two stacks: `past: OpBatch[]` and `future: OpBatch[]`.
- A locally-applied batch (origin `"local"`) is pushed to `past`; `future` is cleared.
- `undo()` pops the head of `past`, inverts each op via its `prev` slice (in reverse order), applies the inverse as a new batch with origin `"history"`, pushes the original to `future`.
- `redo()` is the mirror — pop `future`, re-apply, push to `past`.

**Inverse op table:**

| Op            | Inverse                                       |
|---------------|-----------------------------------------------|
| `node.add`    | `node.remove(node)`                           |
| `node.update` | `node.update(id, prev, /* prev = current */)` |
| `node.remove` | `node.add(node)`                              |
| `edge.*`      | symmetric to nodes                            |
| `group.upsert` | previous `group.upsert(prevValue)` or `group.remove` if was new |
| `group.remove` | `group.upsert(group)`                        |

The `prev` slice captured at apply time means inversion is data-only — no diffing, no replay from the start, no snapshot copies.

**Capacity:** default 100 batches in `past`, configurable. Old batches drop off the back; memory is bounded.

**Collab interaction (important and slightly subtle):**

- **Remote batches (`origin: "remote"`) DO NOT enter the local undo stack.** Otherwise Alice's "undo" would revert Bob's work.
- **Local undo only reverts local ops.** If Alice's local stack has batches A1, A2, A3 and Bob meanwhile did B1 between A2 and A3, Alice's `undo()` reverts A3 only. Standard.
- **Conflict on undo**: Alice undoes A1 (which set `node.color = "red"`), but Bob since then did B1 setting `node.color = "blue"`. Inverse of A1 says "set color back to whatever was before A1, e.g. `"black"`." LWW says higher ts wins; if Alice's inverse is timestamped now (later than Bob's B1), Alice's undo overwrites Bob's change. This is usually what users want ("my undo undid my change") but is a real edge case. Surface via `subscribe("conflict")` for telemetry; don't try to be too clever in v1.
- **`future` is cleared on any new local op** but NOT on remote ops. Alice can undo locally, then Bob does something, Alice can still redo her own change.

**Edge cases:**

- **Undo across `fromJSON`**: `fromJSON` clears history (no time-travel across documents). `clearHistory()` is the manual entry point.
- **Undoing a removed node whose incident edges were cascaded**: `node.remove` op carries the removed node; the cascade-deleted edges are separate ops in the same batch (`store.batch(() => { ... })` semantics). Undoing the batch restores node + edges in order.
- **Undoing a remote-applied LWW-overwrite**: not in the local stack, so no-op. Alice can't undo Bob's change.

### 11.2 Copy / Paste / Clipboard

The library provides a small clipboard subsystem that handles serialization, id remapping, paste positioning, and external-app interop.

```ts
api.clipboard.copy(): Promise<void>            // copies current selection
api.clipboard.cut(): Promise<void>             // copy + delete
api.clipboard.paste(opts?: {
  worldPoint?: Vec2                            // default: current cursor or viewport center
  asNew?: boolean                              // default true; forces id remap
}): Promise<{ nodeIds: NodeId[]; edgeIds: EdgeId[] }>

// Hooks for consumers who want to customize:
<Canvas
  onCopy={(e) => { /* e.payload is the serialized clipboard */ }}
  onPaste={(e) => { /* e.source: "internal" | "external"; e.payload */ }}
/>
```

**Internal format** (the canonical one — what we write to the OS clipboard):

```json
{
  "kind": "canvas-harness/clipboard",
  "version": 1,
  "nodes": [...],          // copied subgraph
  "edges": [...],          // only edges with both endpoints in `nodes`
  "groups": [...],         // only groups referenced by copied nodes
  "origin": {              // for paste-offset calculation
    "boundingRect": { "x": 100, "y": 100, "w": 400, "h": 200 },
    "cursorAt": { "x": 250, "y": 150 }
  }
}
```

Written to the OS clipboard via `navigator.clipboard.write(...)` with a custom MIME type `application/x-canvas-harness+json`. Also written as **`text/plain`** (the concatenated `content` of copied nodes — markdown). This makes paste into Notion/Slack/etc. work natively.

Pasted from another app:
- `image/png` → creates an `image` node with the bitmap.
- `text/html` → strip-paste as `text/plain`.
- `text/plain` → creates a `rect` (or `text`) node with the text as `content`.
- `application/x-canvas-harness+json` → full subgraph paste with id remap.

**Paste positioning:**
- If user explicitly invoked paste (Cmd+V) → place at last known cursor world position.
- If pasted programmatically without `worldPoint` → center on viewport.
- The pasted subgraph's bounding rect is offset so its center lands at the target point.
- Successive pastes (Cmd+V Cmd+V Cmd+V) offset by ~20px each to avoid stacking.

**ID remap on paste:**
- Every node id in the payload is regenerated; edges' `source.nodeId` / `target.nodeId` are rewritten through the remap; groups remap too. Original ids are NOT preserved (use-case: copy-paste creates new entities).
- For "duplicate in place" UX (Cmd+D), `asNew: true` + worldPoint offset.

**External-app interop matrix:**

| Direction    | Format              | Result                                     |
|--------------|---------------------|--------------------------------------------|
| internal → external (text editor) | `text/plain` | markdown content of selected nodes  |
| internal → another canvas-harness instance | `application/x-canvas-harness+json` | full subgraph with id remap |
| external (browser) → internal | `image/png`        | new image node                              |
| external (browser) → internal | `text/html`        | stripped to text/plain, new text node       |
| external → internal | `text/plain`               | new text/rect node                          |

### 11.3 Pointer & Pen Input

The library uses **PointerEvents only** — no separate mouse/touch handlers. PointerEvent unifies mouse, touch, and pen with a single API and avoids the dual-handler bugs that plague graphics editors.

```ts
canvas.addEventListener("pointerdown", handler)
canvas.addEventListener("pointermove", handler, { passive: false })
canvas.addEventListener("pointerup", handler)
canvas.addEventListener("pointercancel", handler)
```

**Per-event we care about:**

| Property            | Used for                                     |
|---------------------|----------------------------------------------|
| `pointerType`       | `"mouse" \| "touch" \| "pen"` — branch behavior |
| `pressure`          | pen-only stroke-width modulation (0..1)      |
| `tiltX`, `tiltY`    | pen-only stroke angle for calligraphy nibs   |
| `width`, `height`   | touch contact area (palm rejection heuristic)|
| `isPrimary`         | filter multi-touch to "primary" for single-pointer flows |
| `button`, `buttons` | mouse buttons + pen eraser end (`buttons & 32`) |

**Default behaviors per pointer type:**

- **`mouse`**: click/drag standard. Right-button = context menu. Shift/Cmd modify behavior (multi-select, etc.).
- **`touch`**: single-finger drag pans the canvas (NOT moves a node) — finger pan is the most ergonomic touch gesture; node-drag requires long-press. Two-finger pinch-zooms and rotates. Two-finger pan also works.
- **`pen`**: behaves like mouse for selection/move. If `event.buttons & 32` (eraser tip) — special erase mode. `pressure` propagates to custom-node `on.drag` handlers so freehand-drawing nodes can use it.

**Palm rejection (touch):**
- When a pen is hovering (`pointerType === "pen"` + a recent `pointermove`), ignore concurrent `pointerType === "touch"` events for ~100ms.
- Heuristic-only; not perfect. Authors of pen-heavy tools should expose a "palm rejection: aggressive | default | off" setting.

**Gesture recognition:**
- `pan` (single-finger / mouse-middle / spacebar+left): updates `camera`.
- `pinch` (two-finger): updates `camera.z` around midpoint.
- `tap`: pointerdown → pointerup within ~250ms and <8px movement → click.
- `long-press` (touch only): ~500ms hold → start node-drag.
- `drag`: pointerdown + sustained movement.

Gestures are recognized by the library's input layer and dispatched as semantic events:

```ts
<Canvas
  onPan={(e) => {}}
  onPinch={(e) => {}}
  onTap={(e) => {}}
  onLongPress={(e) => {}}
  onPenStroke={(e) => {}}            // stream of pressure-rich pointermoves between down and up
/>
```

**For custom nodes**: pointer events bubble through the library's hit-test then dispatch to the node's `on.*` handlers. The `env` passed includes the raw `PointerEvent` so authors can read `pressure` / `tiltX` / etc.

**What v1 does NOT ship:**
- A freehand-drawing tool (use case: stylus sketching). Provide hooks so consumers can build one as a custom node + tool, but the tool itself is out of scope.
- Pen pressure-curve calibration UI.
- Wacom-style stylus-specific APIs beyond what PointerEvent exposes.

### 11.4 Screenshot / Export

```ts
api.exportPNG(opts?: {
  rect?: WorldRect            // default: current viewport in world coords
  scale?: number              // device pixel multiplier; default 2
  background?: string | null  // default: theme background; null = transparent
  includeOverlay?: boolean    // include DOM custom nodes (default true)
  includeUI?: boolean         // include selection, handles (default false)
}): Promise<Blob>

api.exportSVG(opts?: {
  rect?: WorldRect
  background?: string | null
  // includeOverlay: false (always — SVG can't capture DOM custom nodes)
}): Promise<string>

api.exportScene(): SerializedScene    // pure data export, no rendering

// Convenience:
api.exportSelection(opts?): Promise<Blob>   // = exportPNG with rect = bbox of selection + padding
api.exportViewport(opts?): Promise<Blob>    // = exportPNG with rect = current viewport
```

**Implementation:**

- Create an offscreen `HTMLCanvasElement` at `(rect.w * scale, rect.h * scale)` pixels.
- Set up the camera transform so world-rect maps to the offscreen canvas.
- Paint the scene into the offscreen canvas using the same renderer path as `static` (NOT interactive — no handles/selection unless `includeUI: true`).
- For `includeOverlay: true`: rasterize each visible custom-node's DOM via the author's `getSnapshot(node, env)` and blit onto the offscreen canvas. Custom nodes WITHOUT `getSnapshot` get drawn via `drawPlaceholder` → fallback to AABB rect. This is the same fallback chain as LOD mode (§5.3) — authors who want screenshots to include their nodes faithfully MUST provide a snapshot path.
- Encode via `OffscreenCanvas.convertToBlob({ type: "image/png" })` (or `canvas.toBlob` in non-OffscreenCanvas environments).

**Why `getSnapshot` is the only way to capture custom React nodes in a screenshot:**

The export path is a pure-canvas paint. React components can't be painted into a canvas directly — they paint into the DOM. So either:
1. The custom-node author provides `getSnapshot` (returns a `CanvasImageSource`) → library blits it. Authors who care about screenshots invest here.
2. They don't, and the screenshot shows the placeholder (or AABB) instead.

This is consistent with §5.3's snapshot model and avoids the heavy `html2canvas` dependency in the library.

**SVG export**:
- Vector output, great for print/embed. But:
- Custom React nodes can't be SVG-rendered without DOM rasterization. SVG export ALWAYS uses `drawPlaceholder` for custom nodes (no `getSnapshot` fallback — SVG can't embed bitmaps cleanly without ballooning size).
- Text shapes render as SVG `<text>` elements, preserving font tokens (consumer's stylesheet handles fonts).
- Edges render as `<path>`.
- v1 ships exportSVG as opt-in. Not required for most consumers.

**Costs:**

| Export                    | Typical time on mid laptop                            |
|---------------------------|-------------------------------------------------------|
| `exportPNG` viewport      | 50–200ms (depends on visible item count + snapshots) |
| `exportPNG` large rect    | scales linearly with pixel area + visible items      |
| `exportPNG` huge (50k px) | becomes second-scale; OffscreenCanvas in a Worker helps |
| `exportSVG`               | comparable for vector data; slower if many text shapes |

`exportSelection` is `exportPNG` with `rect = unionAABB(selection) + padding` — trivial composition, mentioned only because users will ask for it by name.

### 11.5 AI agent context (read side)

LLM-driven agents are an emerging first-class user of canvas/whiteboard libraries. The library exposes a single read-side API that returns a representation of the canvas suitable for direct LLM injection. Without this, every consumer reinvents the same JSON-flattening / markdown-rendering boilerplate. We bake it in.

```ts
api.getContext(opts?: {
  // What to include
  scope?: "viewport" | "selection" | "all" | { rect: WorldRect }   // default: "viewport"
  overscan?: number                                                  // px around scope (world coords), default 0
  filter?: { types?: string[]; groups?: GroupId[] }                  // optional further narrowing

  // Shape of the output
  format?: "json" | "markdown" | "text"                              // default: "json"
  detail?: "minimal" | "structural" | "full"                         // default: "structural"
  withRelations?: boolean                                            // edges listed per node (adjacency), default false
  withCamera?: boolean                                               // auto: true for "viewport", false for "all"
}): ContextSnapshot | string
```

#### Detail levels

The single most important knob — LLM context windows are precious, and 90% of agent use cases don't need positions/styles.

| `detail`      | Fields included                                                                            | Typical use case                       |
|---------------|---------------------------------------------------------------------------------------------|-----------------------------------------|
| `minimal`     | `id`, `type`, `content`. Nothing else.                                                      | "What's on the canvas?" Q&A             |
| `structural`  | minimal + edges (`source`, `target`, `content`) + `groups`                                  | "Summarize the graph", "Find dependencies" |
| `full`        | structural + `x/y/w/h/angle` + `style`                                                      | "Round-trip back into a scene", layout agents |

#### Format

| `format`      | Output shape                                              | When                                    |
|---------------|-----------------------------------------------------------|-----------------------------------------|
| `json`        | `ContextSnapshot` object (typed, programmatic)            | Default. Tool-use APIs, structured agents |
| `markdown`    | Token-efficient markdown for LLM context window            | Direct LLM prompt injection             |
| `text`        | Plain prose narrative                                      | Reasoning agents, less-structured tasks |

#### JSON output (default)

```ts
type ContextSnapshot = {
  schemaVersion: 1
  scope: "viewport" | "selection" | "all" | "rect"
  viewport?: { x: number; y: number; w: number; h: number; zoom: number }    // when withCamera
  nodes: ContextNode[]
  edges: ContextEdge[]
  selection?: (NodeId | EdgeId)[]
  groups?: Record<GroupId, { name?: string; color?: string }>                 // only referenced groups
  truncated?: { nodes: number; edges: number }                                // when filter capped output (see §11.5.5)
}

type ContextNode = {
  id: NodeId
  type: string
  content?: string                            // omitted when empty
  // detail >= "full":
  x?: number; y?: number; w?: number; h?: number; angle?: number
  style?: Style                                // only non-default fields
  groups?: GroupId[]
  // withRelations:
  incomingEdges?: EdgeId[]
  outgoingEdges?: EdgeId[]
}

type ContextEdge = {
  id: EdgeId
  source: NodeId | { worldPoint: Vec2 }
  target: NodeId | { worldPoint: Vec2 }
  content?: string
  pathStyle?: "straight" | "bezier" | "polyline"
}
```

#### Markdown output (LLM-friendly)

```markdown
# Canvas context (viewport at zoom 1.0)
2 nodes, 1 edge visible. 1 selected.

## Nodes
- `n-1` (rect): Hire Lara before Q3
- `n-2` (ellipse): Review specs *[selected]*

## Edges
- `n-1` → `n-2` — "blocks"
```

Typically 30–60% smaller than equivalent JSON in tokens — significant when stuffing context into a 4k or 8k window. The markdown renderer normalizes id stability (predictable `n-1`, `n-2` style) so agent output is comparable across calls.

#### The write-side companion (already exists)

The library does not need a separate "AI mutation API." The op-based store IS the tool-call surface:

```
1. LLM reads:        api.getContext({ format: "markdown" })
2. LLM emits a tool-call (one of the existing Op types):
                     { tool: "applyOp", op: { type: "node.add", node: {...} } }
3. App validates and executes:
                     store.applyOp(op)
4. LLM observes via getContext() again.
```

This is the entire AI agent loop. The op log doubles as a deterministic tool-call schema:

| AI tool name              | Op produced                              |
|---------------------------|------------------------------------------|
| `addNode(node)`           | `{ type: "node.add", node }`             |
| `updateNode(id, patch)`   | `{ type: "node.update", id, patch }`     |
| `removeNode(id)`          | `{ type: "node.remove", node }`          |
| `addEdge(edge)`           | `{ type: "edge.add", edge }`             |
| `updateEdge(id, patch)`   | `{ type: "edge.update", id, patch }`     |
| `removeEdge(id)`          | `{ type: "edge.remove", edge }`          |
| `setSelection(ids)`       | (presence update, not an op)             |
| `moveCamera(camera)`      | (presence update, not an op)             |

For OpenAI / Anthropic tool-use definitions, the library ships JSON Schema for each Op type so consumers can register them with one call:

```ts
import { opSchemas } from "@canvas-harness/core"

// opSchemas is a record from op type → JSON schema, ready to pass to
// the LLM provider's tool-use API.
```

#### Size & truncation

Real boards can have thousands of nodes. `getContext({ scope: "all" })` on a 10k-node scene would blow any context window. Defaults are designed to fail safe:

- Default `scope: "viewport"` caps output to whatever's visible (typically tens of nodes).
- The library enforces a soft cap of 500 nodes and 1000 edges per `getContext` call. Excess items are dropped and reported in `truncated: { nodes: N, edges: M }`. Consumers can opt out (`maxNodes: Infinity`) but it's the right default for accidental "all" calls.
- For very large agent operations, consumers chunk: query rect-by-rect, summarize each, then ask the LLM to operate on summaries. The library doesn't ship this orchestration — it's app territory.

#### Cost

Implementation: ~150 LOC in `@canvas-harness/core`. Most of it is the markdown formatter and the truncation logic; the underlying data extraction reuses `store.querySpatial` and existing serialization.

Runtime: O(visible items). A single `getContext({ scope: "viewport" })` call on a typical scene is sub-millisecond.

#### Open

1. **Tool-name conventions**: ship `addNode` / `updateNode` etc. as recommended tool names, or let consumers name freely? Lean: ship recommended names + JSON Schemas; consumers override if their LLM provider needs different namespacing.
2. **Streaming**: should `getContext` support a streaming output for agents that operate incrementally on the scene? v1: no, return a snapshot. v2 candidate if real use emerges.
3. **Sensitive content redaction**: customers will eventually ask "can I exclude PII from context sent to OpenAI?" Defer to consumer — they wrap `getContext` and post-process. Don't ship redaction in core.

### 11.6 Resize

Every selected node shows 8 resize handles (4 corners + 4 edge midpoints) on the interactive canvas. Resize is a first-class gesture, not a side effect of `updateNode`.

#### Handle geometry

Handles are drawn at the node's 8 cardinal world points, scaled by camera so they appear at constant screen size (typically 8px squares). They live on the interactive canvas above the selection outline and rotate with the node — a rotated rect's corner handles sit at the rotated corners, not the AABB corners.

Hit testing: each handle is a small AABB hit-tested before the node body (per §5.5 / §7 "interactive elements hit-test before background elements"). Result returns `{ nodeId, part: 'resize-handle', handle: 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' }`.

#### Gesture flow

```
1. user pointerdown on handle           → mode = "resizing"; capture initial node geometry + pointer world position
                                          edge incidents move to interactive canvas (per §4.2 exclude-moving rule)
2. user drags                           → compute new w/h/x/y from pointer delta + which handle:
                                            - corner handles: change w and h (and x/y if pulling from top/left)
                                            - edge handles: change one dimension only
                                          apply to a per-frame display geometry (NOT yet committed)
                                          interactive canvas redraws node + incident edges + handles each frame
3. modifier keys                        → Shift: lock aspect ratio (compute h from w via original ratio)
                                          Alt: resize from center (mirror delta to the opposite side; node.x/y unchanged)
                                          Shift+Alt: both
4. snap (optional via extension)        → consumer can register a resize-snap function (e.g. snap to grid, snap to other-node bounds)
5. release                              → commit one OpBatch:
                                            { type: "node.update", id, patch: { x, y, w, h }, prev: {...} }
                                          incident edges return to static canvas
                                          fires onNodeResize event
6. release without movement             → cancel (no commit)
```

The library handles rotation correctly: if a node has `angle: 0.5`, pointer deltas are inverse-rotated into the node's local frame before being applied to `w/h`. So dragging the "right edge" handle of a 30°-rotated rect grows it along its local x-axis, not world x-axis.

#### Multi-select group resize

When 2+ nodes are selected and the user grabs a handle on the union AABB, the library scales the whole selection:

```
unionRect = unionAABB(selection.map(getRect))
scale = (newUnionSize) / (oldUnionSize)
for each selected node:
  node.x = unionRect.x + (node.x - unionRect.x) * scale.x
  node.y = unionRect.y + (node.y - unionRect.y) * scale.y
  node.w = node.w * scale.x
  node.h = node.h * scale.y
```

Single `OpBatch` containing all the updates. One undo step reverts the whole group resize.

Aspect-lock with multi-select: applies to the union, so the whole group scales uniformly. Per-node aspect lock isn't a thing — that's just "scale x but not y," which is a different gesture.

#### Constraints

Per node type:

```ts
defineNode({
  type: "rect",
  minSize?: { w: number; h: number }     // default { w: 20, h: 20 }
  maxSize?: { w: number; h: number }     // default unbounded
  aspectRatio?: number                    // optional fixed ratio (e.g. 16/9 for video)
})
```

Clamping is applied in the gesture loop, before commit. Edge handles whose direction would violate the constraint are dimmed visually.

#### Edge interaction during resize

Edges attached to resizing nodes follow automatically — `localOffset` is absolute pixels in node-local coords (§6.1), so endpoints stay at the same offset from the (now-resized) top-left corner. Auto-clip (§6.5) handles the visual smoothing at the new boundary. No special-case code in the edge subsystem; it just works.

Consumers who want proportional-to-node-size endpoint behavior (rare) can wire an extension that listens for `onNodeResize` and rewrites `localOffset` for incident edges proportionally.

#### Programmatic API

```ts
api.resize.beginResize(nodeId: NodeId, handle: ResizeHandle): void
api.resize.updateResize(deltaWorld: Vec2, modifiers?: { lockAspect?: boolean; fromCenter?: boolean }): void
api.resize.endResize(opts?: { commit?: boolean }): void

// Event props on <Canvas>
<Canvas
  onNodeResizeStart={(e) => {}}
  onNodeResize={(e) => {}}              // every frame during drag; debounced if needed
  onNodeResizeEnd={(e) => {}}           // commit fires here with final geometry
/>
```

#### Open

1. **Resize text-bearing nodes that have committed content**: should the autosized height stay locked (user explicitly grew it) or unlock on resize so future text edits re-autosize? Lean: resize locks the height; future edits autogrow only if the user clears the lock via a small "fit content" affordance.
2. **Edge label position during edge endpoint resize**: when a node moves and stretches an edge, should the label re-center at the new midpoint or stay at its arc-length parameter? Lean: stay at arc-length (current §6.11 behavior). Users who want re-center clear `data.labelArcLength`.

---

## 12. Performance Budget

Target on a mid-range laptop:

| Operation                    | Budget       |
|------------------------------|--------------|
| Pan/zoom frame (idle)        | <8ms (120fps)|
| Pan/zoom frame (active drag) | <16ms (60fps)|
| Hit test single point        | <0.2ms       |
| Mount custom React node      | <4ms         |
| Add 1000 nodes to scene      | <50ms        |
| Initial load 10k nodes       | <500ms       |
| Text cache miss (one shape)  | <3ms         |
| Text cache hit + blit        | <0.05ms      |

Profile against these. If a change regresses by >20%, it's a bug.

### 12.1 Perf harness (how we actually measure)

Headless canvas perf testing is genuinely hard — there's no DOM tree to assert against, frame timings vary across machines, and CI runners are noisier than dev laptops. The approach that works in practice (used by tldraw and others):

**Test runner**: Playwright running a headless Chromium build. Each test loads a fixture scene, runs a scripted interaction sequence, and captures frame timings via `performance.now()` between rAF callbacks.

**Fixtures** (checked-in JSON scenes, deterministic):
- `tiny.json` — 50 nodes, smoke test
- `medium.json` — 1k nodes mixed types, the typical workload
- `large.json` — 10k nodes with realistic LOD distribution
- `heavy-custom.json` — 200 custom React nodes (chart-card stubs)
- `edge-dense.json` — 5k edges across 1k nodes

**Scenarios** (each runs against each fixture):
- `pan-idle` — pan the camera for 2 seconds, no drag
- `pan-during-drag` — drag a random node while panning
- `drag-50` — multi-select 50 nodes, drag for 1 second
- `commit-mass` — `store.batch(() => { add 1000 nodes })`, measure commit-to-paint latency
- `hit-test-burst` — 1000 hit-test queries at random points
- `undo-redo-stress` — 100 undo/redo cycles

**Captured metrics per scenario**:
- p50 / p95 / p99 frame time
- worst frame
- total dropped frames (>16ms)
- memory snapshot at end (heap size + bitmap cache size)

**Assertion**: each metric is checked against a baseline file (`perf-baselines.json`, checked in). PR builds compute a diff against baseline; >20% regression on any metric fails CI. Baselines are updated deliberately (PR title includes `[perf-baseline-update]`).

**What this catches**: clear regressions (5x slowdowns on a commit, accidentally-O(n²) algorithms, cache invalidation storms). **What it doesn't catch**: 5% drift, micro-regressions, perf differences across machine classes. Those need manual profiling — `chrome://tracing`, Spector.js, performance.mark/measure spans.

**Known limitations**:
- CI runner timing variance: noisy at ±15-20% even for unchanged code. Set the regression threshold above this floor (20% works).
- Headless Chrome lacks GPU acceleration in many configs: absolute numbers won't match real laptops, but trends do. Compare to baseline, not to the §12 budget targets directly.
- Custom React node mount cost is dominated by React internals; tests use stubbed components (`renderReact: () => <div />`) so we measure the library's overhead, not the test fixture's.

---

## 13. Public API Surface

This is what a developer importing the library actually touches. Designed to feel familiar to react-flow users while being far thinner.

### 13.1 Mount

```tsx
import { Canvas } from "@canvas-harness/react"
import { createCanvasStore } from "@canvas-harness/core"

const store = createCanvasStore({
  initial: initialScene,
  nodeTypes,                  // [defineNode(...), ...]
  edgeTypes,                  // [defineEdge(...), ...]
  clientId: "u-7f3a",         // required only if `sync` is set
  sync: myAdapter,            // optional SyncAdapter for collab (§10.6)
  idGenerator: myIdFn,        // optional
})

<Canvas
  store={store}
  className="..."
  onReady={(api) => { /* imperative handle */ }}
/>
```

### 13.2 Define node / edge types

```ts
import { defineNode, defineEdge } from "@canvas-harness/core"

const StickyNote = defineNode({
  type: "sticky",
  renderCanvas: (ctx, node, env) => { /* paint sticky */ },
  hitTest: (node, p) => p.x >= 0 && p.x <= node.w && p.y >= 0 && p.y <= node.h,
})

const ChartCard = defineNode({
  type: "chart-card",
  renderReact: ChartCardComponent,
  drawPlaceholder: (ctx, node) => { ctx.fillStyle = "#eee"; ctx.fillRect(0, 0, node.w, node.h) },
  getSnapshot: (node) => rasterizeChartToCanvas(node.data),   // optional, for screenshots + LOD
})
```

### 13.3 Store API (imperative)

Quick reference. Depth and rationale in [§10](#10-state-store-react-integration--collab-ready-bones).

```ts
// Mutations — every one is an Op under the hood (§10.2)
store.addNode(node)            store.addEdge(edge)            store.upsertGroup(group)
store.updateNode(id, patch)    store.updateEdge(id, patch)    store.removeGroup(id)
store.removeNode(id)           store.removeEdge(id)

store.batch(() => { ... })     // group ops into one OpBatch — required for atomicity
store.applyOp(op)              // lowest-level entry point (used by sync adapters)
store.applyBatch(batch)        // for remote batches arriving from a sync adapter

// Reads — imperative, do NOT subscribe
store.getNode(id)   store.getEdge(id)   store.getGroup(id)
store.querySpatial({ rect?, point? })

// History
store.undo()   store.redo()   store.clearHistory()

// Persistence (snapshots, not ops)
store.toJSON(): SerializedScene
store.fromJSON(scene: SerializedScene): void

// Subscriptions (framework-agnostic — React uses hooks instead, §13.8)
store.subscribe(event, cb): Unsubscribe
// events: "change" (OpBatch), "selection", "camera", "edit-begin", "edit-end",
//         "presence", "conflict", "sync-error"

// Presence (ephemeral per-client state — cursors, selections, etc.)
store.presence.setLocal(patch)        store.presence.get(clientId)
store.presence.getLocal()              store.presence.getAll()
store.presence.subscribe(cb)
```

### 13.4 Camera

```ts
api.camera.panTo({ x, y, animate? })
api.camera.zoomTo(z, { center?, animate? })
api.camera.fitToContent({ padding?, animate? })
api.camera.fitToSelection({ padding?, animate? })
api.camera.screenToWorld({ x, y })
api.camera.worldToScreen({ x, y })

api.camera.subscribe((c) => { ... })  // signal-style
```

### 13.5 Selection

```ts
api.selection.set([...ids])
api.selection.add(id)
api.selection.remove(id)
api.selection.clear()
api.selection.get(): (NodeId | EdgeId)[]
api.selection.subscribe(cb)

api.selection.beginEdit(nodeId)
api.selection.endEdit()
```

### 13.6 Event hooks (declarative)

Subscribed via props on `<Canvas>`, mirrored by store events:

```tsx
<Canvas
  store={store}
  onNodeClick={(e) => {}}
  onNodeDblClick={(e) => {}}
  onNodeDragStart={(e) => {}}
  onNodeDrag={(e) => {}}
  onNodeDragEnd={(e) => {}}
  onEdgeClick={(e) => {}}
  onEdgeConnect={(e) => {}}        // user drew an edge: validate, accept/reject
  onEdgeReconnect={(e) => {}}
  onSelectionChange={(e) => {}}
  onCameraChange={(e) => {}}
  onPointerMoveWorld={(e) => {}}
  onContextMenu={(e) => {}}
  onKeyDown={(e) => {}}
  onCopy={(e) => {}}
  onPaste={(e) => {}}
  onChange={(batch) => {}}            // every committed OpBatch (§10.2)
  onPresenceChange={(map) => {}}      // remote presence map updated (§10.5)
  onConflict={(e) => {}}              // LWW conflict event from sync (§10.6)
/>
```

Every handler receives a `world` point, the underlying DOM event, and the hit target (node/edge + part).

### 13.7 Imperative helpers (returned from `onReady`)

```ts
type CanvasApi = {
  store: CanvasStore
  camera: CameraApi
  selection: SelectionApi

  exportPNG(opts?: { rect?; scale? }): Promise<Blob>
  exportSVG(opts?: { rect? }): Promise<string>          // optional, expensive
  exportScene(): SerializedScene
  loadScene(scene: SerializedScene): void

  focus(): void           // give canvas keyboard focus
  redraw(): void          // force a redraw next frame
  invalidateNode(id): void
  invalidateEdge(id): void
}
```

### 13.8 React hooks (for components inside `<Canvas>` consumers)

Actual shipped surface (Phase 9). Implemented over `useSyncExternalStore`; the original plan considered `signia-react` but our store hides its atoms behind methods, so the React 18 standard API was cleaner.

```ts
useCanvasStore(): CanvasStore             // store handle (no selector — compose yourself)
useCamera(): CameraState                  // subscribed
useSelection(): (NodeId | EdgeId)[]       // subscribed
useNode(id): Node | undefined             // subscribed — ONE node (stable ref via atoms)
useEdge(id): Edge | undefined             // subscribed — ONE edge
useNodes(predicate?: (n: Node) => boolean): Node[]   // EXPENSIVE — sidebars/minimaps only
useEdges(predicate?: (e: Edge) => boolean): Edge[]   // EXPENSIVE — sidebars only

// Interaction observability (§10.11)
useInteractionState(): InteractionState              // full — fires on any change
useInteractionMode(): InteractionMode                // narrowed — fires only on mode change
useCursor(): InteractionState["pointer"]              // shortcut
useIsMoving(): boolean                                // shortcut, derived
useDraggedIds(): readonly (NodeId | EdgeId)[]         // shortcut
useIsPenActive(): boolean                             // Phase 11 — pointerType === 'pen'

// Presence (collab)
useLocalPresence(): PresenceState
usePresence(): ReadonlyMap<ClientId, PresenceState>   // all remote clients
usePresence(clientId): PresenceState | undefined       // one remote client

// History (Phase 8)
useCanUndo(): boolean
useCanRedo(): boolean
```

`useNode` / `useEdge` are fine inside custom-node React components — they subscribe to one id and only re-render when that node changes. `useNodes` is a perf trap inside per-node components; use it only in panels that legitimately see all nodes.

The interaction hooks are designed to be cheap to call from many places: `useCursor()` in a status bar, `useIsMoving()` to gate a heavy effect, `useInteractionMode()` to disable AI mutations during drag.

> Drift from the original plan: `useCanvasApi` / generic `useCanvasStore<T>(selector)` were dropped — `useCanvasStore()` returns the store, consumers compose selectors at call sites. `useLocalPresence`, `useCanUndo`, `useCanRedo`, `useIsPenActive` were added during phases 8, 9, 11.

### 13.9 Plugin / extension hooks

```ts
defineExtension({
  name: "snap-to-grid",
  onInstall: (api) => { /* subscribe to drag, modify deltas, ... */ },
  onUninstall: () => { ... },
})
```

Extensions are the escape hatch for features the core won't ship: snap, alignment guides, minimap, autosave. The minimap, in particular, is itself a `<Canvas>` reading the same store at a different zoom.

### 13.10 Theming (headless)

The library never reads colors except from one resolver function:

```ts
<Canvas
  store={store}
  theme={(token, ctx) => resolveTokenForMyApp(token, ctx)}
/>
```

Tokens are stable strings (`"node.fill"`, `"edge.stroke"`, `"selection.outline"`). Consumers map them to their design system. Custom nodes call `env.theme(token)` from their render functions.

---

## 14. Open Design Questions

These are *not* settled. Each requires a separate decision once we start implementing.

1. **Renderer architecture**: do we expose a low-level renderer (write your own paint loop) or only the high-level scene API? Probably high-level only for v1; revisit if a customer hits the wall.
2. **OffscreenCanvas in a Worker**: viable for browsers that support it. Real perf win, real complexity (postMessage for every event). Defer.
3. **WebGL/WebGPU backend**: probably never needed if canvas2d hits the perf budget. Door open via an internal renderer interface.
4. **Built-in shape catalog scope**: settled in §3.5. v1 = rect, ellipse, diamond, capsule, text, image, icon, frame. Everything else (sheet, layered-rect, thought-cloud, slide, widget, etc.) ships as a preset package or consumer custom nodes.
5. **Multi-touch / pen / gestures**: scope for v1 = mouse + trackpad + basic touch (pan, pinch-zoom, tap, long-press). Pen pressure: follow-up.
6. **Per-shape clip function for non-rect attachment**: ship rect-clip for everything in v1; add per-shape `clipEdge(localSegment)` if ellipse edges look bad enough to bother.
7. **Serialization version migration**: bump `schemaVersion`, register migration functions, run on `fromJSON`. Standard. But: how do *consumer* custom-node `data` shapes migrate? Probably an opt-in `migrate` on `defineNode`.
8. **Accessibility**: an off-screen DOM mirror of the scene (live region + focusable elements per node) is the standard answer. Defer to v2 but don't paint into a corner.

---

## 15. What's Next

LOC-driven implementation plan. Estimates assume one focused developer; parallelize the renderer + store tracks early when paired. See §11 in conversation history for the full LOC breakdown that backs each line.

| # | Phase                                                           | Weeks | LOC   |
|---|-----------------------------------------------------------------|-------|-------|
| 1 | Scene store + serialization codec + uniform grid + camera       | 1     | ~700  |
| 2 | Canvas renderer skeleton + 8 built-in shapes + viewport cull    | 1     | ~1250 |
| 3 | Hit testing, selection, marquee, basic drag                      | 1     | ~400  |
| 4 | **Edge system** — storage, projection, auto-clip, bezier, polyline, hit testing, creation, reconnect, arrowheads, labels | **2** | **~1800** |
| 5 | Custom node API + DOM overlay + viewport culling for overlay + snapshot plumbing | 1 | ~730 |
| 6 | Rich-text port from `dim0/webui` + output-stage rewrite to offscreen canvas | 1 | ~900 |
| 7 | Edit mode — textarea lifecycle + markdown affordances + empty-content placeholder + custom-editor adapter interface | 1 | ~900 |
| 8 | Op log + undo/redo + presence + SyncAdapter interface (experimental in v1, see §10.6) | 1.5 | ~1380 |
| 9 | React layer — `<Canvas>`, hooks, event bridging                  | 0.5   | ~650  |
| 10| Copy/paste + screenshot/export (PNG; SVG optional)              | 0.5   | ~400  |
| 11| Pointer/pen input layer + gesture recognition + palm rejection  | 1     | ~400  |
| 12| Theming resolver + extension system                              | 0.5   | ~230  |
| 13| **Perf pass + integration bugs + polish**                       | **2** |   —   |
|   | **Total — v1 feature-complete**                                  | **~14 weeks (~3.5 months)** | **~9.4K** |

"Feature-complete" means: all subsystems exist, perf budget hit on the demo scene, fixture-based tests passing. NOT: production-hardened, used by paying customers, all bugs found. Production-hardening typically adds 4–8 months in real life for any library in this space.

### Buffer items already priced in

These are the traps every library in this space hits; the 2-week perf pass at the end accounts for the first one but the others may need their own slots:

- **Perf debugging at the end**: budget will read fine in isolation, then a stress scene reveals 80ms drag frames. Profile-driven iteration on bitmap cache invalidation, overlay diff cost, edge geometry recomputation. 2 weeks priced in.
- **Cross-browser quirks**: PointerEvent semantics, IME composition, clipboard API capability detection, OffscreenCanvas availability. Each is 1-2 days; budget 1 week total across the project.
- **Mobile**: touch + pinch + palm rejection is ~5× the effort of mouse. Easy to deprioritize; painful when a customer demos on iPad. Add 1 week if mobile parity is a v1 requirement.
- **First real consumer**: once dim0 (or whoever) builds on top, missing customization hooks emerge — constrain drag to grid, disable specific gestures, customize selection visuals. Add 1-2 weeks of follow-up after first integration.

### Parallel paths (when paired)

The renderer (phases 2, 5, 6) and the store (phases 1, 8, 9) can fork after phase 1 and converge at phase 4 (edge system needs both). Realistic compressed timeline with two developers: ~8–10 weeks for v1 feature-complete.

### What's intentionally NOT in v1

To keep scope honest:

- No built-in sync transport (consumer plugs in via `SyncAdapter`, §10.6).
- No auto-routing for polyline edges (data shape only).
- No rough.js by default (lazy-loaded only when `style.roughness > 0`).
- No `getSnapshot` polyfill (no `html2canvas`; authors own rasterization).
- No collab text editing inside a single node (edit-mode lock instead, §9.9).
- No accessibility DOM mirror (planned for v2).
- No SVG export polish (PNG ships; SVG is opt-in and lossy for custom React nodes).
- No mobile-specific UI chrome (touch gestures supported, UI is consumer territory).

---

## 16. Implementation Notes (post-Phase-12)

This section captures what the actual implementation does where it diverges from sections 1–15 above. Treat 1–15 as the *design*, this section as the *ground truth*. Sections without a note here ship as documented.

### 16.1 Store internals (§10)

- The store uses [`signia`](https://github.com/tldraw/signia) atoms internally (one per node, one per edge, plus camera / selection / interaction / local-presence atoms) — but the atoms are **not exposed** on the public surface. Subscriptions go through `store.subscribe(event, cb)`. React hooks bridge with `useSyncExternalStore`.
- `change` emission is centralized through an internal `emitChange(batch)` that handles undo-stack bookkeeping. Local batches push onto `undoStack`; remote/history batches don't. Fresh local ops clear `redoStack` (the "branching" rule).
- The undo stack is **capped at 50 batches** (Photoshop-default), evicted FIFO. Configurable via the source constant; not yet a public option.
- `undo()` / `redo()` emit their batch via `emit('change', …)` directly (bypassing `emitChange`) so the inverse doesn't recursively push to the stack. The sync adapter forwards them anyway because it filters by `origin !== 'remote'`, not `origin === 'local'` — undo/redo propagate to peers.
- Conflict event payload: `{ batch, conflicts: { op, field }[] }` (not the doc's bare `{ batch }`). Per-field records let consumers name the property that was overwritten.

### 16.2 Op log (§10.2)

- `group.upsert` carries an optional `prev?: Group` — present when updating, absent when inserting. The inverse is `group.upsert(prev, group)` (swap) when present; `group.remove` when absent.
- `store.toJSON` / `store.fromJSON` are not yet on the store — the codec functions (`toSerialized` / `fromSerialized` in `codec/index.ts`) round-trip scenes; gluing them onto the store + clearing history on load is a Phase-13 task.

### 16.3 Presence (§10.5)

Actual shape:

```ts
store.presence: {
  setLocal(patch: PresencePatch): void
  getLocal(): PresenceState
  get(clientId: ClientId): PresenceState | undefined
  getAll(): ReadonlyMap<ClientId, PresenceState>
  applyRemote(clientId: ClientId, state: PresenceState | null): void  // adapter-facing
}
```

`'presence'` events on the store carry either `{ state: PresenceState }` (set / update) or `{ clientId, removed: true }` (leave). The sync adapter calls `presence.applyRemote(...)` directly; consumer code uses the public quartet.

### 16.4 Sync adapter (§10.6)

Adapter interface ships verbatim from the doc. Notes:

- `attachSync(store, adapter)` throws if `capabilities.causalOrdering` and `capabilities.crdt` are both absent — forces the choice into the open.
- Local **and history** batches forward to `adapter.sendBatch`. Initial implementation forwarded only local; fixed when two-tab testing revealed undos didn't propagate.
- Remote batches enter via `store.applyBatch({ ...batch, origin: 'remote' })`. Conflict detection (`detectConflicts`) walks `update.prev` slices vs current values *before* applying, emits `'conflict'` with the per-field records, then applies (LWW: remote wins).

A first-party adapter ships at `@canvas-harness/sync-broadcast` for single-machine multi-tab demos. It advertises `causalOrdering: true` (BroadcastChannel within one origin delivers in order). Sends a `hello` on attach so existing peers can replay their presence; sends `presence-leave` on `pagehide`.

### 16.5 Interaction state (§10.11)

Modes shipped: `'idle' | 'panning' | 'zooming' | 'dragging' | 'resizing' | 'rotating' | 'marqueeing' | 'creating-shape' | 'creating-edge' | 'reconnecting-edge' | 'editing'`. The doc's plan + two new modes:

- `'rotating'` — pointer over the rotation handle (Phase 4.5).
- `'creating-shape'` — drag-to-create gesture (Phase 11.5). Carries `createDraftRect: WorldRect` + `createTool: string`. The renderer paints the draft rect on the interactive canvas; `<Canvas onCreateDrag>` consumes the rect on commit.

`interaction.pointer` is updated on every pointermove with `pointerType` + `pressure` (Phase 11) so `useCursor()` returns those fields. Per-frame coalescing is on the camera path (rAF); pointer info isn't coalesced (it's one atom write per move and consumers gate their own rendering).

### 16.6 Rendering pipeline (§4)

Bitmap cache for text (§8 / 4.4) ships as documented but with two additional layers added during the Phase-6 perf pass:

1. **Readability skip**: when `fontSize * zoom < 3px`, the renderer skips the cache lookup + drawImage entirely. No human reads sub-3px text; saves the full path on extreme zoom-out.
2. **Content hash memoization**: a bounded `Map<text, fnvHash>` so the cache-key build doesn't re-walk the content string for every visible node. Cleared on font-epoch bump alongside the bitmap LRU.

LOD scale ladder (`resolveRenderScale` in `text/render-scale.ts`):

| Zoom range | Idle scale | Moving scale (× 0.72, clamped) |
|------------|------------|--------------------------------|
| ≤ 0.4      | 0.45       | ≤ 0.22                          |
| 0.4 → 0.7  | 0.85       | ≤ 0.40                          |
| 0.7 → 1.0  | 1.15       | clamped to 0.65                 |
| 1.0 → 1.8  | 1.35       | clamped to 0.65                 |
| > 1.8      | 1 + (z-1.8)·0.2 | clamped to 0.65            |

Zoom is bucketed to 0.1 increments + DPR to 0.25 for the cache key, so tiny float drift from wheel events doesn't bust the cache.

`paintInteractive` paints content during drag/resize (not just shape) so text follows a moving sticky. Fix during Phase 7 review — initial impl only painted the shape.

### 16.7 Edit mode (§9)

Autofit (Phase 7) is **grow-only**, not exact-fit:

- A deliberately-tall node doesn't collapse when content is brief.
- Empty content is a no-op — preserves the user's explicit `h` on add.
- Triggered on commit boundaries only: `addNode` (with content), `commitEdit`, resize-commit. Never per-keystroke.
- `style.autoFit: false` opts out.

Edit-mode tab-through (the doc's "tab through shapes" demo bullet) **deferred to v1.x**; required deciding iteration order (z-order vs spatial vs selection) and the call was made to defer rather than pick prematurely.

The textarea is wrapped in a `display: flex; justify-content: center` container so vertical alignment visually matches the canvas paint (which centers content within `node.h` when it fits). Without the wrapper the textarea would top-align mid-edit and visually "jump" relative to the rendered output.

### 16.8 Copy / paste / export (§11.2, §11.4)

Clipboard:

- MIME dual-write: `application/x-canvas-harness+json` + `text/plain` (concatenated content as fallback for non-canvas paste targets).
- Edges crossing the selection boundary are **dropped on copy** (one endpoint missing from the clipboard would dangle on paste). Edges between two selected nodes are included even if not in the selection itself.
- Default paste offset: `(+20, +20)` world units, configurable via `deserializeClipboard(..., { offset })`.

Export:

- `exportSelection(store, opts)` → `Promise<Blob>` (PNG) at default scale 2× with 16px padding.
- `exportSelectionSvg(store, opts)` → `string`. Markdown content is rendered as **plain text** (markdown syntax stripped); PNG preserves all styling via the bitmap pipeline. v2 candidate for tspan-based styling.
- Both honor `transparentBackground: true` (skip the background `fillRect` / `<rect>`).

### 16.9 Pointer / pen input (§11.3)

Phase 11 ships per the doc plus:

- **Drag-to-create** (a §11-adjacent gesture, not in the original architecture): on a non-select tool, pointerdown on empty surface → drag → release commits a node sized to the dragged rect. Sub-5px drags fall through to `onClick` (preserves tap-to-create with default size). Click suppression via a capture-phase listener so the synthetic click doesn't double-fire.
- **Dbl-click on empty board spawns a text node** (consumer policy in the playground; mirrors the library's built-in dbl-click-on-node → beginEdit).
- **Handle sizes** bumped from 10 → 14px (resize) and 7 → 9px (rotate) to improve touch reach. Minor desktop visual change.

Palm rejection state lives in `core/store/palm-rejection.ts` (not actually a store atom — pure state holder) and is composed into both `usePanZoom` and `useInteractionGesture` so each independently filters during palm-active periods. Grace period: 300ms post pen-up.

### 16.10 AI context + extensions (§11.5, §13.9)

`getContext({ format })` ships in two formats:

- `'markdown'` — full-text prose summary (one line per node + edge). Default. Better for LLM token efficiency than tables.
- `'json'` — structured `SceneContextJson` shape (lighter than `SerializedScene`; omits internal fields).

Options: `selectionOnly?`, `maxNodes?: number` (default 500, sets a `truncated` flag in the JSON shape when hit).

`opSchemas` exports hand-written JSON Schemas keyed by Op variant (`nodeAdd`, `nodeUpdate`, ...). `opSchemasAsAnthropicTools()` returns the same schemas wrapped in the Messages-API `{ name, description, input_schema }` shape — drop into a tool-call request directly. Hand-written (not derived from TS) so the schemas survive runtime evolution without an explicit update step.

Extension surface:

```ts
defineExtension({ name, onInstall(api): void | (() => void) })
installExtension(store, ext): Unsubscribe
installedExtensions(store): string[]   // debug aid

type ExtensionApi = {
  store: CanvasStore
  on<E>(event, cb): Unsubscribe   // auto-unsubscribed on uninstall
}
```

Bare-bones by design. Authors who need paint hooks / shortcut registration today compose them inside `onInstall` against the store directly. A `snap-to-grid` example lives in the playground; the library doesn't ship it (extension *policy* vs *mechanism*).

### 16.11 Package layout

Three published packages plus the playground:

```
@canvas-harness/core             ~7.8K LOC src, ~2.5K LOC tests
@canvas-harness/react            ~2K LOC src, ~270 LOC tests
@canvas-harness/sync-broadcast   ~130 LOC src
examples/playground              ~1.4K LOC consumer demo
```

Total ~10K LOC of library + ~1.4K LOC of consumer demo + ~2.8K LOC of tests = ~14K shipped. The original 10K estimate excluded tests + playground; actuals track within ~15% on the library alone.
