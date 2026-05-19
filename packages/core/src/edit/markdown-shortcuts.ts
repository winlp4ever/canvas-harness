/**
 * Editor markdown shortcuts — see IMPLEMENTATION.md Phase 7.
 *
 * Pure string-transform helpers, framework-agnostic. The default DOM
 * textarea editor wires these to keyboard events; consumers using a
 * custom adapter (Lexical / ProseMirror) can ignore this module.
 *
 * Each transform takes `(value, selStart, selEnd)` and returns the new
 * value + new selection so the editor can update its DOM textarea in
 * one pass.
 */

export type Transform = {
  value: string
  selStart: number
  selEnd: number
}

const wrapSelection = (
  value: string,
  selStart: number,
  selEnd: number,
  wrapper: string,
): Transform => {
  const wrapLen = wrapper.length
  // Case 1: selection is immediately surrounded by the wrapper (selection
  // is the inner text). Strip the surrounding markers.
  if (
    selStart >= wrapLen &&
    value.slice(selStart - wrapLen, selStart) === wrapper &&
    value.slice(selEnd, selEnd + wrapLen) === wrapper
  ) {
    const next = value.slice(0, selStart - wrapLen) + value.slice(selStart, selEnd) + value.slice(selEnd + wrapLen)
    return {
      value: next,
      selStart: selStart - wrapLen,
      selEnd: selEnd - wrapLen,
    }
  }
  const middle = value.slice(selStart, selEnd)
  const before = value.slice(0, selStart)
  const after = value.slice(selEnd)
  // Case 2: selection itself starts and ends with the wrapper (user
  // selected the markers along with the content).
  if (middle.startsWith(wrapper) && middle.endsWith(wrapper) && middle.length >= wrapLen * 2) {
    const inner = middle.slice(wrapLen, middle.length - wrapLen)
    const next = before + inner + after
    return { value: next, selStart, selEnd: selStart + inner.length }
  }
  // Case 3: wrap the selection.
  const next = before + wrapper + middle + wrapper + after
  return {
    value: next,
    selStart: selStart + wrapLen,
    selEnd: selEnd + wrapLen,
  }
}

export const toggleBold = (v: string, s: number, e: number): Transform =>
  wrapSelection(v, s, e, '**')

export const toggleItalic = (v: string, s: number, e: number): Transform =>
  wrapSelection(v, s, e, '*')

export const toggleUnderline = (v: string, s: number, e: number): Transform =>
  wrapSelection(v, s, e, '__')

export const toggleStrike = (v: string, s: number, e: number): Transform =>
  wrapSelection(v, s, e, '~~')

export const toggleCode = (v: string, s: number, e: number): Transform =>
  wrapSelection(v, s, e, '`')

/**
 * Inserts `[selection](url)`. If `url` is empty the cursor lands inside
 * the parens so the user can type the URL.
 */
export const insertLink = (
  value: string,
  selStart: number,
  selEnd: number,
  url: string,
): Transform => {
  const before = value.slice(0, selStart)
  const middle = value.slice(selStart, selEnd) || 'link'
  const after = value.slice(selEnd)
  const inserted = `[${middle}](${url})`
  const next = before + inserted + after
  // Place cursor inside the url parens if url is empty, else at end.
  if (url) {
    const newSel = selStart + inserted.length
    return { value: next, selStart: newSel, selEnd: newSel }
  }
  const newSel = before.length + middle.length + 3 // after "]("
  return { value: next, selStart: newSel, selEnd: newSel }
}

/**
 * Auto-list — when the user presses Enter inside a `- ` (or `* `, or
 * `1. ` etc.) line, the next line gets the same prefix prepended.
 * Two consecutive Enters on an empty list line exit the list.
 *
 * Returns a transform when an auto-list rule fires, else null. The
 * editor should fall back to the textarea's default Enter behavior in
 * the null case.
 */
export const handleEnter = (value: string, selStart: number, selEnd: number): Transform | null => {
  if (selStart !== selEnd) return null
  const lineStart = value.lastIndexOf('\n', selStart - 1) + 1
  const lineText = value.slice(lineStart, selStart)
  const match = lineText.match(/^(\s*)([-*]|\d+\.) (.*)$/)
  if (!match) return null
  const indent = match[1] ?? ''
  const bullet = match[2] ?? ''
  const rest = match[3] ?? ''
  // Empty list line + Enter → exit list (remove the bullet from current
  // line; produce a plain newline).
  if (rest.trim() === '') {
    const next = value.slice(0, lineStart) + value.slice(selStart)
    return { value: next, selStart: lineStart, selEnd: lineStart }
  }
  const nextBullet = /^\d+\.$/.test(bullet)
    ? `${Number.parseInt(bullet, 10) + 1}.`
    : bullet
  const insertion = `\n${indent}${nextBullet} `
  const next = value.slice(0, selStart) + insertion + value.slice(selStart)
  const newSel = selStart + insertion.length
  return { value: next, selStart: newSel, selEnd: newSel }
}
