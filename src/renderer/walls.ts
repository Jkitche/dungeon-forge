// Derive wall segments (in grid units) from the cell grid: a wall exists on every
// cell edge that separates open cells from solid rock. Collinear runs are merged so VTTs
// get a small number of long walls rather than thousands of 1-square pieces.

import { isOpen, PILLAR } from './generator.ts';
import type { Dungeon } from './generator.ts';

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * Wall segments. Unit edges listed in `skip` (windows, for exports that represent them
 * separately) are left out, splitting the walls around them.
 */
export function computeWalls(d: Dungeon, skip: readonly Segment[] = []): Segment[] {
  const { width: W, height: H, cells } = d;
  const open = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < H && isOpen(cells[y * W + x] as number);
  const skipped = new Set(skip.map((e) => `${e.x1},${e.y1},${e.x2},${e.y2}`));
  const segs: Segment[] = [];

  for (let y = 0; y <= H; y++) {
    let start = -1;
    for (let x = 0; x <= W; x++) {
      const wall = x < W && open(x, y - 1) !== open(x, y) && !skipped.has(`${x},${y},${x + 1},${y}`);
      if (wall && start < 0) start = x;
      if (!wall && start >= 0) {
        segs.push({ x1: start, y1: y, x2: x, y2: y });
        start = -1;
      }
    }
  }
  for (let x = 0; x <= W; x++) {
    let start = -1;
    for (let y = 0; y <= H; y++) {
      const wall = y < H && open(x - 1, y) !== open(x, y) && !skipped.has(`${x},${y},${x},${y + 1}`);
      if (wall && start < 0) start = y;
      if (!wall && start >= 0) {
        segs.push({ x1: x, y1: start, x2: x, y2: y });
        start = -1;
      }
    }
  }
  return segs;
}

export const PILLAR_RADIUS = 0.34;

/** Closed octagons (grid units) around each pillar, for line-of-sight blocking in VTTs. */
export function computePillarOutlines(d: Dungeon): Point[][] {
  const out: Point[][] = [];
  for (let c = 0; c < d.cells.length; c++) {
    if (d.cells[c] !== PILLAR) continue;
    const cx = (c % d.width) + 0.5;
    const cy = Math.floor(c / d.width) + 0.5;
    const poly: Point[] = [];
    for (let i = 0; i <= 8; i++) {
      const a = ((i % 8) / 8) * Math.PI * 2 + Math.PI / 8;
      poly.push({ x: +(cx + Math.cos(a) * PILLAR_RADIUS).toFixed(3), y: +(cy + Math.sin(a) * PILLAR_RADIUS).toFixed(3) });
    }
    out.push(poly);
  }
  return out;
}
