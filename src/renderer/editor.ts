// Hand-editing operations on a dungeon. Pure data like the generator, so it runs in tests.
//
// Every operation mutates the dungeon in place, then calls normalizeDungeon() so rooms,
// doors and stairs stay consistent with the cell grid, whatever was drawn over what.

import { RNG, randomSeed } from './rng.ts';
import { CORRIDOR, DIRS, PILLAR, ROCK, ROOM, inRoomShape, isFloor, normalizeOptions } from './generator.ts';
import type { Door, DoorType, Dungeon, DungeonOptions, MapWindow, Room, Stair } from './generator.ts';
import { createStocker, stockRoom } from './contents.ts';
import type { RoomContents } from './contents.ts';
import { getGenre } from './genres.ts';
import { PROP_SPECS, editorFree, fitProp, footprint, propAt } from './clutter.ts';
import type { Prop, PropKind } from './clutter.ts';

export interface Cell {
  x: number;
  y: number;
}

/** One cell edge in grid units: horizontal when y1 === y2, vertical when x1 === x2. */
export interface Edge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const idx = (d: Dungeon, x: number, y: number): number => y * d.width + x;

/** The outer ring always stays rock so the map is enclosed by walls. */
export function isEditable(d: Dungeon, x: number, y: number): boolean {
  return x >= 1 && y >= 1 && x < d.width - 1 && y < d.height - 1;
}

export function createBlankDungeon(input: Partial<DungeonOptions> = {}): Dungeon {
  const o = normalizeOptions({ ...input, algorithm: 'rooms' });
  const n = o.width * o.height;
  return {
    version: 1,
    seed: o.seed,
    algorithm: 'rooms',
    options: o,
    width: o.width,
    height: o.height,
    cells: new Uint8Array(n),
    roomIds: new Int16Array(n).fill(-1),
    rooms: [],
    doors: [],
    windows: [],
    stairs: [],
    props: [],
    edited: true,
  };
}

/** Every editable cell in the rectangle spanned by two corners (in any order). */
export function rectCells(d: Dungeon, a: Cell, b: Cell): Cell[] {
  const out: Cell[] = [];
  for (let y = Math.max(1, Math.min(a.y, b.y)); y <= Math.min(d.height - 2, Math.max(a.y, b.y)); y++) {
    for (let x = Math.max(1, Math.min(a.x, b.x)); x <= Math.min(d.width - 2, Math.max(a.x, b.x)); x++) out.push({ x, y });
  }
  return out;
}

/** Cells on a 4-connected line from a to b, so a fast brush stroke leaves no diagonal gaps. */
export function lineCells(a: Cell, b: Cell): Cell[] {
  const out: Cell[] = [{ ...a }];
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  const sx = Math.sign(b.x - a.x);
  const sy = Math.sign(b.y - a.y);
  let { x, y } = a;
  let err = dx - dy;
  while (x !== b.x || y !== b.y) {
    if ((2 * err > -dy && x !== b.x) || y === b.y) {
      err -= dy;
      x += sx;
    } else {
      err += dx;
      y += sy;
    }
    out.push({ x, y });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Operations. Each returns whether anything changed.

/** Carves a rectangular room. Squares taken from other rooms now belong to the new one. */
export function paintRoom(d: Dungeon, a: Cell, b: Cell, contents: RoomContents): boolean {
  const cells = rectCells(d, a, b);
  if (cells.length === 0) return false;
  const id = d.rooms.reduce((m, r) => Math.max(m, r.id), -1) + 1;
  const xs = cells.map((c) => c.x);
  const ys = cells.map((c) => c.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const w = Math.max(...xs) - x + 1;
  const h = Math.max(...ys) - y + 1;
  for (const c of cells) {
    const i = idx(d, c.x, c.y);
    d.cells[i] = ROOM;
    d.roomIds[i] = id;
  }
  d.rooms.push({
    id, x, y, w, h, shape: 'rect',
    cx: x + Math.floor(w / 2), cy: y + Math.floor(h / 2),
    entrance: false, exit: false, contents, doorCount: 0,
  });
  return commit(d);
}

/** Turns rock into corridor. Existing rooms and corridors are left alone. */
export function paintCorridor(d: Dungeon, cells: Cell[]): boolean {
  let changed = false;
  for (const c of cells) {
    if (!isEditable(d, c.x, c.y)) continue;
    const i = idx(d, c.x, c.y);
    if (d.cells[i] !== ROCK) continue;
    d.cells[i] = CORRIDOR;
    changed = true;
  }
  return changed && commit(d);
}

/** Turns squares back into solid rock. */
export function eraseCells(d: Dungeon, cells: Cell[]): boolean {
  let changed = false;
  for (const c of cells) {
    if (!isEditable(d, c.x, c.y)) continue;
    const i = idx(d, c.x, c.y);
    if (d.cells[i] === ROCK) continue;
    d.cells[i] = ROCK;
    d.roomIds[i] = -1;
    changed = true;
  }
  return changed && commit(d);
}

/** Adds a pillar to a floor square, or removes one. Pillars keep their room. */
export function togglePillar(d: Dungeon, c: Cell): boolean {
  if (!isEditable(d, c.x, c.y)) return false;
  const i = idx(d, c.x, c.y);
  const t = d.cells[i];
  if (t === PILLAR) d.cells[i] = (d.roomIds[i] as number) >= 0 ? ROOM : CORRIDOR;
  else if (t === ROOM || t === CORRIDOR) d.cells[i] = PILLAR;
  else return false;
  return commit(d);
}

/** The cell edge nearest a point given in fractional grid coordinates. */
export function edgeAt(fx: number, fy: number): Edge {
  const x = Math.floor(fx);
  const y = Math.floor(fy);
  const u = fx - x;
  const v = fy - y;
  const best = Math.min(u, 1 - u, v, 1 - v);
  if (best === v) return { x1: x, y1: y, x2: x + 1, y2: y };
  if (best === 1 - v) return { x1: x, y1: y + 1, x2: x + 1, y2: y + 1 };
  if (best === u) return { x1: x, y1: y, x2: x, y2: y + 1 };
  return { x1: x + 1, y1: y, x2: x + 1, y2: y + 1 };
}

/** The two cells either side of an edge: above/below or left/right. */
function edgeSides(e: Edge): [Cell, Cell] {
  return e.y1 === e.y2 ? [{ x: e.x1, y: e.y1 - 1 }, { x: e.x1, y: e.y1 }] : [{ x: e.x1 - 1, y: e.y1 }, { x: e.x1, y: e.y1 }];
}

const inside = (d: Dungeon, c: Cell): boolean => c.x >= 0 && c.y >= 0 && c.x < d.width && c.y < d.height;

/** A door needs floor on both sides of the edge. */
export function canHaveDoor(d: Dungeon, e: Edge): boolean {
  return edgeSides(e).every((c) => inside(d, c) && isFloor(d.cells[idx(d, c.x, c.y)] as number));
}

/** A window needs floor on one side of the edge and solid rock on the other. */
export function canHaveWindow(d: Dungeon, e: Edge): boolean {
  const [a, b] = edgeSides(e);
  if (!inside(d, a) || !inside(d, b)) return false;
  const ta = d.cells[idx(d, a.x, a.y)] as number;
  const tb = d.cells[idx(d, b.x, b.y)] as number;
  return (isFloor(ta) && tb === ROCK) || (isFloor(tb) && ta === ROCK);
}

/** Adds a window to a wall edge, or removes the one that's there. */
export function toggleWindow(d: Dungeon, e: Edge): boolean {
  if (!canHaveWindow(d, e)) return false;
  const i = d.windows.findIndex((w) => sameEdge(w, e));
  if (i >= 0) d.windows.splice(i, 1);
  else d.windows.push({ x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2, room: -1 });
  return commit(d);
}

const sameEdge = (a: Edge, b: Edge): boolean => a.x1 === b.x1 && a.y1 === b.y1 && a.x2 === b.x2 && a.y2 === b.y2;
const DOOR_CYCLE: (DoorType | null)[] = ['normal', 'locked', 'secret', null];

/** Click order on an edge: door → locked → secret → no door. */
export function cycleDoor(d: Dungeon, e: Edge): boolean {
  if (!canHaveDoor(d, e)) return false;
  const i = d.doors.findIndex((o) => sameEdge(o, e));
  const current = i >= 0 ? (d.doors[i] as Door).type : null;
  const next = DOOR_CYCLE[(DOOR_CYCLE.indexOf(current) + 1) % DOOR_CYCLE.length] ?? null;
  if (i >= 0) d.doors.splice(i, 1);
  if (next) d.doors.push({ x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2, type: next, room: -1 });
  return commit(d);
}

/** Click order on a floor square: stairs up → stairs down → none. */
export function cycleStairs(d: Dungeon, c: Cell): boolean {
  if (!isEditable(d, c.x, c.y) || !isFloor(d.cells[idx(d, c.x, c.y)] as number)) return false;
  const i = d.stairs.findIndex((s) => s.x === c.x && s.y === c.y);
  const existing = d.stairs[i];
  if (!existing) {
    // Lean the stairs against a wall if there is one.
    const dir = DIRS.findIndex(([dx, dy]) => d.cells[idx(d, c.x + dx, c.y + dy)] === ROCK);
    d.stairs.push({ x: c.x, y: c.y, dir: dir >= 0 ? dir : 3, kind: 'up', room: -1 });
  } else if (existing.kind === 'up') {
    existing.kind = 'down';
  } else {
    d.stairs.splice(i, 1);
  }
  return commit(d);
}

/** Places a prop of the chosen kind with its first square here, if it fits. */
export function placeProp(d: Dungeon, c: Cell, kind: PropKind): boolean {
  if (!isEditable(d, c.x, c.y)) return false;
  const prop = fitProp(d, kind, c, editorFree(d));
  if (!prop) return false;
  d.props.push(prop);
  return commit(d);
}

/** Removes the prop covering a square. */
export function removeProp(d: Dungeon, c: Cell): boolean {
  const i = propAt(d, c.x, c.y);
  if (i < 0) return false;
  d.props.splice(i, 1);
  return commit(d);
}

/** Turns a two-square prop a quarter turn, keeping the clicked square covered. */
export function rotateProp(d: Dungeon, c: Cell): boolean {
  const i = propAt(d, c.x, c.y);
  const old = d.props[i];
  if (!old || !PROP_SPECS[old.kind].long) return false;
  const free = editorFree(d, i);
  const vertical = !old.vertical;
  // Either the clicked square starts the turned prop, or it's the prop's second square.
  const anchors = [c, vertical ? { x: c.x, y: c.y - 1 } : { x: c.x - 1, y: c.y }];
  for (const a of anchors) {
    const second = vertical ? { x: a.x, y: a.y + 1 } : { x: a.x + 1, y: a.y };
    if (!free(a.x, a.y) || !free(second.x, second.y)) continue;
    if (d.roomIds[idx(d, a.x, a.y)] !== d.roomIds[idx(d, second.x, second.y)]) continue;
    d.props[i] = { ...old, x: a.x, y: a.y, vertical };
    return commit(d);
  }
  return false;
}

/** Wipes the map back to solid rock. */
export function clearMap(d: Dungeon): boolean {
  if (d.rooms.length === 0 && d.cells.every((t) => t === ROCK)) return false;
  d.cells.fill(ROCK);
  d.roomIds.fill(-1);
  d.rooms = [];
  d.doors = [];
  d.windows = [];
  d.stairs = [];
  d.props = [];
  return commit(d);
}

function commit(d: Dungeon): boolean {
  d.edited = true;
  normalizeDungeon(d);
  return true;
}

/** Room key contents for a newly drawn room, avoiding names already on the map. */
export function stockNewRoom(d: Dungeon, rng: RNG = new RNG(randomSeed())): RoomContents {
  const decks = createStocker(rng, getGenre(d.options.genre), false);
  const taken = new Set(d.rooms.map((r) => r.contents?.name));
  const contents = stockRoom(rng, decks, { isEntrance: false, isExit: false });
  for (let i = 0; i < 30 && taken.has(contents.name); i++) contents.name = decks.name();
  return contents;
}

// ---------------------------------------------------------------------------
// Consistency

/**
 * Rebuilds everything derived from the cell grid after an edit: drops rooms that lost
 * all their squares, recomputes each room's bounds, shape and label square, renumbers
 * rooms, and removes doors and stairs that no longer sit on floor.
 * On a freshly generated dungeon this changes nothing.
 */
export function normalizeDungeon(d: Dungeon): void {
  const { width: W, cells, roomIds } = d;
  for (let c = 0; c < cells.length; c++) {
    if (cells[c] === ROCK || cells[c] === CORRIDOR) roomIds[c] = -1;
  }

  const members = new Map<number, number[]>();
  for (let c = 0; c < cells.length; c++) {
    const id = roomIds[c] as number;
    if (id < 0) continue;
    const list = members.get(id);
    if (list) list.push(c);
    else members.set(id, [c]);
  }

  const remap = new Map<number, number>();
  const kept: Room[] = [];
  for (const r of d.rooms) {
    const list = members.get(r.id);
    if (!list?.length) continue;
    const xs = list.map((c) => c % W);
    const ys = list.map((c) => Math.floor(c / W));
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    const w = Math.max(...xs) - x + 1;
    const h = Math.max(...ys) - y + 1;

    if (r.shape !== 'area') {
      const sameBounds = x === r.x && y === r.y && w === r.w && h === r.h;
      const matchesShape = sameBounds && r.shape !== 'irregular' && matchesShapeMask(d, r, list.length);
      if (!matchesShape) r.shape = list.length === w * h ? 'rect' : 'irregular';
    }
    Object.assign(r, { x, y, w, h });

    // Keep the label where it was if that square is still this room's floor.
    const label = r.cy * W + r.cx;
    if (roomIds[label] !== r.id || cells[label] !== ROOM) {
      const floor = list.filter((c) => cells[c] === ROOM);
      const pool = floor.length ? floor : list;
      const mx = x + (w - 1) / 2;
      const my = y + (h - 1) / 2;
      let best = pool[0] as number;
      let bestD = Infinity;
      for (const c of pool) {
        const dd = ((c % W) - mx) ** 2 + (Math.floor(c / W) - my) ** 2;
        if (dd < bestD) {
          bestD = dd;
          best = c;
        }
      }
      r.cx = best % W;
      r.cy = Math.floor(best / W);
    }

    remap.set(r.id, kept.length);
    r.id = kept.length;
    kept.push(r);
  }
  for (let c = 0; c < roomIds.length; c++) {
    const id = roomIds[c] as number;
    if (id >= 0) roomIds[c] = remap.get(id) ?? -1;
  }
  d.rooms = kept;

  // Doors: only on floor-to-floor edges, one per edge, owned by a room on either side.
  const seenDoors = new Set<string>();
  d.doors = d.doors.filter((o) => {
    const key = `${o.x1},${o.y1},${o.x2},${o.y2}`;
    if (seenDoors.has(key) || !canHaveDoor(d, o)) return false;
    seenDoors.add(key);
    const owner = edgeSides(o).map((c) => roomIds[idx(d, c.x, c.y)] as number).find((id) => id >= 0);
    o.room = owner ?? -1;
    return true;
  });

  // Windows: only between floor and rock, one per edge, owned by the room on the floor side.
  const seenWindows = new Set<string>();
  d.windows = d.windows.filter((w) => {
    const key = `${w.x1},${w.y1},${w.x2},${w.y2}`;
    if (seenWindows.has(key) || !canHaveWindow(d, w)) return false;
    seenWindows.add(key);
    const floor = edgeSides(w).find((c) => isFloor(cells[idx(d, c.x, c.y)] as number)) as Cell;
    w.room = roomIds[idx(d, floor.x, floor.y)] as number;
    return true;
  });

  // Props: every square they cover must be floor without stairs, and props can't overlap.
  const stairSquares = new Set(d.stairs.map((s) => idx(d, s.x, s.y)));
  const covered = new Set<number>();
  d.props = d.props.filter((p) => {
    const squares = footprint(p).map((f) => (inside(d, f) ? idx(d, f.x, f.y) : -1));
    if (squares.some((c) => c < 0 || !isFloor(cells[c] as number) || stairSquares.has(c) || covered.has(c))) return false;
    for (const c of squares) covered.add(c);
    p.room = roomIds[squares[0] as number] as number;
    return true;
  });

  // Stairs: only on floor, one per square.
  const seenStairs = new Set<number>();
  d.stairs = d.stairs.filter((s: Stair) => {
    const c = idx(d, s.x, s.y);
    if (seenStairs.has(c) || !isFloor(cells[c] as number)) return false;
    seenStairs.add(c);
    s.room = roomIds[c] as number;
    return true;
  });

  for (const r of d.rooms) {
    r.entrance = d.stairs.some((s) => s.room === r.id && s.kind === 'up');
    r.exit = d.stairs.some((s) => s.room === r.id && s.kind === 'down');
    r.doorCount = d.doors.filter((o) => o.room === r.id).length;
  }
}

/** True when the room's squares are exactly its shape's footprint at its current bounds. */
function matchesShapeMask(d: Dungeon, r: Room, memberCount: number): boolean {
  let n = 0;
  for (let j = 0; j < r.h; j++) {
    for (let i = 0; i < r.w; i++) {
      if (!inRoomShape(r, i, j)) continue;
      if (d.roomIds[idx(d, r.x + i, r.y + j)] !== r.id) return false;
      n++;
    }
  }
  return n === memberCount;
}

// ---------------------------------------------------------------------------
// Undo

export interface Snapshot {
  cells: Uint8Array;
  roomIds: Int16Array;
  rooms: Room[];
  doors: Door[];
  windows: MapWindow[];
  stairs: Stair[];
  props: Prop[];
  edited: boolean;
}

export function snapshot(d: Dungeon): Snapshot {
  return {
    cells: d.cells.slice(),
    roomIds: d.roomIds.slice(),
    rooms: structuredClone(d.rooms),
    doors: structuredClone(d.doors),
    windows: structuredClone(d.windows),
    stairs: structuredClone(d.stairs),
    props: structuredClone(d.props),
    edited: d.edited ?? false,
  };
}

export function restore(d: Dungeon, s: Snapshot): void {
  d.cells.set(s.cells);
  d.roomIds.set(s.roomIds);
  d.rooms = structuredClone(s.rooms);
  d.doors = structuredClone(s.doors);
  d.windows = structuredClone(s.windows);
  d.stairs = structuredClone(s.stairs);
  d.props = structuredClone(s.props);
  d.edited = s.edited;
}
