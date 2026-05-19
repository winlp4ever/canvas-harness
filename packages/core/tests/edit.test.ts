import { describe, expect, test } from 'vitest'
import {
  asNodeId,
  computeAutoFitHeight,
  createCanvasStore,
  handleEnter,
  insertLink,
  shouldAutoFit,
  toggleBold,
  toggleCode,
  toggleItalic,
  toggleStrike,
  toggleUnderline,
  withAutoFitHeight,
} from '../src'
import type { Node } from '../src'

const makeNode = (overrides: Partial<Node> = {}): Node => ({
  id: asNodeId('n1'),
  type: 'text',
  x: 0,
  y: 0,
  w: 200,
  h: 100,
  angle: 0,
  z: 0,
  groups: [],
  content: '',
  ...overrides,
})

describe('shouldAutoFit', () => {
  test('all node types default to autofit', () => {
    expect(shouldAutoFit(makeNode())).toBe(true)
    expect(shouldAutoFit(makeNode({ type: 'rect' }))).toBe(true)
    expect(shouldAutoFit(makeNode({ type: 'ellipse' }))).toBe(true)
  })
  test('explicit style.autoFit: false opts out', () => {
    expect(shouldAutoFit(makeNode({ style: { autoFit: false } }))).toBe(false)
    expect(shouldAutoFit(makeNode({ type: 'rect', style: { autoFit: false } }))).toBe(false)
  })
})

describe('computeAutoFitHeight', () => {
  test('empty content returns one line-height (no zero-sized nodes)', () => {
    const h = computeAutoFitHeight(makeNode({ content: '' }))
    expect(h).toBeGreaterThan(0)
  })
  test('more content → taller', () => {
    const a = computeAutoFitHeight(makeNode({ content: 'one line' }))
    const b = computeAutoFitHeight(makeNode({ content: 'line one\nline two\nline three' }))
    expect(b).toBeGreaterThan(a)
  })
})

describe('withAutoFitHeight', () => {
  test('returns unchanged node when autofit is off', () => {
    const node = makeNode({ type: 'rect', content: 'hello', style: { autoFit: false } })
    expect(withAutoFitHeight(node)).toBe(node)
  })
  test('adjusts h when autofit is on', () => {
    const node = makeNode({ content: 'one\ntwo\nthree\nfour', h: 50 })
    const fitted = withAutoFitHeight(node)
    expect(fitted.h).not.toBe(50)
    expect(fitted.h).toBeGreaterThan(50)
  })
})

describe('store edit lifecycle', () => {
  test('beginEdit puts mode into editing', () => {
    const store = createCanvasStore()
    const id = asNodeId(store.generateId())
    store.addNode(makeNode({ id }))
    store.beginEdit(id)
    const state = store.getInteractionState()
    expect(state.mode).toBe('editing')
    expect(state.editingNodeId).toBe(id)
  })

  test('commitEdit writes content + autofit height + exits edit', () => {
    const store = createCanvasStore()
    const id = asNodeId(store.generateId())
    store.addNode(makeNode({ id, h: 50 }))
    store.beginEdit(id)
    store.commitEdit('# Heading\n\nbody text spanning multiple lines\nfor autofit to grow')
    const node = store.getNode(id)
    expect(node?.content).toBe(
      '# Heading\n\nbody text spanning multiple lines\nfor autofit to grow',
    )
    expect(node?.h).toBeGreaterThan(50)
    expect(store.getInteractionState().mode).toBe('idle')
  })

  test('cancelEdit exits without modifying content', () => {
    const store = createCanvasStore()
    const id = asNodeId(store.generateId())
    store.addNode(makeNode({ id, content: 'original' }))
    store.beginEdit(id)
    store.cancelEdit()
    expect(store.getNode(id)?.content).toBe('original')
    expect(store.getInteractionState().mode).toBe('idle')
  })

  test('addNode applies autofit on text nodes', () => {
    const store = createCanvasStore()
    const id = asNodeId(store.generateId())
    store.addNode(
      makeNode({ id, content: 'line one\nline two\nline three\nline four', h: 30 }),
    )
    const node = store.getNode(id)!
    expect(node.h).toBeGreaterThan(30)
  })

  test('addNode opt-out: style.autoFit: false preserves explicit h', () => {
    const store = createCanvasStore()
    const id = asNodeId(store.generateId())
    store.addNode(
      makeNode({
        id,
        type: 'rect',
        content: 'a\nb\nc\nd\ne',
        h: 30,
        style: { autoFit: false },
      }),
    )
    expect(store.getNode(id)?.h).toBe(30)
  })

  test('updateNode skips autofit when only width changes (resize-stream rule)', () => {
    const store = createCanvasStore()
    const id = asNodeId(store.generateId())
    store.addNode(makeNode({ id, content: 'a' }))
    const h0 = store.getNode(id)!.h
    store.updateNode(id, { w: 50 })
    expect(store.getNode(id)?.h).toBe(h0)
  })
})

describe('markdown shortcuts', () => {
  test('toggleBold wraps selection', () => {
    const t = toggleBold('hello world', 0, 5)
    expect(t.value).toBe('**hello** world')
    expect(t.selStart).toBe(2)
    expect(t.selEnd).toBe(7)
  })
  test('toggleBold unwraps already-wrapped selection', () => {
    const t = toggleBold('**hi** there', 2, 4)
    expect(t.value).toBe('hi there')
  })
  test('toggleItalic uses single asterisks', () => {
    const t = toggleItalic('foo', 0, 3)
    expect(t.value).toBe('*foo*')
  })
  test('toggleUnderline uses double underscore', () => {
    const t = toggleUnderline('x', 0, 1)
    expect(t.value).toBe('__x__')
  })
  test('toggleStrike uses double tilde', () => {
    const t = toggleStrike('x', 0, 1)
    expect(t.value).toBe('~~x~~')
  })
  test('toggleCode uses single backtick', () => {
    const t = toggleCode('x', 0, 1)
    expect(t.value).toBe('`x`')
  })
  test('insertLink wraps with markdown link', () => {
    const t = insertLink('see docs', 4, 8, 'https://example.com')
    expect(t.value).toBe('see [docs](https://example.com)')
  })
  test('insertLink with empty url places cursor between parens', () => {
    const t = insertLink('see docs', 4, 8, '')
    expect(t.value).toBe('see [docs]()')
    expect(t.selStart).toBe(11) // inside the ()
  })
})

describe('auto-list (Enter handler)', () => {
  test('continues a bullet list', () => {
    const value = '- first item'
    const t = handleEnter(value, value.length, value.length)
    expect(t?.value).toBe('- first item\n- ')
  })
  test('increments ordered list', () => {
    const value = '1. first'
    const t = handleEnter(value, value.length, value.length)
    expect(t?.value).toBe('1. first\n2. ')
  })
  test('empty bullet → exits the list', () => {
    const value = '- '
    const t = handleEnter(value, value.length, value.length)
    expect(t?.value).toBe('')
  })
  test('returns null on a non-list line', () => {
    expect(handleEnter('just text', 9, 9)).toBeNull()
  })
})
