/**
 * Reference hook for persisting a CanvasStore to a back-end.
 *
 * Subscribes to commit events ('change'), debounces for `delayMs`,
 * then collects a snapshot via the store's synchronous read API and
 * awaits `save(scene)`. The save itself is async — the library is
 * sync end-to-end, so all I/O lives in the caller's `save`.
 *
 * Camera (pan/zoom) is deliberately NOT persisted: view state is
 * not document state. Treating pan/zoom as "unsaved changes" both
 * misrepresents the data model and tanks pan FPS at large scenes
 * (every camera frame would trigger a setState + App re-render).
 * If you need to remember the viewport across sessions, save it
 * separately (e.g. to localStorage on a less aggressive cadence) —
 * don't put it on the same save bus as document edits.
 *
 * Status state is exposed for UI badges ("saving…" / "saved").
 *
 * What this does NOT do (intentionally — keep the example small):
 *   - retry on failure
 *   - queue concurrent saves (a new debounce while a save is in-flight
 *     fires another save after it resolves; for stronger guarantees,
 *     add a single-flight queue with a "dirty after save" flag)
 *   - persist selection / interaction / camera state
 */
import type { CanvasStore } from '@canvas-harness/core'
import { useEffect, useState } from 'react'
import type { PersistedScene } from '../db/fake-db'

export type SaveStatus =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: number }
  | { kind: 'error'; message: string }

export type UseDebouncedSaveOptions = {
  store: CanvasStore
  save: (scene: PersistedScene) => Promise<void>
  /** Trailing-edge debounce window. Default 500ms. */
  delayMs?: number
}

export const useDebouncedSave = ({
  store,
  save,
  delayMs = 500,
}: UseDebouncedSaveOptions): SaveStatus => {
  const [status, setStatus] = useState<SaveStatus>({ kind: 'idle' })

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let cancelled = false

    const snapshot = (): PersistedScene => ({
      nodes: store.getAllNodes(),
      edges: store.getAllEdges(),
      groups: store.getAllGroups(),
    })

    const flush = async () => {
      timer = null
      if (cancelled) return
      setStatus({ kind: 'saving' })
      try {
        await save(snapshot())
        if (cancelled) return
        setStatus({ kind: 'saved', at: Date.now() })
      } catch (err) {
        if (cancelled) return
        setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
      }
    }

    const schedule = () => {
      // Gate the setState on transition (no pending timer → start
      // pending). Each repeat call (rapid edits, drag-resize streams)
      // just shuffles the timer — cheap. The setState only fires
      // when the burst begins, not on every event.
      if (timer === null) setStatus({ kind: 'pending' })
      else clearTimeout(timer)
      timer = setTimeout(flush, delayMs)
    }

    const unsubChange = store.subscribe('change', schedule)

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      unsubChange()
    }
  }, [store, save, delayMs])

  return status
}
