import type { CanvasStore } from '@canvas-harness/core'
import { type ReactNode, createContext, useContext } from 'react'

const CanvasContext = createContext<CanvasStore | null>(null)

export type CanvasProviderProps = {
  store: CanvasStore
  children: ReactNode
}

/**
 * Provides a {@link CanvasStore} to descendant hooks via context.
 * Wrap your app (or just the canvas + its panels) once at the top
 * level. `<Canvas>` reads the same store from context.
 *
 * @example
 * const store = useRef(createCanvasStore()).current
 * <CanvasProvider store={store}>
 *   <Toolbar />
 *   <Canvas tool="select" />
 *   <Sidebar />
 * </CanvasProvider>
 */
export function CanvasProvider({ store, children }: CanvasProviderProps) {
  return <CanvasContext.Provider value={store}>{children}</CanvasContext.Provider>
}

/**
 * Returns the {@link CanvasStore} from context. Use this when you need
 * to mutate the store from event handlers (e.g. tool buttons, side
 * panels). For reactive reads, prefer the more specific hooks
 * (`useNode`, `useSelection`, `useCamera`, ...).
 *
 * Throws if called outside a `<CanvasProvider>`.
 *
 * @example
 * function ClearButton() {
 *   const store = useCanvasStore()
 *   return <button onClick={() => store.batch(() => {
 *     for (const n of store.getAllNodes()) store.removeNode(n.id)
 *   })}>Clear</button>
 * }
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
