import type { Vec2, WorldRect } from '../types'
/**
 * Uniform-grid spatial index — see ARCHITECTURE.md §7.
 *
 * Stores ids by their AABB, with each AABB occupying one or more grid cells.
 * Insert / remove / query are O(1) per cell touched; total per query is
 * O(cells × items-per-cell), which for our 256-unit cell size and
 * typical scene density is well under 1ms even at 50k items.
 *
 * Sized ~256 world units by default. Tune via the constructor.
 */
import { rectsIntersect } from './aabb'

export type SpatialId = string

export class UniformGrid {
  private readonly cellSize: number
  // cell key -> set of ids whose AABB intersects this cell
  private readonly cells = new Map<string, Set<SpatialId>>()
  // id -> AABB (cached so remove() can find which cells to clear)
  private readonly bounds = new Map<SpatialId, WorldRect>()

  constructor(cellSize = 256) {
    if (cellSize <= 0) throw new Error('cellSize must be positive')
    this.cellSize = cellSize
  }

  get size(): number {
    return this.bounds.size
  }

  /**
   * Inserts or replaces an entry. Removes previous cell membership if the id existed.
   */
  insert(id: SpatialId, aabb: WorldRect): void {
    const existing = this.bounds.get(id)
    if (existing) this.removeFromCells(id, existing)
    this.bounds.set(id, aabb)
    for (const key of this.cellKeysFor(aabb)) {
      let cell = this.cells.get(key)
      if (!cell) {
        cell = new Set()
        this.cells.set(key, cell)
      }
      cell.add(id)
    }
  }

  /**
   * Removes an entry. No-op if id is unknown.
   */
  remove(id: SpatialId): void {
    const aabb = this.bounds.get(id)
    if (!aabb) return
    this.removeFromCells(id, aabb)
    this.bounds.delete(id)
  }

  /**
   * Returns the stored AABB for an id, if any.
   */
  getAABB(id: SpatialId): WorldRect | undefined {
    return this.bounds.get(id)
  }

  /**
   * Returns ids whose AABB intersects the query rect.
   * Broad-phase only — callers do narrow-phase per id.
   */
  queryRect(rect: WorldRect): SpatialId[] {
    const result = new Set<SpatialId>()
    for (const key of this.cellKeysFor(rect)) {
      const cell = this.cells.get(key)
      if (!cell) continue
      for (const id of cell) {
        const aabb = this.bounds.get(id)
        if (aabb && rectsIntersect(aabb, rect)) result.add(id)
      }
    }
    return [...result]
  }

  /**
   * Returns ids whose AABB contains the point.
   */
  queryPoint(p: Vec2): SpatialId[] {
    return this.queryRect({ x: p.x, y: p.y, w: 0, h: 0 })
  }

  /**
   * Empties the index. O(1) on the bookkeeping; the GC handles the rest.
   */
  clear(): void {
    this.cells.clear()
    this.bounds.clear()
  }

  /**
   * Yields the cell keys that an AABB covers.
   */
  private *cellKeysFor(aabb: WorldRect): IterableIterator<string> {
    const cs = this.cellSize
    const x0 = Math.floor(aabb.x / cs)
    const y0 = Math.floor(aabb.y / cs)
    const x1 = Math.floor((aabb.x + aabb.w) / cs)
    const y1 = Math.floor((aabb.y + aabb.h) / cs)
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        yield `${cx},${cy}`
      }
    }
  }

  private removeFromCells(id: SpatialId, aabb: WorldRect): void {
    for (const key of this.cellKeysFor(aabb)) {
      const cell = this.cells.get(key)
      if (!cell) continue
      cell.delete(id)
      if (cell.size === 0) this.cells.delete(key)
    }
  }
}
