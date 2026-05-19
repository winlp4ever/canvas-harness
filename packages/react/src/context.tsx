import type { CanvasStore } from '@canvas-harness/core'
import { type ReactNode, createContext, useContext } from 'react'

/**
 * CanvasContext / CanvasProvider — see ARCHITECTURE.md §13.
 *
 * One store per provider tree. Hooks resolve the store from context so
 * components anywhere in the tree (sidebar panels, the canvas surface,
 * status bars, custom-node views) can subscribe to the same store
 * without prop-drilling.
 *
 * `<Canvas>` reads the store from context. If a consumer needs hooks
 * but doesn't render `<Canvas>` (e.g. a standalone control panel), they
 * wrap the panel in `<CanvasProvider>` themselves.
 */
const CanvasContext = createContext<CanvasStore | null>(null)

export type CanvasProviderProps = {
  store: CanvasStore
  children: ReactNode
}

export function CanvasProvider({ store, children }: CanvasProviderProps) {
  return <CanvasContext.Provider value={store}>{children}</CanvasContext.Provider>
}

/**
 * Returns the store from context. Throws if called outside a
 * `<CanvasProvider>` — that's a programming error, not a runtime one,
 * so we fail loud.
 */
export function useCanvasStore(): CanvasStore {
  const store = useContext(CanvasContext)
  if (!store) {
    throw new Error(
      'useCanvasStore() must be used inside <CanvasProvider>. ' +
        'Wrap your tree with <CanvasProvider store={store}>.',
    )
  }
  return store
}
