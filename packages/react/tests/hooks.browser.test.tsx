/**
 * Hook reactivity tests — verifies the data/interaction/history hooks
 * subscribe to the right store events and re-render only when their
 * dependency changes.
 *
 * Browser-mode because hooks need a real React reconciler + DOM tree.
 */
import { type CanvasStore, asNodeId, createCanvasStore } from '@canvas-harness/core'
import { StrictMode, act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, test } from 'vitest'
import {
  CanvasProvider,
  useCamera,
  useCanRedo,
  useCanUndo,
  useIsPenActive,
  useNode,
  useNodes,
  useSelection,
} from '../src'

const mount = (store: CanvasStore, content: React.ReactNode) => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  return { container, root, render: () => root.render(<StrictMode><CanvasProvider store={store}>{content}</CanvasProvider></StrictMode>), cleanup: () => { root.unmount(); container.remove() } }
}

describe('hooks', () => {
  test('useNode returns the node and re-renders on update', async () => {
    const store = createCanvasStore()
    store.addNode({
      id: asNodeId('n1'),
      type: 'rect',
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      angle: 0,
      z: 0,
      groups: [],
    })

    let lastX = -1
    const Probe = () => {
      const n = useNode(asNodeId('n1'))
      lastX = n?.x ?? -1
      return <div>{n?.x}</div>
    }

    const m = mount(store, <Probe />)
    await act(async () => m.render())
    expect(lastX).toBe(0)
    await act(async () => {
      store.updateNode(asNodeId('n1'), { x: 42 })
    })
    expect(lastX).toBe(42)
    await act(async () => m.cleanup())
  })

  test('useNodes re-renders on additions', async () => {
    const store = createCanvasStore()
    let count = -1
    const Probe = () => {
      const nodes = useNodes()
      count = nodes.length
      return <div>{count}</div>
    }
    const m = mount(store, <Probe />)
    await act(async () => m.render())
    expect(count).toBe(0)
    await act(async () => {
      store.addNode({
        id: asNodeId('a'),
        type: 'rect',
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        angle: 0,
        z: 0,
        groups: [],
      })
    })
    expect(count).toBe(1)
    await act(async () => m.cleanup())
  })

  test('useSelection re-renders only on selection events', async () => {
    const store = createCanvasStore()
    store.addNode({
      id: asNodeId('n1'),
      type: 'rect',
      x: 0,
      y: 0,
      w: 1,
      h: 1,
      angle: 0,
      z: 0,
      groups: [],
    })
    let last: string[] = []
    const Probe = () => {
      const sel = useSelection()
      last = sel as string[]
      return null
    }
    const m = mount(store, <Probe />)
    await act(async () => m.render())
    expect(last).toEqual([])
    await act(async () => {
      store.setSelection([asNodeId('n1')])
    })
    expect(last).toEqual(['n1'])
    await act(async () => m.cleanup())
  })

  test('useCamera reflects camera changes', async () => {
    const store = createCanvasStore()
    let lastZ = 0
    const Probe = () => {
      lastZ = useCamera().z
      return null
    }
    const m = mount(store, <Probe />)
    await act(async () => m.render())
    expect(lastZ).toBeGreaterThan(0)
    await act(async () => {
      store.setCamera({ z: 2.5 })
    })
    expect(lastZ).toBe(2.5)
    await act(async () => m.cleanup())
  })

  test('useIsPenActive flips when pointer info reports a pen', async () => {
    const store = createCanvasStore()
    let isPen = false
    const Probe = () => {
      isPen = useIsPenActive()
      return null
    }
    const m = mount(store, <Probe />)
    await act(async () => m.render())
    expect(isPen).toBe(false)
    await act(async () => {
      store.setInteractionState({
        pointer: {
          worldX: 0,
          worldY: 0,
          screenX: 0,
          screenY: 0,
          pointerType: 'pen',
          pressure: 0.7,
        },
      })
    })
    expect(isPen).toBe(true)
    await act(async () => m.cleanup())
  })

  test('useCanUndo / useCanRedo flip with mutations', async () => {
    const store = createCanvasStore()
    let undo = false
    let redo = false
    const Probe = () => {
      undo = useCanUndo()
      redo = useCanRedo()
      return null
    }
    const m = mount(store, <Probe />)
    await act(async () => m.render())
    expect(undo).toBe(false)
    expect(redo).toBe(false)
    await act(async () => {
      store.addNode({
        id: asNodeId('z'),
        type: 'rect',
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        angle: 0,
        z: 0,
        groups: [],
      })
    })
    expect(undo).toBe(true)
    await act(async () => {
      store.undo()
    })
    expect(undo).toBe(false)
    expect(redo).toBe(true)
    await act(async () => m.cleanup())
  })
})
