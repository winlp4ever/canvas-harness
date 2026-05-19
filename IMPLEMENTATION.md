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

| # | Phase                                                              | Weeks | LOC   | Demo at end                                                                          |
|---|--------------------------------------------------------------------|-------|-------|--------------------------------------------------------------------------------------|
| 1 | Foundations — types + codec + store skeleton + spatial index + camera + ids | 1   | ~700  | Programmatic CRUD on a scene via JS console; round-trip `toJSON`/`fromJSON`.        |
| 2 | Renderer + 4 simple shapes (rect/ellipse/diamond/capsule) + viewport cull + static/interactive split | 1 | ~1250 | **Render 1000 rects, pan/zoom 60fps. First perf measurement against §12 budget.**  |
| 3 | Hit testing + selection + marquee + drag + resize handles          | 1     | ~700  | Click, multi-select, drag, resize 100 nodes at 60fps. Multi-select group resize works. |
| 4 | **Edge system** — full §6 (storage, projection, auto-clip, bezier, polyline, hit testing, creation, reconnect, arrowheads, labels) | **2** | **~1800** | Connect any two nodes with a bezier edge, drag endpoints, rotate a node and watch endpoint follow. 5k-edge perf test. |
| 5 | Custom-node API + DOM overlay + viewport culling + LOD + `getSnapshot` plumbing | 1 | ~730 | 200 custom React `<ChartCard>` nodes mount/unmount at viewport edge without jank.   |
| 6 | Rich text port from `dim0/webui/canvas-lite-markdown.tsx` + output-stage rewrite to offscreen canvas | 1 | ~900  | Sticky notes with bold/italic/lists/code render correctly; font-epoch invalidation works on Google Fonts load. |
| 7 | Edit mode — textarea + autosize + Cmd+B/I/U/strike/code/link + auto-list + empty-content placeholder + custom-editor adapter interface | 1 | ~900 | Dbl-click any text-bearing shape, type markdown, Esc to commit. Tab through shapes. |
| 8 | Op log + undo/redo + presence + `SyncAdapter` interface + LWW conflict resolution + experimental flag | 1.5 | ~1380 | Undo/redo across complex multi-node ops works. BroadcastChannel adapter syncs two tabs side-by-side. |
| 9 | React layer — `<Canvas>` + all 13 hooks + event prop bridging      | 0.5   | ~650  | Playground rewritten to use the React API; ergonomic feel matches react-flow.       |
| 10 | Copy/paste (MIME dual-write + ID remap) + screenshot/export (PNG; SVG opt-in) | 0.5 | ~400 | Round-trip copy-paste between canvas instances. `exportSelection` produces a real PNG. |
| 11 | Pointer/pen input + gesture recognition + palm rejection           | 1     | ~400  | Works on trackpad, touchscreen, stylus. Pinch-zoom, long-press-drag, pen pressure propagates. |
| 12 | AI context (`getContext` + `opSchemas`) + InteractionState observability + theming + extension system | 0.5 | ~460 | `getContext({ format: "markdown" })` output snapshot test. Status bar reads `useInteractionState()`. |
| 13 | **Perf pass + integration bugs + polish**                          | **2** | —     | All perf budget assertions green in CI. 10k-node demo scene feels smooth.            |
|   | **Total**                                                          | **~14 weeks** | **~10K LOC** |                                                                          |

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

- **No concrete sync adapter implementation.** Consumer plugs in their own (Yjs, WebSocket, BroadcastChannel adapter is a *test* fixture only). v2 may ship `@canvas-harness/sync-yjs`.
- **No rough.js shipped active.** Lazy-loaded only when `style.roughness > 0`.
- **No `getSnapshot` polyfill.** Authors own rasterization (`html-to-image`, hand-built canvas, etc.).
- **No concurrent text-in-node collab.** Edit-mode lock instead (§9.9). v2 candidate.
- **No accessibility DOM mirror.** Planned for v2.
- **No SVG export polish.** PNG ships; SVG is opt-in and lossy for custom React nodes.
- **No mobile-specific UI chrome.** Touch gestures supported, UI is consumer territory.
- **No auto-routing for polyline edges.** Polyline is a data shape; routing is an extension.

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

Append on every reversal or refinement. This is the trail when someone asks "why are we using X."
