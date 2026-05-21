import type { CanvasStore, StoreEventHandler, StoreEventName, Unsubscribe } from '../store'

/**
 * Extension system — see ARCHITECTURE.md §13.9.
 *
 * The escape hatch for features the core won't ship: snap-to-grid,
 * alignment guides, minimap, autosave, AI plugins. Extensions get a
 * store handle + event subscription helper; they can mutate the store
 * (via the regular API), subscribe to events, and clean up on uninstall.
 *
 * Bare-bones by design — anything more (paint hooks, custom handles,
 * shortcut registration) is a v2 concern. Authors who need those today
 * can compose them inside `onInstall` against the store directly.
 */
export type ExtensionApi = {
  /** The store the extension is attached to. */
  store: CanvasStore
  /**
   * Subscribe to a store event with automatic cleanup on uninstall —
   * authors don't have to thread their own teardown.
   */
  on<E extends StoreEventName>(event: E, cb: StoreEventHandler<E>): Unsubscribe
}

export type Extension = {
  /** Unique name; one extension per name per store. */
  name: string
  /**
   * Called when the extension is installed. May return a cleanup
   * function that runs on uninstall (in addition to auto-unsubscribed
   * listeners registered via `api.on`).
   *
   * `void` in the union is deliberate — extensions whose installer
   * does its work via `api.on` (auto-cleaned-up) don't need to return
   * anything. `undefined | (() => void)` would require an explicit
   * `return undefined`, which is noise. Biome's noConfusingVoidType
   * fires on this pattern; the suppression below is intentional.
   */
  // biome-ignore lint/suspicious/noConfusingVoidType: see comment above
  onInstall(api: ExtensionApi): void | (() => void)
}

/**
 * Defines an extension. Pure identity — exists for symmetry with
 * `defineNode` and to make call sites read nicely.
 *
 * @example
 * export const snapToGrid = defineExtension({
 *   name: 'snap-to-grid',
 *   onInstall: api => {
 *     api.on('interaction', state => {
 *       if (state.mode !== 'dragging') return
 *       const snapped = {
 *         x: Math.round(state.dragDelta.x / 20) * 20,
 *         y: Math.round(state.dragDelta.y / 20) * 20,
 *       }
 *       api.store.setInteractionState({ dragDelta: snapped })
 *     })
 *   },
 * })
 */
export const defineExtension = (ext: Extension): Extension => ext

const installed = new WeakMap<CanvasStore, Map<string, () => void>>()

/**
 * Installs an extension against a store. Returns an `uninstall()`
 * function. Re-installing the same name replaces the previous
 * instance.
 *
 * @example
 * useEffect(() => {
 *   if (snapEnabled) return installExtension(store, snapToGrid)
 * }, [store, snapEnabled])
 */
export const installExtension = (store: CanvasStore, ext: Extension): Unsubscribe => {
  let registry = installed.get(store)
  if (!registry) {
    registry = new Map()
    installed.set(store, registry)
  }
  // Replace existing.
  const existing = registry.get(ext.name)
  if (existing) existing()

  const teardownFns: (() => void)[] = []
  const api: ExtensionApi = {
    store,
    on(event, cb) {
      const unsub = store.subscribe(event, cb)
      teardownFns.push(unsub)
      return unsub
    },
  }
  const userTeardown = ext.onInstall(api)
  if (typeof userTeardown === 'function') teardownFns.push(userTeardown)

  const teardown = (): void => {
    for (const fn of teardownFns) fn()
    teardownFns.length = 0
    registry?.delete(ext.name)
  }
  registry.set(ext.name, teardown)
  return teardown
}

/** Test / debug aid: list installed extension names for a store. */
export const installedExtensions = (store: CanvasStore): string[] => {
  const registry = installed.get(store)
  return registry ? [...registry.keys()] : []
}
