import { describe, expect, test } from 'vitest'
import {
  DEFAULT_CAMERA,
  MAX_ZOOM,
  MIN_ZOOM,
  clampZoom,
  panByScreen,
  screenToWorld,
  viewportWorldRect,
  worldToScreen,
  zoomAtScreenPoint,
} from '../src/camera'

describe('camera', () => {
  test('screenToWorld and worldToScreen are inverses', () => {
    const camera = { x: 50, y: 30, z: 2 }
    const screen = { x: 100, y: 200 }
    const world = screenToWorld(screen, camera)
    const backToScreen = worldToScreen(world, camera)
    expect(backToScreen.x).toBeCloseTo(screen.x)
    expect(backToScreen.y).toBeCloseTo(screen.y)
  })

  test('identity camera at zoom 1 maps screen=world', () => {
    const p = { x: 42, y: -7 }
    expect(screenToWorld(p, DEFAULT_CAMERA)).toEqual(p)
    expect(worldToScreen(p, DEFAULT_CAMERA)).toEqual(p)
  })

  test('viewportWorldRect scales with zoom', () => {
    const camera = { x: 0, y: 0, z: 2 }
    expect(viewportWorldRect(camera, 800, 600)).toEqual({ x: 0, y: 0, w: 400, h: 300 })
  })

  test('clampZoom enforces min/max', () => {
    expect(clampZoom(0)).toBe(MIN_ZOOM)
    expect(clampZoom(1000)).toBe(MAX_ZOOM)
    expect(clampZoom(1)).toBe(1)
    expect(clampZoom(Number.NaN)).toBe(1)
  })

  test('zoomAtScreenPoint keeps the anchor point stationary in world coords', () => {
    const camera = { x: 100, y: 100, z: 1 }
    const anchor = { x: 400, y: 300 }
    const worldBefore = screenToWorld(anchor, camera)
    const next = zoomAtScreenPoint(camera, 4, anchor)
    const worldAfter = screenToWorld(anchor, next)
    expect(worldAfter.x).toBeCloseTo(worldBefore.x)
    expect(worldAfter.y).toBeCloseTo(worldBefore.y)
    expect(next.z).toBe(4)
  })

  test('panByScreen translates camera in world units', () => {
    const camera = { x: 0, y: 0, z: 2 }
    const after = panByScreen(camera, { x: 100, y: -50 })
    expect(after).toEqual({ x: -50, y: 25, z: 2 })
  })
})
