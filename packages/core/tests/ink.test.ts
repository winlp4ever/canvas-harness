import { describe, expect, test } from 'vitest'
import { createInkGeometry, hitTestInkSegmentWorld, hitTestInkWorld, readInkData } from '../src/ink'
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
