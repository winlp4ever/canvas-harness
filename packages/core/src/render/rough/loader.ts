/**
 * Lazy-loader for `roughjs` — avoids inlining its ~30KB gzip into core
 * for users who never set `roughness > 0`.
 *
 * First caller triggers `import('roughjs/bin/canvas')`. Until the
 * promise resolves, `getRoughCanvas` returns `null` and the renderer
 * falls back to plain strokes. Once loaded, subsequent calls return
 * the cached factory synchronously.
 */
type RoughCanvasCtor = new (canvas: HTMLCanvasElement) => RoughCanvasLike

export type RoughCanvasLike = {
  generator: {
    path(d: string, options?: object): RoughDrawableLike
    linearPath(points: [number, number][], options?: object): RoughDrawableLike
    ellipse(x: number, y: number, w: number, h: number, options?: object): RoughDrawableLike
  }
  draw(drawable: RoughDrawableLike): void
}

export type RoughDrawableLike = unknown

let cachedCtor: RoughCanvasCtor | null = null
let loadPromise: Promise<RoughCanvasCtor | null> | null = null
const readyCallbacks = new Set<() => void>()

/**
 * Returns the `RoughCanvas` constructor if ready. Triggers the lazy
 * import on first call. Returns `null` until the module resolves;
 * callers should fall back to plain stroke that frame and call
 * `onRoughReady(cb)` to repaint when rough.js becomes available.
 */
export const getRoughCanvasCtor = (): RoughCanvasCtor | null => {
  if (cachedCtor) return cachedCtor
  if (!loadPromise) {
    loadPromise = import('roughjs/bin/canvas')
      .then(mod => {
        cachedCtor = (mod.RoughCanvas as unknown) as RoughCanvasCtor
        for (const cb of readyCallbacks) cb()
        readyCallbacks.clear()
        return cachedCtor
      })
      .catch(err => {
        console.warn('[rough] failed to load roughjs:', err)
        return null
      })
  }
  return null
}

/**
 * Registers a callback that fires once when rough.js becomes
 * available. No-op when rough is already loaded — caller should check
 * `getRoughCanvasCtor() !== null` first. Used by the renderer to
 * trigger a repaint after the first opt-in to `roughness > 0`.
 */
export const onRoughReady = (cb: () => void): void => {
  if (cachedCtor) return
  readyCallbacks.add(cb)
}

/** Reset state — tests only. */
export const __resetRoughLoader = (): void => {
  cachedCtor = null
  loadPromise = null
  readyCallbacks.clear()
}
