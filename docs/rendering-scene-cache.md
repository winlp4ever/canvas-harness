# Rendering: the scene cache & repaint-avoidance tiers

**Status:** Reference (explanation) · **Date:** 2026-09-04
**Applies to:** `packages/core/src/render/renderer.ts`, `render/scene-cache-math.ts`, `text/render-scale.ts`

How the renderer serves pan, zoom, and view changes with almost no re-rasterization. This is the
mechanism behind the perf ceiling (10k visible nodes at interactive frame rates). The one *decision*
this rests on is recorded separately in **ADR `R-RENDER-001`** (scene-cache invalidation); this doc
explains the *how*.

---

## 1. Two levels of "dirty"

Everything hinges on separating *what's on screen* from *what's been rasterized*. Two independent
flags (`renderer.ts:208,227`):

- **`staticDirty`** — the static surface needs re-*presenting* (a blit / cheap tier).
- **`cacheStale`** — the offscreen scene bitmap itself is out of date and must be *re-rasterized*.

`drawFrame` (`:285`) honors them independently:
```
if (staticDirty)      { paintStatic();      staticDirty = false }
if (interactiveDirty) { paintInteractive(); interactiveDirty = false }
```

## 2. The invalidation matrix (what sets which flag)

`renderer.ts:1464`–`:1489`:

| Event | `cacheStale` | `staticDirty` | Result |
|---|---|---|---|
| `'change'` (document edit) | **yes** | yes | re-rasterize the scene (+ invalidate the sorted-id cache) |
| `'camera'` (pan / zoom) | **no** | yes | **re-blit only — never re-rasterize** |
| `'selection'` / most interaction | no | interactive only | chrome moves, scene untouched |
| some mode transitions | selective | selective | LOD boundaries (motion fast-path, rough gate) |

The load-bearing line is the **no** on `camera`: **pan and zoom never re-rasterize the scene.** They
only change how the existing bitmap is presented. This invariant is ADR `R-RENDER-001`.

## 3. The offscreen cache is bigger than the screen

`renderFullCache` rasterizes the scene into an offscreen canvas sized **viewport +
`SCENE_CACHE_MARGIN_PX = 256` on every side** (`:79,237`), at a frozen camera
`(cacheCamX, cacheCamY, cacheCamZ)`. The 256px of off-screen content in each direction is what lets
small pans be served with zero work.

## 4. The tier ladder — `paintStatic` (`:939`), cheapest first

When `staticDirty` fires (nearly every camera move), it picks the cheapest path that can serve the
new view:

| Tier | When | Cost | Fn |
|---|---|---|---|
| **1 present** | cache fresh, zoom unchanged, viewport still inside the 256px margin | **pure blit** of a cache sub-rect | `presentStatic` / `cacheSourceOffset` `:768` |
| **2 extend** | panned *past* the margin, cache still overlaps | shift pixels + rasterize only the exposed **L-strip** | `extendCache` |
| **2.5 scaled** | zoom changed mid-gesture, cache covers viewport, ratio ≤ `SCALED_BLIT_MAX_RATIO = 4` | **scaled blit** (browser interpolates) — no raster | `presentStaticScaled` |
| **2.7 scaled-extend** | zoom-out exposing perimeter, ratio ≥ `SCALED_EXTEND_MIN_RATIO = 0.8` | scale-blit center + rasterize **perimeter strips** only | `extendCacheScaled` / `cacheReuseLayout` |
| **3 full** | stale content (edit), big zoom drift, or off-cache jump | **re-rasterize the whole scene** | `renderFullCache` |

Tiers 2.5 / 2.7 are gated on `mode === 'zooming'` (`:964`). So a zoom gesture is **N cheap
scaled-blits during the drag, then exactly one `full` re-render when it settles** (crisp), not N full
repaints.

## 5. The cache math

`scene-cache-math.ts` keeps the tier math pure (unit-testable, no canvas refs):

- **`computeCacheSourceRect(cache, view)`** (`:57`) — the source rect inside the cache for a blit.
  One formula serves both the 1:1 present and the scaled blit; the scale ratio (`cache.camZ /
  view.camZ`) falls out naturally, so tier 1 and tier 2.5 share it. `srcX/srcY` are rounded to integer
  cache pixels (so the blit and the fits-in-cache test agree); `srcW/srcH` stay fractional (the
  browser interpolates).
- **`cacheCoversViewport` / `scaleRatioInBounds`** (`:72,88`) — the tier-2.5 guards.
- **`cacheReuseLayout(cache, view)`** (`:132`) — tier 2.7: where to scale-blit the old pixels in the
  new (lower-zoom) cache, plus the four perimeter strips to redraw. Corners are rounded so the dest
  edge and the strip edge land on the same pixel (else a faint bilinear seam shows in dark themes).

The ratio caps are tuned with explicit perf-vs-blur numbers (`renderer.ts:911`–`:927`): e.g. at
zoom-out ratio 0.8, ~36% of the cache is perimeter → ~3× faster than a full render (kept as the cap);
at 0.7 it's ~51% → only ~2× → falls through to tier 3 instead.

## 6. What keeps the *rare* rasterizations cheap

When a `full` or `extend` raster does run, three mechanisms bound its cost:

- **Viewport culling** — `visibleNodes` broad-phases through the spatial grid (`querySpatial`), then
  walks a pre-sorted `(z,id)` id list with an exact AABB test. Only nodes touching the margin-inflated
  viewport are painted.
- **Sorted-id cache** (`:264,1430`) — the `(z,id)` sort is cached and invalidated **only on
  `'change'`**, never per frame (saves the ~1ms/frame `Array.sort` at 10k nodes).
- **Sub-pixel skip** — nodes whose on-screen bbox is `< MIN_ON_SCREEN_SIZE_PX (1.5)` in both dims are
  dropped entirely (`:359`), so extreme zoom-out paints far fewer nodes.
- **Motion LOD** — during motion, expensive content (text bitmaps via `resolveRenderScale`) rasterizes
  at reduced resolution and rough auto-disables, so even the settling re-render is cheaper. See
  `docs/ink-lod-design.md` for how ink joins this path.

## 7. Worked lifecycle

- **Small pan** (drag within 256px): tier 1 every frame — pure blits, zero raster.
- **Longer pan**: tier 2 — each frame rasterizes only the thin strip that scrolled in.
- **Zoom gesture**: tier 2.5 (or 2.7 on zoom-out) every frame — scaled blits, zero raster — then one
  tier-3 full render when the gesture ends and `mode` leaves `'zooming'`.
- **Edit** (add/move/restyle a node): `'change'` → `cacheStale` → one tier-3 full render, bounded by
  culling + the sorted-id cache.
- **Selecting / hovering**: only the interactive surface repaints; the scene bitmap is never touched.

## 8. Why this beats per-element bitmap caches

Tools that cache a **bitmap per element keyed by zoom** (e.g. Excalidraw's `elementWithCanvasCache`,
per the survey in `docs/pen-tool-design.md` §2.1) must regenerate every element's bitmap when the zoom
changes — a zoom is O(elements) of re-rasterization. Here the cache is **scene-level and
camera-independent**: a zoom is a single scaled blit (O(1) rasterization) during the gesture and one
full render at the end. Pan is absorbed by the margin + strip-extend. So camera motion touches
essentially no rasterization in the common case; only edits do.

## 9. If you edit this subsystem

The invariant that makes all of the above work — **the scene cache must invalidate only on document
`'change'`, never on camera/selection/interaction** — is **ADR `R-RENDER-001`**. Read it before adding
any field that participates in cache invalidation.

## References
- `packages/core/src/render/renderer.ts` — `drawFrame`, `paintStatic`, the tier fns, the
  `onStoreChange` / `onCameraChange` / `onInteractionChange` callbacks.
- `packages/core/src/render/scene-cache-math.ts` — the pure tier math.
- `packages/core/src/text/render-scale.ts` — `resolveRenderScale` / `quantizeZoom` (motion + zoom LOD).
- `docs/ARCHITECTURE.md` (rendering model), `docs/adr/R-RENDER-001-scene-cache-invalidation.md`.
