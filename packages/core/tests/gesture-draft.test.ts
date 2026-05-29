/**
 * Resize draft model — the same draft+commit pattern drag uses,
 * extended to resize. During the gesture the in-progress geometry
 * lives on InteractionState.resizeDraft; the store node stays at the
 * original geometry until pointer-up. Validates that no 'change'
 * event fires during the gesture, and exactly one fires on commit.
 */
import { describe, expect, test, vi } from 'vitest'
import { createCanvasStore } from '../src/store'
import { type Node, asClientId, asNodeId } from '../src/types'

const makeRect = (overrides: Partial<Node> = {}): Omit<Node, 'z'> & { z?: number } => ({
  id: asNodeId('n-1'),
  type: 'rect',
  x: 100,
  y: 100,
  w: 200,
  h: 100,
  angle: 0,
  groups: [],
  ...overrides,
})

describe('Resize draft model', () => {
  test('resizeDraft updates do not emit change events', () => {
    const store = createCanvasStore({ clientId: asClientId('u-test') })
    store.addNode(makeRect())
    const onChange = vi.fn()
    const unsub = store.subscribe('change', onChange)

    // Simulate the gesture: many pointermove updates writing only to
    // the draft slot. No store.updateNode calls.
    for (let i = 0; i < 30; i++) {
      store.setInteractionState({
        mode: 'resizing',
        draggedIds: [asNodeId('n-1')],
        resizeDraft: { x: 100, y: 100, w: 200 + i, h: 100 + i, angle: 0 },
      })
    }

    expect(onChange).not.toHaveBeenCalled()
    // The store node is still at original geometry — clients reading
    // store.getNode see the committed state, draft state lives only
    // on InteractionState.
    const live = store.getNode(asNodeId('n-1'))
    expect(live?.w).toBe(200)
    expect(live?.h).toBe(100)
    // The draft has the latest pointer-driven geometry.
    expect(store.getInteractionState().resizeDraft).toEqual({
      x: 100,
      y: 100,
      w: 229,
      h: 129,
      angle: 0,
    })

    unsub()
  })

  test('commit writes the draft and emits exactly one change', () => {
    const store = createCanvasStore({ clientId: asClientId('u-test') })
    store.addNode(makeRect())
    // A few in-progress draft updates first — these must not be in
    // the change-event count.
    for (let i = 0; i < 10; i++) {
      store.setInteractionState({
        mode: 'resizing',
        draggedIds: [asNodeId('n-1')],
        resizeDraft: { x: 100, y: 100, w: 200 + i, h: 100 + i, angle: 0 },
      })
    }

    const onChange = vi.fn()
    const unsub = store.subscribe('change', onChange)

    // Commit: a single batch with the final draft geometry.
    const finalDraft = store.getInteractionState().resizeDraft!
    store.batch(() => {
      store.updateNode(asNodeId('n-1'), {
        x: finalDraft.x,
        y: finalDraft.y,
        w: finalDraft.w,
        h: finalDraft.h,
        angle: finalDraft.angle,
      })
    })
    store.resetInteractionState()

    expect(onChange).toHaveBeenCalledTimes(1)
    const after = store.getNode(asNodeId('n-1'))
    expect(after?.w).toBe(209)
    expect(after?.h).toBe(109)
    expect(store.getInteractionState().resizeDraft).toBeNull()

    unsub()
  })

  test('resetInteractionState clears the draft', () => {
    const store = createCanvasStore({ clientId: asClientId('u-test') })
    store.setInteractionState({
      mode: 'resizing',
      resizeDraft: { x: 0, y: 0, w: 50, h: 50, angle: 0 },
    })
    expect(store.getInteractionState().resizeDraft).not.toBeNull()
    store.resetInteractionState()
    expect(store.getInteractionState().resizeDraft).toBeNull()
    expect(store.getInteractionState().mode).toBe('idle')
  })
})
