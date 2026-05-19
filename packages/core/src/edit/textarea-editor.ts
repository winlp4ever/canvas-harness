import {
  FONT_FAMILY_MAP,
  FONT_SIZE_MAP,
  LINE_HEIGHT_MAP,
} from '../text'
import {
  handleEnter,
  insertLink,
  toggleBold,
  toggleCode,
  toggleItalic,
  toggleStrike,
  toggleUnderline,
} from './markdown-shortcuts'
import type { EditorAdapter, EditorAdapterFactory } from './adapter'

/**
 * Default in-place editor — a plain `<textarea>` positioned over the
 * editing node. See Phase 7 plan.
 *
 * - Auto-sizes its height to its scrollHeight (DOM-native).
 * - Font matches the node's style so what you type roughly matches what
 *   you'll see on commit.
 * - Cmd+B/I/U/Shift+X/E/K: bold/italic/underline/strike/code/link.
 * - Enter inside a `- ` line continues the bullet; double-Enter exits.
 * - Esc / Cmd+Enter / blur: commit. (cancel is wired by the renderer.)
 */
export const createDefaultTextareaEditor: EditorAdapterFactory = ({
  node,
  container,
  camera,
  onCommit,
  onCancel,
}): EditorAdapter => {
  void onCancel
  const style = node.style ?? {}
  const fontSize = style.fontSize ?? 'M'
  const fontFamily = style.fontFamily ?? 'handwriting'
  const align = style.textAlign ?? 'center'
  const color = style.textColor ?? '#1f2937'

  const fontPx = FONT_SIZE_MAP[fontSize]
  const lineHeightPx = LINE_HEIGHT_MAP[fontSize]

  // Screen-space placement: node world-(x,y) → screen via camera.
  const screenX = (node.x - camera.x) * camera.z
  const screenY = (node.y - camera.y) * camera.z
  const screenW = node.w * camera.z
  const screenH = node.h * camera.z

  const ta = document.createElement('textarea')
  ta.value = node.content ?? ''
  ta.spellcheck = false
  ta.style.position = 'absolute'
  ta.style.left = `${screenX}px`
  ta.style.top = `${screenY}px`
  ta.style.width = `${screenW}px`
  ta.style.minHeight = `${screenH}px`
  ta.style.padding = '6px'
  ta.style.margin = '0'
  ta.style.boxSizing = 'border-box'
  ta.style.border = '1px solid #3b82f6'
  ta.style.borderRadius = '4px'
  ta.style.outline = 'none'
  ta.style.resize = 'none'
  ta.style.overflow = 'hidden'
  ta.style.background = style.backgroundColor ?? '#ffffff'
  ta.style.color = color
  ta.style.fontFamily = FONT_FAMILY_MAP[fontFamily]
  ta.style.fontSize = `${fontPx * camera.z}px`
  ta.style.lineHeight = `${lineHeightPx * camera.z}px`
  ta.style.textAlign = align
  ta.style.whiteSpace = 'pre-wrap'
  ta.style.wordBreak = 'break-word'
  ta.style.zIndex = '20'

  const autosize = (): void => {
    ta.style.height = 'auto'
    const min = screenH
    ta.style.height = `${Math.max(min, ta.scrollHeight)}px`
  }

  const commitNow = (): void => {
    onCommit(ta.value)
  }

  const applyTransform = (t: { value: string; selStart: number; selEnd: number }): void => {
    ta.value = t.value
    ta.setSelectionRange(t.selStart, t.selEnd)
    autosize()
  }

  const onInput = (): void => {
    autosize()
  }
  const onBlur = (): void => {
    commitNow()
  }
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      commitNow()
      return
    }
    const meta = e.metaKey || e.ctrlKey
    if (meta && e.key === 'Enter') {
      e.preventDefault()
      commitNow()
      return
    }
    if (meta && !e.shiftKey && (e.key === 'b' || e.key === 'B')) {
      e.preventDefault()
      applyTransform(toggleBold(ta.value, ta.selectionStart, ta.selectionEnd))
      return
    }
    if (meta && !e.shiftKey && (e.key === 'i' || e.key === 'I')) {
      e.preventDefault()
      applyTransform(toggleItalic(ta.value, ta.selectionStart, ta.selectionEnd))
      return
    }
    if (meta && !e.shiftKey && (e.key === 'u' || e.key === 'U')) {
      e.preventDefault()
      applyTransform(toggleUnderline(ta.value, ta.selectionStart, ta.selectionEnd))
      return
    }
    if (meta && e.shiftKey && (e.key === 'x' || e.key === 'X')) {
      e.preventDefault()
      applyTransform(toggleStrike(ta.value, ta.selectionStart, ta.selectionEnd))
      return
    }
    if (meta && !e.shiftKey && (e.key === 'e' || e.key === 'E')) {
      e.preventDefault()
      applyTransform(toggleCode(ta.value, ta.selectionStart, ta.selectionEnd))
      return
    }
    if (meta && !e.shiftKey && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault()
      const url = window.prompt('URL') ?? ''
      applyTransform(insertLink(ta.value, ta.selectionStart, ta.selectionEnd, url))
      return
    }
    if (e.key === 'Enter' && !e.shiftKey && !meta) {
      const t = handleEnter(ta.value, ta.selectionStart, ta.selectionEnd)
      if (t) {
        e.preventDefault()
        applyTransform(t)
      }
    }
  }

  ta.addEventListener('input', onInput)
  ta.addEventListener('blur', onBlur)
  ta.addEventListener('keydown', onKeyDown)
  container.appendChild(ta)
  // Defer focus until after mount to ensure layout settled.
  requestAnimationFrame(() => {
    ta.focus()
    ta.setSelectionRange(ta.value.length, ta.value.length)
    autosize()
  })

  return {
    focus: () => ta.focus(),
    getValue: () => ta.value,
    setValue: (text: string) => {
      ta.value = text
      autosize()
    },
    destroy: () => {
      ta.removeEventListener('input', onInput)
      ta.removeEventListener('blur', onBlur)
      ta.removeEventListener('keydown', onKeyDown)
      ta.remove()
    },
  }
}
