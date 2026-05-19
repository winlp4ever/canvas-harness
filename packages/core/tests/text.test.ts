import { describe, expect, test } from 'vitest'
import {
  estimateMarkdownContentHeight,
  layoutTokens,
  quantizeDpr,
  quantizeZoom,
  resolveRenderScale,
  tokenize,
} from '../src/text'

describe('tokenize', () => {
  test('plain text → single text token', () => {
    const tokens = tokenize('hello world')
    expect(tokens).toEqual([{ type: 'text', content: 'hello world' }])
  })

  test('bold via **', () => {
    const tokens = tokenize('hello **bold** world')
    expect(tokens.map(t => t.type)).toEqual(['text', 'bold', 'text'])
    expect(tokens[1]).toEqual({ type: 'bold', content: 'bold' })
  })

  test('italic via *', () => {
    const tokens = tokenize('say *hi*')
    expect(tokens[1]).toEqual({ type: 'italic', content: 'hi' })
  })

  test('inline code via backticks', () => {
    const tokens = tokenize('use `npm install`')
    expect(tokens[1]).toEqual({ type: 'code', content: 'npm install' })
  })

  test('highlight via ==', () => {
    const tokens = tokenize('==important==')
    expect(tokens[0]).toEqual({ type: 'highlight', content: 'important' })
  })

  test('link via [text](url)', () => {
    const tokens = tokenize('see [docs](https://example.com)')
    expect(tokens[1]).toEqual({ type: 'link', content: 'docs' })
  })

  test('hr line', () => {
    const tokens = tokenize('above\n---\nbelow')
    expect(tokens.map(t => t.type)).toContain('hr')
  })

  test('hr-double line', () => {
    const tokens = tokenize('above\n===\nbelow')
    expect(tokens.map(t => t.type)).toContain('hr-double')
  })

  test('fenced code block', () => {
    const tokens = tokenize('before\n```\nconst x = 1\n```\nafter')
    const codeBlock = tokens.find(t => t.type === 'code-block')
    expect(codeBlock).toBeDefined()
    if (codeBlock && codeBlock.type === 'code-block') {
      expect(codeBlock.content).toContain('const x = 1')
    }
  })

  test('symbol shorthand → unicode', () => {
    const tokens = tokenize('a -> b')
    expect((tokens[0] as { content: string }).content).toContain('→')
  })

  test('br between lines', () => {
    const tokens = tokenize('line one\nline two')
    expect(tokens.map(t => t.type)).toEqual(['text', 'br', 'text'])
  })

  test('empty input', () => {
    expect(tokenize('')).toEqual([])
  })
})

describe('layoutTokens', () => {
  test('produces at least one line', () => {
    const lines = layoutTokens(tokenize('hello'), {
      width: 200,
      fontFamily: 'sans-serif',
      fontSize: 'M',
      textStyle: 'normal',
    })
    expect(lines.length).toBeGreaterThanOrEqual(1)
  })

  test('hr becomes its own line', () => {
    const lines = layoutTokens(tokenize('top\n---\nbottom'), {
      width: 200,
      fontFamily: 'sans-serif',
      fontSize: 'M',
      textStyle: 'normal',
    })
    expect(lines.some(l => l.kind === 'rule')).toBe(true)
  })

  test('code block lines have isFirst/isLast', () => {
    const lines = layoutTokens(tokenize('```\nfoo\nbar\n```'), {
      width: 200,
      fontFamily: 'sans-serif',
      fontSize: 'M',
      textStyle: 'normal',
    })
    const codeLines = lines.filter(l => l.kind === 'code-block')
    expect(codeLines.length).toBeGreaterThan(0)
    expect((codeLines[0] as { isFirst: boolean }).isFirst).toBeTruthy
  })
})

describe('estimateMarkdownContentHeight', () => {
  test('empty text returns 0', () => {
    expect(estimateMarkdownContentHeight({ text: '', width: 200 })).toBe(0)
  })

  test('non-empty text returns positive height', () => {
    const h = estimateMarkdownContentHeight({ text: 'hello', width: 200 })
    expect(h).toBeGreaterThan(0)
  })

  test('more text → taller', () => {
    const h1 = estimateMarkdownContentHeight({ text: 'one line', width: 100 })
    const h2 = estimateMarkdownContentHeight({
      text: 'line one\nline two\nline three',
      width: 100,
    })
    expect(h2).toBeGreaterThan(h1)
  })
})

describe('render-scale', () => {
  test('quantizeZoom rounds to 0.1', () => {
    expect(quantizeZoom(1.234)).toBeCloseTo(1.2)
    expect(quantizeZoom(0.07)).toBeCloseTo(0.1)
    expect(quantizeZoom(Number.NaN)).toBe(1)
  })

  test('quantizeDpr clamps to [1..3] and rounds to 0.25', () => {
    expect(quantizeDpr(1.0)).toBe(1)
    expect(quantizeDpr(2.0)).toBe(2)
    expect(quantizeDpr(1.3)).toBe(1.25)
    expect(quantizeDpr(0.5)).toBe(1)
    expect(quantizeDpr(10)).toBe(3)
  })

  test('resolveRenderScale picks higher quality on idle, lower on moving', () => {
    const idle = resolveRenderScale(1, 1, false)
    const moving = resolveRenderScale(1, 1, true)
    expect(idle).toBeGreaterThan(moving)
  })
})
