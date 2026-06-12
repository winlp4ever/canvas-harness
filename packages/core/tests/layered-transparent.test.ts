/**
 * Regression: layered composites and transparent fill/stroke.
 *
 * The back sub-shape of a `layered-*` / `soft-diamond` node is painted
 * with a darkened copy of the node style. `darkenHex` routes through
 * `parseHex`, which drops the alpha byte — so darkening a transparent
 * color ('#00000000') used to yield an opaque one, and the back layer
 * grew a stray border (with the last-set strokeStyle/width) even when
 * the front correctly had none. `darkenedStyle` now leaves a
 * fully-transparent fill/stroke untouched. See draw-shape.ts.
 */
import { describe, expect, test } from 'vitest'
import { isFullyTransparent } from '../src/render/shapes/defaults'
import { compositeLayout } from '../src/render/shapes/draw-shape'
import { asNodeId } from '../src/types'
import type { Node, Style } from '../src/types'

const TRANSPARENT = '#00000000'

// The composite types whose back layer is darkened via `darkenedStyle`.
// (capsule's subs carry no style; thought-cloud is atomic — neither is
// affected, so they're deliberately excluded here.)
const DARKENED_BACK_TYPES = [
  'layered-rect',
  'layered-ellipse',
  'layered-diamond',
  'soft-diamond',
] as const

const node = (type: Node['type'], style?: Style): Node => ({
  id: asNodeId('n'),
  type,
  x: 0,
  y: 0,
  w: 100,
  h: 100,
  angle: 0,
  z: 0,
  groups: [],
  ...(style ? { style } : {}),
})

describe('layered composites preserve transparency on the back layer', () => {
  for (const type of DARKENED_BACK_TYPES) {
    describe(type, () => {
      test('a transparent stroke stays transparent on the back sub-shape', () => {
        const [back] = compositeLayout(
          node(type, { backgroundColor: '#ff0000', strokeColor: TRANSPARENT }),
        )
        expect(isFullyTransparent(back!.style!.strokeColor!)).toBe(true)
      })

      test('a transparent fill stays transparent on the back sub-shape', () => {
        const [back] = compositeLayout(
          node(type, { backgroundColor: TRANSPARENT, strokeColor: '#000000' }),
        )
        expect(isFullyTransparent(back!.style!.backgroundColor!)).toBe(true)
      })

      test('opaque colors are still darkened on the back sub-shape (control)', () => {
        const [back] = compositeLayout(
          node(type, { backgroundColor: '#ff0000', strokeColor: '#000000' }),
        )
        expect(back!.style!.backgroundColor).toBeDefined()
        expect(back!.style!.backgroundColor).not.toBe('#ff0000')
        expect(isFullyTransparent(back!.style!.backgroundColor!)).toBe(false)
      })

      test('a transparent stroke + opaque fill: fill darkens, stroke stays transparent', () => {
        const [back] = compositeLayout(
          node(type, { backgroundColor: '#3366cc', strokeColor: TRANSPARENT }),
        )
        expect(back!.style!.backgroundColor).not.toBe('#3366cc') // darkened
        expect(isFullyTransparent(back!.style!.strokeColor!)).toBe(true) // preserved
      })
    })
  }
})
