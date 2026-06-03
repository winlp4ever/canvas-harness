/**
 * Browser-mode tests for `exportSelectionSvg`. Image + icon node
 * emission uses DOMParser (via extractSvgDimensions) so these can't
 * live in the node-tier test run.
 */
import { describe, expect, test } from 'vitest'
import { exportSelectionSvg } from '../src/export'
import { createCanvasStore } from '../src/store'
import { type Node, asClientId, asNodeId } from '../src/types'

const TINY_PNG_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

const ICON_SVG_24 =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M2 2H22V22H2Z" fill="currentColor" /></svg>'

const makeNode = (overrides: Partial<Node> & { id: string }): Node => {
  const { id, ...rest } = overrides
  return {
    id: asNodeId(id),
    type: 'rect',
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    angle: 0,
    z: 0,
    groups: [],
    ...rest,
  }
}

describe('exportSelectionSvg: image nodes', () => {
  test('emits <image> with data URI href + node geometry', () => {
    const store = createCanvasStore({ clientId: asClientId('u-t') })
    const id = asNodeId('img')
    store.addNode(
      makeNode({
        id: 'img',
        type: 'image',
        x: 50,
        y: 60,
        w: 200,
        h: 120,
        data: { src: TINY_PNG_DATA_URI, naturalW: 1, naturalH: 1 },
      }),
    )
    store.setSelection([id])
    const svg = exportSelectionSvg(store, { padding: 0 })
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
    const img = doc.querySelector('image')
    expect(img).not.toBeNull()
    // SVG `href` lives in xlink namespace in older docs; modern is plain `href`.
    const href = img!.getAttribute('href') ?? img!.getAttribute('xlink:href')
    expect(href).toBe(TINY_PNG_DATA_URI)
    expect(img!.getAttribute('width')).toBe('200')
    expect(img!.getAttribute('height')).toBe('120')
    expect(img!.getAttribute('preserveAspectRatio')).toBe('none')
  })

  test('image with empty data.src emits no <image> tag', () => {
    const store = createCanvasStore({ clientId: asClientId('u-t') })
    const id = asNodeId('img')
    store.addNode(
      makeNode({
        id: 'img',
        type: 'image',
        data: { src: '', naturalW: 1, naturalH: 1 },
      }),
    )
    store.setSelection([id])
    const svg = exportSelectionSvg(store)
    expect(svg).not.toContain('<image')
  })
})

describe('exportSelectionSvg: icon nodes', () => {
  test('inlines source <svg> wrapped in translate+scale <g>', () => {
    const store = createCanvasStore({ clientId: asClientId('u-t') })
    const id = asNodeId('ic')
    store.addNode(
      makeNode({
        id: 'ic',
        type: 'icon',
        x: 0,
        y: 0,
        w: 48,
        h: 48,
        data: { src: ICON_SVG_24 },
      }),
    )
    store.setSelection([id])
    const svg = exportSelectionSvg(store, { padding: 0 })
    // Source SVG is 24×24, node is 48×48 → scale should be 2×2.
    expect(svg).toContain('scale(2 2)')
    // Inner path survives the inlining.
    expect(svg).toContain('M2 2H22V22H2Z')
  })

  test('respects style.iconColor by recoloring currentColor', () => {
    const store = createCanvasStore({ clientId: asClientId('u-t') })
    const id = asNodeId('ic')
    store.addNode(
      makeNode({
        id: 'ic',
        type: 'icon',
        w: 24,
        h: 24,
        data: { src: ICON_SVG_24 },
        style: { iconColor: '#ff0000' },
      }),
    )
    store.setSelection([id])
    const svg = exportSelectionSvg(store)
    expect(svg).toContain('#ff0000')
    expect(svg).not.toContain('currentColor')
  })
})
