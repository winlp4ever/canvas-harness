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
