/**
 * rAF-driven frame loop — see ARCHITECTURE.md §4.3.
 *
 * The renderer marks layers dirty via `requestFrame()`; the loop coalesces
 * multiple requests into one paint per rAF tick. Idle frames cost nothing
 * because we only schedule when something is dirty.
 *
 * Per-frame timing is captured so consumers can drive perf overlays.
 */
export type FrameStats = {
  /** Most recent frame duration in ms (drawFn + overhead). */
  lastMs: number
  /** Running average over the last `historySize` frames. */
  avgMs: number
  /** Number of frames painted since start. */
  frames: number
  /** Frames drawn in the last 1000ms (FPS measurement). */
  fps: number
}

export type FrameLoop = {
  start(): void
  stop(): void
  requestFrame(): void
  stats(): FrameStats
}

type Opts = {
  draw: () => void
  historySize?: number
}

export const createFrameLoop = ({ draw, historySize = 60 }: Opts): FrameLoop => {
  let running = false
  let scheduled = false
  let frameId = 0
  const history: number[] = []
  let frames = 0
  let lastMs = 0
  let avgMs = 0
  // rolling window of frame timestamps for FPS in the last second
  const fpsWindow: number[] = []
  let fps = 0

  const tick = (): void => {
    frameId = 0
    scheduled = false
    if (!running) return

    const t0 = performance.now()
    draw()
    const dur = performance.now() - t0

    history.push(dur)
    if (history.length > historySize) history.shift()
    let sum = 0
    for (const v of history) sum += v
    avgMs = sum / history.length
    lastMs = dur
    frames++

    fpsWindow.push(t0)
    const cutoff = t0 - 1000
    while (fpsWindow.length > 0 && fpsWindow[0]! < cutoff) fpsWindow.shift()
    fps = fpsWindow.length
  }

  const schedule = (): void => {
    if (scheduled || !running) return
    scheduled = true
    frameId = requestAnimationFrame(tick)
  }

  return {
    start() {
      if (running) return
      running = true
      schedule()
    },
    stop() {
      running = false
      if (frameId !== 0) {
        cancelAnimationFrame(frameId)
        frameId = 0
      }
      scheduled = false
    },
    requestFrame() {
      schedule()
    },
    stats: () => ({ lastMs, avgMs, frames, fps }),
  }
}
