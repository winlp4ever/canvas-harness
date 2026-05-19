import { LINE_HEIGHT_MAP, estimateMarkdownContentHeight } from '../text'
import type { Node } from '../types'

/**
 * Auto-fit policy — see ARCHITECTURE.md §8 and IMPLEMENTATION.md Phase 7.
 *
 * Height of a content-bearing node is recomputed on **commit boundaries**:
 *   - `store.addNode` (when creating a node with content)
 *   - `store.commitEdit` (when the user finishes editing)
 *   - resize-commit (when a width-resize ends; new wrap → new height)
 *
 * NEVER per-keystroke. The textarea-editor grows its own DOM textarea
 * during typing; the canvas catches up once on commit.
 */

/**
 * Should this node auto-fit its height to its content?
 *
 * Default: true for all node types — matches tldraw/excalidraw behavior
 * where a sticky / shape grows to fit whatever you type. Set
 * `style.autoFit: false` to opt out.
 */
export const shouldAutoFit = (node: Node): boolean => {
  return node.style?.autoFit !== false
}

/**
 * Returns the height this node *would* have if its content laid out at its
 * current width and style. For empty content, returns one line-height so a
 * shape with the empty-content placeholder isn't zero-sized.
 */
export const computeAutoFitHeight = (node: Node): number => {
  const fontSize = node.style?.fontSize ?? 'M'
  const oneLine = LINE_HEIGHT_MAP[fontSize]
  const content = node.content ?? ''
  if (!content.trim()) return oneLine
  return Math.max(
    oneLine,
    estimateMarkdownContentHeight({
      text: content,
      width: node.w,
      fontFamily: node.style?.fontFamily,
      fontSize,
      textStyle: node.style?.textStyle,
    }),
  )
}

/**
 * Pure: returns a copy of `node` with `h` adjusted to fit `content`, if
 * the node opts into autofit. Otherwise returns the input unchanged.
 *
 * Pure-by-design so it can run inside `addNode` before the op is enqueued
 * (avoids a double op: add + update-height).
 */
export const withAutoFitHeight = (node: Node): Node => {
  if (!shouldAutoFit(node)) return node
  // Empty content → no autofit; preserve the user's explicit h. Otherwise
  // we'd shrink every freshly-created shape to a single line.
  if (!node.content || !node.content.trim()) return node
  const fitted = computeAutoFitHeight(node)
  // Grow-only: never collapse a deliberately-tall node down to its
  // content height. tldraw / excalidraw behave the same way.
  if (fitted <= node.h) return node
  return { ...node, h: fitted }
}
