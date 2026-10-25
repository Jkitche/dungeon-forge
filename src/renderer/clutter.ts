// Room clutter: furniture and props placed inside rooms. Purely decorative: props are
// drawn on the map but never block movement or sight in VTT exports.

import { CORRIDOR, DIRS, ROCK, ROOM, isFloor } from './cells.ts';
import { RNG } from './rng.ts';
import type { Dungeon } from './generator.ts';
import type { GenreKey } from './genres.ts';

export type PropKind =
  | 'crate' | 'barrel' | 'chest' | 'table' | 'bed' | 'shelf' | 'rug'
  | 'rubble' | 'bones' | 'statue' | 'brazier' | 'console' | 'coffin' | 'pod';

/** A prop on square (x, y); long props also cover the next square right (or down when vertical). */
export interface Prop {
  x: number;
  y: number;
  kind: PropKind;
  vertical: boolean;
  room: number;
}

interface PropSpec {
  /** Two squares long instead of one. */
  long: boolean;
  /** Against a wall, away from walls, or anywhere. */
  place: 'wall' | 'center' | 'any';
  /** Fits in natural caverns. */
  cave: boolean;
}

export const PROP_SPECS: Record<PropKind, PropSpec> = {
  crate: { long: false, place: 'any', cave: true },
  barrel: { long: false, place: 'any', cave: true },
  chest: { long: false, place: 'wall', cave: true },
  table: { long: true, place: 'center', cave: false },
  bed: { long: true, place: 'wall', cave: false },
  shelf: { long: true, place: 'wall', cave: false },
  rug: { long: true, place: 'center', cave: false },
  rubble: { long: false, place: 'any', cave: true },
  bones: { long: false, place: 'any', cave: true },
  statue: { long: false, place: 'center', cave: true },
  brazier: { long: false, place: 'any', cave: true },
  console: { long: true, place: 'wall', cave: false },
  coffin: { long: true, place: 'center', cave: false },
  pod: { long: true, place: 'wall', cave: false },
};

export const PROP_KINDS = Object.keys(PROP_SPECS) as PropKind[];

export const PROP_LABELS: Record<PropKind, string> = {
  crate: 'Crate', barrel: 'Barrel', chest: 'Chest', table: 'Table', bed: 'Bed', shelf: 'Shelf', rug: 'Rug',
  rubble: 'Rubble', bones: 'Bones', statue: 'Statue', brazier: 'Brazier', console: 'Console', coffin: 'Coffin', pod: 'Cryo pod',
};

/**
 * Relative weights per setting. A weight of 0 means the prop only appears where a room's
 * name calls for it (coffins in a fantasy crypt, say).
 */
const GENRE_CLUTTER: Record<GenreKey, Partial<Record<PropKind, number>>> = {
  fantasy: { crate: 3, barrel: 3, chest: 1, table: 2, bed: 1, shelf: 2, rug: 1, rubble: 2, bones: 1, statue: 1, brazier: 1, coffin: 0 },
  scifi: { crate: 3, console: 3, pod: 1, shelf: 2, table: 1, bed: 1, barrel: 2, rubble: 1 },
  steampunk: { crate: 3, barrel: 3, table: 2, shelf: 2, chest: 1, console: 1, rug: 1, rubble: 1, bed: 0, coffin: 0 },
  horror: { coffin: 2, table: 1, shelf: 2, rug: 2, bones: 2, statue: 1, brazier: 2, bed: 1, chest: 1, crate: 0, barrel: 0 },
  wasteland: { barrel: 4, crate: 3, rubble: 4, bones: 1, table: 1, bed: 1, shelf: 1, console: 0 },
};

/** The props a setting uses, including ones it only uses where a room calls for them. */
export function settingProps(genre: GenreKey): PropKind[] {
  return Object.keys(GENRE_CLUTTER[genre]) as PropKind[];
}

/** Room names that call for particular props. Only kinds the setting allows are used. */
const ROOM_HINTS: readonly [RegExp, readonly PropKind[]][] = [
  [/librar|scriptor|archive|study|map room|drafting|patent/, ['shelf', 'table']],
  [/barrack|quarters|bedchamber|cells|nursery|bunk|dormitor/, ['bed']],
  [/kitchen|mess|banquet|lounge|parlour|dining|tavern|larder/, ['table', 'barrel']],
  [/armory|weapon|trophy|smithy/, ['shelf', 'crate']],
  [/vault|treasur|counting|reliquary/, ['chest']],
  [/crypt|ossuary|mausoleum|tomb|morgue|catacomb|bone|charnel|embalm/, ['coffin', 'bones']],
  [/shrine|chapel|altar|temple|summoning|séance|seance/, ['statue', 'brazier', 'rug']],
  [/store|cargo|storage|depot|cellar|hold|warehouse|supply|scrapyard|trading/, ['crate', 'barrel']],
  [/lab|engineering|server|bridge|comms|command|control|radio|telegraph|workshop|reactor|life support/, ['console', 'table']],
  [/cryo|med bay|infirmary|containment/, ['pod', 'bed']],
  [/throne|ballroom|gallery|great hall|observ/, ['rug', 'statue']],
];

const HINT_WEIGHT = 4;

/** Weighted list of prop kinds for a room, e.g. ['crate', 'crate', 'barrel', ...]. */
export function propPool(genre: GenreKey, roomName: string, cave: boolean): PropKind[] {
  const weights: Partial<Record<PropKind, number>> = { ...GENRE_CLUTTER[genre] };
  const name = roomName.toLowerCase();
  for (const [pattern, kinds] of ROOM_HINTS) {
    if (!pattern.test(name)) continue;
    for (const k of kinds) if (Object.hasOwn(weights, k)) weights[k] = (weights[k] ?? 0) + HINT_WEIGHT;
  }
  const pool: PropKind[] = [];
  for (const [k, w] of Object.entries(weights) as [PropKind, number][]) {
    if (cave && !PROP_SPECS[k].cave) continue;
    for (let i = 0; i < w; i++) pool.push(k);
  }
  return pool;
}

/** The squares a prop covers. */
export function footprint(p: Pick<Prop, 'x' | 'y' | 'kind' | 'vertical'>): { x: number; y: number }[] {
  if (!PROP_SPECS[p.kind].long) return [{ x: p.x, y: p.y }];
  return [{ x: p.x, y: p.y }, p.vertical ? { x: p.x, y: p.y + 1 } : { x: p.x + 1, y: p.y }];
}

const cellType = (d: Dungeon, x: number, y: number): number =>
  x < 0 || y < 0 || x >= d.width || y >= d.height ? ROCK : (d.cells[y * d.width + x] as number);

/** Directions (indexes into DIRS) in which a square touches solid rock. */
function rockSides(d: Dungeon, x: number, y: number): number[] {
  return DIRS.flatMap(([dx, dy], i) => (cellType(d, x + dx, y + dy) === ROCK ? [i] : []));
}

function nearRock(d: Dungeon, x: number, y: number): boolean {
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (cellType(d, x + i, y + j) === ROCK) return true;
  return false;
}

function fitsPlacement(d: Dungeon, place: PropSpec['place'], x: number, y: number): boolean {
  if (place === 'wall') return rockSides(d, x, y).length > 0;
  if (place === 'center') return !nearRock(d, x, y);
  return true;
}

export interface FitOptions {
  /**
   * Generation rules: wall props must touch a wall and centre props must keep clear of
   * walls. Off in the editor, where the user decides where things go.
   */
  strict?: boolean;
  /** Breaks ties between orientations at random; without it, horizontal comes first. */
  rng?: RNG;
}

/**
 * Tries to put a prop of `kind` with its first square at `cell`. Long props beside a wall
 * run along it. `free` decides whether a square is available. Returns null if it won't fit.
 */
export function fitProp(
  d: Dungeon,
  kind: PropKind,
  cell: { x: number; y: number },
  free: (x: number, y: number) => boolean,
  { strict = false, rng }: FitOptions = {},
): Prop | null {
  const spec = PROP_SPECS[kind];
  const { x, y } = cell;
  const fits = (px: number, py: number): boolean => free(px, py) && (!strict || fitsPlacement(d, spec.place, px, py));
  if (!fits(x, y)) return null;
  const room = d.roomIds[y * d.width + x] as number;
  if (!spec.long) return { x, y, kind, vertical: false, room };

  // Rock to the north or south means a horizontal wall, so lie horizontally (and vice versa).
  const alongWall = [...new Set(rockSides(d, x, y).map((i) => i === 0 || i === 2))];
  let orientations: boolean[];
  if (strict && spec.place === 'wall') orientations = alongWall;
  else if (rng) orientations = rng.chance(0.5) ? [false, true] : [true, false];
  else orientations = [...new Set([...alongWall, false, true])];
  for (const vertical of orientations) {
    const nx = vertical ? x : x + 1;
    const ny = vertical ? y + 1 : y;
    if (!fits(nx, ny) || d.roomIds[ny * d.width + nx] !== room) continue;
    return { x, y, kind, vertical, room };
  }
  return null;
}

/**
 * Squares kept clear during generation: stairs, room number labels, and anything beside
 * a doorway or corridor opening so entrances never look blocked.
 */
function reservedCells(d: Dungeon): Set<number> {
  const W = d.width;
  const reserved = new Set<number>();
  for (const s of d.stairs) reserved.add(s.y * W + s.x);
  for (const r of d.rooms) reserved.add(r.cy * W + r.cx);
  for (const o of d.doors) {
    reserved.add(o.y1 * W + o.x1);
    reserved.add(o.y1 === o.y2 ? (o.y1 - 1) * W + o.x1 : o.y1 * W + o.x1 - 1);
  }
  for (let c = 0; c < d.cells.length; c++) {
    if (d.cells[c] !== CORRIDOR) continue;
    for (const [dx, dy] of DIRS) reserved.add(c + dy * W + dx);
  }
  return reserved;
}

/**
 * Fills rooms with props. `density` is 0–1. Uses its own random stream, so clutter never
 * changes the layout or room contents a seed produces.
 */
export function placeClutter(d: Dungeon, density: number, genre: GenreKey): void {
  d.props = [];
  if (density <= 0) return;
  const rng = new RNG(`${d.seed}:clutter`);
  const W = d.width;
  const reserved = reservedCells(d);
  const occupied = new Set<number>();

  for (const r of d.rooms) {
    const squares: { x: number; y: number }[] = [];
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        const c = y * W + x;
        if (d.roomIds[c] === r.id && d.cells[c] === ROOM && !reserved.has(c)) squares.push({ x, y });
      }
    }
    if (squares.length === 0) continue;
    const pool = propPool(genre, r.contents?.name ?? '', r.shape === 'area');
    if (pool.length === 0) continue;
    const free = (x: number, y: number): boolean => {
      const c = y * W + x;
      return d.roomIds[c] === r.id && d.cells[c] === ROOM && !reserved.has(c) && !occupied.has(c);
    };
    const target = Math.min(Math.floor(squares.length / 3), Math.floor(squares.length * density * 0.16 + rng.float()));
    for (let placed = 0, tries = 0; placed < target && tries < target * 10; tries++) {
      const prop = fitProp(d, rng.pick(pool), rng.pick(squares), free, { strict: true, rng });
      if (!prop) continue;
      for (const f of footprint(prop)) occupied.add(f.y * W + f.x);
      d.props.push(prop);
      placed++;
    }
  }
}

/** Index of the prop covering a square, or -1. */
export function propAt(d: Dungeon, x: number, y: number): number {
  return d.props.findIndex((p) => footprint(p).some((f) => f.x === x && f.y === y));
}

/** Squares a new prop may use in the editor: any floor without stairs or another prop. */
export function editorFree(d: Dungeon, ignore = -1): (x: number, y: number) => boolean {
  const stairs = new Set(d.stairs.map((s) => s.y * d.width + s.x));
  const taken = new Set<number>();
  d.props.forEach((p, i) => {
    if (i !== ignore) for (const f of footprint(p)) taken.add(f.y * d.width + f.x);
  });
  return (x, y) => {
    if (x < 0 || y < 0 || x >= d.width || y >= d.height) return false;
    const c = y * d.width + x;
    return isFloor(d.cells[c] as number) && !stairs.has(c) && !taken.has(c);
  };
}
