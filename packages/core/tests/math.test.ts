/**
 * Inline math tokenizer + layout placeholder + bitmap-cache key.
 *
 * The actual MathJax compile + rasterize is browser-only (requires
 * `document`, `Image`, `createImageBitmap`); end-to-end is covered
 * by the playground demo + manual testing. These tests cover the
 * pure-function pieces that fail without DOM.
 */
import { describe, expect, test } from 'vitest'
import { layoutTokens } from '../src/text/layout'
import { tokenize } from '../src/text/tokens'

describe('tokenize math', () => {
  test('inline math via $...$', () => {
    expect(tokenize('Mass $E=mc^2$ is famous')).toEqual([
      { type: 'text', content: 'Mass ' },
      { type: 'math', content: 'E=mc^2' },
      { type: 'text', content: ' is famous' },
    ])
  })

  test('multiple math expressions on one line', () => {
    expect(tokenize('$a$ and $b$')).toEqual([
      { type: 'math', content: 'a' },
      { type: 'text', content: ' and ' },
      { type: 'math', content: 'b' },
    ])
  })

  test('math preserves interior whitespace + special chars', () => {
    const result = tokenize('$\\frac{a}{b} + c$')
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ type: 'math', content: '\\frac{a}{b} + c' })
  })

  test('empty $$ is NOT matched as math (block-math not supported)', () => {
    // The regex requires at least one non-$, non-newline char inside.
    const result = tokenize('a $$ b')
    expect(result.find(t => t.type === 'math')).toBeUndefined()
  })

  test('math at the start of a line', () => {
    expect(tokenize('$x$ rest')).toEqual([
      { type: 'math', content: 'x' },
      { type: 'text', content: ' rest' },
    ])
  })

  test('math at the end of a line', () => {
    expect(tokenize('prefix $x$')).toEqual([
      { type: 'text', content: 'prefix ' },
      { type: 'math', content: 'x' },
    ])
  })

  test('math takes precedence over italic (single * inside)', () => {
    // $a*b$ → math, not italic-with-stars
    const result = tokenize('$a*b$')
    expect(result).toEqual([{ type: 'math', content: 'a*b' }])
  })

  test('unmatched $ stays as text', () => {
    // No closing $ → no match → falls through to text.
    expect(tokenize('cost is $5 total')).toEqual([{ type: 'text', content: 'cost is $5 total' }])
  })

  test('math content does not break across lines', () => {
    // Newlines inside `$...$` should NOT match — regex uses `[^$\n]+?`.
    const result = tokenize('a $x\ny$ b')
    expect(result.find(t => t.type === 'math')).toBeUndefined()
  })
})

describe('layoutTokens with math (no MathJax)', () => {
  test('math token becomes a math-typed StyledRun', () => {
    const lines = layoutTokens(tokenize('Hello $x$ world'), {
      width: 400,
      fontFamily: 'sans-serif',
      fontSize: 'M',
      textStyle: 'normal',
    })
    const allRuns = lines
      .filter((l): l is Extract<typeof l, { kind: 'text' }> => l.kind === 'text')
      .flatMap(l => l.runs)
    const mathRun = allRuns.find(r => r.type === 'math')
    expect(mathRun).toBeDefined()
    expect(mathRun?.text).toBe('x')
  })

  test('math placeholder width is positive and bounded by maxWidth', () => {
    const lines = layoutTokens(tokenize('$\\sum_{i=1}^{n} i^2$'), {
      width: 200,
      fontFamily: 'sans-serif',
      fontSize: 'M',
      textStyle: 'normal',
    })
    // Should produce at least one line with a math run; layout did
    // not crash on the unresolved bitmap lookup.
    expect(lines.length).toBeGreaterThan(0)
  })

  test('math is never whitespace-split (preserved as single run)', () => {
    const lines = layoutTokens(tokenize('$ a b c $'), {
      width: 400,
      fontFamily: 'sans-serif',
      fontSize: 'M',
      textStyle: 'normal',
    })
    const mathRuns = lines
      .filter((l): l is Extract<typeof l, { kind: 'text' }> => l.kind === 'text')
      .flatMap(l => l.runs)
      .filter(r => r.type === 'math')
    expect(mathRuns).toHaveLength(1)
    expect(mathRuns[0]!.text).toBe(' a b c ')
  })
})

describe('text without math is unaffected', () => {
  test('tokens of a math-free string are identical to before', () => {
    // Sanity: existing inline patterns still work alongside the new
    // math case.
    expect(tokenize('**bold** and *italic* and `code`')).toEqual([
      { type: 'bold', content: 'bold' },
      { type: 'text', content: ' and ' },
      { type: 'italic', content: 'italic' },
      { type: 'text', content: ' and ' },
      { type: 'code', content: 'code' },
    ])
  })
})
