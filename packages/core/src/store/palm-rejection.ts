/**
 * Palm-rejection helper — see IMPLEMENTATION.md Phase 11.
 *
 * When a stylus is actively touching the surface, mobile/tablet OSes
 * sometimes mis-route palm contacts as `pointerType: 'touch'`. The
 * heuristic: when a pen pointer is down (or has just lifted), drop all
 * incoming `touch` pointers for a short grace period.
 *
 * Pure state holder + helpers. The `<Canvas>` gesture hooks call
 * `notePenActive` / `notePenInactive` on pen pointer events, and
 * `shouldRejectTouch` before processing a touch event.
 */

export type PalmRejectionState = {
  /** True while at least one pen pointer is currently down. */
  penActive: boolean
  /** Timestamp (ms since epoch) at which the most recent pen pointer lifted. */
  lastPenUpAt: number
}

export const PALM_REJECTION_GRACE_MS = 300

export const createPalmRejectionState = (): PalmRejectionState => ({
  penActive: false,
  lastPenUpAt: 0,
})

export const notePenActive = (state: PalmRejectionState): void => {
  state.penActive = true
}

export const notePenInactive = (state: PalmRejectionState, now: number): void => {
  state.penActive = false
  state.lastPenUpAt = now
}

/**
 * Returns true if this touch event should be ignored because a pen is
 * active (or just lifted within the grace window).
 */
export const shouldRejectTouch = (state: PalmRejectionState, now: number): boolean => {
  if (state.penActive) return true
  return now - state.lastPenUpAt < PALM_REJECTION_GRACE_MS
}
