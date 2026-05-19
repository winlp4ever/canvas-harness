/**
 * Lite-markdown tokenizer — ported verbatim from
 * `dim0/webui/src/components/markdown/canvas-lite-markdown.tsx`.
 *
 * The vocabulary is deliberately small: bold, italic, underline, strike,
 * highlight, inline code, links, fenced code blocks, hr lines. No
 * nesting, no escapes — single-pass regex tokenization keeps layout
 * fast at scale. See ARCHITECTURE.md §8.
 */
export type InlineType =
  | 'text'
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strike'
  | 'highlight'
  | 'code'
  | 'link'

export type Token =
  | { type: InlineType; content: string }
  | { type: 'code-block'; content: string }
  | { type: 'br' }
  | { type: 'hr' }
  | { type: 'hr-double' }

const INLINE_PATTERN =
  /(\*\*[^*]+\*\*|==[^=\s](?:[^=]*?[^=\s])?==|`[^`]+`|\*[^*]+\*|__[^_]+__|~~[^~]+~~|_[^_]+_|\[[^\]]+\]\([^)]+\))/g
const HR_LINE_PATTERN = /^[ \t]*---[ \t]*$/
const DOUBLE_HR_LINE_PATTERN = /^[ \t]*===[ \t]*$/

/**
 * Normalizes quick symbol shorthand to unicode glyphs before tokenization.
 */
const transformSymbols = (value: string) =>
  value.replace(/<=>|<->|<-|->|\[\]|\[[vx]\]/gi, match => {
    const normalized = match.toLowerCase()
    if (normalized === '->') return '→'
    if (normalized === '<-') return '←'
    if (normalized === '<->') return '↔'
    if (normalized === '<=>') return '⇔'
    if (normalized === '[]') return '☐'
    if (normalized === '[v]') return '✅'
    if (normalized === '[x]') return '❎'
    return match
  })

/**
 * Tokenizes one line's inline content.
 */
const tokenizeInline = (segment: string): Token[] => {
  if (!segment) return []
  const tokens: Token[] = []
  let lastIndex = 0

  segment.replace(INLINE_PATTERN, (match, _group, offset) => {
    const idx = offset as number
    if (idx > lastIndex) {
      tokens.push({ type: 'text', content: transformSymbols(segment.slice(lastIndex, idx)) })
    }

    if (
      (match.startsWith('**') && match.endsWith('**')) ||
      (match.startsWith('__') && match.endsWith('__'))
    ) {
      tokens.push({ type: 'bold', content: transformSymbols(match.slice(2, -2)) })
    } else if (match.startsWith('*') && match.endsWith('*')) {
      tokens.push({ type: 'italic', content: transformSymbols(match.slice(1, -1)) })
    } else if (match.startsWith('~~') && match.endsWith('~~')) {
      tokens.push({ type: 'strike', content: transformSymbols(match.slice(2, -2)) })
    } else if (match.startsWith('==') && match.endsWith('==')) {
      tokens.push({ type: 'highlight', content: transformSymbols(match.slice(2, -2)) })
    } else if (match.startsWith('_') && match.endsWith('_')) {
      tokens.push({ type: 'underline', content: transformSymbols(match.slice(1, -1)) })
    } else if (match.startsWith('[') && match.includes('](') && match.endsWith(')')) {
      const splitIndex = match.indexOf('](')
      tokens.push({ type: 'link', content: transformSymbols(match.slice(1, splitIndex)) })
    } else if (match.startsWith('`') && match.endsWith('`')) {
      tokens.push({ type: 'code', content: match.slice(1, -1) })
    } else {
      tokens.push({ type: 'text', content: transformSymbols(match) })
    }

    lastIndex = idx + match.length
    return match
  })

  if (lastIndex < segment.length) {
    tokens.push({ type: 'text', content: transformSymbols(segment.slice(lastIndex)) })
  }

  return tokens
}

/**
 * Tokenizes one line including hr / hr-double sentinels.
 */
const tokenizeLine = (line: string): Token[] => {
  if (DOUBLE_HR_LINE_PATTERN.test(line)) return [{ type: 'hr-double' }]
  if (HR_LINE_PATTERN.test(line)) return [{ type: 'hr' }]
  return tokenizeInline(line)
}

/**
 * Tokenizes plain-text sections (outside fenced code blocks) line by line.
 */
const tokenizeTextBlock = (block: string): Token[] => {
  if (!block) return []
  const tokens: Token[] = []
  const lines = block.split('\n')
  lines.forEach((line, index) => {
    const lineTokens = tokenizeLine(line)
    tokens.push(...lineTokens)
    const isRuleLine =
      lineTokens.length === 1 &&
      (lineTokens[0]?.type === 'hr' || lineTokens[0]?.type === 'hr-double')
    if (index < lines.length - 1 && !isRuleLine) tokens.push({ type: 'br' })
  })
  return tokens
}

/**
 * Full markdown tokenizer with fenced code-block support. Code blocks
 * are display-only (no language badge / syntax highlighting).
 */
export const tokenize = (input: string): Token[] => {
  if (!input) return []
  const tokens: Token[] = []
  let cursor = 0

  while (cursor < input.length) {
    const fenceStart = input.indexOf('```', cursor)
    if (fenceStart === -1) {
      tokens.push(...tokenizeTextBlock(input.slice(cursor)))
      break
    }

    if (fenceStart > cursor) {
      tokens.push(...tokenizeTextBlock(input.slice(cursor, fenceStart)))
    }

    const fenceEnd = input.indexOf('```', fenceStart + 3)
    if (fenceEnd === -1) {
      tokens.push(...tokenizeTextBlock(input.slice(fenceStart)))
      break
    }

    const fenceContent = input.slice(fenceStart + 3, fenceEnd)
    const delimiterIndex = fenceContent.search(/[\r\n]/)
    let codeContent = fenceContent
    if (delimiterIndex >= 0) {
      codeContent = fenceContent.slice(delimiterIndex).replace(/^\r?\n/, '')
    }

    tokens.push({ type: 'code-block', content: codeContent.replace(/\r\n/g, '\n') })
    cursor = fenceEnd + 3
  }

  return tokens
}
