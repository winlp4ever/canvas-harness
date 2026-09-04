# R-RENDER-001: The scene cache invalidates only on document change

**Status:** Accepted · 2026-09-04
**Applies to:** `packages/core/src/render/**`

## Decision
The renderer's paint caches — the offscreen **scene bitmap** (`cacheStale`) and the **sorted-(z,id)
paint-order cache** (`sortedNodeIdsCache`/`sortedEdgeIdsCache`) — MUST be invalidated only in response
to the store's `'change'` event (a committed document mutation), plus deliberate LOD mode-transition
boundaries. Camera, selection, and hover changes MUST NOT invalidate them; a camera change may set
`staticDirty` (re-present) at most. Any field that affects what the static scene paints, or paint
order, MUST reach the renderer through a document Op, not through view/interaction state.

## Why
Pan and zoom fire a `'camera'` event continuously (up to input rate). If a camera change staled the
cache, every pan/zoom frame would re-rasterize the entire visible scene — O(visible nodes) per frame —
and the frame budget collapses. The cache is deliberately **camera-independent**: pan is absorbed by
the `SCENE_CACHE_MARGIN_PX` (256px) margin plus the strip-`extend` tier, and zoom by the scaled-blit
tiers (`scene-cache-math.ts`). Staleing on camera throws all of that away. This invariant is what lets
~10k visible nodes pan interactively, where tools that cache a bitmap per element keyed by zoom must
regenerate every element on a zoom. See `docs/rendering-scene-cache.md` for the full mechanism.

## Consequences
- A new field that changes the static scene's appearance must flow through a typed Op (→ `'change'`),
  or the cache renders stale content (it won't re-rasterize on its own).
- View state (camera, selection, hover, interaction mode) stays off the cache-invalidation path. It
  drives the *interactive* surface and, at most, `staticDirty` (a re-present, not a re-raster).
- LOD mode transitions (motion fast-path, rough auto-disable) may selectively stale the cache **at the
  transition boundary only** (`onInteractionChange`), never per frame.

## Rejected alternatives
- **Invalidate the cache on `'camera'`** — simplest to reason about, but re-rasterizes the whole scene
  on every pan/zoom frame. This is the exact perf cliff the tier system exists to avoid.
- **Per-element bitmap cache keyed by zoom** (Excalidraw's model) — a zoom regenerates every element's
  bitmap; a scene-level, camera-independent cache turns a zoom into one scaled blit instead.

## Verify
`onCameraChange` must not touch `cacheStale`:
```
awk '/const onCameraChange/{f=1} f&&/^  }/{print;exit} f' \
  packages/core/src/render/renderer.ts | grep -q cacheStale && echo VIOLATION || echo OK
```
Expected: `OK`.
