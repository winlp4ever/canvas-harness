# Improvements backlog

Living list of perf ideas, polish items, and v1.x/v2 features we've discussed but deliberately deferred. Cross out (or delete) entries as they ship.

Sized in rough effort buckets:

- **XS** ≈ < 1 day
- **S** ≈ 1–3 days
- **M** ≈ 1 week
- **L** ≈ multi-week / architecturally meaningful

---

## Perf — already-identified low-hanging fruit

These came out of specific stress runs; baseline numbers reported are on a mid-range laptop unless noted.

- **Edge-label chip skip below ~24px on-screen** — XS. The current sub-readable skip is font-size-based; an additional check on the label rect's screen size lets us drop the `arcTo × 4 + fill` path (~3µs/label). Recovery: ~5fps at 3k labeled edges.
- **`fillRect` instead of `arcTo` rounded chip when on-screen radius < 1px** — XS. Same trick as the Phase-2 "plain rect when corners sub-pixel" win.
- **Inline edge-label bitmap reference cache on the geometry** — S. Avoids re-hashing the cache key (FNV walk over `content` + concat) on every visible labeled edge per frame. Pin the latest `BitmapCacheEntry` ref directly to the edge geometry; bumps with the version counter. Recovery: ~2µs/label, so ~5fps at 3k.
- **Skip labels during motion** — XS. `interaction.mode === 'panning' | 'zooming'` → skip the chip + blit; resume on idle. Same tradeoff the bitmap cache LOD ladder already makes; a small visual gap during pan in exchange for the headroom.
- **Memoize `text/measure` per (font+content) for full-string measurements** — XS. The existing `measureText` LRU is keyed at a level our edge-label dim calc doesn't always hit cleanly; tighten the key.
- **Adaptive bezier sample count by edge length** — S. Right now bezier edges always sample 32 segments. Short edges (e.g. < 50px world) only need ~8; long edges already get visually-fine 32. Could halve sample cost on dense graphs.
- **OffscreenCanvas Worker for the bitmap-cache rasterization** — L. Rasterizing markdown into a canvas off the main thread would unblock pan/zoom from text rendering. Real perf win; real complexity (postMessage per request, font-load propagation). Defer until profiling shows the rasterization itself dominates a frame.
- **Per-type live-DOM count cap for custom nodes** — M. Today the renderer keeps every in-view custom node mounted as React DOM (see PR #26). Defends against most real scenes, but a pathological case with 500+ custom nodes will hit the browser's compositor-layer cliff (Safari ~256, Chrome ~500) and frame-time degrades. Add an opt-in `lod.maxLiveCount` per node type: when more than N would be live, sort by z desc, take the top N for React, snapshot the rest. Three design knobs to settle before building:
  - **Hysteresis** — once mounted, stay until z drops below `N − margin` (e.g. 110/90). Without it, pan brings new nodes into view → z-ranking shifts → existing live nodes flicker into snapshot. The mount/unmount churn would be worse than no-cap.
  - **Camera-pan interaction** — visibility is camera-dependent, so even with the cap fixed at N, the *set of which N* changes as the user pans. Hysteresis bounds this; the design should pin "no flicker on small pans" as the test.
  - **Snapshot staleness** — for live-data custom nodes (charts hooked to changing stores), the snapshot freezes at capture time. Either restrict the cap to types that opt in via `lod.allowStaleSnapshot: true`, or refresh snapshots on a low-priority schedule (e.g. `requestIdleCallback`). The freeze is fine for static visuals but jarring for changing data.
  - Why per-type, not global: a scene with 50 heavy chart-cards and 200 simple labels has different needs per type. Library shouldn't pick a magic N; consumers know their own node weight. Default `Infinity` preserves current behavior.

---

## Mobile polish (from Phase 11 discussion)

- **Editor anchors to virtual keyboard** — S. When the textarea opens on mobile and the keyboard pushes the viewport up, the editor can scroll out of view. Use `visualViewport` API to reposition / scroll-into-view on focus.
- **Narrow-screen playground layout** — S (playground-only). StylePanel / StressMenu / status bar overlap on phone widths. Collapse to a single bottom drawer below ~600px. Pure consumer-side; not a library concern, but the demo will look bad without it.
- **Real-device testing pass** — M. Touch handle reach (we bumped to 14px), gesture timing on actual iPad / Android, palm rejection accuracy with a Pencil. Plan a half-day on each platform.
- **Tooltips with touch fallback** — XS. None exist yet, but anything that lands in v1.x will need it. Note for the inevitable first tooltip PR.

---

## v1.x — small features deferred during the build

- **Edit-mode tab-through** — S. Tab inside an active edit advances to the next text-bearing shape. Phase 7 deferred this; needed deciding iteration order (z-order vs spatial vs selection). My lean: z-order with spatial-position tie-breaker.
- **`store.fromJSON` integrated with codec** — XS. Codec functions exist; `store.clearHistory` exists; gluing them so `fromJSON(scene)` calls `applyBatch` for every entity + clears history is ~30 LOC.
- **Drag handle on edge label for `labelArcLength` adjust** — S. Currently the field exists; UI to drag the label along its edge would close the loop on the §6.11 spec.
- **`getSnapshot` cache with async support** — M. Phase 5 ships sync-only; async-returning snapshots are no-ops. The cache layer is documented but not built. Useful for consumers shipping heavy custom node React views.
- **First-party `@canvas-harness/sync-yjs` adapter** — M. The interface is proven via BroadcastChannel; a Yjs-backed adapter unlocks real cross-machine collab.
- **Promote `useStyleMemory` to `@canvas-harness/react`** — S. The playground ships a working sticky-style hook (last-used style per node type + edge, persisted to localStorage). Mature it into a library hook with a storage adapter (consumer brings localStorage / async store) and tests. Pair with a generic `arrowDefaults` consumer pattern doc.
- **`Renderer.setTheme` (like `setBackground`)** — XS. Today `<Canvas theme>` prop change tears down + recreates the renderer because `theme` is in the renderer-init effect deps. Pattern-of-record (mirrored from setBackground): keep theme out of init deps, push updates through a `renderer.setTheme(t)` + a separate `useEffect` that calls it on prop change. Memoizing the resolver in the consumer (playground does this) avoids the constant-churn case but the fundamental teardown-on-change is still suboptimal.
- **Theme-driven selection / handle colors** — XS. Today `SELECTION_COLOR` is hardcoded `#3b82f6` in `overlay.ts`. The doc'd token catalog promises `selection.outline` and `handle.fill` / `handle.stroke` but the overlay drawers don't consult `theme`. Pipe theme through `drawSelectionOutline` / `drawResizeHandles` / `drawRotateHandle` / `drawEdgeEndpointHandles` / `drawEdgeMidpointHandle`.
- **Minimap drag-through-shapes overlay (Approach D)** — S. Today the cache only regenerates on commit, so a mid-drag node's minimap dot stays put until pointerup. Approach D paints dragged shapes on top of the cached image at their uncommitted positions (cost O(dragSize), not O(N)). Worth doing when users drag for a long time and expect the minimap to track.
- **`opSchemasAsOpenAITools()` / `…GeminiTools()`** — XS each. Same wrapper pattern as the Anthropic one. ~30 LOC per vendor.
- **Anthropic tool-call demo in the playground** — S. Wires `opSchemasAsAnthropicTools()` to a sandbox key + a chat sidebar so the user can say "add a sticky labeled 'idea'" and watch it land. Pure demo, not a library feature.

---

## v2 candidates (intentionally out of v1)

- **SVG export preserves markdown styling** — M. Requires tspan positioning math; v1 strips syntax for legibility.
- **Concurrent text-in-node collab** — L. Edit-mode lock is the v1 strategy. Needs OT / Y.Text for a true real-time inline-edit collab story.
- **Accessibility DOM mirror** — M. Screen readers + keyboard navigation. Not addressed in v1 at all.
- **Auto-routing for polyline edges** — M. Polyline data shape exists; manhattan routing as an extension.
- **rough.js shipped active for hand-drawn fills** — S. The `style.roughness` field exists; lazy-load wiring is documented but not implemented.
- **Extensions get paint + shortcut hooks** — M. v1 `ExtensionApi` is `{ store, on }`. v2 candidates: `registerCanvasPaint`, `registerShortcut`, `registerToolbarButton`.

---

## Discovered during shipping (paper cuts)

- **`computeLabelDims` line-count heuristic is a guess** — XS. Counting lines as `ceil(naturalWidth / labelWidth)` undercounts on markdown line breaks. Switch to the real `estimateMarkdownContentHeight` once we can absorb its cost (it'd add the layout pass per edge label, currently skipped).
- **Editor mount uses a synthetic Node for edge labels** — S. Works but it's a positioning hack; a cleaner factory contract would take `{ kind, rect, style, content }` directly. Refactor when Phase-7's `EditorAdapterFactory` is re-examined.
- **Conflict event swallows the per-field detail in batched updates** — XS. The current shape is `{ batch, conflicts: { op, field }[] }`; when one batch has multiple conflicting ops the consumer can't tell which property of which op without inspecting. Probably fine; flagging for review.
- **Resize-commit refit refits ALL selected autofit nodes, not just the resized one** — XS. The playground's `commitResize` walks the selection. Cheap to fix by tracking the actually-resized id.
- **Long-press timer doesn't fire on rapid drag-then-pause** — XS. Once a pointermove crosses the `LONG_PRESS_MAX_MOVE_PX` threshold, the timer is cleared and won't re-arm even if the user holds still afterward. Probably the right call; flagging.

---

## How to use this doc

- Add new entries here when you find them; don't lose them in commit messages.
- When an item ships, delete it (don't strikethrough — keeps the list scannable).
- Group by category, not by date. Effort buckets are rough — actual time depends on the day.
- For perf items, include the baseline number when filing so we know what to celebrate.
