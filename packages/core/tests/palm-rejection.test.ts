import { describe, expect, test } from 'vitest'
import {
  PALM_REJECTION_GRACE_MS,
  createPalmRejectionState,
  notePenActive,
  notePenInactive,
  shouldRejectTouch,
} from '../src'

describe('palm rejection', () => {
  test('fresh state rejects no touches', () => {
    const s = createPalmRejectionState()
    expect(shouldRejectTouch(s, 1000)).toBe(false)
  })

  test('rejects touches while a pen is active', () => {
    const s = createPalmRejectionState()
    notePenActive(s)
    expect(shouldRejectTouch(s, 1000)).toBe(true)
  })

  test('continues rejecting within the grace period after pen-up', () => {
    const s = createPalmRejectionState()
    notePenActive(s)
    notePenInactive(s, 1000)
    expect(shouldRejectTouch(s, 1000 + PALM_REJECTION_GRACE_MS - 10)).toBe(true)
  })

  test('accepts touches once the grace period elapses', () => {
    const s = createPalmRejectionState()
    notePenActive(s)
    notePenInactive(s, 1000)
    expect(shouldRejectTouch(s, 1000 + PALM_REJECTION_GRACE_MS + 1)).toBe(false)
  })
})
