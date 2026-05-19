import type { Vec2 } from '../types'

/**
 * Converts a single midpoint `P` (the point the user dragged the
 * bezier midpoint handle to) into a pair of cubic control points
 * `(c1, c2)` such that the resulting cubic **passes through `P` at
 * t = 0.5**.
 *
 * Math: a cubic Bezier with endpoints S, T and controls c1, c2 has
 *
 *   B(0.5) = (1/8) · S + (3/8) · c1 + (3/8) · c2 + (1/8) · T
 *
 * Solving for c1 + c2 when B(0.5) = P:
 *
 *   c1 + c2 = (8P − S − T) / 3
 *
 * One equation, two unknowns. The convention here: split symmetrically
 * (c1 = c2). That keeps the curve smooth and predictable for the user.
 * A two-handle form (c1 / c2 draggable independently) is the v1.x
 * follow-up.
 */
export const midpointToCubicControls = (
  source: Vec2,
  midpoint: Vec2,
  target: Vec2,
): { c1: Vec2; c2: Vec2 } => {
  const c = {
    x: (8 * midpoint.x - source.x - target.x) / 6,
    y: (8 * midpoint.y - source.y - target.y) / 6,
  }
  return { c1: c, c2: { ...c } }
}
