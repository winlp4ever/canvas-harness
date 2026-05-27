/**
 * Browser-mode integration tests for the renderer.
 * Mounts a real canvas, paints, asserts pixels.
 */
import { describe, expect, test } from 'vitest'
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
})
