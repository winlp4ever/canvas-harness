# Implementation Plan — canvas-harness

Concrete playbook for building v1, derived from `ARCHITECTURE.md`. This document is about HOW to build (sequencing, tooling, deliverables, risk ordering). The WHAT (architecture decisions, API surface, data model) lives in `ARCHITECTURE.md`.

---

## 1. Pre-flight decisions

Lock these before phase 0. Each should be picked once and not re-litigated.

| Choice                  | Decision                          | Rationale                                                |
|-------------------------|-----------------------------------|----------------------------------------------------------|
| Monorepo tool           | **pnpm workspaces**               | Fast, simple, what tldraw uses; no extra orchestrator    |
| Library build           | **tsup**                          | Zero-config esbuild wrapper; outputs ESM + CJM + .d.ts   |
| Example app build       | **vite**                          | Standard for React playground                            |
| Unit + integration tests | **vitest**                        | Same config covers both                                  |
| Browser perf tests      | **vitest browser mode** (chromium via Playwright internally) | One tool for everything; no separate harness |
| Lint + format           | **biome**                         | One binary, faster than eslint+prettier, less config     |
| Signal library          | **signia**                        | Extracted from tldraw; exactly the semantics we need     |
| TypeScript              | **strict + noUncheckedIndexedAccess** | Catches the failures that matter at compile time     |
| Node version            | **20 LTS**                        |                                                          |
| License                 | **MIT**                           | Most permissive; matches react-flow/tldraw/Excalidraw    |

These are committed; deviations require an architecture-doc update.

---

## 2. Phase 0 — Repo scaffolding (2 days)

### 2.1 Directory structure

```
canvas-harness/
├─ packages/
│  ├─ core/                          # @canvas-harness/core
│  │  ├─ src/
│  │  │  ├─ index.ts
│  │  │  ├─ types/                   # Node, Edge, Style, Op, Scene
│  │  │  ├─ store/                   # signia-backed store + ops + presence
│  │  │  ├─ render/                  # static/interactive split, frame loop
│  │  │  ├─ shapes/                  # built-in shape draw functions
│  │  │  ├─ edges/                   # projection, clip, sample, hit-test
│  │  │  ├─ text/                    # port of canvas-lite-markdown
│  │  │  ├─ edit/                    # textarea + commit/cancel
│  │  │  ├─ input/                   # pointer events + gestures
│  │  │  ├─ spatial/                 # uniform grid index
│  │  │  ├─ camera/                  # transforms + zoom math
│  │  │  ├─ clipboard/               # copy/paste
│  │  │  ├─ export/                  # PNG/SVG export
│  │  │  ├─ ai/                      # getContext + opSchemas
│  │  │  ├─ extensions/              # extension registry
│  │  │  └─ theme/                   # token resolver
│  │  ├─ tests/                      # vitest unit + browser-mode integration
│  │  ├─ package.json
│  │  ├─ tsconfig.json
│  │  ├─ tsup.config.ts
│  │  └─ vitest.config.ts
│  └─ react/                         # @canvas-harness/react
│     ├─ src/
│     │  ├─ index.ts
│     │  ├─ Canvas.tsx               # the root component
│     │  ├─ hooks/                   # useNode, useCamera, useInteractionState, ...
│     │  └─ events.ts                # event prop bridging
│     ├─ tests/
│     ├─ package.json
│     ├─ tsconfig.json
│     ├─ tsup.config.ts
│     └─ vitest.config.ts
├─ examples/
│  └─ playground/                    # vite + react sandbox
│     ├─ src/main.tsx
│     ├─ package.json
│     └─ vite.config.ts
├─ perf/
│  ├─ fixtures/                      # tiny.json, medium.json, large.json, ...
│  └─ baselines/                     # perf-baselines.json
├─ pnpm-workspace.yaml
├─ biome.json
├─ tsconfig.base.json                # extended by each package
├─ .github/workflows/
│  └─ ci.yml                         # unit + browser-mode perf on every PR
├─ ARCHITECTURE.md
├─ IMPLEMENTATION.md                 # this file
├─ README.md
├─ LICENSE
└─ package.json                      # workspace root scripts
```

### 2.2 Phase 0 deliverable

- `pnpm install` works.
- `pnpm dev` opens the playground at `localhost:5173`, renders "canvas-harness empty" placeholder.
- `pnpm test` runs a smoke vitest in both packages (`expect(true).toBe(true)`).
- `pnpm test:browser` runs a smoke browser-mode test that asserts `document.createElement("canvas")` works.
- `pnpm build` outputs ESM + CJS + `.d.ts` for both packages.
- CI workflow runs all of the above on push/PR.

No library code yet. Pure plumbing.

---

## 3. Phases 1–13 — the build

Each phase ends with a **demo** — a concrete thing you can run that proves the phase works. Demos are checked into `examples/playground/` and added to the perf harness where applicable.

| # | Status | Phase                                                              | Weeks | LOC plan / actual | Demo at end                                                                          |
|---|--------|--------------------------------------------------------------------|-------|-------------------|--------------------------------------------------------------------------------------|
| 1 | ✓ done | Foundations — types + codec + store skeleton + spatial index + camera + ids | 1   | ~700 / ~750  | Programmatic CRUD on a scene via JS console; round-trip `toJSON`/`fromJSON`.        |
| 2 | ✓ done | Renderer + 4 simple shapes (rect/ellipse/diamond/capsule) + viewport cull + static/interactive split | 1 | ~1250 / ~1300 | **Render 1000 rects, pan/zoom 60fps. First perf measurement against §12 budget.**  |
| 3 | ✓ done | Hit testing + selection + marquee + drag + resize handles          | 1     | ~700 / ~750  | Click, multi-select, drag, resize 100 nodes at 60fps. Multi-select group resize works. |
| 4 | ✓ done | **Edge system** — full §6 (storage, projection, auto-clip, bezier, polyline, hit testing, creation, reconnect, arrowheads, labels) | **2** | **~1800 / ~1850** | Connect any two nodes with a bezier edge, drag endpoints, rotate a node and watch endpoint follow. 5k-edge perf test. |
| 5 | ✓ done | Custom-node API + DOM overlay + viewport culling + LOD + `getSnapshot` plumbing | 1 | ~730 / ~780 | 200 custom React `<ChartCard>` nodes mount/unmount at viewport edge without jank.   |
| 6 | ✓ done | Rich text port from `dim0/webui/canvas-lite-markdown.tsx` + output-stage rewrite to offscreen canvas | 1 | ~900 / ~950 | Sticky notes with bold/italic/lists/code render correctly; font-epoch invalidation works on Google Fonts load. |
| 7 | ✓ done | Edit mode — textarea + autosize + Cmd+B/I/U/strike/code/link + auto-list + empty-content placeholder + custom-editor adapter interface | 1 | ~900 / ~1000 | Dbl-click any text-bearing shape, type markdown, Esc to commit. Tab-through deferred to v1.x. |
| 8 | ✓ done | Op log + undo/redo + presence + `SyncAdapter` interface + LWW conflict resolution + experimental flag | 1.5 | ~1380 / ~1220 | Undo/redo across complex multi-node ops works. BroadcastChannel adapter syncs two tabs side-by-side. |
| 9 | ✓ done | React layer — `<Canvas>` + 15 hooks + event prop bridging          | 0.5   | ~650 / ~700  | Playground rewritten to use the React API; idiomatic feel.                          |
| 10 | ✓ done | Copy/paste (MIME dual-write + ID remap) + screenshot/export (PNG + SVG) | 0.5 | ~400 / ~940 | Round-trip copy-paste between canvas instances. `exportSelection` produces a real PNG with optional transparent background. |
| 11 | ✓ done | Pointer/pen input + gesture recognition + palm rejection + drag-to-create + dbl-click-text | 1     | ~400 / ~550 | Two-finger pinch, long-press-drag, pen pressure propagates; drag-to-create on shape tools; touch handle reach. |
| 12 | ✓ done | AI context (`getContext` + `opSchemas`) + InteractionState observability + theming docs + extension system | 0.5 | ~460 / ~530 | One-click "Copy AI context" in the playground; status bar reads `useInteractionState()`; snap-to-grid example extension. |
| 13 | next   | **Perf pass + integration bugs + polish**                          | **2** | —     | All perf budget assertions green in CI. 10k-node demo scene feels smooth. Mobile polish (editor + virtual keyboard, narrow-screen layout, real-device pass). |
|   |        | **Total**                                                          | **~14 weeks** | **~12K LOC actual** (incl. tests + playground) |                                                            |

> Plan estimates excluded tests + playground; actuals include both. The ~6K of pure library + ~2.8K of tests + ~1.5K of playground/sync-broadcast tracks the original estimate within ~15%.

### 3.1.b Implementation deviations from the original plan

These are the calls made during the build that differ from the doc above. Each was an explicit choice point during the corresponding phase.

| Deviation | Phase | Reason |
|-----------|-------|--------|
| `signia-react` considered, then dropped in favor of `useSyncExternalStore` | 9 | Our store hides its atoms behind methods; `signia-react`'s `track()` HOC needs exposed signals to be useful. Standard React 18 API was a cleaner fit and removed a dep. |
| 15 hooks shipped, not 13 | 9 | Added `useLocalPresence`, `useCanUndo`, `useCanRedo`, `useIsPenActive`. Dropped the doc's planned `useCanvasApi` / `useCanvasStore<T>(selector)` — `useCanvasStore()` (zero-arg) returns the store; consumers compose selectors themselves. |
| Drag-to-create + dbl-click-text spawn | 11 | Slipped in as polish after the phase-11 input pass. Excalidraw-style; matched the existing tap-to-create as a fall-through under a 5px threshold. |
| PNG export ~250 LOC, SVG export ~150 LOC, exceeded ~400 target | 10 | Both formats turned out to be worth shipping in v1 since they share the bounding-rect + padding scaffolding. Added `transparentBackground` option to both. |
| `snap-to-grid` ships only as a playground demo, not a library export | 12 | Extension *mechanism* is library; extension *policy* (grid size, snap behavior) is consumer territory. |
| Autofit is grow-only, not exact-fit | 7 | A deliberately-tall node should not collapse when content is brief. Matches tldraw / excalidraw. Empty content is also a no-op so freshly-created shapes preserve their explicit `h`. |
| Edit-mode tab-through deferred to v1.x | 7 | Required deciding iteration order (z-order vs spatial vs selection); user opted to defer rather than pick prematurely. |
| Bitmap-cache key memoization (FNV hash cache) | 6 | Phase-6 perf pass: re-walking content for the cache key on every visible node per frame at zoom 0.08 / 10k nodes was a measurable cost. Added a bounded `Map<text,hash>` cleared on font-epoch bump. |
| Readability skip for text below ~3px on-screen | 6 | Same perf pass — `fontSize * zoom < 3` skips the bitmap lookup + blit entirely. ~50% FPS recovery at extreme zoom-out on markdown-heavy fixtures. |
| Integer edge-cache versions instead of stringified geometry keys | 4 | Phase-4 perf pass: `toFixed(2)` per node attribute multiplied across 5k edges per frame was ~14 string allocs per edge. Replaced with a `Map<EdgeId, number>` version counter bumped on add/update + on incident node update. |
| Rotation handle + gesture | 4.5 | Data model + hit-test math were already in place from phase 3-4 (SAT, rotation-aware AABB); the UI gesture slid in between phases 7 and 8 since it was ~150 LOC and useful for testing rotated-node interactions. |
| `<Canvas>` accepts uncontrolled props only (no `selection={ids}` etc.) | 9 | Store is the controlled source. Controlled-prop variants would create two sources of truth. |
| Conflict event includes per-field record, not just batch | 8 | The doc said `conflict: { batch, conflicts }` — we ship `conflicts: { op, field }[]` so a consumer toast can name the property that was overwritten ("background color was just changed by Alice"). |
| Undo stack capped at 50 (not unlimited or 200) | 8 | Excalidraw is unlimited; Photoshop default is 50. User picked 50 as a memory safety net; size easily configurable later. |

### 3.1 Playground UI deliverables per phase

The playground app at `examples/playground/` is the manual test surface and stress-test harness. It grows alongside the library — each library phase adds the corresponding tray button, style-panel field, or stress fixture. Full architecture in §10; per-phase deliverables:

| Library phase | Playground UI deliverable |
|---------------|---------------------------|
| 1 | (no UI) — `pnpm dev` shows scaffold placeholder; verify store CRUD from JS console |
| 2 | **Build the shell**: top tray with `Rect` tool active + disabled placeholders for other tools, perf overlay (FPS + frame time + node count), stress-test menu (`Create 100 / 1k / 10k rects`, `Clear scene`). Wires up: rect creation, pan, zoom. |
| 3 | Enable `Select` tool. Add marquee. Add style panel (right-bottom), starting with stroke color + background color + stroke width + opacity. Apply to selection. Wire up resize handles + drag. |
| 4 | Enable `Arrow` tool for edge creation. Add edge-specific style fields to the panel: arrowheads (source/target), path style (straight/bezier/polyline). Add `5k-edge` stress fixture. |
| 5 | (no UI change for custom nodes — they're consumer territory) — but add `200 chart-card` stress fixture that registers a synthetic custom node type and loads it |
| 6 | (no tray change) Add font controls to style panel: font family, font size, text align, text color, text style. Add `markdown-heavy` stress fixture (1k notes with multi-line markdown). |
| 7 | Enable `Text` tool (creates an empty text shape that auto-focuses for edit). No new style controls — they already exist from phase 6. |
| 8 | Wire `[Undo]` / `[Redo]` buttons in tray to `store.undo()` / `store.redo()`. Add presence demo: open two tabs, see each other's selections. |
| 9 | No new UI; rewrite playground to consume `<Canvas>` + hooks instead of manual store wiring. Same demo, idiomatic React. |
| 10 | Wire keyboard Cmd+C / Cmd+V / Cmd+X. Add `[Export PNG]` button to tray (exports current viewport). |
| 11 | (no UI) — pointer/pen input is transparent to the playground |
| 12 | Add `[Show context]` debug button that opens a panel showing `getContext({ format: "markdown" })` output for current scene. Add status bar at bottom reading `useInteractionState()` (current mode + cursor world position). |
| 13 | Upgrade perf overlay from minimal to detailed: per-phase frame breakdown, cache hit rates, memory snapshot. Used for profile-driven optimization. |

The playground UI follows the **same exit criteria as library phases** (§3.2): demo runs, no perf regressions. Style controls follow the **progressive principle** — only ship the fields that the library currently supports; expand as features land.

### 3.2 Per-phase exit criteria (the "definition of done")

For each phase, the following must be true before moving on:

1. **Demo runs** in `examples/playground/` and is referenced from the README.
2. **Unit tests cover the public API** with ≥80% line coverage on the phase's new code.
3. **Browser-mode integration tests** exist for any feature that involves the canvas (visual round-trip, hit-test, gesture).
4. **No regressions** against perf baselines for prior phases.
5. **Architecture doc cross-refs are accurate** — if implementation diverged from the spec, update `ARCHITECTURE.md`.

Skipping any of these accumulates technical debt that detonates during phase 13.

---

## 4. Risk ordering — the vertical slice principle

Phase 2 builds the **whole rendering pipeline** (rAF coalescing, static/interactive split, viewport cull, camera transforms) using only the simplest shape primitive. This validates the perf architecture at the earliest possible moment — by end of week 2, we know whether 60fps with 1000 nodes is achievable or whether the design needs revisiting.

Same logic puts edges (the most complex single subsystem) at phase 4 and the perf pass at the end:

- **Phases 1-4** = the architecture's load-bearing pieces. If something fundamental is wrong, we discover it in 5 weeks, not 14.
- **Phases 5-12** = features layered on top. Each is bounded and individually removable in scope.
- **Phase 13** = the optimization budget. Plan for it from day 1, don't hope for it.

If phase 2's perf measurement fails the §12 budget, **stop and re-design before phase 3.** Better to spend a week revisiting the static/interactive split than to spend 12 more weeks building on a broken foundation.

---

## 5. Parallel paths (when paired)

The renderer track (phases 2, 5, 6) and the store track (phases 1, 8) can fork after phase 1 ends, converge at phase 4 (edges need both).

Non-parallelizable:
- **Phase 1** sets up shared types; everything else depends on it.
- **Phase 4 (edges)** touches renderer + store + interaction state; one developer should own it end-to-end to avoid merge conflicts.
- **Phase 13 (perf pass)** needs the whole library complete.

Realistic compressed timeline with two developers: **8-10 weeks** for v1 feature-complete.

---

## 6. MVP options (if v1 scope feels too big)

Two natural cut-points if you want to ship-and-validate before committing to all 14 weeks:

### 6.1 "Architecture proof" — phases 1-4 (5 weeks)

An editable canvas with primitives, edges, and basic interaction. Enough to:
- Demo to stakeholders that the canvas-rendered approach scales.
- Validate the perf story with real users on real hardware.
- Decide whether the remaining 9 weeks of features are worth the investment.

No custom nodes, no rich text, no edit mode, no collab, no export. Just shapes + edges + drag + resize, rendered through the full §4 pipeline.

### 6.2 "Believable demo" — phases 1-7 (9 weeks)

Everything from the architecture proof plus custom nodes, rich text, and edit mode. Has feature parity with "react-flow with canvas rendering and rich text editing" — credible as a product, not just a tech demo.

Missing from v1: collab bones, screenshot/export, pointer/pen polish, AI context, perf pass. All addable later without architectural changes.

---

## 7. What's intentionally NOT in v1 (deferred to v1.x or v2)

To keep scope honest, called out so they don't get smuggled back in:

- **No production-grade sync adapter.** `@canvas-harness/sync-broadcast` ships as a single-machine multi-tab demo and proves the `SyncAdapter` interface; consumer plugs in their own (Yjs, WebSocket) for cross-machine. v2 may ship `@canvas-harness/sync-yjs`.
- **No rough.js shipped active.** Lazy-loaded only when `style.roughness > 0`. Not wired yet.
- **No `getSnapshot` polyfill.** Authors own rasterization (`html-to-image`, hand-built canvas, etc.). The plumbing is in place; only sync snapshots are honored in v1, async returns are no-ops.
- **No concurrent text-in-node collab.** Edit-mode lock instead (§9.9). The local edit lock is enforced; the *remote-edit-blocks-local* path needs the sync adapter to surface peer `editing` presence, which is plumbed but not enforced in v1. v2 candidate.
- **No accessibility DOM mirror.** Planned for v2.
- **No SVG export of markdown styling.** SVG export emits shape geometry + plain text (strips `**bold**`, `==hl==`, etc.); PNG preserves all markdown via the bitmap pipeline. v2 candidate to support tspan-based styling.
- **No mobile-specific UI chrome.** Touch gestures supported (pinch / pan / long-press), handle reach bumped to 14px, but the playground panels don't reflow on narrow screens and the editor doesn't anchor to the virtual keyboard. Real-device polish in Phase 13.
- **No auto-routing for polyline edges.** Polyline is a data shape; routing is an extension.
- **No tab-to-next-shape during edit.** Requires picking an iteration order (z / spatial / selection). Deferred so the choice isn't premature.
- **No store-side `fromJSON` / `clearHistory` integration with the codec.** The codec serializes; `store.clearHistory` exists; gluing the two on `fromJSON` is a small Phase-13 task.
- **No Anthropic-tool execution wired in the playground.** `opSchemasAsAnthropicTools()` returns the schemas; running a live tool-use loop against the canvas is a separate demo, out of v1 scope.

---

## 8. CI workflow (phase 0 deliverable)

`.github/workflows/ci.yml`:

```yaml
name: ci
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm biome check .
      - run: pnpm tsc --noEmit
      - run: pnpm test --run                # vitest unit
      - run: pnpm test:browser --run        # vitest browser mode (chromium)
      - run: pnpm build                      # tsup; verify dist outputs
  perf:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm test:perf --run            # browser-mode perf scenarios
      - run: pnpm perf:assert                # diff against perf/baselines/*.json
```

Perf assertion: each scenario writes `{ scenario, p50, p95, p99, worst }` to a results file; a small script compares to `perf/baselines/*.json` and fails CI if any metric regresses by >20%. Baselines updated deliberately via `[perf-baseline-update]` in a PR title.

---

## 9. The first commit after this doc

Phase 0 is one PR:

1. `pnpm-workspace.yaml`, `package.json`, `pnpm-lock.yaml`
2. `tsconfig.base.json`, package-level `tsconfig.json` files
3. `biome.json`
4. `packages/core/`, `packages/react/` with empty `src/index.ts` that exports nothing meaningful
5. `examples/playground/` with a placeholder React app
6. `perf/` with one fixture and one trivial baseline
7. `.github/workflows/ci.yml`
8. `LICENSE` (MIT), `README.md` (one-paragraph project description + link to ARCHITECTURE.md)

When CI passes on that PR, phase 0 is done and phase 1 starts.

---

## 10. Playground architecture

The playground at `examples/playground/` is **not** part of the library — it's the consumer that exercises every API. Its job is:

1. **Manual testing** during development (a real UI to click around in).
2. **Stress testing** at scale (1k / 5k / 10k node fixtures to validate the perf budget).
3. **Demos** at the end of each phase (every phase's deliverable visible in one place).

It's deliberately Excalidraw-shaped because that UX is what users expect from a graph/canvas editor, and seeing it work proves the library can power that kind of product. Text labels (no icons) to keep scope honest — we're testing the library, not designing icons.

### 10.1 Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│  ┌──────────────────────────────────────────────────┐                │
│  │ [Select] [Rect] [Ellipse] [Diamond] [Text]       │   ← top tray  │
│  │ [Arrow] [Eraser] · [Undo] [Redo] · [Export PNG]  │                │
│  └──────────────────────────────────────────────────┘                │
│                                                                      │
│                                                                      │
│                    [canvas area]                                     │
│                                                                      │
│                                                                      │
│  ┌───────────────┐                            ┌────────────────────┐ │
│  │ Stress test ▾ │                            │ Selection: 3 nodes │ │
│  │  100 rects    │                            │ Stroke color  ▢ ▢ ▢│ │
│  │  1k rects     │                            │ Fill          ▢ ▢ ▢│ │
│  │  10k rects    │                            │ Stroke width  S M L│ │
│  │  5k edges     │                            │ Opacity      [───]│ │
│  │  200 cards    │                            │ Font size     S M L│ │
│  │  Clear        │                            │ Arrow heads   ...  │ │
│  └───────────────┘                            └────────────────────┘ │
│  FPS: 60 · 8.2ms · 1247n · 312e                                      │
│  ↑ perf overlay (always on)                                          │
└──────────────────────────────────────────────────────────────────────┘
```

### 10.2 Components

| Component         | Purpose                                                          | When it ships |
|-------------------|------------------------------------------------------------------|----------------|
| Top tray          | Active-tool selector. Pill-shaped text buttons. Active tool highlighted. | Phase 2 (shell) |
| Stress menu       | Fixture loaders that mass-create nodes/edges via `store.batch`. Synchronous; measures load time. | Phase 2 |
| Perf overlay      | Always-on FPS + frame time + node/edge count. Minimal in early phases, detailed in phase 13. | Phase 2 (minimal) |
| Style panel       | Per-selection style editor. Renders only when selection is non-empty. Shows only fields applicable to the selected types. | Phase 3 (partial), grows per phase |
| Status bar        | `useInteractionState()` driven: current mode + cursor world position + zoom level. | Phase 12 |
| Context debug pane | `getContext({ format: "markdown" })` output for the current scene. Live updates. Useful for verifying AI-context API. | Phase 12 |

### 10.3 State ownership

The playground holds its own UI state in React (`useState` / `useReducer`):

- **Active tool**: `useState<Tool>("select")` — what the user clicked in the top tray.
- **Brush style**: `useState<Partial<Style>>({})` — style defaults applied to newly-created shapes.
- **Style panel visibility**: derived from `useSelection()`.

The **library store** holds only scene state (nodes / edges / camera / selection / presence). Tool state is app concern, NOT scene concern. Keeps the boundary clean — future consumers building their own UI follow the same pattern.

### 10.4 Stress fixtures

Each fixture is a function `(store: CanvasStore) => void` that calls `store.batch(() => { ... addNode ... })`. Fixtures live in `examples/playground/src/fixtures/` and are imported by the stress menu:

| Fixture          | Contents                                              | Stresses                       |
|------------------|-------------------------------------------------------|--------------------------------|
| `100-rects`      | 100 randomly-positioned rects in a 2k × 2k area       | Baseline interactive perf       |
| `1k-rects`       | 1k rects, grid layout                                  | Viewport culling, basic perf    |
| `10k-rects`      | 10k rects, grid layout                                 | Full-perf-budget validation     |
| `5k-edges`       | 1k nodes + 5k random bezier edges                      | Edge hit testing, auto-clip     |
| `200-cards`      | 200 chart-card synthetic custom-node React subtrees    | DOM overlay viewport culling    |
| `markdown-heavy` | 1k notes each with 200 chars of mixed-style markdown   | Text cache, font epoch          |

The stress menu shows generation time after each load (`store.batch` start-to-end) so we can spot regressions visually without consulting CI.

### 10.5 Visual style

Minimal. System fonts. Default browser button styles or a thin custom shell — no design system, no Tailwind, no theming. We are building a graph editor, not its UI library. The playground proves the canvas-harness library works; the canvas-harness library deliberately does NOT ship UI chrome.

If a consumer wants a polished Excalidraw-clone built on canvas-harness, that's a separate package outside this repo.

### 10.6 Cost

| Phase       | Playground LOC added | Cumulative |
|-------------|---------------------|------------|
| Phase 2     | ~250 (shell + perf overlay + first fixture) | 250 |
| Phase 3     | ~200 (style panel skeleton + select tool + marquee) | 450 |
| Phase 4     | ~100 (arrow tool + edge style fields) | 550 |
| Phase 6-8   | ~150 (font controls + text tool + undo/redo wiring) | 700 |
| Phase 10-12 | ~100 (export button + status bar + context pane) | 800 |
| Phase 13    | ~200 (detailed perf overlay) | ~1000 |
| **Total**   | | **~1000 LOC** |

Adds roughly **+0.5 weeks** total to the project, distributed. No separate phase needed.

---

## 11. Decision log (append-only)

Track choices made AFTER this plan is committed, so future devs can read the reasoning:

| Date | Decision | Rationale | Doc updated? |
|------|----------|-----------|--------------|
| 2026-05-18 | All pre-flight decisions in §1 | See `ARCHITECTURE.md` discussion thread | yes |
| 2026-05-19 | Vitest browser mode replaces standalone Playwright | One tool covers unit + perf; Playwright was over-engineering | yes |
| 2026-05-19 | Playground UI built incrementally per phase (option A); progressive style controls; minimal perf overlay (upgrade in phase 13); React state for tool/brush state, library store for scene state | Excalidraw-shaped UI needed for manual + stress testing; distributing keeps each phase's demo coherent and avoids dead time | yes |
| 2026-05-19 | Phase 2 perf wins: rAF-coalesce pan input, sub-pixel shape skip, plain-rect for sub-pixel rounded corners, sub-pixel stroke skip, skip `ctx.save/restore` at opacity=1, lift `scale` out of `drawShape` hot path | Profiling at 20k–30k rects showed `setCamera` per pointermove + per-shape allocations as the bottlenecks | yes |
| 2026-05-19 | Phase 4 perf wins: integer edge-cache versions (replaced `toFixed(2)` string keys), skip sub-pixel arrowheads, adaptive bezier sample stride (1/2/4/8 based on scale) | At 5k edges, string allocs for cache keys dominated. Integer versions cut ~14 allocs/edge/frame | yes |
| 2026-05-19 | Phase 6: keep dim0's tokenizer/layout/measure-cache/font-epoch verbatim, replace `toBlob` + `<img>` output stage with synchronous offscreen-canvas (or detached `HTMLCanvasElement`) bitmap LRU | The async stage was 150 LOC of plumbing that exists to bridge DOM. Canvas-in-canvas can be sync | yes |
| 2026-05-19 | Phase 6 perf wins: readability skip below ~3px on-screen font size; memoize FNV-1a text hash for cache keys | At zoom 0.08 with 10k markdown nodes, the bitmap blit + hash walk dominated. Skip eliminates both | yes |
| 2026-05-19 | Phase 7: plain `<textarea>` (not contenteditable); lock pan/zoom while editing; commit-boundary autofit only (not per-keystroke); autofit grow-only | Markdown is plain text by design; native undo + a11y; camera-lock removes positioning math; grow-only matches tldraw/excalidraw and preserves user intent | yes |
| 2026-05-19 | Phase 7: dbl-click on empty board spawns an editable text node (consumer policy in playground) | Excalidraw-style; mirrors the existing dbl-click-on-node beginEdit behavior | yes |
| 2026-05-19 | Phase 8: undo stack capped at 50 (not unlimited, not 200, not 20) | Photoshop default; balances "user can reach back through an experiment" with bounded memory | yes |
| 2026-05-19 | Phase 8: ship `@canvas-harness/sync-broadcast` alongside the interface | Interface alone is hard to evaluate without a working consumer; two-tab demo makes collab feel real | yes |
| 2026-05-19 | Phase 8: emit `change` for history batches via `emit('change', batch)` bypassing `emitChange` (no undo-stack push) but include history in sync forwarding (`origin !== 'remote'`) | Two distinct concerns: stack bookkeeping vs wire-forwarding. Initially the sync forwarded only `'local'`; that meant undos didn't propagate to peers — bug fixed during testing | yes |
| 2026-05-19 | Phase 9: `useSyncExternalStore` over `signia-react` | `signia-react`'s `track()` HOC needs exposed signals; our store hides atoms behind methods. React 18 standard API is cleaner | yes |
| 2026-05-19 | Phase 9: `<Canvas>` uncontrolled only | Store is the controlled source; controlled props would create two sources of truth | yes |
| 2026-05-19 | Phase 10: drop edges crossing the selection on copy; SVG export ships plain text (no markdown styling) | Matches tldraw/excalidraw cut/paste semantics; SVG `<text>` doesn't support our markdown dialect without tspan positioning math | yes |
| 2026-05-19 | Phase 11: long-press threshold 500ms; palm rejection grace 300ms post pen-up; pen events don't bypass tool gating | Matches tldraw / Procreate-ish; tool-gating exception is a v2 / extension concern | yes |
| 2026-05-19 | Phase 11.5: drag-to-create + dbl-click-text fold into Phase 11 polish | Both were small (~200 LOC) and unblock the "feels like excalidraw" tactile flow | yes |
| 2026-05-19 | Phase 11.5: bump resize handle size 10 → 14px, rotate 7 → 9px | Touch reach (44 / 48px target floor is unreachable without making handles dominate at desktop); 14px is the tldraw value, minor desktop impact | yes |
| 2026-05-19 | Phase 12: getContext markdown is full-text, not tabular; opSchemas ships both raw JSON schemas + Anthropic tool-def wrapper; snap-to-grid is playground demo not library export | LLMs read prose better than tables (wastes tokens); both formats are useful (validate vs tool-use); extension *mechanism* is library, extension *policy* is consumer | yes |

Append on every reversal or refinement. This is the trail when someone asks "why are we using X."
