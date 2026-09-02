import {
  type CanvasStore,
  asClientId,
  asNodeId,
  createCanvasStore,
  createInkGeometry,
  readInkData,
} from '@canvas-harness/core'
import { StrictMode, act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, test, vi } from 'vitest'
import { Canvas, CanvasProvider } from '../src'
import type { InkToolDefaults } from '../src/internal/use-ink-tool'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mountCanvas = async (
  store: CanvasStore,
  tool: 'ink' | 'eraser',
  inkDefaults?: InkToolDefaults,
) => {
  const container = document.createElement('div')
  container.style.position = 'fixed'
  container.style.inset = '0'
  container.style.width = '800px'
  container.style.height = '600px'
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      <StrictMode>
        <CanvasProvider store={store}>
          <Canvas tool={tool} inkDefaults={inkDefaults} />
        </CanvasProvider>
      </StrictMode>,
    )
  })
  await new Promise(resolve => setTimeout(resolve, 0))
  const wrap = container.querySelector('[data-canvas-host]') as HTMLDivElement
  if (!wrap) throw new Error('canvas wrap not found')
  return {
    wrap,
    rerender: (nextTool: 'ink' | 'eraser') =>
      act(async () => {
        root.render(
          <StrictMode>
            <CanvasProvider store={store}>
              <Canvas tool={nextTool} inkDefaults={inkDefaults} />
            </CanvasProvider>
          </StrictMode>,
        )
      }),
    cleanup: () => act(async () => root.unmount()).then(() => container.remove()),
  }
}

const firePointer = (
  wrap: HTMLDivElement,
  type: string,
  point: { x: number; y: number },
  init: PointerEventInit = {},
): void => {
  const rect = wrap.getBoundingClientRect()
  wrap.dispatchEvent(
    new PointerEvent(type, {
      clientX: rect.left + point.x,
      clientY: rect.top + point.y,
      pointerId: 1,
      pointerType: 'pen',
      pressure: 0.5,
      button: type === 'pointerup' ? 0 : 0,
      buttons: type === 'pointerup' ? 0 : 1,
      bubbles: true,
      cancelable: true,
      ...init,
    }),
  )
}

describe('built-in ink tool', () => {
  test('commits one pressure-aware node and ignores pointerrawupdate', async () => {
    const store = createCanvasStore({ clientId: asClientId('ink-test') })
    const mounted = await mountCanvas(store, 'ink', {
      size: 6,
      color: '#2563eb',
      data: { owner: 'alice' },
    })

    await act(async () => firePointer(mounted.wrap, 'pointerdown', { x: 10, y: 20 }))
    // The engine intentionally has no raw-update listener: processing this
    // as well as pointermove would duplicate Apple Pencil samples.
    await act(async () => firePointer(mounted.wrap, 'pointerrawupdate', { x: 15, y: 20 }))
    await act(async () => firePointer(mounted.wrap, 'pointermove', { x: 20, y: 20 }))
    await act(async () => firePointer(mounted.wrap, 'pointerup', { x: 20, y: 20 }))

    const nodes = store.getAllNodes()
    expect(nodes).toHaveLength(1)
    expect(nodes[0]!.type).toBe('ink')
    expect(nodes[0]!.style?.strokeColor).toBe('#2563eb')
    expect(nodes[0]!.data).toMatchObject({ owner: 'alice' })
    const ink = readInkData(nodes[0]!)
    expect(ink?.size).toBe(6)
    expect(ink?.points).toHaveLength(2)
    expect(ink).not.toHaveProperty('outline')

    store.undo()
    expect(store.getAllNodes()).toHaveLength(0)
    await mounted.cleanup()
  })

  test('lets a product factory build its own node envelope', async () => {
    const store = createCanvasStore({ clientId: asClientId('factory-test') })
    let calls = 0
    const mounted = await mountCanvas(store, 'ink', {
      createNode: input => {
        calls++
        return {
          id: input.id,
          type: 'ink',
          x: input.geometry.x,
          y: input.geometry.y,
          w: input.geometry.w,
          h: input.geometry.h,
          angle: 0,
          groups: [],
          style: input.style,
          data: {
            noteType: 'note',
            properties: { inkData: input.geometry.ink },
            ink: input.geometry.ink,
          },
        }
      },
    })

    await act(async () => firePointer(mounted.wrap, 'pointerdown', { x: 30, y: 30 }))
    await act(async () => firePointer(mounted.wrap, 'pointermove', { x: 50, y: 40 }))
    await act(async () => firePointer(mounted.wrap, 'pointerup', { x: 50, y: 40 }))

    expect(calls).toBe(1)
    expect(store.getAllNodes()[0]!.data).toMatchObject({ noteType: 'note' })
    expect(readInkData(store.getAllNodes()[0]!)).not.toBeNull()
    await mounted.cleanup()
  })

  test('hardware eraser contact removes a whole ink stroke in one gesture', async () => {
    const store = createCanvasStore({ clientId: asClientId('eraser-test') })
    const geometry = createInkGeometry(
      [
        { x: 100, y: 100, pressure: 0.5 },
        { x: 140, y: 100, pressure: 0.5 },
      ],
      6,
    )!
    store.addNode({
      id: asNodeId('seed-ink'),
      type: 'ink',
      x: geometry.x,
      y: geometry.y,
      w: geometry.w,
      h: geometry.h,
      angle: 0,
      groups: [],
      data: { ink: geometry.ink },
    })
    const mounted = await mountCanvas(store, 'ink')

    await act(async () =>
      firePointer(mounted.wrap, 'pointerdown', { x: 120, y: 100 }, { button: 5, buttons: 32 }),
    )
    await act(async () =>
      firePointer(mounted.wrap, 'pointerup', { x: 120, y: 100 }, { button: 5, buttons: 0 }),
    )

    expect(store.getAllNodes()).toHaveLength(0)
    store.undo()
    expect(store.getAllNodes()).toHaveLength(1)
    await mounted.cleanup()
  })

  test('splits a long stroke into capped seamless nodes in one undo batch', async () => {
    const store = createCanvasStore({ clientId: asClientId('long-ink-test') })
    const mounted = await mountCanvas(store, 'ink')

    await act(async () => {
      firePointer(mounted.wrap, 'pointerdown', { x: 0, y: 40 })
      for (let index = 1; index <= 600; index++) {
        firePointer(mounted.wrap, 'pointermove', { x: index * 2, y: 40 })
      }
    })
    await act(async () => new Promise(resolve => requestAnimationFrame(resolve)))
    const firstDraft = store.getInteractionState().draftInk!

    await act(async () => firePointer(mounted.wrap, 'pointermove', { x: 1202, y: 40 }))
    await act(async () => new Promise(resolve => requestAnimationFrame(resolve)))
    const secondDraft = store.getInteractionState().draftInk!
    expect(secondDraft.segments[0]).not.toBe(firstDraft.segments[0])

    await act(async () => {
      for (let index = 602; index <= 605; index++) {
        firePointer(mounted.wrap, 'pointermove', { x: index * 2, y: 40 })
      }
      firePointer(mounted.wrap, 'pointerup', { x: 1210, y: 40 })
    })

    const nodes = store.getAllNodes()
    expect(nodes).toHaveLength(2)
    const first = readInkData(nodes[0]!)!
    const second = readInkData(nodes[1]!)!
    expect(first.points).toHaveLength(600)
    expect(second.points.length).toBeLessThanOrEqual(600)
    for (let index = 0; index < 3; index++) {
      const firstPoint = first.points[first.points.length - 3 + index]!
      const secondPoint = second.points[index]!
      expect(nodes[0]!.x + firstPoint[0]).toBeCloseTo(nodes[1]!.x + secondPoint[0])
      expect(nodes[0]!.y + firstPoint[1]).toBeCloseTo(nodes[1]!.y + secondPoint[1])
    }

    store.undo()
    expect(store.getAllNodes()).toHaveLength(0)
    await mounted.cleanup()
  })

  test('sweeps between sparse eraser samples and publishes dim-preview ids', async () => {
    const store = createCanvasStore({ clientId: asClientId('swept-eraser-test') })
    const geometry = createInkGeometry(
      [
        { x: 100, y: 40, pressure: 0.5 },
        { x: 100, y: 160, pressure: 0.5 },
      ],
      6,
    )!
    store.addNode({
      id: asNodeId('swept-ink'),
      type: 'ink',
      x: geometry.x,
      y: geometry.y,
      w: geometry.w,
      h: geometry.h,
      angle: 0,
      groups: [],
      data: { ink: geometry.ink },
    })
    const mounted = await mountCanvas(store, 'eraser')

    await act(async () => firePointer(mounted.wrap, 'pointerdown', { x: 20, y: 100 }))
    await act(async () => firePointer(mounted.wrap, 'pointermove', { x: 180, y: 100 }))
    await act(async () => new Promise(resolve => requestAnimationFrame(resolve)))
    expect(store.getInteractionState().draftEraser?.erasedIds).toEqual([asNodeId('swept-ink')])
    await act(async () => firePointer(mounted.wrap, 'pointerup', { x: 180, y: 100 }))
    expect(store.getAllNodes()).toHaveLength(0)
    await mounted.cleanup()
  })

  test('releases pointer capture when the active tool changes mid-stroke', async () => {
    const store = createCanvasStore({ clientId: asClientId('capture-test') })
    const mounted = await mountCanvas(store, 'ink')
    vi.spyOn(mounted.wrap, 'hasPointerCapture').mockReturnValue(true)
    const release = vi.spyOn(mounted.wrap, 'releasePointerCapture')

    await act(async () => firePointer(mounted.wrap, 'pointerdown', { x: 20, y: 20 }))
    await mounted.rerender('eraser')

    expect(release).toHaveBeenCalledWith(1)
    expect(store.getInteractionState().mode).toBe('idle')
    await mounted.cleanup()
  })
})
