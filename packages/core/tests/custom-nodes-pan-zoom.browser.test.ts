/**
 * Browser-mode tests for the custom-node-stays-live-during-pan-zoom
 * policy. The renderer used to swap React custom nodes to a canvas
 * snapshot for the duration of any motion gesture; this file pins the
 * new behavior:
 *
 *   - pan / zoom of an in-view custom node: stays in the React overlay,
 *     no snapshot painted into the static cache.
 *   - pan past margin with a newly-entering custom node: that node gets
 *     a one-time canvas snapshot in the strip (so it's visible during
 *     the gesture); the gesture-end full re-render promotes it to the
 *     React overlay.
 *   - drag / resize / rotate / marquee: snapshot path preserved.
 */
import { describe, expect, test } from 'vitest'
import { defineNode } from '../src/node-types'
import { createRenderer } from '../src/render'
import { createCanvasStore } from '../src/store'
import { type Node, type NodeTypeDef, asClientId, asNodeId } from '../src/types'

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

const SNAPSHOT_FILL = '#ff00ff'

/**
 * A custom node type with a React view (truthy) and a distinctive
 * canvas placeholder. The placeholder fills the node rect with a
 * solid magenta — easy to probe via pixel reads.
 */
const customDef: NodeTypeDef = defineNode({
  type: 'test-custom',
  view: {}, // truthy → renderer uses the React overlay path
  drawPlaceholder: (ctx, node) => {
    ctx.fillStyle = SNAPSHOT_FILL
    ctx.fillRect(0, 0, node.w, node.h)
  },
})

const customNode = (id: string, overrides: Partial<Node> = {}): Node => ({
  id: asNodeId(id),
  type: 'test-custom',
  x: 100,
  y: 100,
  w: 200,
  h: 100,
  angle: 0,
  z: 0,
  groups: [],
  ...overrides,
})

/** Reads a pixel from a canvas and returns its RGBA tuple. */
const readPixel = (
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
): [number, number, number, number] => {
  const ctx = canvas.getContext('2d')!
  const dpr = canvas.width / Number.parseFloat(canvas.style.width || '0' || '1')
  const px = Math.round(x * dpr)
  const py = Math.round(y * dpr)
  const data = ctx.getImageData(px, py, 1, 1).data
  return [data[0]!, data[1]!, data[2]!, data[3]!]
}

const isMagenta = (rgba: [number, number, number, number]): boolean =>
  rgba[0] > 200 && rgba[1] < 50 && rgba[2] > 200 && rgba[3] > 0

describe('custom nodes during pan/zoom (live DOM policy)', () => {
  test('pan within margin keeps in-view node mounted; no canvas snapshot', async () => {
    const { staticCanvas, interactiveCanvas } = makeCanvases()
    const store = createCanvasStore({ clientId: asClientId('u-test'), nodeTypes: [customDef] })
    const renderer = createRenderer({
      store,
      staticCanvas,
      interactiveCanvas,
      width: 800,
      height: 600,
      background: { color: 'transparent' },
    })
    store.addNode(customNode('cn-1'))
    renderer.start()
    await waitFrame()
    await waitFrame()
    // First paint: tier 3 full render. Custom node should land in
    // the React overlay set, NOT painted as snapshot in the cache.
    expect(renderer.getOverlaySet()).toContain('cn-1')
    expect(isMagenta(readPixel(staticCanvas, 150, 150))).toBe(false)

    // Enter pan mode — flush the tier-3 re-render that the mode flip
    // triggers (cache invalidation). Then a small camera move within
    // the cache margin hits tier 1; overlay set unchanged; no snapshot.
    store.setInteractionState({ mode: 'panning' })
    await waitFrame()
    await waitFrame()
    store.setCamera({ ...store.getCamera(), x: 30, y: 30 })
    await waitFrame()
    await waitFrame()
    expect(renderer.getLastDrawPath()).toBe('present')
    expect(renderer.getOverlaySet()).toContain('cn-1')
    expect(isMagenta(readPixel(staticCanvas, 150, 150))).toBe(false)
    renderer.dispose()
    cleanup(staticCanvas, interactiveCanvas)
  })

  test('zoom in/out keeps in-view custom node mounted; no canvas snapshot', async () => {
    const { staticCanvas, interactiveCanvas } = makeCanvases()
    const store = createCanvasStore({ clientId: asClientId('u-test'), nodeTypes: [customDef] })
    const renderer = createRenderer({
      store,
      staticCanvas,
      interactiveCanvas,
      width: 800,
      height: 600,
      background: { color: 'transparent' },
    })
    store.addNode(customNode('cn-1'))
    renderer.start()
    await waitFrame()
    await waitFrame()
    expect(renderer.getOverlaySet()).toContain('cn-1')
    expect(isMagenta(readPixel(staticCanvas, 150, 150))).toBe(false)

    // Enter zoom + step zoom. Should hit tier 2.5 (scaled present);
    // overlay set unchanged; no snapshot painted.
    store.setInteractionState({ mode: 'zooming' })
    const cam = store.getCamera()
    store.setCamera({ ...cam, z: cam.z * 1.2 })
    await waitFrame()
    await waitFrame()
    expect(renderer.getLastDrawPath()).toBe('scaled')
    expect(renderer.getOverlaySet()).toContain('cn-1')
    renderer.dispose()
    cleanup(staticCanvas, interactiveCanvas)
  })

  test('pan past margin: in-view node stays live, newly-entering node gets a snapshot', async () => {
    const { staticCanvas, interactiveCanvas } = makeCanvases()
    const store = createCanvasStore({ clientId: asClientId('u-test'), nodeTypes: [customDef] })
    const renderer = createRenderer({
      store,
      staticCanvas,
      interactiveCanvas,
      width: 800,
      height: 600,
      background: { color: 'transparent' },
    })
    // Node 1: in-view at gesture start. Node 2: far enough offscreen
    // that even cache margin doesn't cover it.
    store.addNode(customNode('cn-1', { x: 100, y: 100 }))
    store.addNode(customNode('cn-2', { x: 1500, y: 100 }))
    renderer.start()
    await waitFrame()
    await waitFrame()
    expect(renderer.getOverlaySet()).toContain('cn-1')
    expect(renderer.getOverlaySet()).not.toContain('cn-2')

    // Step 1: enter pan mode. The mode flip invalidates the cache → a
    // full re-render fires at the current camera, baking cn-1 into
    // the overlay (and the cache content excludes the offscreen cn-2).
    store.setInteractionState({ mode: 'panning' })
    await waitFrame()
    await waitFrame()
    expect(renderer.getLastDrawPath()).toBe('full')
    expect(renderer.getOverlaySet()).toContain('cn-1')
    expect(renderer.getOverlaySet()).not.toContain('cn-2')

    // Step 2: move camera past the cache margin. Tier 2 (pan-extend)
    // fires; the strip render brings cn-2 into the visible viewport
    // → snapshot painted into the strip. cn-1 (already React-mounted)
    // is NOT re-snapshotted. Overlay set unchanged by the strip.
    store.setCamera({ ...store.getCamera(), x: 900, y: 0 })
    await waitFrame()
    await waitFrame()
    expect(renderer.getLastDrawPath()).toBe('extend')
    expect(renderer.getOverlaySet()).toContain('cn-1')
    expect(renderer.getOverlaySet()).not.toContain('cn-2')
    // cn-2 sits at world (1500, 100), camera at (900, 0) → screen
    // (600, 100). Sample inside its body.
    expect(isMagenta(readPixel(staticCanvas, 650, 150))).toBe(true)
    renderer.dispose()
    cleanup(staticCanvas, interactiveCanvas)
  })

  test('gesture end promotes newly-entered nodes from snapshot to live overlay', async () => {
    const { staticCanvas, interactiveCanvas } = makeCanvases()
    const store = createCanvasStore({ clientId: asClientId('u-test'), nodeTypes: [customDef] })
    const renderer = createRenderer({
      store,
      staticCanvas,
      interactiveCanvas,
      width: 800,
      height: 600,
      background: { color: 'transparent' },
    })
    store.addNode(customNode('cn-1', { x: 100, y: 100 }))
    store.addNode(customNode('cn-2', { x: 1500, y: 100 }))
    renderer.start()
    await waitFrame()
    await waitFrame()

    // Build up to the same state as the prior test: cn-1 mounted,
    // cn-2 visible in the cache as a snapshot but not yet in overlay.
    store.setInteractionState({ mode: 'panning' })
    await waitFrame()
    await waitFrame()
    store.setCamera({ ...store.getCamera(), x: 900, y: 0 })
    await waitFrame()
    await waitFrame()
    expect(renderer.getOverlaySet()).not.toContain('cn-2')

    // End the gesture — tier 3 full render fires, overlay set
    // recomputed. cn-2 (now in view) gets promoted to the React
    // overlay. cn-1 has scrolled off-screen (camera.x=900, cn-1 at
    // world x=100 → screen x=-800) so it falls out of the overlay set.
    store.setInteractionState({ mode: 'idle' })
    await waitFrame()
    await waitFrame()
    expect(renderer.getLastDrawPath()).toBe('full')
    expect(renderer.getOverlaySet()).toContain('cn-2')
    expect(renderer.getOverlaySet()).not.toContain('cn-1')
    renderer.dispose()
    cleanup(staticCanvas, interactiveCanvas)
  })

  test('marquee keeps in-view custom node mounted; no canvas snapshot', async () => {
    // Marquee is a view-level motion (selection rect on the interactive
    // surface, camera doesn't move, no node geometry changes), so it
    // belongs with pan/zoom in the live-DOM group — NOT with drag.
    const { staticCanvas, interactiveCanvas } = makeCanvases()
    const store = createCanvasStore({ clientId: asClientId('u-test'), nodeTypes: [customDef] })
    const renderer = createRenderer({
      store,
      staticCanvas,
      interactiveCanvas,
      width: 800,
      height: 600,
      background: { color: 'transparent' },
    })
    store.addNode(customNode('cn-1'))
    renderer.start()
    await waitFrame()
    await waitFrame()
    expect(renderer.getOverlaySet()).toContain('cn-1')
    expect(isMagenta(readPixel(staticCanvas, 150, 150))).toBe(false)

    // Enter marquee mode. Cache stays valid (no mode-flip invalidate
    // for marquee), no strip render fires (camera unchanged). Custom
    // node must stay live in the overlay — no snapshot painted into
    // the static cache.
    store.setInteractionState({ mode: 'marqueeing' })
    await waitFrame()
    await waitFrame()
    expect(renderer.getOverlaySet()).toContain('cn-1')
    expect(isMagenta(readPixel(staticCanvas, 150, 150))).toBe(false)
    renderer.dispose()
    cleanup(staticCanvas, interactiveCanvas)
  })

  test('drag still produces canvas snapshot (preserved behavior)', async () => {
    const { staticCanvas, interactiveCanvas } = makeCanvases()
    const store = createCanvasStore({ clientId: asClientId('u-test'), nodeTypes: [customDef] })
    const renderer = createRenderer({
      store,
      staticCanvas,
      interactiveCanvas,
      width: 800,
      height: 600,
      background: { color: 'transparent' },
    })
    store.addNode(customNode('cn-1', { x: 100, y: 100 }))
    renderer.start()
    await waitFrame()
    await waitFrame()
    expect(renderer.getOverlaySet()).toContain('cn-1')

    // Enter drag mode. The full re-render fires (mode flip
    // invalidates cache); custom node should now be snapshot, NOT in
    // the overlay set.
    store.setInteractionState({ mode: 'dragging' })
    await waitFrame()
    await waitFrame()
    expect(renderer.getOverlaySet()).not.toContain('cn-1')
    expect(isMagenta(readPixel(staticCanvas, 150, 150))).toBe(true)
    renderer.dispose()
    cleanup(staticCanvas, interactiveCanvas)
  })
})
