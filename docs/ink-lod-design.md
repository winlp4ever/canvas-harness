# Design: Ink zoom-LOD + eraser-patch per-stroke rects

**Status:** Draft (design discussion) · **Date:** 2026-09-02
**Scope:** Two deferred perf items for the built-in `ink` tool (merged in #39, polished in #40):
1. **Zoom level-of-detail** — cheaper stroke rendering when zoomed out, full detail when zoomed in.
2. **Eraser preview patch: per-stroke rects** — stop the dirty-rect union degrading to ~a viewport
   repaint when erased strokes are far apart.

> Grounded in the merged ink code. `file:line` refs are to the tree at time of writing.

---

## 1. Background: how ink renders, and where the cost actually is

- A committed stroke is a canvas-only `ink` node (`ink/node.ts`, `defineNode`). Its perfect-freehand
  **outline is built once at world resolution and cached** per `InkStrokeData`
  (`outlineFromInk`, `ink/geometry.ts`); `drawInkNode` fills it. It rides the **static scene cache**.
- **Pan/zoom are already cheap** because of the cache: pan blits cached pixels; zoom uses the
  scaled-blit tiers (`renderer.ts` `paintStatic` `present`/`scaled`/`scaled-extend`). `getStroke`
  never re-runs per frame.
- **Where the cost lives:** a **full static (re)render** — triggered by any document `'change'`, the
  tier-3 `renderFullCache` on a large zoom step, or the first frame of an interaction — walks every
  visible node and *fills each ink outline* (`traceSmoothInkOutline` + `ctx.fill`). The outline point
  count is **fixed regardless of zoom**, so at low zoom a stroke that's 4px on screen is still filled
  from its full ~N-point outline. On a dense-ink board (thousands of long strokes) a full repaint
  fills millions of outline points that render as a smudge.
- **The gap:** there is no zoom-adaptive simplification today. `inkNodeDef.lod` is
  `{ minZoomForPlaceholder: 0.02 }` with `drawPlaceholder = drawInkNode`, i.e. the "placeholder" is
  the full render. The only zoom LOD ink inherits is the renderer's **sub-pixel cull**
  (`MIN_ON_SCREEN_SIZE_PX 1.5` — drop strokes whose on-screen bbox is <1.5px in both dims).

## 2. The key architectural constraint (differs from tldraw)

tldraw re-renders each shape (SVG/React) **per frame** with viewport culling, so its `forceSolid`
LOD is a per-frame per-shape decision. Here, committed ink is **baked into the static cache**, so:

- **LOD is chosen at cache-rasterization time**, from the zoom in `RenderEnv.zoom` when the cache is
  (re)painted — not per display frame.
- During an active zoom gesture the scaled-blit reuses whatever LOD the cache was baked at; the new
  LOD **takes effect on the next full re-render** (tier-3 or on change). This is the same trade the
  cache already makes for sharpness during zoom, so it's acceptable — but it means:
  - **The perf win is on full repaints of dense scenes** (exactly where it's needed).
  - **Crossing a LOD threshold must force a cache refresh**, or you'd blit stale-detail pixels
    indefinitely. This is the one non-trivial integration point (see §3.4).

`drawInkNode` already receives `env` on every path (static `drawPlaceholder`, drag `renderCanvas`,
export `renderCanvas`), so **no plumbing is needed to get the zoom** — `drawInkNode` just has to read
`env.zoom` (it currently ignores the 3rd arg).

## 3. Ink zoom-LOD

### 3.1 Approaches considered

- **D. Per-node ink bitmap cache at `resolveRenderScale` (reuse the text machinery).** Rasterize each
  stroke's outline once per zoom bucket into a per-node bitmap at the zoom+motion-derived resolution
  (`resolveRenderScale`), key by quantized bucket, and **blit** it — exactly how text already works
  (`text/bitmap-cache.ts` `getOrRenderTextBitmap`). A full scene repaint then blits ink bitmaps instead
  of filling outlines; zoomed out, the bitmap is low-res and cheap; during motion, lower still. Reuses
  `render-scale.ts` + the `bitmap-cache.ts` structure wholesale and **rides the existing cache tiers
  (ADR `R-RENDER-001`) with no bespoke invalidation.** This is the library's proven 10k-node path.
- **B. `forceSolid`: stroked centerline below a zoom cutoff (tldraw's approach).** Below a threshold,
  skip the filled outline and `ctx.stroke()` the stored centerline (`lineWidth ≈ size·zoom`, clamped
  ≥1px, round caps). No `getStroke`, no big fill, no per-node bitmap memory — but a full repaint still
  *strokes* each polyline (not a blit), and it invents its own threshold + cache. A lighter-memory
  alternative to D, not the primary.
- **A. Decimated outline variants (RDP on the polygon), cached per bucket.** Keeps the filled look via
  the vector path; more memory + RDP per level. Superseded by D (a bitmap is simpler and cheaper to blit).
- **C. Centerline decimation (RDP, tolerance ∝ 1/zoom).** An add-on to **B** only, if we take the
  vector route.

### 3.2 Recommendation: **D — per-node ink bitmap cache**

Adopt the pattern text already uses: a per-node ink bitmap at `resolveRenderScale`, keyed by quantized
zoom/dpr buckets, blitted into the scene. Why D over B:
- **DRY / proven:** reuses `render-scale.ts` + the `bitmap-cache.ts` structure — the exact machinery
  behind the perf ceiling — instead of a parallel geometric-LOD.
- **Rides the existing cache design:** it **eliminates the "force a cache re-bake on threshold
  crossing" problem** (old §3.4). Like text, ink just requests the right-bucket bitmap on each scene
  render and inherits the zoom-tier re-render cadence — see `docs/rendering-scene-cache.md` and ADR
  `R-RENDER-001`.
- **Same resolution-LOD for free:** `resolveRenderScale` already gives low-res-when-zoomed-out +
  lower-during-motion.

Keep **B (`forceSolid`)** documented as the fallback if per-node bitmap *memory* ever becomes the
constraint on extreme-density boards.

> §3.3–§3.4 below describe the **B (vector)** route and are retained as the alternative. **The D route
> is what shipped** (`packages/core/src/ink/bitmap-cache.ts`): `resolveInkRender(req)` mirrors
> `getOrRenderTextBitmap` (quantize → `resolveRenderScale` → key → LRU → draw outline via
> `outlineFromInk`) but folds in a crisp **vector fallback** — it returns `{kind:'bitmap',entry}` when
> zoomed-out/moving and `{kind:'vector'}` when zoomed-in and idle (where a blit would be softer than a
> direct fill and few strokes are visible anyway). The renderer's `node.type === 'ink'` branch in
> `paintSceneBody` either blits `entry.canvas` or falls back to `drawInkNode`, reading `zoom`/`isMoving`
> from the render pass. The gate — `isMoving || effectiveScale >= screenScale * BITMAP_CRISP_FACTOR`
> (1.0, so an idle stroke blits only when the bitmap is a genuine downscale — never softer than the
> old analytic fill) — lives in the cache module (one place, independently testable); a large stroke
> shrinks `effectiveScale` toward the size cap in `clampEffectiveScale`, flipping it to vector
> automatically. LRU is insertion-order (O(1) touch; deleted-node bitmaps drain first) capped at
> **4000** (vs text's sort-based 1000 — many strokes visible at low zoom). `getInkRenderStats()` exposes
> the bitmap-vs-vector split for the perf/correctness tests.

#### Thrash guard: the per-pass build budget

A cache **miss** costs *more* than the old vector fill — `createElement('canvas')` + trace + fill +
store, then blit. So a scene with more distinct live keys (`id × zoomBucket × dpr × color × opacity`)
than the cache holds would evict-then-rebuild every stroke every pass: strictly slower than never
caching. The cache only pays off when a built bitmap is *reused* across passes.

`INK_BITMAP_MISS_CEILING` (512) caps how many bitmaps a single paint pass may **build**. The renderer
calls `beginInkFrame()` at the top of every `paintSceneBody` pass to refresh the budget; once spent,
any further miss returns `{kind:'vector'}` — drawn the old way, no alloc, no eviction — instead of
rasterizing. Consequences:

- **Never worse than baseline.** Anything past the budget costs at most the old fill, so a cold or
  over-cap board degrades *to* the pre-LOD cost, never below it. No rebuild-every-frame spiral.
- **Warms gradually.** A huge board caches ≤512 new strokes per pass and fills in over a few passes
  instead of one janky frame — same idea as tldraw's debounced-zoom warm-up.
- **Ordinary boards are unaffected** — fewer than 512 newly-visible strokes per pass all cache at once.
- The budget rate-limits builds but still *allows* them, so stale entries from a previous zoom bucket
  keep cycling out (a plain "stop caching when full" guard would strand you on vector after a zoom).

### 3.3 Alternative-B render logic (`ink/geometry.ts`)

```
drawInkNode(ctx, node, env):
  ink = readInkData(node); if !ink return
  # effective on-screen stroke thickness, in device px
  onScreenWidth = ink.size * min(scaleX, scaleY) * env.zoom          # scaleX/Y = node.w/intrinsicW
  if onScreenWidth < SOLID_WIDTH_PX (≈ 2):
      drawInkCenterline(ctx, node, ink, env)     # forceSolid path (B, optional C)
  else:
      drawInkFilledOutline(ctx, node, ink)       # today's path (outlineFromInk + fill)
```

- **Centerline path (B):** iterate `ink.points` (already node-local), `ctx.lineWidth = max(1,
  onScreenWidth) / (scale · env.zoom)` in local units (so it renders ~1–2 device px), `lineCap =
  lineJoin = 'round'`, `strokeStyle = node.style?.strokeColor`, `ctx.stroke()`. One-point strokes →
  a dot (reuse the existing single-point handling).
- **Decimation (C):** an RDP pass over `ink.points` with tolerance `≈ SOLID_WIDTH_PX / (scale·zoom)`,
  cached in a `WeakMap<InkStrokeData, Map<zoomBucket, Point[]>>` (mirror `outlineCache`). Only build
  a level when first needed.

### 3.4 Threshold, hysteresis, and cache integration (the important part)

- **Bucket the zoom, don't read it raw.** Use `quantizeZoom` (`text/render-scale.ts`) so the LOD
  level changes only at discrete steps. The static cache already re-rasterizes on zoom drift; align
  the LOD buckets with those steps so a stroke doesn't flip solid↔outline every frame mid-gesture.
- **One threshold with hysteresis.** A single `SOLID_WIDTH_PX` boundary will flicker for strokes
  hovering right at it during a zoom. Add a hysteresis band (e.g. switch to solid below 2px, back to
  outline above 3px) keyed off the quantized bucket, not the live zoom.
- **Force a cache refresh when the *scene's* LOD level changes.** Track the current ink-LOD bucket at
  the renderer level; when a zoom step crosses into a new bucket, set `cacheStale = true` on that
  transition (same mechanism the zoom tiers already use) so the cache re-bakes at the new detail. Do
  **not** invalidate per-stroke — it's a scene-level bucket transition, and it only fires on real zoom
  steps, so it's rare.
- **Motion:** while actively zooming (`isMoving`/`'zooming'`), keep blitting the existing cache (no
  LOD re-bake) and only re-bake once motion settles — mirrors tldraw's debounced zoom and the repo's
  existing "full render on the first settled frame" behavior.

### 3.5 Perf expectation

- Dense-ink **full repaints at low zoom**: from "fill every stroke's full outline" to "stroke a short
  (optionally decimated) polyline" — the dominant win. Rough order: a 600-point stroke's ~1200-point
  filled outline becomes a ≤600-point (pre-decimation) or ≤tens-of-points (post-decimation) stroked
  line.
- **No change at normal/high zoom** (above the threshold it's exactly today's path).
- **Sub-pixel cull** still removes the truly-tiny strokes first, so LOD only spans the "small but
  visible" band.
- Guard with the existing perf gates plus a new browser test: a dense-ink scene full-repaint under a
  budget at low zoom.

### 3.6 Risks

- **Visual pop at the threshold.** Mitigated by hysteresis + bucketed zoom; tldraw ships with this and
  it's acceptable. The solid line is tuned to match the filled stroke's apparent weight at the
  crossover.
- **Cache re-bake churn** if the bucket transition fires too often. Mitigated by quantized buckets +
  only re-baking on settle.
- **Colour/opacity parity** between the filled and solid paths — the solid path must read the same
  `strokeColor`/`opacity` so the crossover is invisible in hue.

---

## 4. Eraser preview patch: per-stroke rects (deferred #2 from #40)

**Problem.** `paintEraserPreviewPatch` (`renderer.ts`) unions all pending-erase strokes into **one**
AABB, so erasing two strokes at opposite viewport corners grows the repainted region to ~the whole
viewport and re-scenes it every `erasedIds` change — defeating the dirty-rect goal.

**Design (small, self-contained).** Keep the `bounds: WorldRect[]` we already build (post-#40) and,
instead of `unionRects` into one patch, repaint **each rect independently**:

```
for rect in bounds:
  clipped = intersect(rect, viewport); if empty continue
  device-round clipped (as today), clip + clear + paintSceneBody(painted, excludedNodes)
```

Details:
- **Merge overlapping/near rects first** (a cheap sweep, or reuse `unionRects` pairwise on rects that
  actually overlap) so touching strokes don't double-paint their shared band.
- **Each `paintSceneBody` pass still excludes the full `erasedIds` set** — a stroke may straddle two
  rects, and neighbours inside a rect must stay visible.
- Reuse the **exact device-rounding + `painted`-rect** fix from #40 per rect (so no 1px ring per rect).
- Total repainted area is now proportional to the strokes, not the gap between them. Worst case (many
  overlapping strokes) collapses back toward one union — no regression.

This is ~25–40 lines localized to `paintEraserPreviewPatch`; no new concepts.

---

## 5. Phasing

- **Phase 1 — ink per-node bitmap cache LOD (§3.2, approach D).** _Shipped._ The bulk of the value:
  full repaints blit a per-node bitmap (low-res when zoomed out) instead of re-tracing the outline;
  crisp vector fill retained zoomed-in and for export.
- **Phase 2 — eraser per-stroke rects (§4).** Small, low-risk follow-up; independent of Phase 1.
- **Deferred — `forceSolid` centerline (§3.3–3.4, approach B) + decimation (C).** Retained as the
  fallback if per-node bitmap *memory* ever becomes the constraint on extreme-density boards.

## 6. File touch list

_Phase 1 (shipped):_
- `packages/core/src/ink/bitmap-cache.ts` — **new.** `resolveInkRender` + the crispness gate + the
  per-pass build budget (`INK_BITMAP_MISS_CEILING` / `beginInkFrame`) + insertion-order LRU cache
  (mirror `text/bitmap-cache.ts`); `clearInkBitmapCache`/`getInkBitmapCacheSize`/`getInkRenderStats`
  test aids.
- `packages/core/src/ink/index.ts` — export the new API.
- `packages/core/src/render/renderer.ts` — `node.type === 'ink'` branch in `paintSceneBody` (blit vs
  `drawInkNode`), replicating the sub-pixel + `minZoomForPlaceholder` cull gates; `beginInkFrame()` at
  the top of each pass to refresh the build budget.
- Reused unchanged: `packages/core/src/ink/geometry.ts` (`outlineFromInk`, `traceSmoothInkOutline`),
  `packages/core/src/text/render-scale.ts` (`quantizeZoom`/`quantizeDpr`/`resolveRenderScale`/
  `clampEffectiveScale`).
- Tests: `ink-bitmap-cache.browser.test.ts` — color/opacity key + baking, motion-forces-bitmap,
  large-stroke → vector, LRU eviction/recency at the real cap, and the per-pass build-budget fallback.
  `renderer.browser.test.ts` — zoomed-out-bitmap / zoomed-in-vector correctness gate, sub-pixel cull,
  and a dense-ink (2000 strokes) low-zoom repaint perf gate.

_Phase 2 (follow-up):_
- `packages/core/src/render/renderer.ts` — per-stroke rects in `paintEraserPreviewPatch`.

## 7. Open questions

1. **Threshold value** — `SOLID_WIDTH_PX ≈ 2` device px, or tie it to `MIN_READABLE_FONT_PX`-style
   tuning? Needs a visual pass.
2. **Decimation now or later?** Start without (B only); add C if profiling asks.
3. **Bucket granularity** — reuse `quantizeZoom`'s steps, or a coarser ink-specific bucket to minimize
   cache re-bakes?
4. **Highlighter** (if added later) is `thinning:0` uniform width — the solid path is basically its
   full-detail render already, so LOD is trivial there.

## 8. References

- Codebase: `ink/geometry.ts` (`drawInkNode`, `outlineFromInk`), `render/renderer.ts`
  (`paintStatic` tiers, `paintEraserPreviewPatch`, custom-node LOD ladder), `node-types/define-node.ts`
  (`RenderEnv`), `text/render-scale.ts` (`quantizeZoom`).
- Industry: tldraw `forceSolid` / debounced zoom, RDP simplification, and the static/dynamic split —
  see `docs/pen-tool-design.md` §2.2 and §2.5.
