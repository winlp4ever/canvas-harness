/**
 * Regression test for the source-arrowhead direction. Both arrowheads
 * used to render pointing in the SAME direction because the source
 * paint negated its already-outward tangent before passing it to
 * drawArrowhead. With the fix, the source arrowhead's chevron sits
 * INSIDE the curve (base toward target, tip at the endpoint), the
 * same as the target arrowhead but mirrored.
 *
 * Strategy: paint a horizontal free-floating edge with `arrow-filled`
 * at both ends to a real canvas, then sample pixels just OUTSIDE each
 * endpoint. With the fix those pixels are background; with the bug,
 * the source arrowhead's filled triangle extends past its endpoint.
 */
import { describe, expect, test } from 'vitest'
import { computeEdgeGeometry } from '../src/edges'
import { drawEdge } from '../src/edges/draw'
import { type Edge, type Node, asEdgeId } from '../src/types'

const makeCanvas = (w: number, h: number): HTMLCanvasElement => {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

const isOpaque = (data: Uint8ClampedArray, x: number, y: number, w: number): boolean => {
  const idx = (y * w + x) * 4
  return data[idx + 3]! > 0
}

describe('edge arrowhead direction', () => {
  test('source + target arrows extend INWARD from their endpoints', () => {
    const W = 240
    const H = 80
    const canvas = makeCanvas(W, H)
    const ctx = canvas.getContext('2d')!

    // Free-floating endpoints — no clipping, the polyline samples
    // are exactly (10, 40) → (230, 40).
    const edge: Edge = {
      id: asEdgeId('e-1'),
      source: { worldPoint: { x: 10, y: 40 } },
      target: { worldPoint: { x: 230, y: 40 } },
      pathStyle: 'straight',
      z: 0,
      groups: [],
      style: {
        strokeColor: '#000',
        strokeWidth: 2,
        sourceArrowhead: 'arrow-filled',
        targetArrowhead: 'arrow-filled',
      },
    }
    const getNode = (): Node | undefined => undefined
    const geom = computeEdgeGeometry(edge, getNode)
    expect(geom).not.toBeNull()

    drawEdge(ctx, edge, geom!, null, null, 1, undefined, {
      roughEnabled: false,
      zoom: 1,
      dpr: 1,
      isMoving: false,
    })

    const data = ctx.getImageData(0, 0, W, H).data

    // Sample 6px OUTSIDE each endpoint, along the curve's tangent
    // line. With the fix, both arrowheads point outward — their
    // filled triangle bases sit between the two endpoints, so pixels
    // just past the endpoints are background.
    expect(isOpaque(data, 10 - 6, 40, W)).toBe(false) // left of source
    expect(isOpaque(data, 230 + 6, 40, W)).toBe(false) // right of target

    // And 6px INSIDE each endpoint — those pixels should be opaque
    // (either the arrowhead fill or the line stroke).
    expect(isOpaque(data, 10 + 6, 40, W)).toBe(true) // right of source
    expect(isOpaque(data, 230 - 6, 40, W)).toBe(true) // left of target
  })
})
