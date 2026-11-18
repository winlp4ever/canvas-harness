import type { Node, Vec2 } from '../types'
/**
 * Auto-clip: hide the part of an edge that's inside its attached nodes.
 * See ARCHITECTURE.md §6.5.
 *
 * For each end, transform the polyline samples into the attached node's
 * pre-rotation local frame (collapsing the rotated-rect problem to
 * axis-aligned). Walk samples from that endpoint outward; the border
 * counts as inside. The first sample outside the rect ends the walk, and
 * the clip is where the segment into it exits the rect (slab exit). If
 * that exit lands on the segment's inside sample (e.g. an endpoint stored
 * on the border, heading outward), the sample itself is the clip.
 */
import { nodeLocalToWorld, worldToNodeLocal } from './project'

/**
 * Result of clipping the polyline against the two attached-node rects.
 * `startIndex` / `endIndex` are sample indices: the first sample past
 * each clip point, or the clip sample itself when the clip lands on one
 * (an untrimmed endpoint, or a sample on the node border). The
 * renderer paints `[startPoint, samples[startIndex+1..endIndex-1], endPoint]`,
 * so when a clip lands mid-segment the sample at the trimmed index itself
 * is not painted (known gap: a polyline bend right after a mid-segment
 * clip is dropped). When the two clips fall on the same or adjacent
 * segments, a visible result can have `startIndex >= endIndex` (by at
 * most one): use `visible`, not the index order, to test visibility.
 * If both ends are free-floating (no attached node), returns the full range.
 */
export type ClipResult = {
  startIndex: number
  endIndex: number
  startPoint: Vec2
  endPoint: Vec2
  visible: boolean
}

export const fullVisibleClipResult = (samples: Vec2[]): ClipResult => ({
  startIndex: 0,
  endIndex: samples.length - 1,
  startPoint: samples[0] ?? { x: 0, y: 0 },
  endPoint: samples[samples.length - 1] ?? { x: 0, y: 0 },
  visible: samples.length >= 2,
})

/**
 * Clips a polyline against (up to) two attached-node rects.
 * `sourceNode` / `targetNode` are the nodes the source/target endpoints
 * attach to (null for free-floating endpoints).
 */
export const clipSamples = (
  samples: Vec2[],
  sourceNode: Node | null,
  targetNode: Node | null,
): ClipResult => {
  if (samples.length < 2) return fullVisibleClipResult(samples)
  const last = samples.length - 1

  const start = sourceNode ? trimFrom(samples, sourceNode, +1) : clipAtSample(samples, 0)
  const end = targetNode ? trimFrom(samples, targetNode, -1) : clipAtSample(samples, last)
  if (!start || !end) return { ...fullVisibleClipResult(samples), visible: false }

  // The visible span must have positive length: clips that cross (nodes
  // overlap and the edge runs inside both) or coincide (touching nodes)
  // leave nothing to draw. The tolerance absorbs round-off between the two
  // node frames.
  return {
    startIndex: start.index,
    endIndex: end.index,
    startPoint: start.point,
    endPoint: end.point,
    visible: end.pos - start.pos > POSITION_EPS,
  }
}

/**
 * Local-frame distance within which a point counts as on the node border:
 * absorbs world↔local round-off (e.g. rotated nodes) for endpoints the
 * host stores exactly on the border.
 */
const BORDER_EPS = 1e-6

/** Minimum visible span, in segments (`index + fraction` units). */
const POSITION_EPS = 1e-9

type Trim = {
  /**
   * First sample past the clip point, walking from the endpoint; the clip
   * sample itself when the clip lands on one (e.g. an untrimmed endpoint).
   * Same meaning the renderer has always used for `ClipResult` indices.
   */
  index: number
  /** Clip point in world coords. */
  point: Vec2
  /** Clip position along the polyline, as `segment start index + fraction`. */
  pos: number
}

/** A clip that lands exactly on `samples[index]` (untrimmed end or a sample on the exit side). */
const clipAtSample = (samples: Vec2[], index: number): Trim => ({
  index,
  point: samples[index]!,
  pos: index,
})

/**
 * Walks samples from one end (`dir` = +1 from the source, -1 from the
 * target) and returns where the polyline first leaves the node's local
 * rect (border inclusive). An endpoint outside its node is untrimmed. When
 * the exit lands on a sample (within `BORDER_EPS`, e.g. a border endpoint
 * heading outward), that sample is reported as the clip, so the renderer
 * still paints the sample after it (a polyline bend). A border endpoint
 * heading inward is trimmed where the path leaves the far side. Returns
 * null if every sample is inside.
 */
const trimFrom = (samples: Vec2[], node: Node, dir: 1 | -1): Trim | null => {
  const first = dir === 1 ? 0 : samples.length - 1
  let insideLocal: Vec2 | null = null
  for (let i = first; i >= 0 && i < samples.length; i += dir) {
    // Converted lazily: the walk usually stops after a sample or two.
    const p = worldToNodeLocal(samples[i]!, node)
    if (isInsideLocalRect(p, node.w, node.h)) {
      insideLocal = p
      continue
    }
    if (!insideLocal) return clipAtSample(samples, first)
    // The crossing lies on segment (i - dir) → i.
    const { t, gap } = segmentRectExit(insideLocal, p, node.w, node.h)
    // The inside sample lies on the side the segment exits through (within
    // round-off, measured across that side, not along a shallow segment).
    if (t <= 0 || gap <= BORDER_EPS) return clipAtSample(samples, i - dir)
    const local = {
      x: insideLocal.x + t * (p.x - insideLocal.x),
      y: insideLocal.y + t * (p.y - insideLocal.y),
    }
    return { index: i, point: nodeLocalToWorld(local, node), pos: i - dir + dir * t }
  }
  return null
}

/**
 * Boolean: is a local-frame point inside the rect [0..w, 0..h], border
 * included? A tiny epsilon absorbs world↔local round-off for endpoints
 * stored on the border.
 */
const isInsideLocalRect = (p: Vec2, w: number, h: number): boolean =>
  p.x >= -BORDER_EPS && p.x <= w + BORDER_EPS && p.y >= -BORDER_EPS && p.y <= h + BORDER_EPS

/**
 * Where the local-frame segment `inside → outside` leaves the rect
 * [0..w, 0..h] (Liang–Barsky slab exit): `t ∈ [0, 1]` along the segment,
 * and `gap`, the distance from `inside` to the side it exits through
 * (0 when `inside` lies on that side). `inside` may lie on the border:
 * heading outward gives `t = 0`, heading inward gives the far-side exit.
 */
const segmentRectExit = (
  inside: Vec2,
  outside: Vec2,
  w: number,
  h: number,
): { t: number; gap: number } => {
  const dx = outside.x - inside.x
  const dy = outside.y - inside.y
  // Per axis: the slab side the segment heads toward, its param and gap.
  const gapX = dx > 0 ? w - inside.x : inside.x
  const gapY = dy > 0 ? h - inside.y : inside.y
  const tx = dx === 0 ? Number.POSITIVE_INFINITY : gapX / Math.abs(dx)
  const ty = dy === 0 ? Number.POSITIVE_INFINITY : gapY / Math.abs(dy)
  const exitsX = tx <= ty
  const t = Math.min(1, exitsX ? tx : ty)
  return { t: Math.max(0, t), gap: Math.abs(exitsX ? gapX : gapY) }
}
