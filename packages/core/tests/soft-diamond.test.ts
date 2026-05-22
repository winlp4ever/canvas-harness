/**
 * `soft-diamond` composite layout — verifies the concentric scale
 * pattern (back 108%, front 96%, both centered) and integration
 * with `isCompositePrimitive` + `contentBounds`.
 */
import { describe, expect, test } from 'vitest'
import { contentBounds } from '../src/render/shapes'
import { compositeLayout } from '../src/render/shapes/draw-shape'
import { isCompositePrimitive } from '../src/render/shapes/draw-shape'
import { asNodeId } from '../src/types'
import type { Node } from '../src/types'

const node = (over: Partial<Node> = {}): Node => ({
  id: asNodeId('n-soft'),
  type: 'soft-diamond',
  x: 0,
  y: 0,
  w: 100,
  h: 100,
  angle: 0,
  z: 0,
  groups: [],
  ...over,
})

describe('soft-diamond composite layout', () => {
  test('is recognized as a composite primitive', () => {
    expect(isCompositePrimitive('soft-diamond')).toBe(true)
  })

  test('returns two diamond sub-shapes', () => {
    const subs = compositeLayout(node())
    expect(subs).toHaveLength(2)
    expect(subs[0]!.atomic).toBe('diamond')
    expect(subs[1]!.atomic).toBe('diamond')
  })

  test('back is 108% centered, front is 96% centered', () => {
    const subs = compositeLayout(node({ w: 100, h: 100 }))
    const [back, front] = subs
    // Back: 108% → 108 wide, centered with -4 offset on each side
    expect(back!.w).toBeCloseTo(108)
    expect(back!.h).toBeCloseTo(108)
    expect(back!.x).toBeCloseTo(-4)
    expect(back!.y).toBeCloseTo(-4)
    // Front: 96% → 96 wide, centered with +2 offset on each side
    expect(front!.w).toBeCloseTo(96)
    expect(front!.h).toBeCloseTo(96)
    expect(front!.x).toBeCloseTo(2)
    expect(front!.y).toBeCloseTo(2)
  })

  test('back carries a darkened style; front uses node style as-is', () => {
    const subs = compositeLayout(
      node({ style: { backgroundColor: '#ff0000', strokeColor: '#000000' } }),
    )
    const [back, front] = subs
    // Back has its own style with darkened colors
    expect(back!.style?.backgroundColor).toBeDefined()
    expect(back!.style?.backgroundColor).not.toBe('#ff0000')
    // Front inherits — no style override on the sub means it falls
    // through to node.style during paint.
    expect(front!.style).toBeUndefined()
  })

  test('scales with bbox aspect ratio (non-square)', () => {
    const subs = compositeLayout(node({ w: 200, h: 100 }))
    const [back, front] = subs
    expect(back!.w).toBeCloseTo(216) // 200 * 1.08
    expect(back!.h).toBeCloseTo(108) // 100 * 1.08
    expect(front!.w).toBeCloseTo(192) // 200 * 0.96
    expect(front!.h).toBeCloseTo(96) // 100 * 0.96
  })

  test('contentBounds inscribes a square inside the bbox (same as diamond)', () => {
    const bounds = contentBounds(node({ w: 100, h: 100 }))
    // 1/√2 ≈ 0.7071
    expect(bounds.w).toBeCloseTo(70.71, 1)
    expect(bounds.h).toBeCloseTo(70.71, 1)
    expect(bounds.x).toBeCloseTo(14.64, 1)
    expect(bounds.y).toBeCloseTo(14.64, 1)
  })
})
