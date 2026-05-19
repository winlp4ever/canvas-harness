import { defineExtension } from '@canvas-harness/core'

/**
 * Snap-to-grid — example extension demonstrating the Phase 12 plugin
 * surface. Subscribes to interaction state during drag/resize and
 * snaps the live delta to a grid step.
 *
 * Ships as a playground demo, not a library export — see
 * IMPLEMENTATION.md Phase 12.
 */
export const createSnapToGrid = (step = 20) =>
  defineExtension({
    name: 'snap-to-grid',
    onInstall: api => {
      // Re-entrance guard: when we write dragDelta back, the interaction
      // event fires again with the new value. Tag the value we wrote so
      // the next event is a no-op.
      let lastWritten = { x: Number.NaN, y: Number.NaN }
      api.on('interaction', state => {
        if (state.mode !== 'dragging') return
        const sx = Math.round(state.dragDelta.x / step) * step
        const sy = Math.round(state.dragDelta.y / step) * step
        if (sx === state.dragDelta.x && sy === state.dragDelta.y) return
        if (sx === lastWritten.x && sy === lastWritten.y) return
        lastWritten = { x: sx, y: sy }
        api.store.setInteractionState({ dragDelta: { x: sx, y: sy } })
      })
    },
  })
