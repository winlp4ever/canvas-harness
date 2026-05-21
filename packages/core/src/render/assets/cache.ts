/**
 * Renderer-side asset cache for `image` and `icon` node types.
 *
 * Why a cache: paint hot-path is sync; image / SVG decoding is async.
 * Each node carries its source on `node.data.src`; on first paint we
 * trigger an async decode and return a placeholder. When the decode
 * lands the cache fires `onReady`, which the renderer wires to a
 * static repaint so the next frame blits the real bitmap.
 *
 * Eviction: LRU bounded by `MAX_ENTRIES`. Entries hold either an
 * `HTMLImageElement` (raster) or an `ImageBitmap` (rasterized SVG).
 * Decoded images are GC-friendly — once the cache evicts the wrapper,
 * the browser frees the underlying pixel buffer.
 *
 * SVG raster cache keys by (markup, color, sizeBucket) so resizing an
 * icon node only rasterizes at the new size, leaving the previous
 * resolution available for siblings still at that size.
 */
import { applySvgColor } from '../../assets'

const MAX_ENTRIES = 256

type ImageEntry = {
  kind: 'image'
  state: 'pending' | 'ready' | 'error'
  bitmap: HTMLImageElement | null
  err?: unknown
}

type IconEntry = {
  kind: 'icon'
  state: 'pending' | 'ready' | 'error'
  bitmap: ImageBitmap | null
  err?: unknown
}

type Entry = ImageEntry | IconEntry

/**
 * Bucket the requested icon raster size to a power-of-two step so
 * minor zoom changes don't churn the rasterizer. 32, 64, 128, 256,
 * 512. Above 512 the cache disables bucketing (one entry per exact
 * size) since fewer nodes hit those sizes.
 */
const bucketSize = (px: number): number => {
  if (px <= 32) return 32
  if (px <= 64) return 64
  if (px <= 128) return 128
  if (px <= 256) return 256
  if (px <= 512) return 512
  return Math.ceil(px / 256) * 256
}

export type AssetCacheOptions = {
  /** Called when a pending entry transitions to ready or error. */
  onReady?: () => void
}

export type AssetCache = {
  /** Returns a loaded HTMLImageElement or null if still loading. */
  getImage(src: string): HTMLImageElement | null
  /**
   * Returns a rasterized ImageBitmap for the given SVG markup at the
   * given on-device pixel size + tint color, or null if pending.
   */
  getIcon(markup: string, color: string | undefined, devicePixelSize: number): ImageBitmap | null
  /** Frees decoded bitmaps. Call from renderer.dispose(). */
  dispose(): void
}

export const createAssetCache = (opts: AssetCacheOptions = {}): AssetCache => {
  const entries = new Map<string, Entry>()
  let disposed = false

  const notify = (): void => {
    if (disposed) return
    opts.onReady?.()
  }

  const touch = (key: string, entry: Entry): void => {
    entries.delete(key)
    entries.set(key, entry)
    if (entries.size > MAX_ENTRIES) {
      // Evict the oldest entry (insertion-order iteration on Map).
      const oldestKey = entries.keys().next().value
      if (oldestKey !== undefined) {
        const evicted = entries.get(oldestKey)
        if (evicted?.kind === 'icon' && evicted.bitmap) evicted.bitmap.close?.()
        entries.delete(oldestKey)
      }
    }
  }

  const startImageDecode = (key: string, src: string): void => {
    const entry: ImageEntry = { kind: 'image', state: 'pending', bitmap: null }
    touch(key, entry)
    const img = new Image()
    // Data URIs are same-origin; no crossorigin attribute needed.
    img.onload = () => {
      if (disposed) return
      entry.state = 'ready'
      entry.bitmap = img
      notify()
    }
    img.onerror = e => {
      if (disposed) return
      entry.state = 'error'
      entry.err = e
      notify()
    }
    img.src = src
  }

  const startIconRaster = (
    key: string,
    markup: string,
    color: string | undefined,
    sizePx: number,
  ): void => {
    const entry: IconEntry = { kind: 'icon', state: 'pending', bitmap: null }
    touch(key, entry)
    const colored = color ? applySvgColor(markup, color) : markup
    const blob = new Blob([colored], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = async () => {
      URL.revokeObjectURL(url)
      if (disposed) return
      try {
        // Use the intrinsic image dimensions but cap to the requested
        // bucket size; createImageBitmap with options gives a crisp
        // result at the target pixel grid without an OffscreenCanvas
        // dance in the simple cases.
        const bitmap = await createImageBitmap(img, {
          resizeWidth: sizePx,
          resizeHeight: sizePx,
          resizeQuality: 'high',
        })
        if (disposed) {
          bitmap.close?.()
          return
        }
        entry.state = 'ready'
        entry.bitmap = bitmap
        notify()
      } catch (e) {
        entry.state = 'error'
        entry.err = e
        notify()
      }
    }
    img.onerror = e => {
      URL.revokeObjectURL(url)
      if (disposed) return
      entry.state = 'error'
      entry.err = e
      notify()
    }
    img.src = url
  }

  return {
    getImage(src) {
      const key = `img:${src}`
      const existing = entries.get(key)
      if (existing && existing.kind === 'image') {
        if (existing.state === 'ready') {
          // Promote on access so LRU works.
          touch(key, existing)
          return existing.bitmap
        }
        return null
      }
      startImageDecode(key, src)
      return null
    },
    getIcon(markup, color, devicePixelSize) {
      const size = bucketSize(Math.max(1, Math.ceil(devicePixelSize)))
      const key = `icon:${size}:${color ?? ''}:${markup}`
      const existing = entries.get(key)
      if (existing && existing.kind === 'icon') {
        if (existing.state === 'ready') {
          touch(key, existing)
          return existing.bitmap
        }
        return null
      }
      startIconRaster(key, markup, color, size)
      return null
    },
    dispose() {
      disposed = true
      for (const entry of entries.values()) {
        if (entry.kind === 'icon' && entry.bitmap) entry.bitmap.close?.()
      }
      entries.clear()
    },
  }
}
