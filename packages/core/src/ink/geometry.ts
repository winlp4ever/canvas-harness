import { getStroke } from 'perfect-freehand'
import { worldToNodeLocal } from '../edges'
import type { Node, Vec2 } from '../types'
import type { InkGeometry, InkNodeData, InkSample, InkStrokeData } from './types'

const MIN_NODE_SIZE = 1

/** Trace a closed outline with midpoint quadratic curves instead of visible segments. */
export const traceSmoothInkOutline = (
  ctx: CanvasRenderingContext2D,
  points: ReadonlyArray<readonly [number, number]>,
): void => {
  const first = points[0]
  if (!first) return
  if (points.length < 3) {
    ctx.moveTo(first[0], first[1])
    for (let i = 1; i < points.length; i++) {
      const point = points[i]
      if (point) ctx.lineTo(point[0], point[1])
    }
    return
  }

  const second = points[1]!
  ctx.moveTo((first[0] + second[0]) / 2, (first[1] + second[1]) / 2)
  for (let i = 1; i <= points.length; i++) {
    const control = points[i % points.length]!
    const next = points[(i + 1) % points.length]!
    ctx.quadraticCurveTo(
      control[0],
      control[1],
      (control[0] + next[0]) / 2,
      (control[1] + next[1]) / 2,
    )
  }
  ctx.closePath()
}

/** Produce a pressure-aware polygon for one freehand stroke. */
export const buildInkOutline = (
  samples: ReadonlyArray<InkSample>,
  size: number,
): Array<[number, number]> => {
  if (samples.length === 0) return []
  return getStroke(
    samples.map(point => [point.x, point.y, point.pressure]),
    {
      size,
      thinning: 0.68,
      smoothing: 0.58,
      streamline: 0.42,
      simulatePressure: false,
      last: true,
    },
  ).map(([x, y]) => [x, y])
}

/**
 * Normalize a completed world-space trace into local points plus bounds.
 * The derived outline is deliberately not persisted; renderers rebuild it
 * from `points + size` so synced scenes stay compact.
 */
export const createInkGeometry = (
  samples: ReadonlyArray<InkSample>,
  size: number,
): InkGeometry | null => {
  const outline = buildInkOutline(samples, size)
  if (outline.length === 0) return null

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const [x, y] of outline) {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }

  const w = Math.max(MIN_NODE_SIZE, maxX - minX)
  const h = Math.max(MIN_NODE_SIZE, maxY - minY)
  const ink: InkStrokeData = {
    type: 'ink',
    version: 1,
    size,
    points: samples.map(({ x, y, pressure }) => [x - minX, y - minY, pressure]),
    intrinsicWidth: w,
    intrinsicHeight: h,
  }
  validInkData.add(ink)
  return {
    x: minX,
    y: minY,
    w,
    h,
    ink,
  }
}

const validInkData = new WeakSet<object>()
const invalidInkData = new WeakSet<object>()

/** Read validated engine geometry from a built-in ink node. */
export const readInkData = (node: Node): InkStrokeData | null => {
  if (node.type !== 'ink' || !node.data || typeof node.data !== 'object') return null
  const raw = (node.data as Partial<InkNodeData>).ink
  if (!raw || typeof raw !== 'object') return null
  if (validInkData.has(raw)) return raw
  if (invalidInkData.has(raw)) return null
  if (
    raw.type !== 'ink' ||
    raw.version !== 1 ||
    !Number.isFinite(raw.size) ||
    raw.size <= 0 ||
    !Array.isArray(raw.points) ||
    !raw.points.every(
      point =>
        Array.isArray(point) && point.length === 3 && point.every(value => Number.isFinite(value)),
    ) ||
    !Number.isFinite(raw.intrinsicWidth) ||
    raw.intrinsicWidth <= 0 ||
    !Number.isFinite(raw.intrinsicHeight) ||
    raw.intrinsicHeight <= 0
  ) {
    invalidInkData.add(raw)
    return null
  }
  validInkData.add(raw)
  return raw
}

const outlineCache = new WeakMap<InkStrokeData, Array<[number, number]>>()

export const outlineFromInk = (ink: InkStrokeData): Array<[number, number]> => {
  const cached = outlineCache.get(ink)
  if (cached) return cached
  const outline = buildInkOutline(
    ink.points.map(([x, y, pressure]) => ({ x, y, pressure })),
    ink.size,
  )
  outlineCache.set(ink, outline)
  return outline
}

/** Paint a committed ink node in node-local space. */
export const drawInkNode = (ctx: CanvasRenderingContext2D, node: Node): void => {
  drawInkNodeWithOpacity(ctx, node, 1)
}

/** Paint an ink node with an additional opacity multiplier for interaction previews. */
export const drawInkNodeWithOpacity = (
  ctx: CanvasRenderingContext2D,
  node: Node,
  opacityMultiplier: number,
): void => {
  const ink = readInkData(node)
  if (!ink) return
  const outline = outlineFromInk(ink)
  if (outline.length === 0) return
  const scaleX = node.w / Math.max(MIN_NODE_SIZE, ink.intrinsicWidth)
  const scaleY = node.h / Math.max(MIN_NODE_SIZE, ink.intrinsicHeight)
  ctx.save()
  ctx.scale(scaleX, scaleY)
  ctx.fillStyle = node.style?.strokeColor ?? '#1f2937'
  ctx.globalAlpha =
    Math.max(0, Math.min(1, (node.style?.opacity ?? 100) / 100)) *
    Math.max(0, Math.min(1, opacityMultiplier))
  ctx.beginPath()
  traceSmoothInkOutline(ctx, outline)
  ctx.fill()
  ctx.restore()
}

/** Paint a world-space in-progress stroke on the renderer's interactive surface. */
export const drawInkDraft = (
  ctx: CanvasRenderingContext2D,
  samples: ReadonlyArray<InkSample>,
  size: number,
  color: string,
  opacity = 100,
): void => {
  const outline = draftOutlineFromSamples(samples, size)
  if (outline.length === 0) return
  ctx.save()
  ctx.fillStyle = color
  ctx.globalAlpha = Math.max(0, Math.min(1, opacity / 100))
  ctx.beginPath()
  traceSmoothInkOutline(ctx, outline)
  ctx.fill()
  ctx.restore()
}

const draftOutlineCache = new WeakMap<
  ReadonlyArray<InkSample>,
  Map<number, Array<[number, number]>>
>()

const draftOutlineFromSamples = (
  samples: ReadonlyArray<InkSample>,
  size: number,
): Array<[number, number]> => {
  const bySize = draftOutlineCache.get(samples)
  const cached = bySize?.get(size)
  if (cached) return cached
  const outline = buildInkOutline(samples, size)
  const nextBySize = bySize ?? new Map<number, Array<[number, number]>>()
  nextBySize.set(size, outline)
  if (!bySize) draftOutlineCache.set(samples, nextBySize)
  return outline
}

export const distanceToSegment = (point: Vec2, a: Vec2, b: Vec2): number => {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return Math.hypot(point.x - a.x, point.y - a.y)
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared))
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy))
}

const cross = (a: Vec2, b: Vec2, c: Vec2): number =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)

const segmentsIntersect = (a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean => {
  const abC = cross(a, b, c)
  const abD = cross(a, b, d)
  const cdA = cross(c, d, a)
  const cdB = cross(c, d, b)
  if (abC === 0 && distanceToSegment(c, a, b) === 0) return true
  if (abD === 0 && distanceToSegment(d, a, b) === 0) return true
  if (cdA === 0 && distanceToSegment(a, c, d) === 0) return true
  if (cdB === 0 && distanceToSegment(b, c, d) === 0) return true
  return abC > 0 !== abD > 0 && cdA > 0 !== cdB > 0
}

export const distanceBetweenSegments = (a: Vec2, b: Vec2, c: Vec2, d: Vec2): number => {
  if (segmentsIntersect(a, b, c, d)) return 0
  return Math.min(
    distanceToSegment(a, c, d),
    distanceToSegment(b, c, d),
    distanceToSegment(c, a, b),
    distanceToSegment(d, a, b),
  )
}

/** Pressure-centerline hit test used by selection and whole-stroke erasing. */
export const hitTestInkLocal = (node: Node, localPoint: Vec2, extraRadius = 0): boolean => {
  const ink = readInkData(node)
  if (!ink || ink.points.length === 0 || node.w <= 0 || node.h <= 0) return false
  if (
    localPoint.x < -extraRadius ||
    localPoint.y < -extraRadius ||
    localPoint.x > node.w + extraRadius ||
    localPoint.y > node.h + extraRadius
  ) {
    return false
  }

  const scaleX = node.w / Math.max(MIN_NODE_SIZE, ink.intrinsicWidth)
  const scaleY = node.h / Math.max(MIN_NODE_SIZE, ink.intrinsicHeight)
  const intrinsicPoint = { x: localPoint.x / scaleX, y: localPoint.y / scaleY }
  const intrinsicExtra = extraRadius / Math.max(MIN_NODE_SIZE, Math.min(scaleX, scaleY))
  const radius = ink.size / 2 + intrinsicExtra + 2
  const first = ink.points[0]
  if (!first) return false
  if (ink.points.length === 1) {
    return Math.hypot(intrinsicPoint.x - first[0], intrinsicPoint.y - first[1]) <= radius
  }

  for (let i = 1; i < ink.points.length; i++) {
    const previous = ink.points[i - 1]
    const current = ink.points[i]
    if (!previous || !current) continue
    const a = { x: previous[0], y: previous[1] }
    const b = { x: current[0], y: current[1] }
    if (distanceToSegment(intrinsicPoint, a, b) <= radius) return true
  }
  return false
}

/** Hit-test one world point against a rotated/scaled ink node. */
export const hitTestInkWorld = (node: Node, worldPoint: Vec2, extraRadius = 0): boolean =>
  hitTestInkLocal(node, worldToNodeLocal(worldPoint, node), extraRadius)

/** Hit-test a swept eraser segment against a rotated/scaled ink centerline. */
export const hitTestInkSegmentWorld = (
  node: Node,
  worldA: Vec2,
  worldB: Vec2,
  extraRadius = 0,
): boolean => {
  const ink = readInkData(node)
  if (!ink || ink.points.length === 0 || node.w <= 0 || node.h <= 0) return false
  const localA = worldToNodeLocal(worldA, node)
  const localB = worldToNodeLocal(worldB, node)
  const scaleX = node.w / Math.max(MIN_NODE_SIZE, ink.intrinsicWidth)
  const scaleY = node.h / Math.max(MIN_NODE_SIZE, ink.intrinsicHeight)
  const a = { x: localA.x / scaleX, y: localA.y / scaleY }
  const b = { x: localB.x / scaleX, y: localB.y / scaleY }
  const intrinsicExtra = extraRadius / Math.max(MIN_NODE_SIZE, Math.min(scaleX, scaleY))
  const radius = ink.size / 2 + intrinsicExtra + 2
  const first = ink.points[0]
  if (!first) return false
  if (ink.points.length === 1) {
    return distanceToSegment({ x: first[0], y: first[1] }, a, b) <= radius
  }
  for (let i = 1; i < ink.points.length; i++) {
    const previous = ink.points[i - 1]
    const current = ink.points[i]
    if (!previous || !current) continue
    if (
      distanceBetweenSegments(
        a,
        b,
        { x: previous[0], y: previous[1] },
        { x: current[0], y: current[1] },
      ) <= radius
    ) {
      return true
    }
  }
  return false
}
