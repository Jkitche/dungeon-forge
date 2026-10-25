// Procedural dungeon generation. Pure data, no DOM, so it runs in tests too.
//
// The map is a grid of cells. Walls are not stored: they are derived from the
// boundary between open and solid cells (see walls.ts). Doors live on the
// edge between a room cell and the corridor cell that enters it.

import { RNG, randomSeed } from './rng.ts';
import { createStocker, stockRoom } from './contents.ts';
import type { RoomContents } from './contents.ts';
import { getGenre, isGenreKey } from './genres.ts';
import { placeClutter } from './clutter.ts';
import type { Prop } from './clutter.ts';
import type { GenreKey } from './genres.ts';

// Cell types and directions live in cells.ts so other modules can use them without
// importing the generator; re-exported here for existing callers.
export { ROCK, ROOM, CORRIDOR, PILLAR, isFloor, isOpen, DIRS } from './cells.ts';
export type { CellType } from './cells.ts';
import { ROCK, ROOM, CORRIDOR, PILLAR, isFloor, DIRS } from './cells.ts';

export type Algorithm = 'rooms' | 'caves';
export type CorridorStyle = 'straight' | 'winding';
/** 'irregular' rooms come from hand edits; 'area' is a cavern region. */
export type RoomShape = 'rect' | 'round' | 'octagon' | 'irregular' | 'area';
export type DoorType = 'normal' | 'locked' | 'secret';

export interface DungeonOptions {
  seed: string;
  /** Setting: drives room contents and vocabulary, not the layout. */
  genre: GenreKey;
  algorithm: Algorithm;
  width: number;
  height: number;
  roomCount: number;
  roomMin: number;
  roomMax: number;
  roundRoomChance: number;
  pillarChance: number;
  corridorStyle: CorridorStyle;
  loopChance: number;
  doorChance: number;
  lockedDoorChance: number;
  secretDoorChance: number;
  /** Chance that each straight stretch of room wall gets a window. */
  windowChance: number;
  /** How much furniture and junk fills each room, 0–1. */
  clutter: number;
  caveFill: number;
  caveSteps: number;
}

export interface Room {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  shape: RoomShape;
  /** The cell where the room's label goes. */
  cx: number;
  cy: number;
  entrance: boolean;
  exit: boolean;
  contents: RoomContents | null;
  doorCount: number;
}

/** A door on the cell edge (x1,y1)–(x2,y2), in grid units. */
export interface Door {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  type: DoorType;
  room: number;
}

/** A window in a wall: the edge (x1,y1)–(x2,y2) between a room's floor and solid rock. */
export interface MapWindow {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  room: number;
}

export interface Stair {
  x: number;
  y: number;
  /** Index into DIRS pointing at the wall the stairs lean against. */
  dir: number;
  kind: 'up' | 'down';
  room: number;
}

export interface Dungeon {
  version: 1;
  seed: string;
  algorithm: Algorithm;
  options: DungeonOptions;
  width: number;
  height: number;
  cells: Uint8Array;
  roomIds: Int16Array;
  rooms: Room[];
  doors: Door[];
  windows: MapWindow[];
  stairs: Stair[];
  /** Decorative furniture and props inside rooms. */
  props: Prop[];
  /** Set once the map has been hand-edited; the seed no longer reproduces it. */
  edited?: boolean;
}

export type SerializedDungeon = Omit<Dungeon, 'cells' | 'roomIds'> & { cells: string; roomIds: number[] };

export const DEFAULT_OPTIONS: DungeonOptions = {
  seed: '',
  genre: 'fantasy',
  algorithm: 'rooms',
  width: 48,
  height: 36,
  roomCount: 12,
  roomMin: 4,
  roomMax: 10,
  roundRoomChance: 0.15,
  pillarChance: 0.35,
  corridorStyle: 'straight',
  loopChance: 0.2,
  doorChance: 0.8,
  lockedDoorChance: 0.15,
  secretDoorChance: 0.1,
  windowChance: 0.1,
  clutter: 0.4,
  caveFill: 0.45,
  caveSteps: 5,
};

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const num = (v: unknown, fallback: number): number => (Number.isFinite(Number(v)) ? Number(v) : fallback);

const CHANCE_KEYS = ['roundRoomChance', 'pillarChance', 'loopChance', 'doorChance', 'lockedDoorChance', 'secretDoorChance', 'windowChance', 'clutter'] as const;

export function normalizeOptions(input: Partial<DungeonOptions> = {}): DungeonOptions {
  const o: DungeonOptions = { ...DEFAULT_OPTIONS, ...input };
  o.seed = String(o.seed ?? '').trim() || randomSeed();
  o.genre = isGenreKey(o.genre) ? o.genre : 'fantasy';
  o.algorithm = o.algorithm === 'caves' ? 'caves' : 'rooms';
  o.corridorStyle = o.corridorStyle === 'winding' ? 'winding' : 'straight';
  o.width = Math.round(clamp(num(o.width, 48), 16, 120));
  o.height = Math.round(clamp(num(o.height, 36), 16, 120));
  o.roomCount = Math.round(clamp(num(o.roomCount, 12), 1, 60));
  o.roomMax = Math.round(clamp(num(o.roomMax, 10), 3, Math.min(o.width, o.height) - 4));
  o.roomMin = Math.round(clamp(num(o.roomMin, 4), 3, o.roomMax));
  for (const k of CHANCE_KEYS) o[k] = clamp(num(o[k], DEFAULT_OPTIONS[k]), 0, 1);
  o.caveFill = clamp(num(o.caveFill, 0.45), 0.3, 0.6);
  o.caveSteps = Math.round(clamp(num(o.caveSteps, 5), 1, 10));
  return o;
}

export function generateDungeon(input: Partial<DungeonOptions> = {}): Dungeon {
  const o = normalizeOptions(input);
  const rng = new RNG(o.seed);
  const W = o.width;
  const H = o.height;
  const d: Dungeon = {
    version: 1,
    seed: o.seed,
    algorithm: o.algorithm,
    options: o,
    width: W,
    height: H,
    cells: new Uint8Array(W * H),
    roomIds: new Int16Array(W * H).fill(-1),
    rooms: [],
    doors: [],
    windows: [],
    stairs: [],
    props: [],
  };
  // Per-cell noise makes winding corridors and cave tunnels wander deterministically.
  const noise = new Float32Array(W * H);
  for (let i = 0; i < noise.length; i++) noise[i] = rng.float();
  const pathCells = new Set<number>();

  if (o.algorithm === 'caves') buildCaves(d, rng, o, noise, pathCells);
  else buildRooms(d, rng, o, noise, pathCells);

  numberRoomsAndPlaceStairs(d, rng, pathCells);
  if (o.algorithm === 'rooms') {
    placePillars(d, rng, o, pathCells);
    placeDoors(d, rng, o);
    placeWindows(d, o);
  }

  // Contents are rolled after the layout, so a seed keeps its floor plan across genres.
  const decks = createStocker(rng, getGenre(o.genre), o.algorithm === 'caves');
  for (const room of d.rooms) {
    room.contents = stockRoom(rng, decks, { isEntrance: room.entrance, isExit: room.exit });
    room.doorCount = d.doors.filter((door) => door.room === room.id).length;
  }
  // After stocking, because room names steer the choice of props.
  placeClutter(d, o.clutter, o.genre);
  return d;
}

function newRoom(id: number, x: number, y: number, w: number, h: number, shape: RoomShape, cx: number, cy: number): Room {
  return { id, x, y, w, h, shape, cx, cy, entrance: false, exit: false, contents: null, doorCount: 0 };
}

// ---------------------------------------------------------------------------
// Rooms & corridors

function buildRooms(d: Dungeon, rng: RNG, o: DungeonOptions, noise: Float32Array, pathCells: Set<number>): void {
  const { width: W, height: H } = d;
  const pad = 2;
  const maxAttempts = o.roomCount * 60;

  for (let a = 0; a < maxAttempts && d.rooms.length < o.roomCount; a++) {
    const w = rng.int(o.roomMin, o.roomMax);
    const h = rng.int(o.roomMin, o.roomMax);
    if (W - w - 2 < 2 || H - h - 2 < 2) continue;
    const x = rng.int(2, W - w - 2);
    const y = rng.int(2, H - h - 2);
    const overlaps = d.rooms.some(
      (r) => x < r.x + r.w + pad && x + w + pad > r.x && y < r.y + r.h + pad && y + h + pad > r.y,
    );
    if (overlaps) continue;

    let shape: RoomShape = 'rect';
    if (w >= 5 && h >= 5 && rng.chance(o.roundRoomChance)) shape = 'round';
    else if (w >= 6 && h >= 6 && rng.chance(0.15)) shape = 'octagon';

    const room = newRoom(d.rooms.length, x, y, w, h, shape, x + Math.floor(w / 2), y + Math.floor(h / 2));
    carveRoom(d, room);
    d.rooms.push(room);
  }

  connectRooms(d, rng, o, noise, pathCells);
}

export function inRoomShape(room: Room, i: number, j: number): boolean {
  const { w, h, shape } = room;
  if (shape === 'round') {
    const dx = (i + 0.5 - w / 2) / (w / 2);
    const dy = (j + 0.5 - h / 2) / (h / 2);
    return dx * dx + dy * dy <= 1.08;
  }
  if (shape === 'octagon') {
    const k = Math.floor(Math.min(w, h) / 3);
    return Math.min(i, w - 1 - i) + Math.min(j, h - 1 - j) >= k;
  }
  return true;
}

function carveRoom(d: Dungeon, room: Room): void {
  for (let j = 0; j < room.h; j++) {
    for (let i = 0; i < room.w; i++) {
      if (!inRoomShape(room, i, j)) continue;
      const c = (room.y + j) * d.width + room.x + i;
      d.cells[c] = ROOM;
      d.roomIds[c] = room.id;
    }
  }
}

interface Edge {
  a: number;
  b: number;
  dist: number;
}

function connectRooms(d: Dungeon, rng: RNG, o: DungeonOptions, noise: Float32Array, pathCells: Set<number>): void {
  const rooms = d.rooms;
  const n = rooms.length;
  if (n < 2) return;

  const edges: Edge[] = [];
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      const ra = rooms[a] as Room;
      const rb = rooms[b] as Room;
      edges.push({ a, b, dist: Math.hypot(ra.cx - rb.cx, ra.cy - rb.cy) });
    }
  }
  edges.sort((p, q) => p.dist - q.dist);

  // Kruskal's minimum spanning tree guarantees every room is reachable.
  const parent = rooms.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i] as number)));
  const tree: Edge[] = [];
  const extra: Edge[] = [];
  for (const e of edges) {
    const ra = find(e.a);
    const rb = find(e.b);
    if (ra !== rb) {
      parent[ra] = rb;
      tree.push(e);
    } else {
      extra.push(e);
    }
  }
  // Extra short connections create loops so the dungeon is not a pure tree.
  const loops = extra.slice(0, n * 2).filter(() => rng.chance(o.loopChance));

  const winding = o.corridorStyle === 'winding';
  for (const e of [...tree, ...loops]) {
    const A = rooms[e.a] as Room;
    const B = rooms[e.b] as Room;
    const cost = (c: number): number => {
      const t = d.cells[c];
      if (t === ROOM) return d.roomIds[c] === A.id || d.roomIds[c] === B.id ? 1 : 6;
      if (t === CORRIDOR) return 0.6;
      let k = 1 + (winding ? (noise[c] as number) * 3 : 0);
      // Avoid hugging other rooms' walls or running beside corridors, which makes ragged openings.
      for (const [dx, dy] of DIRS) {
        const nc = c + dy * d.width + dx;
        const nt = d.cells[nc];
        if (nt === ROOM && d.roomIds[nc] !== A.id && d.roomIds[nc] !== B.id) k += 4;
        else if (nt === CORRIDOR) k += 0.8;
      }
      return k;
    };
    const path = findPath(
      d,
      [A.cy * d.width + A.cx],
      (c) => d.roomIds[c] === B.id,
      cost,
      winding ? 0.3 : 2,
      (c) => 0.6 * (Math.abs((c % d.width) - B.cx) + Math.abs(Math.floor(c / d.width) - B.cy)),
    );
    if (!path) continue;
    for (const c of path) {
      pathCells.add(c);
      if (d.cells[c] === ROCK) d.cells[c] = CORRIDOR;
    }
  }
}

function placePillars(d: Dungeon, rng: RNG, o: DungeonOptions, pathCells: Set<number>): void {
  const stairCells = new Set(d.stairs.map((s) => s.y * d.width + s.x));
  for (const r of d.rooms) {
    if (r.shape !== 'rect' || r.w < 7 || r.h < 7 || !rng.chance(o.pillarChance)) continue;
    const spots: [number, number][] = [];
    if (r.w >= r.h) {
      for (let x = r.x + 2; x <= r.x + r.w - 3; x += 2) spots.push([x, r.y + 2], [x, r.y + r.h - 3]);
    } else {
      for (let y = r.y + 2; y <= r.y + r.h - 3; y += 2) spots.push([r.x + 2, y], [r.x + r.w - 3, y]);
    }
    for (const [x, y] of spots) {
      const c = y * d.width + x;
      if (d.cells[c] !== ROOM || pathCells.has(c) || stairCells.has(c) || (x === r.cx && y === r.cy)) continue;
      d.cells[c] = PILLAR;
    }
  }
}

function placeDoors(d: Dungeon, rng: RNG, o: DungeonOptions): void {
  const { width: W, cells, roomIds } = d;
  const used = new Set<number>();
  for (let c = 0; c < cells.length; c++) {
    if (cells[c] !== ROOM) continue;
    const x = c % W;
    const y = Math.floor(c / W);
    for (const [dx, dy] of DIRS) {
      const n = c + dy * W + dx;
      if (cells[n] !== CORRIDOR || used.has(n)) continue;
      // Only 1-wide entrances get doors: the corridor cell's sides along the wall must be solid.
      const side1 = n + dx * W + dy;
      const side2 = n - dx * W - dy;
      if (isFloor(cells[side1] as number) || isFloor(cells[side2] as number)) continue;
      const roomNeighbors = DIRS.filter(([ex, ey]) => cells[n + ey * W + ex] === ROOM).length;
      if (roomNeighbors !== 1) continue;
      used.add(n);
      if (!rng.chance(o.doorChance)) continue;

      const roll = rng.float();
      const type: DoorType = roll < o.secretDoorChance ? 'secret' : roll < o.secretDoorChance + o.lockedDoorChance ? 'locked' : 'normal';
      const edge = dx !== 0
        ? { x1: Math.max(x, x + dx), y1: y, x2: Math.max(x, x + dx), y2: y + 1 }
        : { x1: x, y1: Math.max(y, y + dy), x2: x + 1, y2: Math.max(y, y + dy) };
      d.doors.push({ ...edge, type, room: roomIds[c] as number });
    }
  }
}

/**
 * Puts windows in straight stretches of room wall that face rock, away from corners,
 * doors and stairs. Uses its own random stream so windows never change the layout or
 * room contents a seed produces.
 */
function placeWindows(d: Dungeon, o: DungeonOptions): void {
  if (o.windowChance <= 0) return;
  const rng = new RNG(`${d.seed}:windows`);
  const W = d.width;
  const stairCells = new Set(d.stairs.map((s) => s.y * W + s.x));
  const nearDoor = (e: { x1: number; y1: number; x2: number; y2: number }): boolean =>
    d.doors.some((o) => Math.abs(o.x1 + o.x2 - e.x1 - e.x2) / 2 + Math.abs(o.y1 + o.y2 - e.y1 - e.y2) / 2 < 2);

  for (const r of d.rooms) {
    if (r.shape === 'area') continue;
    for (const [dx, dy] of DIRS) {
      // Wall edges facing this direction, keyed by the row/column they lie on.
      const lines = new Map<number, number[]>();
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) {
          const c = y * W + x;
          if (d.roomIds[c] !== r.id || d.cells[c] !== ROOM || stairCells.has(c)) continue;
          if (d.cells[c + dy * W + dx] !== ROCK) continue;
          const line = dx === 0 ? y : x;
          const list = lines.get(line);
          if (list) list.push(dx === 0 ? x : y);
          else lines.set(line, [dx === 0 ? x : y]);
        }
      }
      for (const [line, positions] of lines) {
        positions.sort((a, b) => a - b);
        // Split into straight runs of consecutive squares.
        const runs: number[][] = [];
        for (const p of positions) {
          const run = runs[runs.length - 1];
          if (run && p === (run[run.length - 1] as number) + 1) run.push(p);
          else runs.push([p]);
        }
        for (const run of runs) {
          if (run.length < 3 || !rng.chance(o.windowChance)) continue;
          const count = run.length >= 8 ? 2 : 1;
          for (let k = 1; k <= count; k++) {
            const pos = run[Math.round((k * (run.length - 1)) / (count + 1))] as number;
            const edge = dx === 0
              ? { x1: pos, y1: dy < 0 ? line : line + 1, x2: pos + 1, y2: dy < 0 ? line : line + 1 }
              : { x1: dx < 0 ? line : line + 1, y1: pos, x2: dx < 0 ? line : line + 1, y2: pos + 1 };
            if (!nearDoor(edge)) d.windows.push({ ...edge, room: r.id });
          }
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Caverns (cellular automata)

function buildCaves(d: Dungeon, rng: RNG, o: DungeonOptions, noise: Float32Array, pathCells: Set<number>): void {
  const { width: W, height: H } = d;
  let solid = new Uint8Array(W * H);
  const border = (x: number, y: number): boolean => x <= 0 || y <= 0 || x >= W - 1 || y >= H - 1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) solid[y * W + x] = border(x, y) || rng.chance(o.caveFill) ? 1 : 0;
  }
  const countSolid = (grid: Uint8Array, x: number, y: number, r: number): number => {
    let k = 0;
    for (let j = -r; j <= r; j++) {
      for (let i = -r; i <= r; i++) {
        const nx = x + i;
        const ny = y + j;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || grid[ny * W + nx]) k++;
      }
    }
    return k;
  };
  for (let step = 0; step < o.caveSteps; step++) {
    const next = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (border(x, y)) {
          next[y * W + x] = 1;
          continue;
        }
        const r1 = countSolid(solid, x, y, 1);
        // Early steps also seed rock in wide-open areas, giving pillars and alcoves.
        const r2 = step < o.caveSteps - 2 ? countSolid(solid, x, y, 2) : 99;
        next[y * W + x] = r1 >= 5 || r2 <= 2 ? 1 : 0;
      }
    }
    solid = next;
  }
  for (let c = 0; c < solid.length; c++) d.cells[c] = solid[c] ? ROCK : ROOM;

  // Find connected regions, drop tiny ones and tunnel the rest together.
  let regions = floodRegions(d);
  for (const reg of regions.filter((r) => r.length < 12)) for (const c of reg) d.cells[c] = ROCK;
  regions = regions.filter((r) => r.length >= 12).sort((a, b) => b.length - a.length);
  if (regions.length === 0) {
    // Degenerate fill: carve a single central chamber so there is always something to play on.
    for (let y = Math.floor(H / 3); y < Math.ceil((2 * H) / 3); y++) {
      for (let x = Math.floor(W / 3); x < Math.ceil((2 * W) / 3); x++) d.cells[y * W + x] = ROOM;
    }
    regions = floodRegions(d);
  }
  const connected = new Uint8Array(W * H);
  for (const c of regions[0] ?? []) connected[c] = 1;
  for (const reg of regions.slice(1)) {
    const path = findPath(
      d,
      [rng.pick(reg)],
      (c) => connected[c] === 1,
      (c) => (d.cells[c] === ROCK ? 1 + (noise[c] as number) * 2 : 0.5),
      0.3,
      () => 0,
    );
    for (const c of reg) connected[c] = 1;
    if (!path) continue;
    for (const c of path) {
      connected[c] = 1;
      pathCells.add(c);
      if (d.cells[c] === ROCK) d.cells[c] = ROOM;
    }
  }

  placeCaveAreas(d, rng, o);
}

function floodRegions(d: Dungeon): number[][] {
  const { width: W, cells } = d;
  const seen = new Uint8Array(cells.length);
  const regions: number[][] = [];
  for (let s = 0; s < cells.length; s++) {
    if (seen[s] || !isFloor(cells[s] as number)) continue;
    const reg: number[] = [];
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const c = stack.pop() as number;
      reg.push(c);
      for (const [dx, dy] of DIRS) {
        const n = c + dy * W + dx;
        if (!seen[n] && isFloor(cells[n] as number)) {
          seen[n] = 1;
          stack.push(n);
        }
      }
    }
    regions.push(reg);
  }
  return regions;
}

// Caves have no rooms, so pick well-spread "areas" in open spots and
// split the floor between them (nearest area wins) for labels and the key.
function placeCaveAreas(d: Dungeon, rng: RNG, o: DungeonOptions): void {
  const { width: W, cells } = d;
  const floor: number[] = [];
  for (let c = 0; c < cells.length; c++) if (isFloor(cells[c] as number)) floor.push(c);
  const openness = (c: number): number => {
    let k = 0;
    for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) if (isFloor(cells[c + j * W + i] as number)) k++;
    return k;
  };
  let candidates = floor.filter((c) => openness(c) >= 18);
  if (candidates.length < 8) candidates = floor;
  const count = Math.max(1, Math.min(o.roomCount, Math.floor(floor.length / 40)));

  // Farthest-point sampling spreads the areas across the cave.
  const pts = [rng.pick(candidates)];
  const minDist = candidates.map(() => Infinity);
  while (pts.length < count) {
    const last = pts[pts.length - 1] as number;
    let best = -1;
    let bestD = -1;
    candidates.forEach((c, i) => {
      const dd = Math.hypot((c % W) - (last % W), Math.floor(c / W) - Math.floor(last / W));
      if (dd < (minDist[i] as number)) minDist[i] = dd;
      if ((minDist[i] as number) > bestD) {
        bestD = minDist[i] as number;
        best = c;
      }
    });
    if (bestD < 4) break;
    pts.push(best);
  }

  d.rooms = pts.map((c, id) => newRoom(id, c % W, Math.floor(c / W), 1, 1, 'area', c % W, Math.floor(c / W)));

  // Multi-source BFS assigns each floor cell to its nearest area.
  const queue = [...pts];
  pts.forEach((c, id) => (d.roomIds[c] = id));
  for (let qi = 0; qi < queue.length; qi++) {
    const c = queue[qi] as number;
    for (const [dx, dy] of DIRS) {
      const n = c + dy * W + dx;
      if (d.roomIds[n] === -1 && isFloor(cells[n] as number)) {
        d.roomIds[n] = d.roomIds[c] as number;
        queue.push(n);
      }
    }
  }

  // Like every room, an area's x/y/w/h are the bounds of the squares it owns.
  for (const r of d.rooms) Object.assign(r, { x: Infinity, y: Infinity, w: 0, h: 0 });
  const maxX = d.rooms.map(() => -1);
  const maxY = d.rooms.map(() => -1);
  for (const c of queue) {
    const r = d.rooms[d.roomIds[c] as number] as Room;
    const x = c % W;
    const y = Math.floor(c / W);
    r.x = Math.min(r.x, x);
    r.y = Math.min(r.y, y);
    maxX[r.id] = Math.max(maxX[r.id] as number, x);
    maxY[r.id] = Math.max(maxY[r.id] as number, y);
  }
  for (const r of d.rooms) {
    r.w = (maxX[r.id] as number) - r.x + 1;
    r.h = (maxY[r.id] as number) - r.y + 1;
  }
}

// ---------------------------------------------------------------------------
// Stairs and numbering

function bfsDistances(d: Dungeon, start: number): Int32Array {
  const { width: W, cells } = d;
  const dist = new Int32Array(cells.length).fill(-1);
  const queue = [start];
  dist[start] = 0;
  for (let qi = 0; qi < queue.length; qi++) {
    const c = queue[qi] as number;
    for (const [dx, dy] of DIRS) {
      const n = c + dy * W + dx;
      if (dist[n] === -1 && isFloor(cells[n] as number)) {
        dist[n] = (dist[c] as number) + 1;
        queue.push(n);
      }
    }
  }
  return dist;
}

interface StairCandidate {
  c: number;
  dir: number;
  dd: number;
}

function numberRoomsAndPlaceStairs(d: Dungeon, rng: RNG, pathCells: Set<number>): void {
  const { width: W } = d;
  if (d.rooms.length === 0) return;

  const entrance = rng.pick(d.rooms);
  const dist = bfsDistances(d, entrance.cy * W + entrance.cx);
  const distOf = (r: Room): number => (r === entrance ? -1 : (dist[r.cy * W + r.cx] as number));

  // Number rooms in order of walking distance from the entrance.
  const order = [...d.rooms].sort((a, b) => distOf(a) - distOf(b));
  const remap = new Int16Array(d.rooms.length);
  order.forEach((r, i) => {
    remap[r.id] = i;
    r.id = i;
  });
  for (let c = 0; c < d.roomIds.length; c++) {
    const id = d.roomIds[c] as number;
    if (id >= 0) d.roomIds[c] = remap[id] as number;
  }
  d.rooms = order;

  const exit = order.length > 1 ? (order[order.length - 1] as Room) : null;
  for (const r of order) {
    r.entrance = r === entrance;
    r.exit = r === exit;
  }

  const placeStair = (room: Room, kind: Stair['kind']): void => {
    const candidates: StairCandidate[] = [];
    for (let c = 0; c < d.cells.length; c++) {
      if (d.roomIds[c] !== room.id || d.cells[c] !== ROOM || pathCells.has(c)) continue;
      if (c === room.cy * W + room.cx) continue;
      let rockDir = -1;
      let rocks = 0;
      let nearCorridor = false;
      DIRS.forEach(([dx, dy], i) => {
        const t = d.cells[c + dy * W + dx];
        if (t === ROCK) {
          rocks++;
          rockDir = i;
        } else if (t === CORRIDOR) {
          nearCorridor = true;
        }
      });
      if (rocks === 1 && !nearCorridor) {
        candidates.push({ c, dir: rockDir, dd: Math.hypot((c % W) - room.cx, Math.floor(c / W) - room.cy) });
      }
    }
    candidates.sort((a, b) => a.dd - b.dd);
    const pick = candidates.length ? rng.pick(candidates.slice(0, 6)) : { c: room.cy * W + room.cx, dir: 3 };
    d.stairs.push({ x: pick.c % W, y: Math.floor(pick.c / W), dir: pick.dir, kind, room: room.id });
  };
  placeStair(entrance, 'up');
  if (exit) placeStair(exit, 'down');
}

// ---------------------------------------------------------------------------
// A* over (cell, heading) states so turns can be penalised.

class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];

  get size(): number {
    return this.keys.length;
  }
  push(key: number, val: number): void {
    const { keys, vals } = this;
    let i = keys.length;
    keys.push(key);
    vals.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((keys[p] as number) <= key) break;
      keys[i] = keys[p] as number;
      vals[i] = vals[p] as number;
      i = p;
    }
    keys[i] = key;
    vals[i] = val;
  }
  pop(): number {
    const { keys, vals } = this;
    const top = vals[0] as number;
    const lastK = keys.pop() as number;
    const lastV = vals.pop() as number;
    if (keys.length) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= keys.length) break;
        const r = l + 1;
        const m = r < keys.length && (keys[r] as number) < (keys[l] as number) ? r : l;
        if ((keys[m] as number) >= lastK) break;
        keys[i] = keys[m] as number;
        vals[i] = vals[m] as number;
        i = m;
      }
      keys[i] = lastK;
      vals[i] = lastV;
    }
    return top;
  }
}

function findPath(
  d: { width: number; height: number },
  starts: number[],
  isGoal: (c: number) => boolean,
  cellCost: (c: number) => number,
  turnCost: number,
  heuristic: (c: number) => number,
): number[] | null {
  const { width: W, height: H } = d;
  const N = W * H * 4;
  const g = new Float64Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const heap = new MinHeap();
  for (const s of starts) {
    for (let dir = 0; dir < 4; dir++) {
      g[s * 4 + dir] = 0;
      heap.push(heuristic(s), s * 4 + dir);
    }
  }
  while (heap.size) {
    const st = heap.pop();
    if (closed[st]) continue;
    closed[st] = 1;
    const c = st >> 2;
    const dir = st & 3;
    if (isGoal(c)) {
      const path: number[] = [];
      for (let s = st; s >= 0; s = prev[s] as number) path.push(s >> 2);
      return path.reverse();
    }
    const x = c % W;
    const y = Math.floor(c / W);
    for (let nd = 0; nd < 4; nd++) {
      if (nd === (dir + 2) % 4) continue;
      const [dx, dy] = DIRS[nd] as readonly [number, number];
      const nx = x + dx;
      const ny = y + dy;
      // Never carve the outer ring so the map always has an enclosing wall.
      if (nx < 1 || ny < 1 || nx >= W - 1 || ny >= H - 1) continue;
      const nc = ny * W + nx;
      const ns = nc * 4 + nd;
      const ng = (g[st] as number) + cellCost(nc) + (nd !== dir ? turnCost : 0);
      if (ng < (g[ns] as number)) {
        g[ns] = ng;
        prev[ns] = st;
        heap.push(ng + heuristic(nc), ns);
      }
    }
  }
  return null;
}

export interface DoorSummary {
  total: number;
  locked: number;
  secret: number;
}

export function doorSummary(d: Dungeon): DoorSummary {
  const count = (t: string): number => d.doors.filter((o) => o.type === t).length;
  return { total: d.doors.length, locked: count('locked'), secret: count('secret') };
}

// ---------------------------------------------------------------------------
// Project file (de)serialisation

export function serializeDungeon(d: Dungeon): SerializedDungeon {
  return { ...d, cells: Array.from(d.cells).join(''), roomIds: Array.from(d.roomIds) };
}

export function deserializeDungeon(obj: unknown): Dungeon {
  const s = obj as Partial<SerializedDungeon> | null;
  if (!s || typeof s.cells !== 'string' || !Array.isArray(s.roomIds) || typeof s.width !== 'number' || typeof s.height !== 'number') {
    throw new Error('Not a Dungeon Forge map');
  }
  if (s.cells.length !== s.width * s.height || s.roomIds.length !== s.cells.length) {
    throw new Error('Map data is corrupt (size mismatch)');
  }
  const full = s as SerializedDungeon;
  return {
    ...full,
    // Maps saved before windows existed have none.
    windows: full.windows ?? [],
    props: full.props ?? [],
    cells: Uint8Array.from(full.cells, (ch) => Number(ch)),
    roomIds: Int16Array.from(full.roomIds),
  };
}
