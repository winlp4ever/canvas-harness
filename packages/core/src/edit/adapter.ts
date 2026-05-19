import type { CameraState, Node } from '../types'

/**
 * EditorAdapter — see ARCHITECTURE.md §8 (edit mode pluggability).
 *
 * Pluggable contract for the in-place editor. The default is a plain
 * `<textarea>` overlay (see `default-textarea-editor.ts`). Consumers can
 * swap in a Lexical / ProseMirror / TipTap subtree by implementing this
 * interface and passing it to the renderer.
 *
 * The adapter is created **per edit session** — `mount` runs on
 * `beginEdit`, `destroy` runs on `commit`/`cancel`.
 */

export type EditorAdapterMountOptions = {
  /** The node being edited. Use its style for font-family / size / align. */
  node: Node
  /** The host DOM container the adapter should append its element into. */
  container: HTMLElement
  /**
   * Current camera. The adapter is responsible for positioning its
   * element so it overlaps the node in screen-space.
   */
  camera: CameraState
  /** Device pixel ratio at edit time. Used for crisp positioning. */
  dpr: number

  /** Called when the user commits (Esc / blur / Cmd+Enter). */
  onCommit: (text: string) => void
  /** Called when the user cancels (no content change). */
  onCancel: () => void
}

export type EditorAdapter = {
  /** Focus the editor (after mount). */
  focus(): void
  /** Read the current draft text. */
  getValue(): string
  /** Replace the draft text (rare; mostly used by undo or programmatic). */
  setValue(text: string): void
  /** Tear down the editor and remove its DOM. */
  destroy(): void
}

export type EditorAdapterFactory = (opts: EditorAdapterMountOptions) => EditorAdapter
