/**
 * Browser-mode tests for the arrow-tool defaults — covers the
 * factory-form `style` and `data` knobs added to fix the
 * double-undo bug when consumers want to stamp domain fields onto
 * arrow-drawn edges at creation time.
 *
 * Strategy: mount <Canvas tool="arrow"> with two prepared nodes,
 * dispatch real PointerEvents to simulate a drag from node A to
 * node B, then read the resulting edge from the store.
 */
import { type CanvasStore, asClientId, asNodeId, createCanvasStore } from '@canvas-harness/core'
import { StrictMode, act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, test } from 'vitest'
import { Canvas, CanvasProvider } from '../src'
import type { ArrowToolDefaults } from '../src/internal/use-arrow-tool'

// Silence the "testing environment is not configured to support act"
// warning React 18+ logs when act runs without this flag set.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const VIEWPORT_W = 800
const VIEWPORT_H = 600

const setupStore = (): CanvasStore => {
  const store = createCanvasStore({ clientId: asClientId('test') })
  store.addNode({
    id: asNodeId('n1'),
    type: 'rect',
    x: 100,
    y: 100,
    w: 80,
    h: 60,
    angle: 0,
    z: 0,
    groups: [],
  })
  store.addNode({
    id: asNodeId('n2'),
    type: 'rect',
    x: 400,
    y: 100,
    w: 80,
    h: 60,
    angle: 0,
    z: 0,
    groups: [],
  })
  return store
}

const mountCanvas = async (store: CanvasStore, arrowDefaults?: ArrowToolDefaults) => {
  const container = document.createElement('div')
  container.style.position = 'fixed'
  container.style.left = '0px'
  container.style.top = '0px'
  container.style.width = `${VIEWPORT_W}px`
  container.style.height = `${VIEWPORT_H}px`
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      <StrictMode>
        <CanvasProvider store={store}>
          <Canvas tool="arrow" arrowDefaults={arrowDefaults} />
        </CanvasProvider>
      </StrictMode>,
    )
  })
  // Yield a microtask so child effects (renderer mount, ResizeObserver
  // callback) run and the arrow-tool pointer listeners attach.
  await new Promise(resolve => setTimeout(resolve, 0))
  const wrap = container.querySelector('[data-canvas-host]') as HTMLDivElement
  if (!wrap) throw new Error('canvas wrap not found')
  return {
    container,
    root,
    wrap,
    cleanup: () => act(async () => root.unmount()).then(() => container.remove()),
  }
}

/**
 * Dispatches a pointerdown → pointermove (past click threshold) →
 * pointerup sequence on `el`. Coords are wrap-relative; we add the
 * wrap's bounding-rect offset before dispatch.
 */
const dragArrow = async (
  wrap: HTMLDivElement,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> => {
  const rect = wrap.getBoundingClientRect()
  const fire = (type: string, p: { x: number; y: number }) => {
    wrap.dispatchEvent(
      new PointerEvent(type, {
        clientX: rect.left + p.x,
        clientY: rect.top + p.y,
        button: 0,
        pointerId: 1,
        bubbles: true,
        cancelable: true,
      }),
    )
  }
  await act(async () => fire('pointerdown', from))
  await act(async () => fire('pointermove', to))
  await act(async () => fire('pointerup', to))
}

/**
 * Asserts the gesture from (140, 130) → (440, 130) snapped the edge
 * endpoints to the two test nodes. Every test relies on this — if
 * snapping breaks, every test would still pass on the style/data
 * assertions alone, masking a real regression. Centralised here so
 * each test stays focused on the knob it exercises.
 */
const expectEndpointsSnappedToTestNodes = (
  edge: ReturnType<CanvasStore['getAllEdges']>[number],
) => {
  expect(edge.source).toMatchObject({ nodeId: 'n1' })
  expect(edge.target).toMatchObject({ nodeId: 'n2' })
}

describe('arrow-tool defaults', () => {
  test('plain-object style + data land on the edge in a single batch', async () => {
    const store = setupStore()
    const m = await mountCanvas(store, {
      style: { strokeColor: '#f00' },
      data: { version: 1, owner: 'alice' },
    })

    await dragArrow(m.wrap, { x: 140, y: 130 }, { x: 440, y: 130 })

    const edges = store.getAllEdges()
    expect(edges).toHaveLength(1)
    expectEndpointsSnappedToTestNodes(edges[0]!)
    expect(edges[0]!.style?.strokeColor).toBe('#f00')
    expect(edges[0]!.data).toEqual({ version: 1, owner: 'alice' })
    await m.cleanup()
  })

  test('style factory is invoked at commit and reads closure state', async () => {
    const store = setupStore()
    let currentColor = '#aaa'
    const m = await mountCanvas(store, {
      style: () => ({ strokeColor: currentColor }),
    })

    // Mutate the closure variable AFTER mount — the factory should
    // see the latest value at commit time, not the value at mount.
    currentColor = '#bbb'
    await dragArrow(m.wrap, { x: 140, y: 130 }, { x: 440, y: 130 })

    const edges = store.getAllEdges()
    expect(edges).toHaveLength(1)
    expectEndpointsSnappedToTestNodes(edges[0]!)
    expect(edges[0]!.style?.strokeColor).toBe('#bbb')
    await m.cleanup()
  })

  test('data factory is invoked once per gesture commit, not per render', async () => {
    const store = setupStore()
    let calls = 0
    const m = await mountCanvas(store, {
      data: () => {
        calls++
        return { createdAt: 'stub', count: calls }
      },
    })

    await dragArrow(m.wrap, { x: 140, y: 130 }, { x: 440, y: 130 })

    expect(calls).toBe(1)
    const edges = store.getAllEdges()
    expectEndpointsSnappedToTestNodes(edges[0]!)
    expect(edges[0]!.data).toEqual({ createdAt: 'stub', count: 1 })
    await m.cleanup()
  })

  test('one Cmd+Z restores pre-create state when defaults stamp via factory', async () => {
    // Regression test for the original double-undo bug. With the
    // factory form, both addEdge's payload (source/target/pathStyle)
    // and the stamped data live in a single batch — one undo
    // reverts the entire create. Also verify the two seed nodes
    // survive the undo (single-batch undo must remove only the edge).
    const store = setupStore()
    const m = await mountCanvas(store, {
      data: () => ({ version: 1, createdAt: 'stub' }),
    })

    await dragArrow(m.wrap, { x: 140, y: 130 }, { x: 440, y: 130 })
    expect(store.getAllEdges()).toHaveLength(1)
    expectEndpointsSnappedToTestNodes(store.getAllEdges()[0]!)

    store.undo()
    expect(store.getAllEdges()).toHaveLength(0)
    expect(store.getAllNodes()).toHaveLength(2)
    await m.cleanup()
  })

  test('no defaults set → edge has default pathStyle and no style/data fields', async () => {
    const store = setupStore()
    const m = await mountCanvas(store)

    await dragArrow(m.wrap, { x: 140, y: 130 }, { x: 440, y: 130 })

    const edges = store.getAllEdges()
    expect(edges).toHaveLength(1)
    expectEndpointsSnappedToTestNodes(edges[0]!)
    expect(edges[0]!.pathStyle).toBe('bezier')
    expect(edges[0]!.style).toBeUndefined()
    expect(edges[0]!.data).toBeUndefined()
    await m.cleanup()
  })
})
