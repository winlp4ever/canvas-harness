/**
 * Browser-mode tests for `exportSelectionSvg`. Image + icon node
 * emission uses DOMParser (via extractSvgDimensions) so these can't
 * live in the node-tier test run.
 */
import { describe, expect, test } from 'vitest'
import { exportSelectionSvg } from '../src/export'
import { createCanvasStore } from '../src/store'
import { type Edge, type Node, asClientId, asEdgeId, asNodeId } from '../src/types'

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

describe('exportSelectionSvg: paint order', () => {
  /**
   * Returns the indices of each fill color in the SVG string, in
   * the order they appear. Lets a test assert "color A comes
   * before color B in the output" — which directly corresponds to
   * "A paints first, B paints on top" in SVG.
   */
  const fillOrder = (svg: string, colors: string[]): number[] =>
    colors.map(c => svg.indexOf(`fill="${c}"`))

  test('nodes are painted in (z asc, id asc) order regardless of insertion order', () => {
    // Add nodes in a NON-z order. Each gets a distinct background
    // color so we can identify them in the SVG output. With the
    // fix, the SVG should emit them in z-order: z=1 first (bottom
    // of the paint stack), z=5 last (top).
    const store = createCanvasStore({ clientId: asClientId('u-t') })
    store.addNode(makeNode({ id: 'high', z: 5, style: { backgroundColor: '#aaaaaa' } }))
    store.addNode(makeNode({ id: 'low', z: 1, style: { backgroundColor: '#bbbbbb' } }))
    store.addNode(makeNode({ id: 'mid', z: 3, style: { backgroundColor: '#cccccc' } }))
    store.setSelection(['high', 'low', 'mid'].map(asNodeId))
    const svg = exportSelectionSvg(store)
    const [iLow, iMid, iHigh] = fillOrder(svg, ['#bbbbbb', '#cccccc', '#aaaaaa'])
    expect(iLow).toBeGreaterThan(-1)
    expect(iMid).toBeGreaterThan(iLow!)
    expect(iHigh).toBeGreaterThan(iMid!)
  })

  test('frames paint behind non-frames even when the frame has higher z', () => {
    // Frame with high z (10) added FIRST; non-frame with low z (1)
    // added SECOND. By pure z-sort the frame would paint last (on
    // top), but frames are treated as background chrome and must
    // paint behind everything regardless of z.
    // Frame nodes serialize to SVG as a dashed placeholder rect
    // (`stroke-dasharray="4 4"`) — that's our anchor for "frame
    // appeared here." Non-frame rect has a distinctive fill.
    const store = createCanvasStore({ clientId: asClientId('u-t') })
    store.addNode(makeNode({ id: 'fr', type: 'frame', z: 10 }))
    store.addNode(makeNode({ id: 'rect', z: 1, style: { backgroundColor: '#bbbbbb' } }))
    store.setSelection(['fr', 'rect'].map(asNodeId))
    const svg = exportSelectionSvg(store)
    const iFrame = svg.indexOf('stroke-dasharray="4 4"')
    const iRect = svg.indexOf('fill="#bbbbbb"')
    expect(iFrame).toBeGreaterThan(-1)
    expect(iRect).toBeGreaterThan(iFrame)
  })

  test('edges are painted in (z asc, id asc) order', () => {
    const store = createCanvasStore({ clientId: asClientId('u-t') })
    store.addNode(makeNode({ id: 'a', x: 0, y: 0 }))
    store.addNode(makeNode({ id: 'b', x: 300, y: 0 }))
    // Edge with HIGHER z added FIRST; edge with LOWER z added SECOND.
    // Sort should emit low-z edge first in the SVG.
    const highEdge: Edge = {
      id: asEdgeId('e-high'),
      source: { nodeId: asNodeId('a'), localOffset: { x: 100, y: 50 } },
      target: { nodeId: asNodeId('b'), localOffset: { x: 0, y: 50 } },
      pathStyle: 'straight',
      z: 5,
      groups: [],
      style: { strokeColor: '#dd0000' },
    }
    const lowEdge: Edge = {
      id: asEdgeId('e-low'),
      source: { nodeId: asNodeId('a'), localOffset: { x: 100, y: 50 } },
      target: { nodeId: asNodeId('b'), localOffset: { x: 0, y: 50 } },
      pathStyle: 'straight',
      z: 1,
      groups: [],
      style: { strokeColor: '#00dd00' },
    }
    store.addEdge(highEdge)
    store.addEdge(lowEdge)
    store.setSelection(['a', 'b'].map(asNodeId))
    const svg = exportSelectionSvg(store)
    const iLowStroke = svg.indexOf('stroke="#00dd00"')
    const iHighStroke = svg.indexOf('stroke="#dd0000"')
    expect(iLowStroke).toBeGreaterThan(-1)
    expect(iHighStroke).toBeGreaterThan(iLowStroke)
  })
})
