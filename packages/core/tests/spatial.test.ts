import { describe, expect, test } from 'vitest'
import {
  UniformGrid,
  inflateRect,
  nodeAABB,
  rectContainsPoint,
  rectsIntersect,
  unionRects,
} from '../src/spatial'
import { type Node, asNodeId } from '../src/types'

describe('aabb', () => {
  test('rectContainsPoint inclusive of edges', () => {
    const r = { x: 0, y: 0, w: 100, h: 100 }
    expect(rectContainsPoint(r, { x: 50, y: 50 })).toBe(true)
    expect(rectContainsPoint(r, { x: 0, y: 0 })).toBe(true)
    expect(rectContainsPoint(r, { x: 100, y: 100 })).toBe(true)
    expect(rectContainsPoint(r, { x: 101, y: 0 })).toBe(false)
  })

  test('rectsIntersect detects overlap; rejects touching edges', () => {
    const a = { x: 0, y: 0, w: 10, h: 10 }
    expect(rectsIntersect(a, { x: 5, y: 5, w: 10, h: 10 })).toBe(true)
    expect(rectsIntersect(a, { x: 10, y: 0, w: 10, h: 10 })).toBe(false)
    expect(rectsIntersect(a, { x: 100, y: 100, w: 1, h: 1 })).toBe(false)
  })

  test('inflateRect grows on all sides', () => {
    expect(inflateRect({ x: 10, y: 10, w: 100, h: 100 }, 5)).toEqual({
      x: 5,
      y: 5,
      w: 110,
      h: 110,
    })
  })

  test('unionRects produces enclosing rect', () => {
    const u = unionRects([
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 50, y: 50, w: 5, h: 5 },
    ])
    expect(u).toEqual({ x: 0, y: 0, w: 55, h: 55 })
    expect(unionRects([])).toBeNull()
  })
})

describe('UniformGrid', () => {
  test('insert/queryPoint returns the inserted id', () => {
    const grid = new UniformGrid(256)
    grid.insert('a', { x: 100, y: 100, w: 50, h: 50 })
    expect(grid.queryPoint({ x: 120, y: 120 })).toEqual(['a'])
    expect(grid.queryPoint({ x: 1000, y: 1000 })).toEqual([])
  })

  test('queryRect returns ids whose AABB intersects', () => {
    const grid = new UniformGrid(256)
    grid.insert('a', { x: 0, y: 0, w: 100, h: 100 })
    grid.insert('b', { x: 200, y: 200, w: 100, h: 100 })
    grid.insert('c', { x: 90, y: 90, w: 20, h: 20 })
    expect(grid.queryRect({ x: 80, y: 80, w: 30, h: 30 }).sort()).toEqual(['a', 'c'])
  })

  test('remove unindexes an id', () => {
    const grid = new UniformGrid()
    grid.insert('a', { x: 0, y: 0, w: 10, h: 10 })
    grid.remove('a')
    expect(grid.queryPoint({ x: 5, y: 5 })).toEqual([])
    expect(grid.size).toBe(0)
  })

  test('insert with same id updates rather than duplicates', () => {
    const grid = new UniformGrid()
    grid.insert('a', { x: 0, y: 0, w: 10, h: 10 })
    grid.insert('a', { x: 500, y: 500, w: 10, h: 10 })
    expect(grid.queryPoint({ x: 5, y: 5 })).toEqual([])
    expect(grid.queryPoint({ x: 505, y: 505 })).toEqual(['a'])
    expect(grid.size).toBe(1)
  })

  test('handles 10k items efficiently', () => {
    const grid = new UniformGrid()
    for (let i = 0; i < 10000; i++) {
      grid.insert(`n${i}`, { x: i * 10, y: 0, w: 5, h: 5 })
    }
    const t0 = performance.now()
    const hits = grid.queryRect({ x: 50000, y: -10, w: 100, h: 20 })
    const elapsed = performance.now() - t0
    expect(hits.length).toBeGreaterThan(0)
    expect(elapsed).toBeLessThan(5) // generous; usually <0.5ms
  })
})

describe('nodeAABB', () => {
  const baseNode = (overrides: Partial<Node> = {}): Node => ({
    id: asNodeId('n-1'),
    type: 'rect',
    x: 100,
    y: 100,
    w: 200,
    h: 100,
    angle: 0,
    z: 0,
    groups: [],
    ...overrides,
  })

  test('axis-aligned returns the rect itself', () => {
    expect(nodeAABB(baseNode())).toEqual({ x: 100, y: 100, w: 200, h: 100 })
  })

  test('45-degree rotation encloses rotated corners', () => {
    const r = nodeAABB(baseNode({ angle: Math.PI / 4 }))
    // For a 200x100 rect rotated 45°, the AABB is wider/taller than the original.
    expect(r.w).toBeGreaterThan(200)
    expect(r.h).toBeGreaterThan(100)
    // and centered on the original center
    expect(r.x + r.w / 2).toBeCloseTo(200)
    expect(r.y + r.h / 2).toBeCloseTo(150)
  })
})
