import { describe, expect, test } from 'vitest'
import { defineNode } from '../src/node-types'
import { createCanvasStore } from '../src/store'
import { asClientId } from '../src/types'

describe('defineNode', () => {
  test('canvas-only kind when only renderCanvas provided', () => {
    const def = defineNode({ type: 'a', renderCanvas: () => {} })
    expect(def.kind).toBe('canvas-only')
  })

  test('react-only kind when only view provided', () => {
    const def = defineNode({ type: 'a', view: () => null })
    expect(def.kind).toBe('react-only')
  })

  test('mixed kind when both provided', () => {
    const def = defineNode({ type: 'a', view: () => null, renderCanvas: () => {} })
    expect(def.kind).toBe('mixed')
  })

  test('invalid kind when neither provided', () => {
    const def = defineNode({ type: 'a' })
    expect(def.kind).toBe('invalid')
  })

  test('defaults applied to lod config', () => {
    const def = defineNode({ type: 'a', view: () => null })
    expect(def.lod.minZoomForReact).toBe(0.7)
    expect(def.lod.minZoomForPlaceholder).toBe(0.3)
    expect(def.lod.snapshotMaxAge).toBe(Number.POSITIVE_INFINITY)
  })

  test('lod overrides accepted', () => {
    const def = defineNode({
      type: 'a',
      view: () => null,
      lod: { minZoomForReact: 0.5, minZoomForPlaceholder: 0.1 },
    })
    expect(def.lod.minZoomForReact).toBe(0.5)
    expect(def.lod.minZoomForPlaceholder).toBe(0.1)
    // snapshotMaxAge falls back to default when not overridden
    expect(def.lod.snapshotMaxAge).toBe(Number.POSITIVE_INFINITY)
  })
})

describe('store node-type registry', () => {
  test('getNodeTypeDef returns the registered def', () => {
    const def = defineNode({ type: 'chart-card', view: () => null })
    const store = createCanvasStore({ clientId: asClientId('u-t'), nodeTypes: [def] })
    expect(store.getNodeTypeDef('chart-card')).toBe(def)
    expect(store.getNodeTypeDef('rect')).toBeUndefined()
  })

  test('no nodeTypes option → registry empty', () => {
    const store = createCanvasStore({ clientId: asClientId('u-t') })
    expect(store.getNodeTypeDef('chart-card')).toBeUndefined()
  })
})
