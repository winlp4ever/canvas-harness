/**
 * Smoke test that runs in real Chromium via vitest browser mode.
 * Verifies canvas 2D context is available — the foundation of every render path.
 */
import { describe, expect, test } from 'vitest'

describe('@canvas-harness/core (browser)', () => {
  test('canvas 2d context is available', () => {
    const canvas = document.createElement('canvas')
    canvas.width = 100
    canvas.height = 100
    const ctx = canvas.getContext('2d')
    expect(ctx).not.toBeNull()
  })

  test('requestAnimationFrame is available', () => {
    expect(typeof requestAnimationFrame).toBe('function')
  })
})
