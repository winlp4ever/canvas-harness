/**
 * Browser-mode tests for `exportSelection` (PNG). Asset painting goes
 * through the renderer's AssetCache; we mock one here with a known
 * decoded HTMLImageElement so we can assert pixels.
 */
import { beforeAll, describe, expect, test } from 'vitest'
import { exportSelection } from '../src/export'
import type { AssetCache } from '../src/render/assets'
import { createCanvasStore } from '../src/store'
import { type Node, asClientId, asNodeId } from '../src/types'

/** Build a 4×4 fully-red PNG data URI via OffscreenCanvas. */
const makeRedPngDataUri = async (): Promise<string> => {
  const canvas = new OffscreenCanvas(4, 4)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ff0000'
  ctx.fillRect(0, 0, 4, 4)
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  return await new Promise<string>(resolve => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.readAsDataURL(blob)
  })
}

const loadImage = async (src: string): Promise<HTMLImageElement> => {
  const img = new Image()
  img.src = src
  await img.decode()
  return img
}

/** Cache stub that returns a single pre-decoded HTMLImageElement for any src. */
const makeStubCache = (img: HTMLImageElement | null): AssetCache => ({
  getImage: () => img,
  getIcon: () => null,
  dispose: () => {},
})

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

/** Decode a PNG blob and return its RGBA bytes. */
const decodePng = async (blob: Blob): Promise<Uint8ClampedArray> => {
  const bmp = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bmp.width
  canvas.height = bmp.height
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bmp, 0, 0)
  return ctx.getImageData(0, 0, bmp.width, bmp.height).data
}

const samplePixel = (pixels: Uint8ClampedArray, x: number, y: number, w: number): [number, number, number] => {
  const idx = (y * w + x) * 4
  return [pixels[idx]!, pixels[idx + 1]!, pixels[idx + 2]!]
}

describe('exportSelection (PNG): image nodes', () => {
  let redPngDataUri = ''
  beforeAll(async () => {
    redPngDataUri = await makeRedPngDataUri()
  })

  test('paints image node when assetCache provided', async () => {
    const img = await loadImage(redPngDataUri)
    expect(img.complete).toBe(true)
    expect(img.naturalWidth).toBeGreaterThan(0)
    const store = createCanvasStore({ clientId: asClientId('u-t') })
    const id = asNodeId('img')
    store.addNode(
      makeNode({
        id: 'img',
        type: 'image',
        x: 0,
        y: 0,
        w: 40,
        h: 40,
        data: { src: redPngDataUri, naturalW: 1, naturalH: 1 },
      }),
    )
    store.setSelection([id])
    let stubCalls = 0
    const stub: AssetCache = {
      getImage: () => {
        stubCalls++
        return img
      },
      getIcon: () => null,
      dispose: () => {},
    }
    const blob = await exportSelection(store, { scale: 1, padding: 0, assetCache: stub })
    expect(stubCalls).toBeGreaterThan(0)
    const bmp = await createImageBitmap(blob)
    expect(bmp.width).toBe(40)
    expect(bmp.height).toBe(40)
    const pixels = await decodePng(blob)
    // Sample center of the node — should be red, not white background.
    const [r, g, b] = samplePixel(pixels, 20, 20, 40)
    expect(r).toBeGreaterThan(200)
    expect(g).toBeLessThan(50)
    expect(b).toBeLessThan(50)
  })

  test('skips image node when assetCache absent (back-compat)', async () => {
    const store = createCanvasStore({ clientId: asClientId('u-t') })
    const id = asNodeId('img')
    store.addNode(
      makeNode({
        id: 'img',
        type: 'image',
        x: 0,
        y: 0,
        w: 40,
        h: 40,
        data: { src: redPngDataUri, naturalW: 1, naturalH: 1 },
      }),
    )
    store.setSelection([id])
    const blob = await exportSelection(store, { scale: 1, padding: 0 })
    const pixels = await decodePng(blob)
    // No assetCache → image not painted, center stays at the default
    // white background fill.
    const [r, g, b] = samplePixel(pixels, 20, 20, 40)
    expect(r).toBe(255)
    expect(g).toBe(255)
    expect(b).toBe(255)
  })
})
