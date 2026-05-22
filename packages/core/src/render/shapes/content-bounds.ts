/**
 * Per-shape content bounds — the rect within a node where text content
 * is laid out and painted. Defaults to the full node bbox; shapes with
 * non-rectangular interiors override so text doesn't bleed into the
 * non-content areas (capsule's accent circle, diamond's narrow tips,
 * thought-cloud's dome, tag's notch, etc.).
 *
 * Returned in node-local coords. Renderer's `paintNodeContent` already
 * applies the node transform before drawing — bounds are relative to
 * (0, 0) inside the node.
 */
import type { Node } from '../../types'

export type ContentBounds = { x: number; y: number; w: number; h: number }

const SQRT2_INV = 1 / Math.SQRT2

export const contentBounds = (node: Node): ContentBounds => {
  const { w, h } = node
  switch (node.type) {
    case 'capsule': {
      // Skip the accent circle — text fills the rect body to its right.
      // Must mirror compositeLayout's capsule geometry.
      const circ = Math.min(h * 0.55, w * 0.28, 56)
      const overlap = circ * 0.15
      const rectX = circ - overlap
      return { x: rectX, y: 0, w: Math.max(0, w - rectX), h }
    }
    case 'diamond':
    case 'layered-diamond':
    case 'soft-diamond': {
      // Inscribed rectangle of a square rotated 45° = bbox × (1/√2).
      // For `soft-diamond` the inner (front) diamond is 96% of bbox so
      // its inscribed rect is slightly tighter, but the bbox-relative
      // formula reads well enough without a separate case.
      const cw = w * SQRT2_INV
      const ch = h * SQRT2_INV
      return { x: (w - cw) / 2, y: (h - ch) / 2, w: cw, h: ch }
    }
    case 'ellipse':
    case 'layered-ellipse': {
      // True ellipse-inscribed rect is bbox × (1/√2). Using 0.7 gives a
      // tiny safety margin so text doesn't kiss the curve at the edges.
      const f = 0.7
      const cw = w * f
      const ch = h * f
      return { x: (w - cw) / 2, y: (h - ch) / 2, w: cw, h: ch }
    }
    case 'thought-cloud': {
      // Rect body only — skip the dome area at the top. Must mirror
      // the geometry in `path-helpers.ts thoughtCloudGeometry`.
      const domeW = Math.min(w * 0.4, h * 1.2)
      const domeH = Math.min(h * 0.45, domeW)
      const bodyY = domeH * 0.55
      return { x: 0, y: bodyY, w, h: Math.max(0, h - bodyY) }
    }
    case 'tag': {
      // Skip the left notch — text fills the body to the right.
      const notch = Math.min(h * 0.5, w * 0.3)
      return { x: notch, y: 0, w: Math.max(0, w - notch), h }
    }
    default:
      return { x: 0, y: 0, w, h }
  }
}
