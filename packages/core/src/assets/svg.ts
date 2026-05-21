/**
 * SVG utilities used by `store.addSvg` and the renderer's asset cache.
 *
 * SVG is XML — it can carry `<script>` tags, `on*` event handlers, and
 * `javascript:` hrefs that execute when the markup is inlined into the
 * DOM. We rasterize SVGs (so the DOM is never asked to live-render
 * them as elements), but a defense-in-depth sanitize still runs since
 * the rasterization itself goes through `<img src=blob:>` and a stray
 * embedded `<foreignObject>` could host arbitrary HTML.
 */

export const MAX_SVG_BYTES = 2 * 1024 * 1024
const DEFAULT_SVG_SIZE = 24

/**
 * Cheap "is this plausibly SVG markup?" check + size cap. Throws on
 * rejection so consumers see the error immediately.
 */
export const validateSvgMarkup = (markup: string): void => {
  if (typeof markup !== 'string') {
    throw new Error('addSvg: src must be a string of SVG markup')
  }
  // UTF-8 byte length, not character count.
  const byteLen = new Blob([markup]).size
  if (byteLen > MAX_SVG_BYTES) {
    throw new Error(`addSvg: SVG markup exceeds the 2 MB limit (${Math.round(byteLen / 1024)} KB).`)
  }
  if (!/<svg[\s>]/i.test(markup)) {
    throw new Error('addSvg: src does not look like SVG markup (no <svg> tag found)')
  }
}

/**
 * Removes attack surfaces from SVG markup:
 *   - `<script>` and `<foreignObject>` elements entirely
 *   - `on*` event-handler attributes
 *   - `href` / `xlink:href` / `src` attributes whose value starts with
 *     `javascript:` (case-insensitive)
 *   - External entity references (`<!DOCTYPE` / `<!ENTITY`) by parsing
 *     in SVG mode (DOMParser ignores DTDs in SVG context)
 *
 * Returns the cleaned markup. Throws if the parser can't make sense
 * of the input.
 */
export const sanitizeSvg = (markup: string): string => {
  const parser = new DOMParser()
  const doc = parser.parseFromString(markup, 'image/svg+xml')
  const root = doc.documentElement
  if (root.nodeName === 'parsererror' || root.querySelector('parsererror')) {
    throw new Error('addSvg: malformed SVG (parser error)')
  }

  const removable: Element[] = []
  const walker = doc.createTreeWalker(doc, NodeFilter.SHOW_ELEMENT)
  let n: Node | null = walker.nextNode()
  while (n) {
    const el = n as Element
    const tag = el.tagName.toLowerCase()
    if (tag === 'script' || tag === 'foreignobject') {
      removable.push(el)
    } else {
      for (const attr of [...el.attributes]) {
        const name = attr.name.toLowerCase()
        const value = attr.value.trim().toLowerCase()
        if (name.startsWith('on')) {
          el.removeAttribute(attr.name)
        } else if (
          (name === 'href' || name === 'xlink:href' || name === 'src') &&
          value.startsWith('javascript:')
        ) {
          el.removeAttribute(attr.name)
        }
      }
    }
    n = walker.nextNode()
  }
  for (const el of removable) el.remove()
  return new XMLSerializer().serializeToString(doc)
}

/**
 * Resolves intended display dimensions for an SVG. Order of preference:
 *   1. explicit `width` + `height` attributes (numeric, units stripped)
 *   2. `viewBox` width/height
 *   3. fallback 24×24
 *
 * The result is the SVG's "natural size" — what `addSvg` uses as the
 * default node dimensions when caller omits `w`/`h`.
 */
export const extractSvgDimensions = (markup: string): { w: number; h: number } => {
  const parser = new DOMParser()
  const doc = parser.parseFromString(markup, 'image/svg+xml')
  const svg = doc.documentElement
  if (svg.nodeName.toLowerCase() !== 'svg') {
    return { w: DEFAULT_SVG_SIZE, h: DEFAULT_SVG_SIZE }
  }
  const widthAttr = svg.getAttribute('width')
  const heightAttr = svg.getAttribute('height')
  if (widthAttr && heightAttr) {
    const w = Number.parseFloat(widthAttr)
    const h = Number.parseFloat(heightAttr)
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return { w, h }
  }
  const viewBox = svg.getAttribute('viewBox')
  if (viewBox) {
    const parts = viewBox.split(/[\s,]+/).map(Number.parseFloat)
    if (parts.length === 4 && parts.every(Number.isFinite) && parts[2]! > 0 && parts[3]! > 0) {
      return { w: parts[2]!, h: parts[3]! }
    }
  }
  return { w: DEFAULT_SVG_SIZE, h: DEFAULT_SVG_SIZE }
}

/**
 * Substitutes every `currentColor` occurrence in the markup with the
 * given color literal. Case-insensitive. Used by the rasterizer cache
 * to bake the icon's tint into the rendered bitmap.
 *
 * Single-color recoloring covers ~95% of real icon libraries (Lucide,
 * Heroicons, Phosphor, Tabler, etc.) which are designed monochromatic.
 * Two-tone icons can pre-color their markup and skip this step.
 */
export const applySvgColor = (markup: string, color: string): string => {
  return markup.replace(/currentColor/gi, color)
}
