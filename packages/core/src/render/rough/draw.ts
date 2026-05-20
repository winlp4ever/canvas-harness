import type { Edge, Node, Style, Vec2 } from '../../types'
import {
  DEFAULT_STYLE,
  type ThemeResolver,
  dashPatternFor,
  resolveColor,
  resolveStrokeWidth,
} from '../shapes/defaults'
import { ROUGH_DEFAULTS } from './constants'
import { type RoughCanvasLike, getRoughCanvasCtor } from './loader'
import {
  capsulePath,
  diamondPath,
  ellipsePath,
  excalidrawRoundedRectPath,
  rectPath,
} from './paths'
import { getOrBuildDrawable, seedFromId } from './cache'
import { deriveRoughStrokeColor } from './tone-down'

/**
 * Per-shape rough stroke pass.
 *
 * Caller (renderer) decides whether to call this (via the gate). Fill
 * has already been painted by the regular `drawShape` pipeline — we
 * paint only the wobbly outline on top.
 *
 * Returns false when the rough.js module hasn't loaded yet; caller
 * should fall back to plain stroke.
 */

type RoughPrimitive = 'rect' | 'ellipse' | 'diamond' | 'capsule'

const apparentDetail = (
  maxSide: number,
  zoom: number,
): { curveStepCount: number; maxRandomnessOffset: number } => {
  const apparent = maxSide * Math.min(1, zoom)
  if (apparent >= 800) return { curveStepCount: 3, maxRandomnessOffset: 0.9 }
  if (apparent >= 400) return { curveStepCount: 4, maxRandomnessOffset: 1.1 }
  return { curveStepCount: 5, maxRandomnessOffset: 1.3 }
}

/**
 * Paints the rough stroke into `ctx` at the node's local origin
 * (caller has already applied the node transform). Returns true on
 * success, false if rough.js isn't loaded yet.
 */
export const drawRoughShape = (
  ctx: CanvasRenderingContext2D,
  node: Node,
  scale: number,
  theme?: ThemeResolver,
): boolean => {
  const Ctor = getRoughCanvasCtor()
  if (!Ctor) return false

  const type = node.type as RoughPrimitive
  const style: Style | undefined = node.style
  const rawStroke = resolveColor(style, 'strokeColor', '#1f2937', theme)
  // When the user picks a transparent border but kept a fill, derive a
  // tone-shifted edge so the misregistration effect stays visible.
  // `theme('mode')` is the convention: returns 'dark' in dark mode,
  // anything else (or undefined) → light.
  const isDark = theme?.('mode') === 'dark'
  const fill = resolveColor(style, 'backgroundColor', DEFAULT_STYLE.backgroundColor, theme)
  const strokeColor = deriveRoughStrokeColor(rawStroke, fill, isDark)
  const strokeWidth = resolveStrokeWidth(style, theme)
  if (strokeWidth <= 0) return true // nothing to draw, but "handled"

  const roughness = style?.roughness ?? 0
  if (roughness <= 0) return true

  const seed = node.id ? (seedFromId(node.id) % 2147483646) + 1 : 1337
  const w = node.w
  const h = node.h
  // Match drawShape's resolution exactly so the rough outline picks
  // the same corner radius as the solid fill behind it.
  const cornerRadius = (style?.roundness ?? DEFAULT_STYLE.roundness) * 4
  const radius = Math.max(0, Math.min(cornerRadius, w / 2, h / 2))
  const dash = dashPatternFor(style?.strokeStyle, strokeWidth)
  const detail = apparentDetail(Math.max(w, h), scale)

  // Note: rough stroke draws at native (0, 0, w, h). The misregistration
  // effect (fill shifted up-and-left while stroke stays put) is applied
  // by the renderer translating the ctx before calling drawShape for the
  // fill — see ROUGH_FILL_MISREGISTER_X/Y in constants.ts.

  const cacheKey = [
    type,
    w.toFixed(1),
    h.toFixed(1),
    radius.toFixed(1),
    strokeColor,
    strokeWidth.toFixed(2),
    style?.strokeStyle ?? 'solid',
    roughness.toFixed(2),
    seed,
    detail.curveStepCount,
    detail.maxRandomnessOffset.toFixed(2),
  ].join('|')

  const rc = ensureRoughCanvas(ctx, Ctor)
  if (!rc) return false

  const drawable = getOrBuildDrawable(cacheKey, () => {
    const pathData = buildPath(type, 0, 0, w, h, radius)
    return rc.generator.path(pathData, {
      ...ROUGH_DEFAULTS,
      stroke: strokeColor,
      strokeWidth,
      roughness,
      seed,
      strokeLineDash: dash.length > 0 ? dash : undefined,
      curveStepCount: detail.curveStepCount,
      maxRandomnessOffset: detail.maxRandomnessOffset,
    })
  })

  ctx.save()
  ctx.lineJoin = 'round'
  rc.draw(drawable)
  ctx.restore()
  return true
}

/**
 * Paints a rough stroke for an edge body. `samples` is the cached
 * polyline. We use rough's `linearPath` because it preserves the
 * shape exactly (excalidraw connectors). Arrowheads + clip stay plain
 * — wobble on arrowheads doesn't add visual value.
 */
export const drawRoughEdge = (
  ctx: CanvasRenderingContext2D,
  edge: Edge,
  samples: Vec2[],
  scale: number,
  theme?: ThemeResolver,
): boolean => {
  const Ctor = getRoughCanvasCtor()
  if (!Ctor) return false
  if (samples.length < 2) return true

  const style = edge.style
  const strokeColor = resolveColor(style, 'strokeColor', '#475569', theme)
  const strokeWidth = resolveStrokeWidth(style, theme)
  if (strokeWidth <= 0) return true

  const roughness = style?.roughness ?? 0
  if (roughness <= 0) return true

  const seed = edge.id ? (seedFromId(edge.id) % 2147483646) + 1 : 1337
  const dash = dashPatternFor(style?.strokeStyle, strokeWidth)
  // Detail off the bbox span of the samples; cheap proxy.
  let minX = samples[0]!.x
  let maxX = samples[0]!.x
  let minY = samples[0]!.y
  let maxY = samples[0]!.y
  for (const p of samples) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  const detail = apparentDetail(Math.max(maxX - minX, maxY - minY), scale)

  const cacheKey = [
    'edge',
    edge.id,
    samples.length,
    Math.round(minX),
    Math.round(minY),
    Math.round(maxX),
    Math.round(maxY),
    strokeColor,
    strokeWidth.toFixed(2),
    style?.strokeStyle ?? 'solid',
    roughness.toFixed(2),
    seed,
    detail.curveStepCount,
    detail.maxRandomnessOffset.toFixed(2),
  ].join('|')

  const rc = ensureRoughCanvas(ctx, Ctor)
  if (!rc) return false

  const drawable = getOrBuildDrawable(cacheKey, () => {
    const points: [number, number][] = samples.map(s => [s.x, s.y])
    return rc.generator.linearPath(points, {
      ...ROUGH_DEFAULTS,
      stroke: strokeColor,
      strokeWidth,
      roughness,
      seed,
      strokeLineDash: dash.length > 0 ? dash : undefined,
      curveStepCount: detail.curveStepCount,
      maxRandomnessOffset: detail.maxRandomnessOffset,
    })
  })

  ctx.save()
  ctx.lineJoin = 'round'
  rc.draw(drawable)
  ctx.restore()
  return true
}

/**
 * Reuses one `RoughCanvas` per CanvasRenderingContext2D — building it
 * is cheap (~5µs) but per-frame stacks up. Stored on the context as
 * a hidden property.
 */
const ROUGH_CANVAS_KEY = '__roughCanvas'
const ensureRoughCanvas = (
  ctx: CanvasRenderingContext2D,
  Ctor: NonNullable<ReturnType<typeof getRoughCanvasCtor>>,
): RoughCanvasLike | null => {
  const ctxWithCache = ctx as CanvasRenderingContext2D & {
    [ROUGH_CANVAS_KEY]?: RoughCanvasLike
  }
  if (ctxWithCache[ROUGH_CANVAS_KEY]) return ctxWithCache[ROUGH_CANVAS_KEY]
  const rc = new Ctor(ctx.canvas) as RoughCanvasLike
  ctxWithCache[ROUGH_CANVAS_KEY] = rc
  return rc
}

const buildPath = (
  type: RoughPrimitive,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): string => {
  switch (type) {
    case 'rect':
      return radius > 0 ? excalidrawRoundedRectPath(x, y, w, h, radius) : rectPath(x, y, w, h)
    case 'ellipse':
      return ellipsePath(x, y, w, h)
    case 'diamond':
      return diamondPath(x, y, w, h)
    case 'capsule':
      return capsulePath(x, y, w, h)
  }
}
