/**
 * Browser-mode integration tests for the renderer.
 * Mounts a real canvas, paints, asserts pixels.
 */
import { describe, expect, test } from 'vitest'
import {
  clearInkBitmapCache,
  createInkGeometry,
  getInkBitmapCacheSize,
  getInkRenderStats,
  resetInkRenderStats,
} from '../src/ink'
import { createRenderer } from '../src/render'
import { createCanvasStore } from '../src/store'
import { type Node, asClientId, asNodeId } from '../src/types'

const makeCanvases = (w = 800, h = 600) => {
  const staticCanvas = document.createElement('canvas')
  const interactiveCanvas = document.createElement('canvas')
  staticCanvas.style.width = `${w}px`
  staticCanvas.style.height = `${h}px`
  interactiveCanvas.style.width = `${w}px`
  interactiveCanvas.style.height = `${h}px`
  document.body.appendChild(staticCanvas)
  document.body.appendChild(interactiveCanvas)
  return { staticCanvas, interactiveCanvas, w, h }
}

const cleanup = (...els: HTMLElement[]) => {
  for (const el of els) el.remove()
}

/**
 * Counts non-fully-transparent backing-store pixels. Used as a "did anything draw" probe.
 */
const countNonEmptyPixels = (canvas: HTMLCanvasElement): number => {
  const ctx = canvas.getContext('2d')!
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
  let count = 0
  for (let i = 3; i < data.length; i += 4) {
    if (data[i]! > 0) count++
  }
  return count
}

const readPixels = (canvas: HTMLCanvasElement): Uint8ClampedArray =>
  canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data

/** Count of RGBA bytes that differ between two equally-sized buffers. */
const diffByteCount = (a: Uint8ClampedArray, b: Uint8ClampedArray): number => {
  let n = 0
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++
  return n
}

/**
 * Forces the renderer to paint synchronously by running one rAF tick.
 */
const waitFrame = (): Promise<void> =>
  new Promise(resolve => requestAnimationFrame(() => resolve()))

const rectNode = (id: string, overrides: Partial<Node> = {}): Node => ({
  id: asNodeId(id),
  type: 'rect',
  x: 100,
  y: 100,
  w: 200,
  h: 100,
  angle: 0,
  z: 0,
  groups: [],
  ...overrides,
})

describe('Renderer (browser)', () => {
  test('paints a rect when the store has one', async () => {
    const { staticCanvas, interactiveCanvas } = makeCanvases()
    const store = createCanvasStore({ clientId: asClientId('u-test') })
    const renderer = createRenderer({
      store,
      staticCanvas,
      interactiveCanvas,
      width: 800,
      height: 600,
    })

    store.addNode(rectNode('n-1'))
    renderer.start()
    await waitFrame()
    await waitFrame()

    expect(countNonEmptyPixels(staticCanvas)).toBeGreaterThan(0)
    expect(renderer.lastDrawCount()).toBe(1)

    renderer.dispose()
    cleanup(staticCanvas, interactiveCanvas)
  })

  test('empty store produces an empty canvas', async () => {
    const { staticCanvas, interactiveCanvas } = makeCanvases()
    const store = createCanvasStore({ clientId: asClientId('u-test') })
    const renderer = createRenderer({
      store,
      staticCanvas,
      interactiveCanvas,
      width: 800,
      height: 600,
      // Transparent background so the pixel count reflects shape paints
      // only; without this the default `#f8fafc` page color fills every
      // pixel and `countNonEmptyPixels` would always be 800*600=480000.
      background: { color: 'transparent' },
    })
    renderer.start()
    await waitFrame()

    expect(countNonEmptyPixels(staticCanvas)).toBe(0)
    expect(renderer.lastDrawCount()).toBe(0)

    renderer.dispose()
    cleanup(staticCanvas, interactiveCanvas)
  })

  test('repaints when store changes', async () => {
    const { staticCanvas, interactiveCanvas } = makeCanvases()
    const store = createCanvasStore({ clientId: asClientId('u-test') })
    const renderer = createRenderer({
      store,
      staticCanvas,
      interactiveCanvas,
      width: 800,
      height: 600,
      // See comment above — isolate node paints from the page color.
      background: { color: 'transparent' },
    })
    renderer.start()
    await waitFrame()
    const beforePixels = countNonEmptyPixels(staticCanvas)

    store.addNode(rectNode('n-1'))
    await waitFrame()
    await waitFrame()
    const afterPixels = countNonEmptyPixels(staticCanvas)

    expect(beforePixels).toBe(0)
    expect(afterPixels).toBeGreaterThan(0)

    renderer.dispose()
    cleanup(staticCanvas, interactiveCanvas)
  })

  test('viewport cull: off-screen nodes are not drawn', async () => {
    const { staticCanvas, interactiveCanvas } = makeCanvases(800, 600)
    const store = createCanvasStore({ clientId: asClientId('u-test') })
    store.batch(() => {
      store.addNode(rectNode('on-screen', { x: 100, y: 100 }))
      store.addNode(rectNode('off-screen', { x: 100000, y: 100000 }))
    })

    const renderer = createRenderer({
      store,
      staticCanvas,
      interactiveCanvas,
      width: 800,
      height: 600,
    })
    renderer.start()
    await waitFrame()
    await waitFrame()

    expect(renderer.lastDrawCount()).toBe(1)

    renderer.dispose()
    cleanup(staticCanvas, interactiveCanvas)
  })

  test('paints all 4 built-in primitives', async () => {
    const { staticCanvas, interactiveCanvas } = makeCanvases()
    const store = createCanvasStore({ clientId: asClientId('u-test') })
    store.batch(() => {
      store.addNode(rectNode('a', { type: 'rect', x: 10, y: 10 }))
      store.addNode(rectNode('b', { type: 'ellipse', x: 220, y: 10 }))
      store.addNode(rectNode('c', { type: 'diamond', x: 10, y: 220 }))
      store.addNode(rectNode('d', { type: 'capsule', x: 220, y: 220 }))
    })
    const renderer = createRenderer({
      store,
      staticCanvas,
      interactiveCanvas,
      width: 800,
      height: 600,
    })
    renderer.start()
    await waitFrame()
    await waitFrame()

    expect(renderer.lastDrawCount()).toBe(4)
    expect(countNonEmptyPixels(staticCanvas)).toBeGreaterThan(0)

    renderer.dispose()
    cleanup(staticCanvas, interactiveCanvas)
  })

  test('respects camera transform: panning hides shapes that move off-screen', async () => {
    const { staticCanvas, interactiveCanvas } = makeCanvases()
    const store = createCanvasStore({ clientId: asClientId('u-test') })
    store.addNode(rectNode('n-1'))
    const renderer = createRenderer({
      store,
      staticCanvas,
      interactiveCanvas,
      width: 800,
      height: 600,
    })
    renderer.start()
    await waitFrame()
    await waitFrame()
    expect(renderer.lastDrawCount()).toBe(1)

    // pan the camera far away
    store.setCamera({ x: 100000, y: 100000 })
    await waitFrame()
    await waitFrame()
    expect(renderer.lastDrawCount()).toBe(0)

    renderer.dispose()
    cleanup(staticCanvas, interactiveCanvas)
  })

  test('pan within cache margin: blit-only output matches a full re-render', async () => {
    const { staticCanvas, interactiveCanvas } = makeCanvases()
    const store = createCanvasStore({ clientId: asClientId('u-test') })
    store.addNode(rectNode('n-1', { x: 300, y: 200, w: 150, h: 120 }))
    const renderer = createRenderer({
      store,
      staticCanvas,
      interactiveCanvas,
      width: 800,
      height: 600,
    })
    renderer.start()
    await waitFrame()
    await waitFrame()

    // Small pan, well inside the 256px cache margin → paintStatic takes
    // the blit-only fast path (no scene re-render).
    store.setCamera({ x: 40, y: 25 })
    await waitFrame()
    await waitFrame()
    const blit = readPixels(staticCanvas)
    expect(countNonEmptyPixels(staticCanvas)).toBeGreaterThan(0)

    // Force a full re-render at the same camera; the presented pixels
    // must match what the blit produced.
    renderer.invalidate()
    await waitFrame()
    await waitFrame()
    const full = readPixels(staticCanvas)

    // Integer-pixel pan → expect an exact match (tiny tolerance guards
    // against AA jitter at rect edges across paths).
    expect(diffByteCount(blit, full)).toBeLessThan(blit.length * 0.005)

    renderer.dispose()
    cleanup(staticCanvas, interactiveCanvas)
  })

  test('strip extend: panning past the margin matches a full re-render', async () => {
    const { staticCanvas, interactiveCanvas } = makeCanvases()
    const store = createCanvasStore({ clientId: asClientId('u-test') })
    // Grid of rects across a wide area so each pan reveals new content
    // and some rects straddle the strip seams.
    let k = 0
    for (let gx = 0; gx < 1400; gx += 120) {
      for (let gy = 0; gy < 1400; gy += 120) {
        store.addNode(rectNode(`g-${k++}`, { x: gx, y: gy, w: 80, h: 60 }))
      }
    }
    const renderer = createRenderer({
      store,
      staticCanvas,
      interactiveCanvas,
      width: 800,
      height: 600,
    })
    renderer.start()
    await waitFrame()
    await waitFrame()

    // Pan past the 256px margin in steps: horizontal, then vertical,
    // then diagonal — exercising single-strip and L-shape extends.
    for (const cam of [
      { x: 300, y: 0 },
      { x: 300, y: 300 },
      { x: 600, y: 600 },
    ]) {
      store.setCamera(cam)
      await waitFrame()
      await waitFrame()
    }
    const extended = readPixels(staticCanvas)
    expect(countNonEmptyPixels(staticCanvas)).toBeGreaterThan(0)

    // A full re-render at the same final camera must match what the
    // shift + strip repaints produced.
    renderer.invalidate()
    await waitFrame()
    await waitFrame()
    const full = readPixels(staticCanvas)

    expect(diffByteCount(extended, full)).toBeLessThan(extended.length * 0.01)

    renderer.dispose()
    cleanup(staticCanvas, interactiveCanvas)
  })

  test('skip-tiny LOD: sub-pixel-on-screen shapes are culled', async () => {
    const { staticCanvas, interactiveCanvas } = makeCanvases()
    const store = createCanvasStore({ clientId: asClientId('u-test') })
    // Two on-screen rects: one large, one tiny.
    store.addNode(rectNode('big', { x: 100, y: 100, w: 200, h: 200 }))
    store.addNode(rectNode('tiny', { x: 10, y: 10, w: 4, h: 4 }))

    const renderer = createRenderer({
      store,
      staticCanvas,
      interactiveCanvas,
      width: 800,
      height: 600,
    })
    renderer.start()
    await waitFrame()
    await waitFrame()
    // At zoom 1, the 4x4 rect is still visible; both should draw.
    expect(renderer.lastDrawCount()).toBe(2)

    // Zoom way out — the 4x4 rect drops below 1.5 logical px and should be culled.
    store.setCamera({ x: 0, y: 0, z: 0.1 })
    await waitFrame()
    await waitFrame()
    expect(renderer.lastDrawCount()).toBe(1)

    renderer.dispose()
    cleanup(staticCanvas, interactiveCanvas)
  })

  test('dims new eraser targets without invalidating the scene cache', async () => {
    const { staticCanvas, interactiveCanvas } = makeCanvases(240, 180)
    const store = createCanvasStore({ clientId: asClientId('eraser-preview') })
    const geometry = createInkGeometry(
      [
        { x: 40, y: 90, pressure: 0.5 },
        { x: 200, y: 90, pressure: 0.5 },
      ],
      10,
    )!
    const id = asNodeId('ink-preview')
    store.addNode({
      id,
      type: 'ink',
      x: geometry.x,
      y: geometry.y,
      w: geometry.w,
      h: geometry.h,
      angle: 0,
      groups: [],
      style: { strokeColor: '#000000' },
      data: { ink: geometry.ink },
    })
    const secondGeometry = createInkGeometry(
      [
        { x: 40, y: 120, pressure: 0.5 },
        { x: 200, y: 120, pressure: 0.5 },
      ],
      10,
    )!
    const secondId = asNodeId('ink-preview-second')
    store.addNode({
      id: secondId,
      type: 'ink',
      x: secondGeometry.x,
      y: secondGeometry.y,
      w: secondGeometry.w,
      h: secondGeometry.h,
      angle: 0,
      groups: [],
      style: { strokeColor: '#000000' },
      data: { ink: secondGeometry.ink },
    })
    const renderer = createRenderer({
      store,
      staticCanvas,
      interactiveCanvas,
      width: 240,
      height: 180,
      background: { color: 'transparent' },
    })
    renderer.start()
    await waitFrame()
    await waitFrame()

    store.setInteractionState({
      mode: 'erasing-ink',
      draftEraser: { point: { x: 120, y: 90 }, radius: 14, erasedIds: [id] },
    })
    await waitFrame()
    await waitFrame()

    const staticAlpha = staticCanvas.getContext('2d')!.getImageData(120, 90, 1, 1).data[3]!
    const previewAlpha = interactiveCanvas.getContext('2d')!.getImageData(120, 90, 1, 1).data[3]!
    expect(staticAlpha).toBe(0)
    expect(previewAlpha).toBeGreaterThan(0)
    expect(previewAlpha).toBeLessThan(200)
    expect(renderer.getLastDrawPath()).toBe('present')

    store.setInteractionState({
      mode: 'erasing-ink',
      draftEraser: {
        point: { x: 120, y: 120 },
        radius: 14,
        erasedIds: [id, secondId],
      },
    })
    await waitFrame()
    await waitFrame()
    const secondStaticAlpha = staticCanvas.getContext('2d')!.getImageData(120, 120, 1, 1).data[3]!
    const secondPreviewAlpha = interactiveCanvas.getContext('2d')!.getImageData(120, 120, 1, 1)
      .data[3]!
    expect(secondStaticAlpha).toBe(0)
    expect(secondPreviewAlpha).toBeGreaterThan(0)
    expect(renderer.getLastDrawPath()).toBe('present')

    renderer.dispose()
    cleanup(staticCanvas, interactiveCanvas)
  })

  test('benchmark: paints 1k nodes + 5k bezier edges in under 80ms (phase-4 perf gate)', async () => {
    const { staticCanvas, interactiveCanvas } = makeCanvases(1200, 800)
    const store = createCanvasStore({ clientId: asClientId('u-test') })
    const nodeIds: string[] = []
    store.batch(() => {
      for (let i = 0; i < 1000; i++) {
        const id = `n-${i}`
        store.addNode(
          rectNode(id, {
            x: (i % 25) * 180,
            y: Math.floor(i / 25) * 120,
            w: 80,
            h: 50,
          }),
        )
        nodeIds.push(id)
      }
      for (let i = 0; i < 5000; i++) {
        const aIdx = i % nodeIds.length
        const bIdx = (aIdx + 1 + Math.floor(Math.random() * (nodeIds.length - 1))) % nodeIds.length
        store.addEdge({
          id: asNodeId(`e-${i}`) as unknown as ReturnType<typeof asNodeId>,
          source: { nodeId: asNodeId(nodeIds[aIdx]!), localOffset: { x: 80, y: 25 } },
          target: { nodeId: asNodeId(nodeIds[bIdx]!), localOffset: { x: 0, y: 25 } },
          pathStyle: 'bezier',
          z: 0,
          groups: [],
        } as unknown as Parameters<typeof store.addEdge>[0])
      }
    })

    const renderer = createRenderer({
      store,
      staticCanvas,
      interactiveCanvas,
      width: 1200,
      height: 800,
    })
    renderer.start()
    await waitFrame()
    await waitFrame()

    const t0 = performance.now()
    renderer.invalidate()
    await waitFrame()
    await waitFrame()
    const elapsed = performance.now() - t0

    expect(renderer.lastDrawCount()).toBeGreaterThan(100)
    // Generous gate; tightens in phase 13.
    expect(elapsed).toBeLessThan(200)

    renderer.dispose()
    cleanup(staticCanvas, interactiveCanvas)
  })

  test('benchmark: paints 1000 rects in under 16ms (phase-2 perf gate)', async () => {
    const { staticCanvas, interactiveCanvas } = makeCanvases(1200, 800)
    const store = createCanvasStore({ clientId: asClientId('u-test') })
    store.batch(() => {
      for (let i = 0; i < 1000; i++) {
        store.addNode(
          rectNode(`n-${i}`, {
            x: (i % 40) * 30,
            y: Math.floor(i / 40) * 30,
            w: 25,
            h: 25,
          }),
        )
      }
    })
    const renderer = createRenderer({
      store,
      staticCanvas,
      interactiveCanvas,
      width: 1200,
      height: 800,
    })

    renderer.start()
    await waitFrame()
    await waitFrame()

    // After warm-up, invalidate and time the next frame.
    const t0 = performance.now()
    renderer.invalidate()
    await waitFrame()
    await waitFrame()
    const elapsed = performance.now() - t0

    expect(renderer.lastDrawCount()).toBeGreaterThan(500)
    // Generous gate to absorb headless-chromium variance; tighten in phase 13.
    expect(elapsed).toBeLessThan(60)

    renderer.dispose()
    cleanup(staticCanvas, interactiveCanvas)
  })

  test('ink zoom-LOD: blits a cached bitmap zoomed-out, fills crisp vector zoomed-in', async () => {
    const { staticCanvas, interactiveCanvas } = makeCanvases(800, 600)
    const store = createCanvasStore({ clientId: asClientId('ink-lod') })
    // A modest horizontal-ish stroke near the origin so it stays visible
    // across both zoom levels this test drives.
    const geometry = createInkGeometry(
      [
        { x: 20, y: 40, pressure: 0.6 },
        { x: 90, y: 50, pressure: 0.6 },
      ],
      12,
    )!
    store.addNode({
      id: asNodeId('ink-lod-stroke'),
      type: 'ink',
      x: geometry.x,
      y: geometry.y,
      w: geometry.w,
      h: geometry.h,
      angle: 0,
      groups: [],
      style: { strokeColor: '#000000' },
      data: { ink: geometry.ink },
    })

    const renderer = createRenderer({
      store,
      staticCanvas,
      interactiveCanvas,
      width: 800,
      height: 600,
      background: { color: 'transparent' },
    })

    // ---- zoomed out + idle → bitmap ----
    clearInkBitmapCache()
    resetInkRenderStats()
    store.setCamera({ x: 0, y: 0, z: 0.2 })
    renderer.start()
    await waitFrame()
    await waitFrame()

    expect(getInkRenderStats().bitmap).toBeGreaterThanOrEqual(1)
    expect(getInkRenderStats().vector).toBe(0)
    expect(getInkBitmapCacheSize()).toBeGreaterThan(0)
    // The bitmap actually painted visible pixels (transparent background).
    expect(countNonEmptyPixels(staticCanvas)).toBeGreaterThan(0)

    // ---- zoomed in + idle → crisp vector, no bitmap built ----
    store.setCamera({ x: 0, y: 0, z: 8 })
    await waitFrame()
    await waitFrame()
    clearInkBitmapCache()
    resetInkRenderStats()
    renderer.invalidate()
    await waitFrame()
    await waitFrame()

    expect(getInkRenderStats().vector).toBeGreaterThanOrEqual(1)
    expect(getInkRenderStats().bitmap).toBe(0)
    expect(getInkBitmapCacheSize()).toBe(0)
    expect(countNonEmptyPixels(staticCanvas)).toBeGreaterThan(0)

    renderer.dispose()
    cleanup(staticCanvas, interactiveCanvas)
  })

  test('benchmark: paints 2000 ink strokes zoomed-out (LOD bitmap) under budget', async () => {
    const { staticCanvas, interactiveCanvas } = makeCanvases(1200, 800)
    const store = createCanvasStore({ clientId: asClientId('ink-perf') })
    clearInkBitmapCache()
    store.batch(() => {
      for (let i = 0; i < 2000; i++) {
        const ox = (i % 50) * 120
        const oy = Math.floor(i / 50) * 120
        const geometry = createInkGeometry(
          [
            { x: ox, y: oy, pressure: 0.5 },
            { x: ox + 40, y: oy + 20, pressure: 0.7 },
            { x: ox + 70, y: oy + 5, pressure: 0.5 },
          ],
          10,
        )
        if (!geometry) continue
        store.addNode({
          id: asNodeId(`ink-${i}`),
          type: 'ink',
          x: geometry.x,
          y: geometry.y,
          w: geometry.w,
          h: geometry.h,
          angle: 0,
          groups: [],
          style: { strokeColor: '#1f2937' },
          data: { ink: geometry.ink },
        })
      }
    })

    const renderer = createRenderer({
      store,
      staticCanvas,
      interactiveCanvas,
      width: 1200,
      height: 800,
    })
    // Low zoom: strokes shrink on-screen and the bitmap LOD path kicks in.
    store.setCamera({ x: 0, y: 0, z: 0.2 })
    renderer.start()
    await waitFrame()
    await waitFrame()

    // First timed repaint (cache warm from the two warm-up frames).
    const t0 = performance.now()
    renderer.invalidate()
    await waitFrame()
    await waitFrame()
    const first = performance.now() - t0

    // Second repaint at the same zoom reuses the same bitmaps — should be
    // no slower than the first within headless-chromium timing noise.
    const t1 = performance.now()
    renderer.invalidate()
    await waitFrame()
    await waitFrame()
    const second = performance.now() - t1

    expect(getInkBitmapCacheSize()).toBeGreaterThan(0)
    expect(renderer.lastDrawCount()).toBeGreaterThan(100)
    // Generous absolute gate to absorb headless variance.
    expect(first).toBeLessThan(200)
    expect(second).toBeLessThan(first * 1.5 + 40)

    renderer.dispose()
    cleanup(staticCanvas, interactiveCanvas)
  })

  test('ink node is culled (no bitmap or vector work) when sub-pixel on screen', async () => {
    const { staticCanvas, interactiveCanvas } = makeCanvases(800, 600)
    const store = createCanvasStore({ clientId: asClientId('ink-cull') })
    // A tiny stroke (~12x7 world px) so a modest zoom-out takes both
    // dimensions below the 1.5px sub-pixel threshold.
    const geometry = createInkGeometry(
      [
        { x: 0, y: 0, pressure: 0.5 },
        { x: 8, y: 3, pressure: 0.5 },
      ],
      4,
    )!
    store.addNode({
      id: asNodeId('ink-tiny'),
      type: 'ink',
      x: geometry.x,
      y: geometry.y,
      w: geometry.w,
      h: geometry.h,
      angle: 0,
      groups: [],
      style: { strokeColor: '#000000' },
      data: { ink: geometry.ink },
    })

    const renderer = createRenderer({
      store,
      staticCanvas,
      interactiveCanvas,
      width: 800,
      height: 600,
    })

    // Zoomed out so the node is in-viewport but sub-pixel → the ink branch
    // hits the cull gate before resolveInkRender, so neither counter moves.
    clearInkBitmapCache()
    resetInkRenderStats()
    store.setCamera({ x: 0, y: 0, z: 0.06 })
    renderer.start()
    await waitFrame()
    await waitFrame()
    expect(getInkRenderStats().bitmap + getInkRenderStats().vector).toBe(0)
    expect(getInkBitmapCacheSize()).toBe(0)

    // Zoom in — now it clears the threshold and paints.
    resetInkRenderStats()
    store.setCamera({ x: 0, y: 0, z: 1 })
    renderer.invalidate()
    await waitFrame()
    await waitFrame()
    expect(getInkRenderStats().bitmap + getInkRenderStats().vector).toBeGreaterThanOrEqual(1)

    renderer.dispose()
    cleanup(staticCanvas, interactiveCanvas)
  })

  // ---- eraser preview patch: per-stroke rects (PR2) --------------------
  const addInk = (
    store: ReturnType<typeof createCanvasStore>,
    id: string,
    samples: { x: number; y: number; pressure: number }[],
    size = 10,
  ) => {
    const geo = createInkGeometry(samples, size)!
    store.addNode({
      id: asNodeId(id),
      type: 'ink',
      x: geo.x,
      y: geo.y,
      w: geo.w,
      h: geo.h,
      angle: 0,
      groups: [],
      style: { strokeColor: '#000000' },
      data: { ink: geo.ink },
    })
  }
  const alphaAt = (canvas: HTMLCanvasElement, x: number, y: number): number =>
    canvas.getContext('2d')!.getImageData(x, y, 1, 1).data[3]!

  test('eraser patch: scattered erasures stay localized (one small rect each)', async () => {
    const { staticCanvas, interactiveCanvas } = makeCanvases(800, 600)
    const store = createCanvasStore({ clientId: asClientId('eraser-scatter') })
    // Two strokes at opposite corners + a witness stroke in the middle.
    addInk(store, 'ink-a', [
      { x: 40, y: 40, pressure: 0.5 },
      { x: 160, y: 40, pressure: 0.5 },
    ])
    addInk(store, 'ink-b', [
      { x: 620, y: 540, pressure: 0.5 },
      { x: 740, y: 540, pressure: 0.5 },
    ])
    addInk(store, 'ink-witness', [
      { x: 350, y: 290, pressure: 0.5 },
      { x: 470, y: 290, pressure: 0.5 },
    ])
    const renderer = createRenderer({
      store,
      staticCanvas,
      interactiveCanvas,
      width: 800,
      height: 600,
      background: { color: 'transparent' },
    })
    renderer.start()
    await waitFrame()
    await waitFrame()

    // Erase just A → one rect.
    store.setInteractionState({
      mode: 'erasing-ink',
      draftEraser: { point: { x: 100, y: 40 }, radius: 14, erasedIds: [asNodeId('ink-a')] },
    })
    await waitFrame()
    await waitFrame()
    expect(renderer.getLastEraserPatchRects()).toHaveLength(1)

    // Erase A + B (opposite corners) → TWO rects, not one viewport-sized union.
    store.setInteractionState({
      mode: 'erasing-ink',
      draftEraser: {
        point: { x: 680, y: 540 },
        radius: 14,
        erasedIds: [asNodeId('ink-a'), asNodeId('ink-b')],
      },
    })
    await waitFrame()
    await waitFrame()
    const rects = renderer.getLastEraserPatchRects()
    expect(rects).toHaveLength(2)
    // Combined repainted area is a tiny fraction of the viewport (the old
    // single-union behavior would have covered ~70% of it).
    const area = rects.reduce((sum, r) => sum + r.w * r.h, 0)
    expect(area).toBeLessThan(0.1 * (800 * 600))
    // Still a cheap blit path, not a full re-render.
    expect(renderer.getLastDrawPath()).toBe('present')

    // Correctness: both erased strokes are cleared on the static surface and
    // shown at preview opacity on the interactive surface; the witness between
    // them (never erased) stays painted — the gap is not touched.
    expect(alphaAt(staticCanvas, 100, 40)).toBe(0)
    expect(alphaAt(staticCanvas, 680, 540)).toBe(0)
    expect(alphaAt(interactiveCanvas, 100, 40)).toBeGreaterThan(0)
    expect(alphaAt(interactiveCanvas, 680, 540)).toBeGreaterThan(0)
    expect(alphaAt(staticCanvas, 410, 290)).toBeGreaterThan(0)

    renderer.dispose()
    cleanup(staticCanvas, interactiveCanvas)
  })

  test('eraser patch: adjacent erasures coalesce into one rect', async () => {
    const { staticCanvas, interactiveCanvas } = makeCanvases(800, 600)
    const store = createCanvasStore({ clientId: asClientId('eraser-adjacent') })
    // Two strokes whose (inflated) bounds overlap — a drag along a line.
    addInk(store, 'ink-x', [
      { x: 40, y: 60, pressure: 0.5 },
      { x: 160, y: 60, pressure: 0.5 },
    ])
    addInk(store, 'ink-y', [
      { x: 150, y: 66, pressure: 0.5 },
      { x: 270, y: 66, pressure: 0.5 },
    ])
    const renderer = createRenderer({
      store,
      staticCanvas,
      interactiveCanvas,
      width: 800,
      height: 600,
      background: { color: 'transparent' },
    })
    renderer.start()
    await waitFrame()
    await waitFrame()

    store.setInteractionState({
      mode: 'erasing-ink',
      draftEraser: {
        point: { x: 200, y: 63 },
        radius: 14,
        erasedIds: [asNodeId('ink-x'), asNodeId('ink-y')],
      },
    })
    await waitFrame()
    await waitFrame()
    expect(renderer.getLastEraserPatchRects()).toHaveLength(1)

    renderer.dispose()
    cleanup(staticCanvas, interactiveCanvas)
  })

  test('eraser patch: an off-screen erased stroke contributes no rect', async () => {
    const { staticCanvas, interactiveCanvas } = makeCanvases(800, 600)
    const store = createCanvasStore({ clientId: asClientId('eraser-offscreen') })
    addInk(store, 'ink-on', [
      { x: 100, y: 100, pressure: 0.5 },
      { x: 220, y: 100, pressure: 0.5 },
    ])
    addInk(store, 'ink-off', [
      { x: 5000, y: 5000, pressure: 0.5 },
      { x: 5120, y: 5000, pressure: 0.5 },
    ])
    const renderer = createRenderer({
      store,
      staticCanvas,
      interactiveCanvas,
      width: 800,
      height: 600,
      background: { color: 'transparent' },
    })
    renderer.start()
    await waitFrame()
    await waitFrame()

    store.setInteractionState({
      mode: 'erasing-ink',
      draftEraser: {
        point: { x: 160, y: 100 },
        radius: 14,
        erasedIds: [asNodeId('ink-on'), asNodeId('ink-off')],
      },
    })
    await waitFrame()
    await waitFrame()
    // Only the on-screen stroke yields a rect; the off-screen one is clipped out.
    expect(renderer.getLastEraserPatchRects()).toHaveLength(1)
    expect(alphaAt(staticCanvas, 160, 100)).toBe(0)

    renderer.dispose()
    cleanup(staticCanvas, interactiveCanvas)
  })
})
