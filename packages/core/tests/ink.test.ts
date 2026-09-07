import { describe, expect, test } from 'vitest'
import {
  buildInkOutline,
  createInkGeometry,
  hitTestInkSegmentWorld,
  hitTestInkWorld,
  outlineFromInk,
  pickInkStrokeOptions,
  readInkData,
} from '../src/ink'
import { type Node, asNodeId } from '../src/types'

describe('ink geometry', () => {
  test('stores only points + size and derives a compact local geometry', () => {
    const geometry = createInkGeometry(
      [
        { x: 20, y: 30, pressure: 0.25 },
        { x: 40, y: 45, pressure: 0.75 },
      ],
      6,
    )

    expect(geometry).not.toBeNull()
    expect(geometry!.w).toBeGreaterThan(0)
    expect(geometry!.h).toBeGreaterThan(0)
    expect(geometry!.ink.points).toHaveLength(2)
    expect(geometry!.ink).not.toHaveProperty('outline')
  })

  test('reads canonical ink data and rejects malformed points', () => {
    const geometry = createInkGeometry([{ x: 10, y: 10, pressure: 0.5 }], 4)!
    const node = makeNode(geometry)
    expect(readInkData(node)).toBe(geometry.ink)

    const malformed: Node = {
      ...node,
      data: { ink: { ...geometry.ink, points: [[Number.NaN, 0, 0.5]] } },
    }
    expect(readInkData(malformed)).toBeNull()
  })

  test('hit-tests the pressure centerline instead of the full node bounds', () => {
    const geometry = createInkGeometry(
      [
        { x: 10, y: 20, pressure: 0.5 },
        { x: 50, y: 20, pressure: 0.5 },
      ],
      4,
    )!
    const node = makeNode(geometry)

    expect(hitTestInkWorld(node, { x: 30, y: 20 })).toBe(true)
    expect(hitTestInkWorld(node, { x: 30, y: 60 })).toBe(false)
  })

  test('hit-tests the full swept eraser segment between sparse events', () => {
    const geometry = createInkGeometry(
      [
        { x: 50, y: 10, pressure: 0.5 },
        { x: 50, y: 90, pressure: 0.5 },
      ],
      4,
    )!
    const node = makeNode(geometry)

    expect(hitTestInkSegmentWorld(node, { x: 0, y: 50 }, { x: 100, y: 50 }, 2)).toBe(true)
    expect(hitTestInkSegmentWorld(node, { x: 0, y: 120 }, { x: 100, y: 120 }, 2)).toBe(false)
  })
})

const makeNode = (geometry: NonNullable<ReturnType<typeof createInkGeometry>>): Node => ({
  id: asNodeId('ink-1'),
  type: 'ink',
  x: geometry.x,
  y: geometry.y,
  w: geometry.w,
  h: geometry.h,
  angle: 0,
  z: 1,
  groups: [],
  data: { ink: geometry.ink },
})

describe('ink stroke options', () => {
  const jitter = [
    { x: 0, y: 0, pressure: 0.5 },
    { x: 10, y: 8, pressure: 0.5 },
    { x: 20, y: -4, pressure: 0.5 },
    { x: 30, y: 9, pressure: 0.5 },
    { x: 40, y: 0, pressure: 0.5 },
  ]

  test('a default stroke persists no shape knobs (compact + back-compatible)', () => {
    const ink = createInkGeometry(jitter, 6)!.ink
    expect(ink).not.toHaveProperty('thinning')
    expect(ink).not.toHaveProperty('smoothing')
    expect(ink).not.toHaveProperty('streamline')
  })

  test('persists only the overridden knobs', () => {
    const ink = createInkGeometry(jitter, 6, { smoothing: 0.9 })!.ink
    expect(ink.smoothing).toBe(0.9)
    expect(ink).not.toHaveProperty('thinning')
    expect(ink).not.toHaveProperty('streamline')
  })

  test('options change the traced outline', () => {
    const loose = buildInkOutline(jitter, 8, { streamline: 0.1 })
    const tight = buildInkOutline(jitter, 8, { streamline: 0.9 })
    expect(loose.length).toBeGreaterThan(0)
    expect(JSON.stringify(loose)).not.toBe(JSON.stringify(tight))
  })

  test('outlineFromInk rebuilds with the persisted knobs, not the defaults', () => {
    // Same samples/size, different persisted streamline → different outline,
    // so a committed stroke keeps its feel across a re-render.
    const a = createInkGeometry(jitter, 8, { streamline: 0.1 })!.ink
    const b = createInkGeometry(jitter, 8, { streamline: 0.9 })!.ink
    expect(JSON.stringify(outlineFromInk(a))).not.toBe(JSON.stringify(outlineFromInk(b)))
  })

  test('clamps out-of-range knobs to perfect-freehand domains at render', () => {
    expect(JSON.stringify(buildInkOutline(jitter, 8, { streamline: 5 }))).toBe(
      JSON.stringify(buildInkOutline(jitter, 8, { streamline: 1 })),
    )
    expect(JSON.stringify(buildInkOutline(jitter, 8, { streamline: -5 }))).toBe(
      JSON.stringify(buildInkOutline(jitter, 8, { streamline: 0 })),
    )
  })

  test('treats a non-finite knob as the default and never persists it', () => {
    // Rendering falls back to the default (no NaN geometry).
    expect(JSON.stringify(buildInkOutline(jitter, 8, { thinning: Number.NaN }))).toBe(
      JSON.stringify(buildInkOutline(jitter, 8)),
    )
    const geo = createInkGeometry(jitter, 6, { thinning: Number.NaN })!
    expect(Number.isFinite(geo.w)).toBe(true)
    expect(geo.ink).not.toHaveProperty('thinning') // dropped, not stored
  })

  test('pickInkStrokeOptions keeps finite overrides, drops undefined and non-finite', () => {
    expect(pickInkStrokeOptions({ thinning: 0.5, smoothing: Number.NaN })).toEqual({
      thinning: 0.5,
    })
    expect(pickInkStrokeOptions({ streamline: Number.POSITIVE_INFINITY })).toEqual({})
    expect(pickInkStrokeOptions(undefined)).toEqual({})
  })

  test('readInkData accepts finite knobs and rejects non-finite ones', () => {
    const base = createInkGeometry(jitter, 6)!
    const node = makeNode(base)
    // Fresh objects (spread) bypass the validated-instance fast path.
    const withKnob: Node = { ...node, data: { ink: { ...base.ink, thinning: 0.9 } } }
    expect(readInkData(withKnob)?.thinning).toBe(0.9)
    const badKnob: Node = { ...node, data: { ink: { ...base.ink, smoothing: Number.NaN } } }
    expect(readInkData(badKnob)).toBeNull()
  })
})
