// Canvas rendering of a dungeon. Used both for the on-screen view and for exports,
// so everything is drawn in grid units scaled by `ppg` (pixels per grid square).
//
// A theme is plain data: colours plus the name of a painter for each layer (rock,
// floor, doors, stairs, pillars, decorations). The painters live in tables below.

import { RNG } from './rng.ts';
import { isFloor, isOpen, ROCK, ROOM, CORRIDOR, PILLAR, DIRS } from './generator.ts';
import type { Dungeon, Door } from './generator.ts';
import { computeWalls, PILLAR_RADIUS } from './walls.ts';

type RGB = readonly [number, number, number];

export type RockStyle = 'none' | 'grid' | 'hatch' | 'speckle' | 'plating' | 'brick' | 'rubble';
export type FloorStyle = 'plain' | 'flagstone' | 'deckplate' | 'planks' | 'checker' | 'concrete';
export type DoorStyle = 'outline' | 'wood' | 'sliding' | 'hatch' | 'metal';
export type StairStyle = 'steps' | 'lift' | 'ladder';
export type PillarStyle = 'round' | 'square' | 'boiler';
export type DecorStyle = 'gears' | 'pipes' | 'rivets' | 'hazard' | 'candles' | 'stains' | 'debris';

export interface Theme {
  label: string;
  bg: string;
  /** Base floor fill; with a textured floor style this shows through as mortar or seams. */
  floor: string;
  grid: string;
  wall: string;
  /** Wall thickness as a fraction of a square. */
  wallWidth: number;
  /** A bright glowing line drawn down the middle of every wall. */
  wallLine?: string;
  /** Soft dark shadows under walls and pillars. */
  shadow?: boolean;
  door: string;
  doorStroke: string;
  stair: string;
  stairFill?: string;
  pillarFill: string;
  pillarStroke: string;
  text: string;
  halo: string;
  font: string;
  secretMark?: string;
  lockMark?: string;
  rock: RockStyle;
  rockColors?: readonly string[];
  rockLine?: string;
  floorStyle: FloorStyle;
  /** Base colour for textured floors (checker uses floorAlt as the second colour). */
  floorTone?: RGB;
  floorAlt?: RGB;
  doorStyle: DoorStyle;
  stairStyle: StairStyle;
  pillarStyle: PillarStyle;
  decor?: readonly DecorStyle[];
}

export type ThemeKey = 'parchment' | 'blueprint' | 'stone' | 'starship' | 'brass' | 'gothic' | 'wasteland';

const SERIF = 'Georgia, "Times New Roman", serif';

export const THEMES: Record<ThemeKey, Theme> = {
  parchment: {
    label: 'Parchment',
    bg: '#ede0c4', floor: '#fdf8ec', grid: 'rgba(120, 95, 60, 0.35)',
    wall: '#2b2219', wallWidth: 0.14,
    door: '#fdf8ec', doorStroke: '#2b2219', stair: '#2b2219',
    pillarFill: '#2b2219', pillarStroke: '#2b2219',
    text: '#2b2219', halo: '#fdf8ec', font: SERIF,
    rock: 'hatch', rockLine: '#3d3125',
    floorStyle: 'plain', doorStyle: 'outline', stairStyle: 'steps', pillarStyle: 'round',
  },
  blueprint: {
    label: 'Blueprint',
    bg: '#4a7fc1', floor: '#ffffff', grid: 'rgba(74, 127, 193, 0.5)',
    wall: '#1d3b6e', wallWidth: 0.14,
    door: '#ffffff', doorStroke: '#1d3b6e', stair: '#1d3b6e',
    pillarFill: '#1d3b6e', pillarStroke: '#1d3b6e',
    text: '#1d3b6e', halo: '#ffffff', font: SERIF,
    rock: 'grid', rockLine: 'rgba(255, 255, 255, 0.2)',
    floorStyle: 'plain', doorStyle: 'outline', stairStyle: 'steps', pillarStyle: 'round',
  },
  stone: {
    label: 'Dark Stone',
    bg: '#151413', floor: '#4f4a44', grid: 'rgba(0, 0, 0, 0.4)',
    wall: '#0b0a09', wallWidth: 0.24, shadow: true,
    door: '#7b5432', doorStroke: '#24170b', stair: '#2a2622', stairFill: '#8e877c',
    pillarFill: '#3a3632', pillarStroke: '#0b0a09',
    text: '#f6eedc', halo: '#151413', font: SERIF, secretMark: '#e0b44c', lockMark: '#d9b25a',
    rock: 'speckle', rockColors: ['#1d1b19', '#211f1c', '#191816', '#25221f'],
    floorStyle: 'flagstone', floorTone: [122, 116, 106],
    doorStyle: 'wood', stairStyle: 'steps', pillarStyle: 'round',
  },
  starship: {
    label: 'Starship Deck',
    bg: '#070a10', floor: '#0e131a', grid: 'rgba(120, 200, 255, 0.10)',
    wall: '#1c2836', wallWidth: 0.26, wallLine: '#5fd4ff',
    door: '#3a4656', doorStroke: '#0b1118', stair: '#5fd4ff', stairFill: '#1b2430',
    pillarFill: '#263241', pillarStroke: '#5fd4ff',
    text: '#c8f2ff', halo: '#070a10', font: '"Consolas", "DejaVu Sans Mono", ui-monospace, monospace',
    secretMark: '#ffcf4a',
    rock: 'plating', rockColors: ['#0f151e', '#121a25', '#0d131b'], rockLine: '#1a2431',
    floorStyle: 'deckplate', floorTone: [50, 60, 74],
    doorStyle: 'sliding', stairStyle: 'lift', pillarStyle: 'square',
    decor: ['hazard'],
  },
  brass: {
    label: 'Brass & Steam',
    bg: '#1c140e', floor: '#2e1e12', grid: 'rgba(25, 14, 6, 0.45)',
    wall: '#8a5a2b', wallWidth: 0.24, shadow: true,
    door: '#4a4c50', doorStroke: '#c0924f', stair: '#2a1a0f', stairFill: '#9a7046',
    pillarFill: '#d4945a', pillarStroke: '#5a3517',
    text: '#f4dfb5', halo: '#1c140e', font: SERIF, secretMark: '#f0c070', lockMark: '#c0392b',
    rock: 'brick', rockColors: ['#3b2619', '#432b1b', '#35221a', '#3f2a1c'],
    floorStyle: 'planks', floorTone: [124, 84, 50],
    doorStyle: 'hatch', stairStyle: 'lift', pillarStyle: 'boiler',
    decor: ['gears', 'pipes', 'rivets'],
  },
  gothic: {
    label: 'Gothic Crypt',
    bg: '#0e0b10', floor: '#1d1820', grid: 'rgba(0, 0, 0, 0.35)',
    wall: '#08060a', wallWidth: 0.24, shadow: true,
    door: '#4a2c22', doorStroke: '#140b08', stair: '#120d14', stairFill: '#5a5260',
    pillarFill: '#4a4350', pillarStroke: '#08060a',
    text: '#eadbc6', halo: '#0e0b10', font: '"Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif',
    secretMark: '#d0453a', lockMark: '#c9a227',
    rock: 'speckle', rockColors: ['#1a151d', '#1e1822', '#16121a', '#221b26'],
    floorStyle: 'checker', floorTone: [62, 55, 70], floorAlt: [44, 38, 51],
    doorStyle: 'wood', stairStyle: 'steps', pillarStyle: 'round',
    decor: ['stains', 'candles'],
  },
  wasteland: {
    label: 'Wasteland',
    bg: '#8f7a55', floor: '#6d6a63', grid: 'rgba(30, 25, 20, 0.3)',
    wall: '#3d2f25', wallWidth: 0.2, shadow: true,
    door: '#8a5a36', doorStroke: '#2b1d14', stair: '#2b241e',
    pillarFill: '#8a4b25', pillarStroke: '#2b1d14',
    text: '#1f1a14', halo: '#e3d5b2', font: 'Impact, "Arial Narrow Bold", "Arial Black", sans-serif',
    secretMark: '#b3261e', lockMark: '#e0b030',
    rock: 'rubble', rockColors: ['#7d6a48', '#6f5e40', '#a08a62', '#5f5137'], rockLine: 'rgba(60, 45, 25, 0.6)',
    floorStyle: 'concrete', floorTone: [128, 124, 116],
    doorStyle: 'metal', stairStyle: 'ladder', pillarStyle: 'round',
    decor: ['debris'],
  },
};

export const isThemeKey = (k: unknown): k is ThemeKey => typeof k === 'string' && k in THEMES;

export interface RenderOptions {
  ppg?: number;
  theme?: ThemeKey;
  showGrid?: boolean;
  showLabels?: boolean;
  /** Show room numbers and mark secret doors; the player view hides both. */
  gmView?: boolean;
}

type Ctx = CanvasRenderingContext2D;

/** Everything a painter needs. Coordinates passed to painters are in grid units unless noted. */
interface Paint {
  ctx: Ctx;
  d: Dungeon;
  ppg: number;
  theme: Theme;
  rng: RNG;
  gm: boolean;
}

/** Draw the dungeon into `canvas`, resizing it to fit. */
export function renderDungeon(canvas: HTMLCanvasElement, d: Dungeon, opts: RenderOptions = {}): HTMLCanvasElement {
  const ppg = opts.ppg ?? 48;
  const theme = THEMES[isThemeKey(opts.theme) ? opts.theme : 'parchment'];
  canvas.width = d.width * ppg;
  canvas.height = d.height * ppg;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const p: Paint = { ctx, d, ppg, theme, rng: new RNG(`${d.seed}:art`), gm: opts.gmView ?? true };
  const decor = theme.decor ?? [];
  const runDecor = (phase: DecorPhase): void => {
    for (const k of decor) if (DECOR[k].phase === phase) DECOR[k].paint(p);
  };

  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ROCK_PAINTERS[theme.rock](p);
  runDecor('rock');

  const floorPath = buildFloorPath(d, ppg);
  ctx.fillStyle = theme.floor;
  ctx.fill(floorPath);
  ctx.save();
  ctx.clip(floorPath);
  FLOOR_PAINTERS[theme.floorStyle](p);
  runDecor('floor');
  if (opts.showGrid ?? true) drawGridLines(p, theme.grid);
  ctx.restore();

  for (const s of d.stairs) STAIR_PAINTERS[theme.stairStyle](p, s.x, s.y, s.dir, s.kind);
  runDecor('beforeWalls');
  drawWalls(p);
  for (let c = 0; c < d.cells.length; c++) {
    if (d.cells[c] === PILLAR) PILLAR_PAINTERS[theme.pillarStyle](p, (c % d.width) + 0.5, Math.floor(c / d.width) + 0.5);
  }
  runDecor('afterWalls');
  drawDoors(p);
  if (p.gm && (opts.showLabels ?? true)) drawLabels(p);
  return canvas;
}

// ---------------------------------------------------------------------------
// Shared helpers

function buildFloorPath(d: Dungeon, ppg: number): Path2D {
  const path = new Path2D();
  const { width: W, height: H, cells } = d;
  for (let y = 0; y < H; y++) {
    let start = -1;
    for (let x = 0; x <= W; x++) {
      const f = x < W && isOpen(cells[y * W + x] as number);
      if (f && start < 0) start = x;
      if (!f && start >= 0) {
        path.rect(start * ppg, y * ppg, (x - start) * ppg, ppg);
        start = -1;
      }
    }
  }
  return path;
}

function drawGridLines({ ctx, d, ppg }: Paint, color: string): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, ppg * 0.02);
  ctx.beginPath();
  for (let x = 0; x <= d.width; x++) {
    ctx.moveTo(x * ppg, 0);
    ctx.lineTo(x * ppg, d.height * ppg);
  }
  for (let y = 0; y <= d.height; y++) {
    ctx.moveTo(0, y * ppg);
    ctx.lineTo(d.width * ppg, y * ppg);
  }
  ctx.stroke();
}

function nearFloor(d: Dungeon, x: number, y: number, r: number): boolean {
  for (let j = -r; j <= r; j++) {
    for (let i = -r; i <= r; i++) {
      const nx = x + i;
      const ny = y + j;
      if (nx >= 0 && ny >= 0 && nx < d.width && ny < d.height && isFloor(d.cells[ny * d.width + nx] as number)) return true;
    }
  }
  return false;
}

/** Calls fn for each rock cell within r squares of the floor (the visible "rock band"). */
function eachRockNearFloor(d: Dungeon, r: number, fn: (x: number, y: number) => void): void {
  for (let y = 0; y < d.height; y++) {
    for (let x = 0; x < d.width; x++) {
      if (d.cells[y * d.width + x] === ROCK && nearFloor(d, x, y, r)) fn(x, y);
    }
  }
}

function eachOpenCell(d: Dungeon, fn: (x: number, y: number) => void): void {
  for (let y = 0; y < d.height; y++) {
    for (let x = 0; x < d.width; x++) if (isOpen(d.cells[y * d.width + x] as number)) fn(x, y);
  }
}

const rgb = ([r, g, b]: RGB, v = 0): string => `rgb(${r + v}, ${g + v}, ${b + v})`;

/** Small deterministic hash so per-plank/per-tile variation does not depend on draw order. */
function hash2(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b ^ 0xc2b2ae35, 0x27d4eb2f);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  return (h ^ (h >>> 13)) >>> 0;
}

function irregularBlob(p: Paint, cx: number, cy: number, r: number, points: number): void {
  const { ctx, ppg, rng } = p;
  ctx.beginPath();
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2;
    const rr = r * (0.6 + rng.float() * 0.5);
    const x = (cx + Math.cos(a) * rr) * ppg;
    const y = (cy + Math.sin(a) * rr) * ppg;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

// ---------------------------------------------------------------------------
// Rock (everything outside the dungeon)

const ROCK_PAINTERS: Record<RockStyle, (p: Paint) => void> = {
  none: () => {},

  grid: (p) => drawGridLines(p, p.theme.rockLine ?? p.theme.grid),

  // Classic hand-drawn crosshatching.
  hatch: (p) => {
    const { ctx, ppg, rng } = p;
    ctx.strokeStyle = p.theme.rockLine ?? p.theme.wall;
    ctx.lineWidth = Math.max(1, ppg * 0.035);
    ctx.lineCap = 'round';
    ctx.beginPath();
    eachRockNearFloor(p.d, 1, (x, y) => {
      for (let k = 0; k < 3; k++) {
        const cx = (x + rng.float()) * ppg;
        const cy = (y + rng.float()) * ppg;
        const ang = rng.float() * Math.PI;
        const len = ppg * (0.35 + rng.float() * 0.25);
        const ux = Math.cos(ang);
        const uy = Math.sin(ang);
        for (let i = 0; i < 3; i++) {
          const off = (i - 1) * ppg * 0.11;
          const sx = cx - uy * off;
          const sy = cy + ux * off;
          ctx.moveTo(sx - (ux * len) / 2, sy - (uy * len) / 2);
          ctx.lineTo(sx + (ux * len) / 2, sy + (uy * len) / 2);
        }
      }
    });
    ctx.stroke();
  },

  speckle: (p) => {
    const { ctx, ppg, rng } = p;
    const shades = p.theme.rockColors ?? ['#222'];
    eachRockNearFloor(p.d, 2, (x, y) => {
      for (let k = 0; k < 3; k++) {
        const s = ppg * (0.2 + rng.float() * 0.35);
        ctx.fillStyle = rng.pick(shades);
        ctx.fillRect((x + rng.float()) * ppg - s / 2, (y + rng.float()) * ppg - s / 2, s, s * (0.6 + rng.float() * 0.6));
      }
    });
  },

  // Hull plating: one riveted panel per square.
  plating: (p) => {
    const { ctx, ppg, rng } = p;
    const shades = p.theme.rockColors ?? ['#111'];
    const inset = ppg * 0.04;
    eachRockNearFloor(p.d, 2, (x, y) => {
      ctx.fillStyle = rng.pick(shades);
      ctx.fillRect(x * ppg + inset, y * ppg + inset, ppg - inset * 2, ppg - inset * 2);
      if (rng.chance(0.35)) {
        ctx.fillStyle = p.theme.rockLine ?? '#000';
        for (const [i, j] of [[0.15, 0.15], [0.85, 0.15], [0.15, 0.85], [0.85, 0.85]] as const) {
          ctx.beginPath();
          ctx.arc((x + i) * ppg, (y + j) * ppg, ppg * 0.035, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    });
  },

  // Running-bond brickwork, two courses per square.
  brick: (p) => {
    const { ctx, ppg, rng } = p;
    const shades = p.theme.rockColors ?? ['#432'];
    const gap = Math.max(1, ppg * 0.04);
    const h = ppg / 2;
    eachRockNearFloor(p.d, 2, (x, y) => {
      for (let k = 0; k < 2; k++) {
        const top = y * ppg + k * h;
        const pieces: [number, number][] = (y * 2 + k) % 2 === 0 ? [[0, 1]] : [[0, 0.5], [0.5, 1]];
        for (const [a, b] of pieces) {
          ctx.fillStyle = rng.pick(shades);
          ctx.fillRect((x + a) * ppg + gap / 2, top + gap / 2, (b - a) * ppg - gap, h - gap);
        }
      }
    });
  },

  // Loose rocks and cracked earth.
  rubble: (p) => {
    const { ctx, ppg, rng } = p;
    const shades = p.theme.rockColors ?? ['#776'];
    eachRockNearFloor(p.d, 2, (x, y) => {
      for (let k = 0; k < 4; k++) {
        ctx.fillStyle = rng.pick(shades);
        irregularBlob(p, x + rng.float(), y + rng.float(), 0.08 + rng.float() * 0.14, 6);
      }
      if (rng.chance(0.15)) {
        ctx.strokeStyle = p.theme.rockLine ?? '#000';
        ctx.lineWidth = Math.max(1, ppg * 0.025);
        ctx.beginPath();
        ctx.moveTo((x + rng.float()) * ppg, y * ppg);
        ctx.lineTo((x + rng.float()) * ppg, (y + 0.5) * ppg);
        ctx.lineTo((x + rng.float()) * ppg, (y + 1) * ppg);
        ctx.stroke();
      }
    });
  },
};

// ---------------------------------------------------------------------------
// Floors (drawn clipped to the floor area, over the base floor colour)

const FLOOR_PAINTERS: Record<FloorStyle, (p: Paint) => void> = {
  plain: () => {},

  // One or two flagstones per square; the base floor colour reads as mortar.
  flagstone: (p) => {
    const { ctx, ppg, rng } = p;
    const tone = p.theme.floorTone ?? [120, 120, 120];
    const gap = Math.max(1, ppg * 0.04);
    const stone = (x: number, y: number, w: number, h: number): void => {
      ctx.fillStyle = rgb(tone, Math.floor(rng.float() * 22) - 11);
      ctx.fillRect(x + gap / 2, y + gap / 2, w - gap, h - gap);
    };
    eachOpenCell(p.d, (x, y) => {
      const px = x * ppg;
      const py = y * ppg;
      const r = rng.float();
      if (r < 0.2) {
        stone(px, py, ppg / 2, ppg);
        stone(px + ppg / 2, py, ppg / 2, ppg);
      } else if (r < 0.4) {
        stone(px, py, ppg, ppg / 2);
        stone(px, py + ppg / 2, ppg, ppg / 2);
      } else {
        stone(px, py, ppg, ppg);
      }
      if (rng.chance(0.06)) {
        ctx.strokeStyle = 'rgba(40, 36, 32, 0.6)';
        ctx.lineWidth = Math.max(1, ppg * 0.02);
        ctx.beginPath();
        ctx.moveTo(px + ppg * rng.float(), py + ppg * 0.1);
        ctx.lineTo(px + ppg * rng.float(), py + ppg * 0.5);
        ctx.lineTo(px + ppg * rng.float(), py + ppg * 0.9);
        ctx.stroke();
      }
    });
  },

  // Bevelled metal deck plates with screws and the occasional vent grate.
  deckplate: (p) => {
    const { ctx, ppg, rng } = p;
    const tone = p.theme.floorTone ?? [50, 60, 74];
    const gap = Math.max(1, ppg * 0.03);
    const bevel = Math.max(1, ppg * 0.03);
    eachOpenCell(p.d, (x, y) => {
      const px = x * ppg + gap / 2;
      const py = y * ppg + gap / 2;
      const s = ppg - gap;
      ctx.fillStyle = rgb(tone, Math.floor(rng.float() * 10) - 5);
      ctx.fillRect(px, py, s, s);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
      ctx.fillRect(px, py, s, bevel);
      ctx.fillRect(px, py, bevel, s);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
      ctx.fillRect(px, py + s - bevel, s, bevel);
      ctx.fillRect(px + s - bevel, py, bevel, s);
      if (rng.chance(0.08)) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
        for (let i = 0; i < 4; i++) ctx.fillRect(px + s * 0.2, py + s * (0.22 + i * 0.16), s * 0.6, s * 0.07);
      } else {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        for (const [i, j] of [[0.12, 0.12], [0.88, 0.12], [0.12, 0.88], [0.88, 0.88]] as const) {
          ctx.fillRect(px + s * i - ppg * 0.02, py + s * j - ppg * 0.02, ppg * 0.04, ppg * 0.04);
        }
      }
    });
  },

  // Wooden floorboards: two boards per square, three squares long, staggered by row.
  planks: (p) => {
    const { ctx, ppg } = p;
    const tone = p.theme.floorTone ?? [124, 84, 50];
    const h = ppg / 2;
    const seam = Math.max(1, ppg * 0.03);
    eachOpenCell(p.d, (x, y) => {
      for (let k = 0; k < 2; k++) {
        const row = y * 2 + k;
        const shifted = x + (hash2(row, 7) % 3);
        const plank = Math.floor(shifted / 3);
        const v = (hash2(row, plank) % 25) - 12;
        const top = y * ppg + k * h;
        ctx.fillStyle = rgb(tone, v);
        ctx.fillRect(x * ppg, top + seam / 2, ppg, h - seam);
        // Wood grain.
        ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
        ctx.fillRect(x * ppg, top + h * (0.3 + (hash2(row, plank + 99) % 40) / 100), ppg, Math.max(1, ppg * 0.015));
        if (shifted % 3 === 0) {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
          ctx.fillRect(x * ppg - seam / 2, top, seam, h);
          ctx.fillStyle = 'rgba(30, 20, 10, 0.8)';
          for (const ny of [0.3, 0.7]) {
            ctx.beginPath();
            ctx.arc(x * ppg + ppg * 0.08, top + h * ny, ppg * 0.022, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    });
  },

  checker: (p) => {
    const { ctx, ppg } = p;
    const a = p.theme.floorTone ?? [60, 60, 60];
    const b = p.theme.floorAlt ?? [40, 40, 40];
    const gap = Math.max(1, ppg * 0.025);
    eachOpenCell(p.d, (x, y) => {
      ctx.fillStyle = rgb((x + y) % 2 === 0 ? a : b, (hash2(x, y) % 7) - 3);
      ctx.fillRect(x * ppg + gap / 2, y * ppg + gap / 2, ppg - gap, ppg - gap);
    });
  },

  // Poured concrete with expansion joints, cracks and rust stains.
  concrete: (p) => {
    const { ctx, ppg, rng } = p;
    const tone = p.theme.floorTone ?? [128, 124, 116];
    eachOpenCell(p.d, (x, y) => {
      ctx.fillStyle = rgb(tone, Math.floor(rng.float() * 10) - 5);
      ctx.fillRect(x * ppg, y * ppg, ppg, ppg);
    });
    eachOpenCell(p.d, (x, y) => {
      ctx.fillStyle = 'rgba(40, 35, 30, 0.35)';
      if (x % 3 === 0) ctx.fillRect(x * ppg, y * ppg, Math.max(1, ppg * 0.025), ppg);
      if (y % 3 === 0) ctx.fillRect(x * ppg, y * ppg, ppg, Math.max(1, ppg * 0.025));
      if (rng.chance(0.06)) {
        const cx = (x + rng.float()) * ppg;
        const cy = (y + rng.float()) * ppg;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, ppg * 0.8);
        g.addColorStop(0, 'rgba(130, 64, 20, 0.4)');
        g.addColorStop(1, 'rgba(130, 64, 20, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(cx - ppg, cy - ppg, ppg * 2, ppg * 2);
      }
      if (rng.chance(0.08)) {
        ctx.strokeStyle = 'rgba(35, 30, 25, 0.6)';
        ctx.lineWidth = Math.max(1, ppg * 0.02);
        ctx.beginPath();
        ctx.moveTo((x + rng.float()) * ppg, y * ppg);
        ctx.lineTo((x + rng.float()) * ppg, (y + 0.5) * ppg);
        ctx.lineTo((x + 1) * ppg, (y + rng.float()) * ppg);
        ctx.stroke();
      }
    });
  },
};

// ---------------------------------------------------------------------------
// Walls, stairs, pillars

function drawWalls(p: Paint): void {
  const { ctx, ppg, theme } = p;
  const walls = computeWalls(p.d);
  const strokeAll = (): void => {
    ctx.beginPath();
    for (const s of walls) {
      ctx.moveTo(s.x1 * ppg, s.y1 * ppg);
      ctx.lineTo(s.x2 * ppg, s.y2 * ppg);
    }
    ctx.stroke();
  };
  ctx.save();
  ctx.lineCap = 'square';
  if (theme.shadow) {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
    ctx.shadowBlur = ppg * 0.35;
  }
  ctx.strokeStyle = theme.wall;
  ctx.lineWidth = ppg * theme.wallWidth;
  strokeAll();
  if (theme.wallLine) {
    ctx.shadowColor = theme.wallLine;
    ctx.shadowBlur = ppg * 0.3;
    ctx.strokeStyle = theme.wallLine;
    ctx.lineWidth = Math.max(1, ppg * 0.05);
    strokeAll();
  }
  ctx.restore();
}

type StairPainter = (p: Paint, x: number, y: number, dir: number, kind: 'up' | 'down') => void;

const STAIR_PAINTERS: Record<StairStyle, StairPainter> = {
  // Parallel treads; descending stairs narrow as they go down (the traditional symbol).
  steps: ({ ctx, ppg, theme }, x, y, dir, kind) => {
    const [ux, uy] = DIRS[dir] ?? [0, -1]; // towards the wall the stairs lean against
    const vx = -uy;
    const vy = ux;
    const cx = (x + 0.5) * ppg;
    const cy = (y + 0.5) * ppg;
    if (theme.stairFill) {
      ctx.fillStyle = theme.stairFill;
      ctx.fillRect(x * ppg, y * ppg, ppg, ppg);
    }
    ctx.strokeStyle = theme.stair;
    ctx.lineWidth = Math.max(1, ppg * 0.05);
    ctx.lineCap = 'butt';
    ctx.beginPath();
    const steps = 5;
    for (let i = 0; i < steps; i++) {
      const a = 0.5 - (i + 0.5) / steps;
      const half = ppg * 0.42 * (kind === 'down' ? 1 - i * 0.13 : 1);
      const px = cx + ux * a * ppg;
      const py = cy + uy * a * ppg;
      ctx.moveTo(px - vx * half, py - vy * half);
      ctx.lineTo(px + vx * half, py + vy * half);
    }
    ctx.stroke();
  },

  // A lift platform: boxed X with a direction arrow.
  lift: ({ ctx, ppg, theme }, x, y, _dir, kind) => {
    const i = ppg * 0.1;
    ctx.fillStyle = theme.stairFill ?? theme.floor;
    ctx.fillRect(x * ppg, y * ppg, ppg, ppg);
    ctx.strokeStyle = theme.stair;
    ctx.lineWidth = Math.max(1, ppg * 0.045);
    ctx.strokeRect(x * ppg + i, y * ppg + i, ppg - i * 2, ppg - i * 2);
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    ctx.moveTo(x * ppg + i, y * ppg + i);
    ctx.lineTo((x + 1) * ppg - i, (y + 1) * ppg - i);
    ctx.moveTo((x + 1) * ppg - i, y * ppg + i);
    ctx.lineTo(x * ppg + i, (y + 1) * ppg - i);
    ctx.stroke();
    ctx.globalAlpha = 1;
    const cx = (x + 0.5) * ppg;
    const cy = (y + 0.5) * ppg;
    const s = ppg * 0.2 * (kind === 'up' ? -1 : 1);
    ctx.fillStyle = theme.stair;
    ctx.beginPath();
    ctx.moveTo(cx, cy + s);
    ctx.lineTo(cx - Math.abs(s), cy - s * 0.6);
    ctx.lineTo(cx + Math.abs(s), cy - s * 0.6);
    ctx.closePath();
    ctx.fill();
  },

  // Ladder against the wall; going down, it sits in a dark shaft.
  ladder: ({ ctx, ppg, theme }, x, y, dir, kind) => {
    const [ux, uy] = DIRS[dir] ?? [0, -1];
    const vx = -uy;
    const vy = ux;
    const cx = (x + 0.5) * ppg;
    const cy = (y + 0.5) * ppg;
    if (kind === 'down') {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(x * ppg + ppg * 0.08, y * ppg + ppg * 0.08, ppg * 0.84, ppg * 0.84);
    }
    ctx.strokeStyle = kind === 'down' ? '#b0a080' : theme.stair;
    ctx.lineWidth = Math.max(1, ppg * 0.06);
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const side of [-0.22, 0.22]) {
      ctx.moveTo(cx + vx * side * ppg + ux * 0.42 * ppg, cy + vy * side * ppg + uy * 0.42 * ppg);
      ctx.lineTo(cx + vx * side * ppg - ux * 0.42 * ppg, cy + vy * side * ppg - uy * 0.42 * ppg);
    }
    for (let i = 0; i < 5; i++) {
      const a = (0.36 - i * 0.18) * ppg;
      ctx.moveTo(cx + ux * a - vx * 0.22 * ppg, cy + uy * a - vy * 0.22 * ppg);
      ctx.lineTo(cx + ux * a + vx * 0.22 * ppg, cy + uy * a + vy * 0.22 * ppg);
    }
    ctx.stroke();
  },
};

type PillarPainter = (p: Paint, x: number, y: number) => void;

const PILLAR_PAINTERS: Record<PillarStyle, PillarPainter> = {
  round: ({ ctx, ppg, theme }, x, y) => {
    ctx.save();
    if (theme.shadow) {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
      ctx.shadowBlur = ppg * 0.25;
    }
    ctx.beginPath();
    ctx.arc(x * ppg, y * ppg, ppg * PILLAR_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = theme.pillarFill;
    ctx.fill();
    ctx.lineWidth = ppg * 0.06;
    ctx.strokeStyle = theme.pillarStroke;
    ctx.stroke();
    ctx.restore();
  },

  // Square support column with a glowing trim line.
  square: ({ ctx, ppg, theme }, x, y) => {
    const r = ppg * PILLAR_RADIUS * 0.92;
    ctx.save();
    ctx.fillStyle = theme.pillarFill;
    ctx.fillRect(x * ppg - r, y * ppg - r, r * 2, r * 2);
    ctx.shadowColor = theme.pillarStroke;
    ctx.shadowBlur = ppg * 0.2;
    ctx.strokeStyle = theme.pillarStroke;
    ctx.lineWidth = Math.max(1, ppg * 0.04);
    ctx.strokeRect(x * ppg - r * 0.6, y * ppg - r * 0.6, r * 1.2, r * 1.2);
    ctx.restore();
  },

  // Copper boiler drum with a rivet ring.
  boiler: ({ ctx, ppg, theme }, x, y) => {
    const cx = x * ppg;
    const cy = y * ppg;
    const r = ppg * PILLAR_RADIUS * 1.08;
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = ppg * 0.25;
    const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.1, cx, cy, r);
    g.addColorStop(0, '#f6c48a');
    g.addColorStop(0.5, theme.pillarFill);
    g.addColorStop(1, theme.pillarStroke);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = Math.max(1, ppg * 0.04);
    ctx.strokeStyle = theme.pillarStroke;
    ctx.stroke();
    ctx.fillStyle = theme.pillarStroke;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * r * 0.78, cy + Math.sin(a) * r * 0.78, ppg * 0.025, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  },
};

// ---------------------------------------------------------------------------
// Doors

/** Door geometry in pixels: centre, and the rectangle's size along/across the edge. */
interface DoorBox {
  door: Door;
  horiz: boolean;
  mx: number;
  my: number;
  w: number;
  h: number;
}

function doorBox(door: Door, ppg: number, length: number, thickness: number): DoorBox {
  const horiz = door.y1 === door.y2;
  const L = ppg * length;
  const T = ppg * thickness;
  return {
    door,
    horiz,
    mx: ((door.x1 + door.x2) / 2) * ppg,
    my: ((door.y1 + door.y2) / 2) * ppg,
    w: horiz ? L : T,
    h: horiz ? T : L,
  };
}

function fillDoorRect(ctx: Ctx, b: DoorBox, fill: string, stroke: string, lineWidth: number): void {
  ctx.fillStyle = fill;
  ctx.fillRect(b.mx - b.w / 2, b.my - b.h / 2, b.w, b.h);
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = stroke;
  ctx.strokeRect(b.mx - b.w / 2, b.my - b.h / 2, b.w, b.h);
}

/** Lines across the door's thickness at fractions t (from -0.5 to 0.5) of its length. */
function doorCrossLines(ctx: Ctx, b: DoorBox, ts: readonly number[]): void {
  ctx.beginPath();
  for (const t of ts) {
    if (b.horiz) {
      ctx.moveTo(b.mx + t * b.w, b.my - b.h / 2);
      ctx.lineTo(b.mx + t * b.w, b.my + b.h / 2);
    } else {
      ctx.moveTo(b.mx - b.w / 2, b.my + t * b.h);
      ctx.lineTo(b.mx + b.w / 2, b.my + t * b.h);
    }
  }
  ctx.stroke();
}

function lockDot(ctx: Ctx, b: DoorBox, theme: Theme, ppg: number): void {
  if (b.door.type !== 'locked') return;
  ctx.fillStyle = theme.lockMark ?? theme.doorStroke;
  ctx.beginPath();
  ctx.arc(b.mx, b.my, ppg * 0.07, 0, Math.PI * 2);
  ctx.fill();
}

const DOOR_PAINTERS: Record<DoorStyle, (p: Paint, door: Door) => void> = {
  outline: ({ ctx, ppg, theme }, door) => {
    const b = doorBox(door, ppg, 0.72, 0.26);
    fillDoorRect(ctx, b, theme.door, theme.doorStroke, Math.max(1, ppg * 0.05));
    lockDot(ctx, b, theme, ppg);
  },

  wood: ({ ctx, ppg, theme }, door) => {
    const b = doorBox(door, ppg, 0.72, 0.26);
    fillDoorRect(ctx, b, theme.door, theme.doorStroke, Math.max(1, ppg * 0.05));
    // Plank lines run along the door.
    ctx.lineWidth = Math.max(1, ppg * 0.02);
    ctx.beginPath();
    for (const t of [-1 / 6, 1 / 6]) {
      if (b.horiz) {
        ctx.moveTo(b.mx - b.w / 2, b.my + t * b.h * 2);
        ctx.lineTo(b.mx + b.w / 2, b.my + t * b.h * 2);
      } else {
        ctx.moveTo(b.mx + t * b.w * 2, b.my - b.h / 2);
        ctx.lineTo(b.mx + t * b.w * 2, b.my + b.h / 2);
      }
    }
    ctx.stroke();
    lockDot(ctx, b, theme, ppg);
  },

  // Two sliding leaves meeting in the middle, with a red/green status light.
  sliding: ({ ctx, ppg, theme }, door) => {
    const b = doorBox(door, ppg, 0.9, 0.2);
    fillDoorRect(ctx, b, theme.door, theme.doorStroke, Math.max(1, ppg * 0.04));
    ctx.strokeStyle = theme.doorStroke;
    ctx.lineWidth = Math.max(1, ppg * 0.035);
    doorCrossLines(ctx, b, [0]);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    if (b.horiz) ctx.fillRect(b.mx - b.w / 2, b.my - b.h / 2, b.w, b.h * 0.3);
    else ctx.fillRect(b.mx - b.w / 2, b.my - b.h / 2, b.w * 0.3, b.h);
    const light = door.type === 'locked' ? '#ff4b4b' : '#4bff8a';
    const lx = b.horiz ? b.mx + b.w * 0.3 : b.mx;
    const ly = b.horiz ? b.my : b.my + b.h * 0.3;
    ctx.save();
    ctx.shadowColor = light;
    ctx.shadowBlur = ppg * 0.25;
    ctx.fillStyle = light;
    ctx.beginPath();
    ctx.arc(lx, ly, ppg * 0.045, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  },

  // Iron hatch with a brass-rimmed porthole and rivets at each end.
  hatch: ({ ctx, ppg, theme }, door) => {
    const b = doorBox(door, ppg, 0.8, 0.3);
    fillDoorRect(ctx, b, theme.door, theme.doorStroke, Math.max(1, ppg * 0.05));
    ctx.fillStyle = theme.doorStroke;
    for (const t of [-0.4, 0.4]) {
      ctx.beginPath();
      ctx.arc(b.horiz ? b.mx + t * b.w : b.mx, b.horiz ? b.my : b.my + t * b.h, ppg * 0.03, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(b.mx, b.my, ppg * 0.1, 0, Math.PI * 2);
    ctx.fillStyle = door.type === 'locked' ? (theme.lockMark ?? '#7a2a20') : '#9fcfd6';
    ctx.fill();
    ctx.lineWidth = Math.max(1, ppg * 0.035);
    ctx.strokeStyle = theme.doorStroke;
    ctx.stroke();
  },

  // Corrugated sheet metal.
  metal: ({ ctx, ppg, theme }, door) => {
    const b = doorBox(door, ppg, 0.76, 0.24);
    fillDoorRect(ctx, b, theme.door, theme.doorStroke, Math.max(1, ppg * 0.045));
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.lineWidth = Math.max(1, ppg * 0.02);
    doorCrossLines(ctx, b, [-0.3, -0.15, 0, 0.15, 0.3]);
    lockDot(ctx, b, theme, ppg);
  },
};

function drawDoors(p: Paint): void {
  const { ctx, ppg, theme, gm } = p;
  for (const door of p.d.doors) {
    if (door.type !== 'secret') {
      DOOR_PAINTERS[theme.doorStyle](p, door);
      continue;
    }
    // Players see an unbroken wall; the GM sees the classic "S".
    ctx.strokeStyle = theme.wall;
    ctx.lineWidth = ppg * theme.wallWidth;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(door.x1 * ppg, door.y1 * ppg);
    ctx.lineTo(door.x2 * ppg, door.y2 * ppg);
    ctx.stroke();
    if (gm) {
      const mx = ((door.x1 + door.x2) / 2) * ppg;
      const my = ((door.y1 + door.y2) / 2) * ppg;
      ctx.font = `bold ${Math.round(ppg * 0.55)}px ${theme.font}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = ppg * 0.1;
      ctx.strokeStyle = theme.halo;
      ctx.strokeText('S', mx, my);
      ctx.fillStyle = theme.secretMark ?? theme.text;
      ctx.fillText('S', mx, my);
    }
  }
}

// ---------------------------------------------------------------------------
// Decorations

type DecorPhase = 'rock' | 'floor' | 'beforeWalls' | 'afterWalls';

function gear(ctx: Ctx, cx: number, cy: number, r: number, teeth: number, rot: number): void {
  ctx.beginPath();
  for (let i = 0; i < teeth * 2; i++) {
    const a0 = rot + (i / (teeth * 2)) * Math.PI * 2;
    const a1 = rot + ((i + 1) / (teeth * 2)) * Math.PI * 2;
    const rr = i % 2 === 0 ? r : r * 0.78;
    ctx.lineTo(cx + Math.cos(a0) * rr, cy + Math.sin(a0) * rr);
    ctx.lineTo(cx + Math.cos(a1) * rr, cy + Math.sin(a1) * rr);
  }
  ctx.closePath();
  ctx.moveTo(cx + r * 0.3, cy);
  ctx.arc(cx, cy, r * 0.3, 0, Math.PI * 2, true);
  ctx.fill('evenodd');
}

/** Visits every unit-length wall edge with the side (dx, dy) that faces into rock. */
function eachWallUnit(d: Dungeon, fn: (x1: number, y1: number, x2: number, y2: number, rx: number, ry: number) => void): void {
  const open = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < d.width && y < d.height && isOpen(d.cells[y * d.width + x] as number);
  for (let y = 1; y < d.height; y++) {
    for (let x = 0; x < d.width; x++) {
      const up = open(x, y - 1);
      if (up !== open(x, y)) fn(x, y, x + 1, y, 0, up ? 1 : -1);
    }
  }
  for (let x = 1; x < d.width; x++) {
    for (let y = 0; y < d.height; y++) {
      const left = open(x - 1, y);
      if (left !== open(x, y)) fn(x, y, x, y + 1, left ? 1 : -1, 0);
    }
  }
}

const DECOR: Record<DecorStyle, { phase: DecorPhase; paint: (p: Paint) => void }> = {
  // Gear silhouettes set into the brickwork.
  gears: {
    phase: 'rock',
    paint: (p) => {
      const { ctx, ppg, rng } = p;
      ctx.fillStyle = 'rgba(190, 130, 60, 0.35)';
      eachRockNearFloor(p.d, 1, (x, y) => {
        if (!rng.chance(0.05)) return;
        gear(ctx, (x + 0.5) * ppg, (y + 0.5) * ppg, ppg * (0.3 + rng.float() * 0.15), 8 + rng.int(0, 3), rng.float());
      });
    },
  },

  // Copper pipes running just inside the rock along some stretches of wall.
  // Drawn after the walls so the wall shadows don't swallow them.
  pipes: {
    phase: 'afterWalls',
    paint: (p) => {
      const { ctx, ppg, rng, d } = p;
      const off = 0.3;
      // Decide per wall line (row/column + side) so pipes form long continuous runs.
      const runs = new Map<string, boolean>();
      const segs: [number, number, number, number][] = [];
      eachWallUnit(d, (x1, y1, x2, y2, rx, ry) => {
        const key = `${x1 === x2 ? 'v' : 'h'}${x1 === x2 ? x1 : y1}:${rx}${ry}:${Math.floor((x1 === x2 ? y1 : x1) / 6)}`;
        if (!runs.has(key)) runs.set(key, rng.chance(0.45));
        if (runs.get(key)) segs.push([x1 + rx * off, y1 + ry * off, x2 + rx * off, y2 + ry * off]);
      });
      const stroke = (color: string, width: number, shift: number): void => {
        ctx.strokeStyle = color;
        ctx.lineWidth = ppg * width;
        ctx.beginPath();
        for (const [x1, y1, x2, y2] of segs) {
          const sx = y1 === y2 ? 0 : shift;
          const sy = y1 === y2 ? shift : 0;
          ctx.moveTo((x1 + sx) * ppg, (y1 + sy) * ppg);
          ctx.lineTo((x2 + sx) * ppg, (y2 + sy) * ppg);
        }
        ctx.stroke();
      };
      ctx.lineCap = 'butt';
      stroke('#5a3517', 0.16, 0);
      stroke('#b8743a', 0.11, 0);
      stroke('rgba(255, 210, 150, 0.6)', 0.03, -0.025);
      // Flanges and the odd valve wheel.
      for (const [x1, y1, x2, y2] of segs) {
        if (!rng.chance(0.18)) continue;
        const mx = ((x1 + x2) / 2) * ppg;
        const my = ((y1 + y2) / 2) * ppg;
        if (rng.chance(0.5)) {
          ctx.fillStyle = '#7a4a22';
          const horiz = y1 === y2;
          ctx.fillRect(mx - ppg * (horiz ? 0.04 : 0.11), my - ppg * (horiz ? 0.11 : 0.04), ppg * (horiz ? 0.08 : 0.22), ppg * (horiz ? 0.22 : 0.08));
        } else {
          ctx.strokeStyle = '#c0392b';
          ctx.lineWidth = Math.max(1, ppg * 0.035);
          ctx.beginPath();
          ctx.arc(mx, my, ppg * 0.12, 0, Math.PI * 2);
          ctx.moveTo(mx - ppg * 0.12, my);
          ctx.lineTo(mx + ppg * 0.12, my);
          ctx.moveTo(mx, my - ppg * 0.12);
          ctx.lineTo(mx, my + ppg * 0.12);
          ctx.stroke();
        }
      }
    },
  },

  // Brass rivets along every wall.
  rivets: {
    phase: 'afterWalls',
    paint: ({ ctx, ppg, d }) => {
      ctx.fillStyle = '#e3b46b';
      eachWallUnit(d, (x1, y1, x2, y2) => {
        ctx.beginPath();
        ctx.arc(((x1 + x2) / 2) * ppg, ((y1 + y2) / 2) * ppg, ppg * 0.03, 0, Math.PI * 2);
        ctx.fill();
      });
    },
  },

  // Yellow/black hazard stripes on the corridor side of each door.
  hazard: {
    phase: 'beforeWalls',
    paint: ({ ctx, ppg, d }) => {
      const band = 0.22;
      for (const door of d.doors) {
        if (door.type === 'secret') continue;
        const horiz = door.y1 === door.y2;
        const before = horiz ? (door.y1 - 1) * d.width + door.x1 : door.y1 * d.width + door.x1 - 1;
        const corridorBefore = d.cells[before] === CORRIDOR;
        const rx = horiz ? door.x1 : corridorBefore ? door.x1 - band : door.x1;
        const ry = horiz ? (corridorBefore ? door.y1 - band : door.y1) : door.y1;
        const rw = horiz ? 1 : band;
        const rh = horiz ? band : 1;
        ctx.save();
        ctx.beginPath();
        ctx.rect(rx * ppg, ry * ppg, rw * ppg, rh * ppg);
        ctx.clip();
        ctx.fillStyle = '#e8b923';
        ctx.fillRect(rx * ppg, ry * ppg, rw * ppg, rh * ppg);
        ctx.strokeStyle = '#151515';
        ctx.lineWidth = ppg * 0.07;
        ctx.beginPath();
        for (let k = -2; k <= 6; k++) {
          const ox = (rx + k * 0.2) * ppg;
          ctx.moveTo(ox, (ry + rh) * ppg);
          ctx.lineTo(ox + ppg * 0.6, (ry + rh - 0.6) * ppg);
        }
        ctx.stroke();
        ctx.restore();
      }
    },
  },

  // Candles with warm glows in room corners (clipped to the floor so light stops at walls).
  candles: {
    phase: 'floor',
    paint: ({ ctx, ppg, d, rng }) => {
      for (const r of d.rooms) {
        if (r.shape === 'area') continue;
        const corners: [number, number, number, number][] = [
          [r.x, r.y, 0.32, 0.32],
          [r.x + r.w - 1, r.y, 0.68, 0.32],
          [r.x, r.y + r.h - 1, 0.32, 0.68],
          [r.x + r.w - 1, r.y + r.h - 1, 0.68, 0.68],
        ];
        for (const [x, y, ox, oy] of corners) {
          if (d.cells[y * d.width + x] !== ROOM || !rng.chance(0.6)) continue;
          const cx = (x + ox) * ppg;
          const cy = (y + oy) * ppg;
          const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, ppg * 1.3);
          g.addColorStop(0, 'rgba(255, 176, 70, 0.45)');
          g.addColorStop(1, 'rgba(255, 176, 70, 0)');
          ctx.fillStyle = g;
          ctx.fillRect(cx - ppg * 1.3, cy - ppg * 1.3, ppg * 2.6, ppg * 2.6);
          ctx.fillStyle = '#efe2c4';
          ctx.beginPath();
          ctx.arc(cx, cy, ppg * 0.07, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#ffb347';
          ctx.beginPath();
          ctx.arc(cx, cy - ppg * 0.02, ppg * 0.035, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    },
  },

  // Old bloodstains on the floor.
  stains: {
    phase: 'floor',
    paint: (p) => {
      const { ctx, rng, d } = p;
      eachOpenCell(d, (x, y) => {
        if (!rng.chance(0.03)) return;
        ctx.fillStyle = 'rgba(110, 10, 18, 0.45)';
        irregularBlob(p, x + 0.5, y + 0.5, 0.3 + rng.float() * 0.2, 9);
        for (let i = 0; i < 3; i++) irregularBlob(p, x + rng.float(), y + rng.float(), 0.06, 6);
      });
    },
  },

  // Scattered rubble and junk on the floor.
  debris: {
    phase: 'floor',
    paint: (p) => {
      const { ctx, rng, d } = p;
      const stairs = new Set(d.stairs.map((s) => s.y * d.width + s.x));
      const colors = ['#5b544a', '#4a443b', '#6e665a', '#7a4a2a'];
      eachOpenCell(d, (x, y) => {
        if (stairs.has(y * d.width + x) || !rng.chance(0.05)) return;
        for (let i = 0; i < 5; i++) {
          ctx.fillStyle = rng.pick(colors);
          irregularBlob(p, x + 0.2 + rng.float() * 0.6, y + 0.2 + rng.float() * 0.6, 0.05 + rng.float() * 0.08, 5);
        }
      });
    },
  },
};

// ---------------------------------------------------------------------------
// Labels

function drawLabels({ ctx, d, ppg, theme }: Paint): void {
  ctx.font = `bold ${Math.round(ppg * 0.6)}px ${theme.font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  for (const r of d.rooms) {
    const x = (r.cx + 0.5) * ppg;
    const y = (r.cy + 0.5) * ppg;
    const label = String(r.id + 1);
    ctx.lineWidth = ppg * 0.16;
    ctx.strokeStyle = theme.halo;
    ctx.strokeText(label, x, y);
    ctx.fillStyle = theme.text;
    ctx.fillText(label, x, y);
  }
}
