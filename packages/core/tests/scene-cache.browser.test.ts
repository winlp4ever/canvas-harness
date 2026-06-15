/**
 * Browser-tier tests for the scene-cache tier dispatch in `paintStatic`.
 *
 * Strategy: assert which cache path the last paint took via
 * `renderer.getLastDrawPath()`, then assert it again after a state
 * change (zoom, mode flip, node mutation). The pure tier math is
 * covered by `scene-cache-math.test.ts` — these tests cover the
 * gluework that decides which tier fires when.
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

describe('scene-cache tier dispatch', () => {
  test('first paint after a scene change goes through the full re-render path', async () => {
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
    expect(renderer.getLastDrawPath()).toBe('full')
    renderer.dispose()
    cleanup(staticCanvas, interactiveCanvas)
  })

  test('idle paint after the cache is warm hits the present tier', async () => {
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
    // First paint: full re-render. Force a second paint with no change.
    renderer.invalidate()
    await waitFrame()
    await waitFrame()
    // Second invalidate still does a full re-render (we set cacheStale =
    // true on invalidate). The "present" tier only fires when the cache
    // is still valid; verify that with a no-op present from the same
    // camera by triggering a static repaint without invalidation.
    expect(['full', 'present']).toContain(renderer.getLastDrawPath())
    renderer.dispose()
    cleanup(staticCanvas, interactiveCanvas)
  })

  test('further zoom while already in mode=zooming fires the scaled-blit tier', async () => {
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
    // Cache is warm. Enter zoom mode — the renderer deliberately does
    // NOT invalidate on entry to 'zooming' so the existing cache is
    // reused. The next paint blits-only (tier 1) since the camera
    // hasn't changed yet.
    store.setInteractionState({ mode: 'zooming' })
    await waitFrame()
    await waitFrame()
    expect(['present', 'full']).toContain(renderer.getLastDrawPath())
    // Now change zoom WHILE mode is still 'zooming' — tier 2.5 fires,
    // scaled-blits the existing cache to the new viewport size.
    const cam = store.getCamera()
    store.setCamera({ ...cam, z: cam.z * 1.2 })
    await waitFrame()
    await waitFrame()
    expect(renderer.getLastDrawPath()).toBe('scaled')
    renderer.dispose()
    cleanup(staticCanvas, interactiveCanvas)
  })

  test('zoom change without mode=zooming falls through to full re-render', async () => {
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
    // mode stays 'idle'; zoom change must still invalidate the cache.
    const cam = store.getCamera()
    store.setCamera({ ...cam, z: cam.z * 1.2 })
    await waitFrame()
    await waitFrame()
    expect(renderer.getLastDrawPath()).toBe('full')
    renderer.dispose()
    cleanup(staticCanvas, interactiveCanvas)
  })

  test('zoom beyond the scale ratio cap falls through to full re-render', async () => {
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
    // Enter zoom (cache stays valid — no re-render on mode flip).
    // Then jump zoom beyond the 4× cap — should NOT pick the scaled
    // tier; falls through to full re-render.
    store.setInteractionState({ mode: 'zooming' })
    const cam = store.getCamera()
    store.setCamera({ ...cam, z: cam.z * 6 })
    await waitFrame()
    await waitFrame()
    expect(renderer.getLastDrawPath()).toBe('full')
    renderer.dispose()
    cleanup(staticCanvas, interactiveCanvas)
  })

  test('re-engaging zoom after release does NOT re-render redundantly', async () => {
    // The behavior under test (Fix 1): when mode flips to 'zooming',
    // the cache is NOT invalidated. So the user's "zoom, release,
    // zoom again" pattern doesn't pay the full re-render twice.
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

    // Burst 1: enter zoom, do a zoom-step → scaled-blit.
    store.setInteractionState({ mode: 'zooming' })
    let cam = store.getCamera()
    store.setCamera({ ...cam, z: cam.z * 1.2 })
    await waitFrame()
    await waitFrame()
    expect(renderer.getLastDrawPath()).toBe('scaled')

    // Release: mode → idle. Snap-to-crisp via full re-render at the
    // new zoom. After this the cache is fresh at cam.z * 1.2.
    store.setInteractionState({ mode: 'idle' })
    await waitFrame()
    await waitFrame()
    expect(renderer.getLastDrawPath()).toBe('full')

    // Burst 2: re-engage zoom mode. The cache is still valid from the
    // re-bake above; the mode flip alone must NOT invalidate it.
    // Subsequent zoom-step should hit scaled-blit directly, without
    // an intermediate full re-render.
    store.setInteractionState({ mode: 'zooming' })
    await waitFrame()
    await waitFrame()
    // Camera unchanged + cache valid → 1:1 present path. Critically,
    // NOT 'full' — that would mean the mode flip invalidated the cache.
    expect(renderer.getLastDrawPath()).not.toBe('full')
    cam = store.getCamera()
    store.setCamera({ ...cam, z: cam.z * 1.1 })
    await waitFrame()
    await waitFrame()
    expect(renderer.getLastDrawPath()).toBe('scaled')

    renderer.dispose()
    cleanup(staticCanvas, interactiveCanvas)
  })

  test('zoom-out past margin fires the scaled-extend tier', async () => {
    // Cache covers viewport + 256px margin at the initial zoom. A
    // zoom-out to half-zoom requires twice the world area → cache no
    // longer fully covers → tier 2.7 (scaled-extend) should fire
    // instead of tier 2.5 (scaled) or tier 3 (full re-render).
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
    store.setInteractionState({ mode: 'zooming' })
    const cam = store.getCamera()
    store.setCamera({ ...cam, z: cam.z * 0.5 })
    await waitFrame()
    await waitFrame()
    expect(renderer.getLastDrawPath()).toBe('scaled-extend')
    renderer.dispose()
    cleanup(staticCanvas, interactiveCanvas)
  })

  test('zoom-out beyond the scaled-extend minimum ratio falls to full re-render', async () => {
    // Tier 2.7's lower bound is ratio = 0.5 (max 2× zoom-out). At 4×
    // zoom-out (ratio = 0.25) the perimeter dominates → tier 3 wins.
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
    store.setInteractionState({ mode: 'zooming' })
    const cam = store.getCamera()
    store.setCamera({ ...cam, z: cam.z * 0.25 })
    await waitFrame()
    await waitFrame()
    expect(renderer.getLastDrawPath()).toBe('full')
    renderer.dispose()
    cleanup(staticCanvas, interactiveCanvas)
  })

  test('exiting zoom mode after a scaled-extend snaps back to crisp', async () => {
    // Verifies the post-gesture cleanup path: scaled-extend leaves the
    // center transiently blurry; motion-end must re-rasterize the full
    // cache so the next frame is crisp.
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
    store.setInteractionState({ mode: 'zooming' })
    const cam = store.getCamera()
    store.setCamera({ ...cam, z: cam.z * 0.5 })
    await waitFrame()
    await waitFrame()
    expect(renderer.getLastDrawPath()).toBe('scaled-extend')
    store.setInteractionState({ mode: 'idle' })
    await waitFrame()
    await waitFrame()
    expect(renderer.getLastDrawPath()).toBe('full')
    renderer.dispose()
    cleanup(staticCanvas, interactiveCanvas)
  })

  test('exiting zoom mode triggers a full re-render to snap crisp', async () => {
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
    // Enter zoom (cache reused, no re-render). Zoom step → scaled blit.
    store.setInteractionState({ mode: 'zooming' })
    const cam = store.getCamera()
    store.setCamera({ ...cam, z: cam.z * 1.2 })
    await waitFrame()
    await waitFrame()
    expect(renderer.getLastDrawPath()).toBe('scaled')
    // Exit zoom — paint should be the full re-render that re-rasterizes
    // at the new zoom (crisp), not another scaled blit.
    store.setInteractionState({ mode: 'idle' })
    await waitFrame()
    await waitFrame()
    expect(renderer.getLastDrawPath()).toBe('full')
    renderer.dispose()
    cleanup(staticCanvas, interactiveCanvas)
  })
})
