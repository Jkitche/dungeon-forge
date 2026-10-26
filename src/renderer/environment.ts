// Room environments: conditions a room's own description implies (ice, heat, water...),
// shown as a tag in the room key. Cold and heat also bleed out of the room on the map.
//
// Pure data, no DOM: detection reads a room's text, and environmentField works out how
// strongly each square is affected.

import { DIRS, isFloor } from "./cells.ts";
import type { RoomContents } from "./contents.ts";
import type { Door, Dungeon } from "./generator.ts";

export type Environment =
  | "lava"
  | "fire"
  | "ice"
  | "frost"
  | "heat"
  | "webs"
  | "crystals"
  | "fungus"
  | "toxic"
  | "water"
  | "smoke";

export interface EnvironmentInfo {
  /** Shown as a tag in the room key. */
  label: string;
}

export const ENVIRONMENTS: Record<Environment, EnvironmentInfo> = {
  lava: { label: "Lava" },
  fire: { label: "Burning" },
  ice: { label: "Iced over" },
  frost: { label: "Frozen" },
  heat: { label: "Scorching" },
  fungus: { label: "Overgrown" },
  toxic: { label: "Toxic" },
  water: { label: "Flooded" },
  smoke: { label: "Smoky" },
  webs: { label: "Webbed" },
  crystals: { label: "Crystalline" },
};

/**
 * Phrases that put a room in each environment, checked in this order so the most
 * specific wins: "moss glows a sickly green" is fungus, not toxic; "boiling water" is heat.
 * "Frozen" is left out on purpose: the tables use it for things that are stuck ("a robot
 * frozen mid-task", "a frozen error message"), not icy.
 */
const RULES: readonly [Environment, RegExp][] = [
  ["lava", /\b(lava|magma|molten)\b/],
  // Flames now, not old burns: "burnt insulation" and "scorched from an old fire" are smoke.
  ["fire", /\b(flames?|burning|burns|ablaze|blaze|inferno)\b/],
  ["ice", /\b(ice|icy|icicles?|glacier)\b|frozen lake|ice-bound/],
  ["frost", /\b(frost|freezing|snow)\b|breath fogs|temperature drops|cryo bay/],
  [
    "heat",
    /\b(boiler|foundry|smithy|furnace|steam(?!-powered)|scald\w*|boiling|heat|ember\w*)\b|unnaturally warm|reactor core/,
  ],
  ["webs", /\b(cobwebs?|webs?|webbed|webbing)\b|spider nest/],
  [
    "crystals",
    /\bcrystal (hollow|vug|cave|cavern|growths?)\b|crystals (jut|grow|glow|line)/,
  ],
  [
    "fungus",
    /\b(moss|fungus|fungal|mushroom\w*|spore\w*|mou?ld\w*|resin|glowworm)\b/,
  ],
  ["toxic", /\b(toxic|poison\w*|radiation|rad|plague|gas)\b|sickly green/],
  [
    "water",
    /\b(water|flood\w*|pool|cistern|well|drip\w*|sunken|lake|puddles?|coolant)\b/,
  ],
  [
    "smoke",
    /\b(smoke|ash|ashes|soot|scorch\w*|burnt|charred|smoulder\w*|smolder\w*)\b/,
  ],
];

/**
 * The environment a room's description implies, or null. Only the room's name and
 * atmosphere count: they describe the room's condition, while its feature is an object in
 * it ("a well", "a scrying pool") that shouldn't flood the whole room. Traps are left out
 * too: a freezing-gas trap that hasn't gone off shouldn't frost the map and warn players.
 */
export function detectEnvironment(
  contents: RoomContents | null | undefined,
): Environment | null {
  if (!contents) return null;
  const text = `${contents.name} ${contents.atmosphere}`.toLowerCase();
  for (const [env, pattern] of RULES) if (pattern.test(text)) return env;
  return null;
}

export const isEnvironment = (v: unknown): v is Environment =>
  typeof v === "string" && Object.hasOwn(ENVIRONMENTS, v);

/** Environments the map shows, and how many squares each reaches beyond a doorway. */
export const SPREAD: Partial<Record<Environment, number>> = {
  frost: 3,
  heat: 2,
};

export interface EnvironmentCell {
  env: Environment;
  /** 1 inside the room, fading toward 0 at the edge of the spill. */
  intensity: number;
  /** True inside the room itself, false where it has seeped out. */
  source: boolean;
}

/** How much of the effect gets past a closed door, compared with an open archway. */
const DOOR_LEAK = 0.85;

/** A way out of an affected room: the effect pours out here. */
export interface EnvironmentOpening {
  env: Environment;
  /** Middle of the doorway edge, in grid units. */
  x: number;
  y: number;
  /** Direction out of the room, as a DIRS step. */
  dx: number;
  dy: number;
  /** 1 for an open archway, less for a closed door. */
  strength: number;
}

const edgeKey = (a: number, b: number): string =>
  a < b ? `${a}:${b}` : `${b}:${a}`;

/** The two squares either side of a door, as cell indexes. */
function doorSquares(d: Dungeon, o: Door): [number, number] {
  const b = o.y1 * d.width + o.x1;
  return [o.y1 === o.y2 ? b - d.width : b - 1, b];
}

function doorsByEdge(d: Dungeon): Map<string, Door> {
  const doors = new Map<string, Door>();
  for (const o of d.doors) {
    const [a, b] = doorSquares(d, o);
    doors.set(edgeKey(a, b), o);
  }
  return doors;
}

/**
 * The ways out of every affected room: each floor-to-floor edge leaving the room, except
 * through secret doors. Each comes with the square just outside, where the spill starts.
 */
function exits(
  d: Dungeon,
  doors: Map<string, Door>,
): (EnvironmentOpening & { room: number; outside: number })[] {
  const W = d.width;
  const out: (EnvironmentOpening & { room: number; outside: number })[] = [];
  for (const r of d.rooms) {
    const env = r.environment;
    if (!env || SPREAD[env] === undefined) continue;
    for (let c = 0; c < d.cells.length; c++) {
      if (d.roomIds[c] !== r.id || !isFloor(d.cells[c] as number)) continue;
      for (const [dx, dy] of DIRS) {
        const n = c + dy * W + dx;
        if (d.roomIds[n] === r.id || !isFloor(d.cells[n] as number)) continue;
        const door = doors.get(edgeKey(c, n));
        if (door?.type === "secret") continue;
        const x = (c % W) + 0.5 + dx / 2;
        const y = Math.floor(c / W) + 0.5 + dy / 2;
        out.push({
          env,
          x,
          y,
          dx,
          dy,
          strength: door ? DOOR_LEAK : 1,
          room: r.id,
          outside: n,
        });
      }
    }
  }
  return out;
}

/**
 * Where each affected room's effect pours out, one per doorway. Neighbouring openings
 * (a corridor running alongside a room) merge, so they don't stack up.
 */
export function environmentOpenings(d: Dungeon): EnvironmentOpening[] {
  const kept: EnvironmentOpening[] = [];
  for (const e of exits(d, doorsByEdge(d))) {
    if (
      kept.some(
        (k) => k.env === e.env && Math.hypot(k.x - e.x, k.y - e.y) < 1.5,
      )
    )
      continue;
    kept.push({
      env: e.env,
      x: e.x,
      y: e.y,
      dx: e.dx,
      dy: e.dy,
      strength: e.strength,
    });
  }
  return kept;
}

/**
 * Every square touched by cold or heat, keyed by cell index. Each affected room is filled
 * at full strength; then the effect seeps out through every doorway (less through a closed
 * door, never through a secret one), fading over its spread. Where two meet, the stronger wins.
 */
export function environmentField(d: Dungeon): Map<number, EnvironmentCell> {
  const W = d.width;
  const field = new Map<number, EnvironmentCell>();
  const put = (c: number, cell: EnvironmentCell): void => {
    const old = field.get(c);
    if (!old || cell.intensity > old.intensity) field.set(c, cell);
  };
  const doors = doorsByEdge(d);
  const allExits = exits(d, doors);

  for (const r of d.rooms) {
    const env = r.environment;
    const spread = env ? SPREAD[env] : undefined;
    if (!env || spread === undefined) continue;
    const inRoom = (c: number): boolean => d.roomIds[c] === r.id;
    for (let c = 0; c < d.cells.length; c++)
      if (inRoom(c)) put(c, { env, intensity: 1, source: true });

    // Breadth-first from the doorways outward, so squares are reached in order of distance;
    // strength carries the doorway's leak along. A square is only revisited by a stronger path.
    const best = new Map<number, number>();
    const queue: [number, number, number][] = allExits
      .filter((e) => e.room === r.id)
      .map((e) => [e.outside, 1, e.strength]);
    for (let i = 0; i < queue.length; i++) {
      const [c, steps, strength] = queue[i] as [number, number, number];
      if ((best.get(c) ?? 0) >= strength) continue;
      best.set(c, strength);
      put(c, {
        env,
        intensity: strength * (1 - (steps - 1) / (spread + 0.5)) * 0.9,
        source: false,
      });
      if (steps >= spread) continue;
      for (const [dx, dy] of DIRS) {
        const n = c + dy * W + dx;
        if (inRoom(n) || !isFloor(d.cells[n] as number)) continue;
        if (doors.get(edgeKey(c, n))?.type === "secret") continue;
        queue.push([n, steps + 1, strength]);
      }
    }
  }
  return field;
}
