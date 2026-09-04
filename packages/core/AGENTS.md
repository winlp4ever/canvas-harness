# AGENTS.md — @canvas-harness/core

Additive to the root `AGENTS.md` (commands, conventions, cross-cutting gotchas). This file is the
map + invariants for the engine. Framework-agnostic; no React. Single barrel entry `src/index.ts`.

## Subsystem map

| Dir | Owns | Entry |
|---|---|---|
| `store/` | The document: reactive scene (signia atoms per node/edge/group), typed-Op mutations, spatial-index sync, undo/redo, selection, camera, interaction, presence, conflict | `store/store.ts` (`createCanvasStore`) |
| `render/` | Dual-surface frame loop, scene cache, culling, LOD dispatch | `render/renderer.ts` (`createRenderer`), `render/frame-loop.ts` |
| `edges/` | Edge geometry: project, auto-route, sample, clip, arrowhead, versioned geometry cache, draw | `edges/cache.ts`, `edges/draw.ts` |
| `text/` | Markdown tokenize → layout → measure → offscreen bitmap cache; font/math epoch invalidation | `text/bitmap-cache.ts`, `text/layout.ts`, `text/font-epoch.ts` |
| `node-types/` | Custom-node registration + LOD/lifecycle contract | `node-types/define-node.ts` (`defineNode`) |
| `ai/` | LLM scene context (md/JSON) + Op schemas as Anthropic tools | `ai/context.ts` (`getContext`), `ai/op-schemas.ts` |
| `hit-test/` | Pointer→entity resolution | `hit-test/` |
| `spatial/` | `UniformGrid` broad-phase + AABBs | `spatial/` |
| `camera/` | World↔screen math; zoom clamps (`MIN_ZOOM 0.05`, `MAX_ZOOM 16`) | `camera/index.ts` |
| `codec/` | Scene ↔ wire serialization + schema migrators | `codec/index.ts` (`toSerialized`/`fromSerialized`, `registerMigrator`) |
| `clipboard/` `export/` `assets/` | copy/paste · PNG/SVG export · image/svg decode+sanitize | resp. dirs |
| `extension/` `ids/` `types/` | plugin escape-hatch · id gen (`${clientId}-${counter}`) · all domain types | resp. dirs |

**Store (`store/store.ts`)** owns per-entity + id-list atoms, camera/selection/frameOrder/interaction/
presence atoms, two `UniformGrid` indexes, `EdgeGeometryCache`, `incidentEdges`, `edgeVersions`,
`topZ`/`bottomZ` watermarks, the node-type registry, the batch buffer, and `undo/redoStack` (cap 50).
Siblings: `interaction.ts`, `presence.ts`, `conflict.ts`, `inverse-op.ts`, `sync.ts`, `palm-rejection.ts`.

**Public API:** `createCanvasStore` (`store/store.ts:117`); `addNode`/`updateNode`/`removeNode`/`addEdge`/
`addImage`/`addSvg`/`batch`/`undo`/`redo` (store methods, `store.ts:494+`); branded ids
`asNodeId`/`asEdgeId`/… (`types/primitives.ts:10`); `getContext` (`ai/context.ts:47`); `configureFonts`
(`text/defaults.ts`); `defineNode`
(`node-types/define-node.ts:177`).

## Rendering hot path (`src/render/`)

- `frame-loop.ts` — rAF-coalesced; schedules only when dirty.
- `renderer.ts` — **static surface** (committed scene, `paintStatic` :881, 6 cache tiers,
  `SCENE_CACHE_MARGIN_PX 256`) vs **interactive surface** (`paintInteractive` :1111 — drag/resize/
  selection chrome/marquee/draft edge). Cache math in `scene-cache-math.ts`.
- Culling: `visibleNodes` :1345 / `visibleEdges` :1097 — `store.querySpatial` broad-phase → sorted-id
  walk → exact AABB.
- LOD dispatch :493–538 (sub-pixel skip → placeholder → canvas fallback → React overlay); thresholds
  `define-node.ts:73`. **DOM overlay itself lives in the React layer** — core only maintains
  `overlaySet` and fires `onOverlayChange(mountedIds)` (:209, :557). `render/overlay.ts` is selection
  *chrome*, not the overlay.

## Invariants — read before editing render/ or store/

- **Sorted-(z,id) paint cache** (`renderer.ts:262`) invalidates ONLY on `'change'` (:1374), never on
  camera/selection/interaction (:1370) — same rule as the scene bitmap, see ADR `R-RENDER-001` +
  `docs/rendering-scene-cache.md`. Paint order = `a.z - b.z || id asc` (:1340, :1092) — keep the
  tie-break stable or z-order flickers.
- **Save/restore elision.** Built-in drawers must set every ctx state they depend on and assume no
  defaults (`define-node.ts:44`) — NO per-node save/restore. Only *custom* `renderCanvas`/
  `drawPlaceholder` are wrapped (:530, :964). Frame paint saves only when opacity≠1 (`paint-frame.ts:33`).
  The rough-misregister translate (:436, mirror :1165) is unpaired — must translate back manually.
- **Integer edge cache versions** (`edges/cache.ts:107`) — pure int compare; the old `toFixed(2)`
  string version cost ~5–8ms at 2k edges (:112). Store bumps via `bumpEdgeVersion` on edge add/update
  AND on incident `node.update` (`store.ts:158,321`). Drag bypasses the cache (:1188) — version
  doesn't bump mid-gesture.
- **Font/math epoch** (`text/font-epoch.ts`, a dependency-free leaf) bumps an int on `document.fonts`
  settle **and on `configureFonts()`**; subscribers pull (measure clears its cache, renderer repaints),
  and the epoch is folded into the bitmap-cache key. Add any font-affecting field to that key or you get
  stale glyphs. **All font resolution goes through the `getFontStack`/`getFontSizePx`/`getLineHeightPx`
  getters in `text/defaults.ts`** (the runtime registry `configureFonts()` mutates) — never read the
  deprecated `FONT_*_MAP` constants, or an override won't reach measurement/paint/export.
- **Sub-pixel / readability skips**: `MIN_ON_SCREEN_SIZE_PX 1.5` (:85), `MIN_READABLE_FONT_PX 3` (:93) —
  skipping bypasses path build + the bitmap FNV walk. Don't remove without measuring.
- **`undefined` → `null` normalization** (`store.ts:429`, `slicePrev` :445): `undefined` is dropped by
  `JSON.stringify`, so a field clear would silently no-op over sync/undo. Both patch and prev slices are
  normalized. Clearing a field = set it to `null`, not `undefined`.
- **z watermarks monotonic + central** (`store.ts:169`): `topZ` only ++, `bottomZ` only --, maintained in
  `applyOpInternal` so remote/explicit z stay consistent; negative z is first-class. `bringForward`/
  `sendBackward` binary-search non-target z (:91).
- **Op log / undo** (`types/op.ts`, 9 variants): `node.update`/`edge.update` carry `prev` slices so the
  inverse needs no diff. Only `origin:'local'` batches enter the undo stack (`store.ts:244`); undo/redo
  replay with `origin:'history'` and bypass `emitChange` (:774,:788). Conflict detection runs BEFORE
  apply, LWW wins (:745).
- **`removeNode` cascades incident edges first, same batch** (`store.ts:539`). Skipping the cascade
  orphans edges in the spatial index.

## Tests

`vitest run` (unit) and `vitest run -c vitest.browser.config.ts` (browser, chromium/playwright,
`tests/**/*.browser.test.{ts,tsx}`). Rendering/geometry that needs a real canvas goes in browser tests.
