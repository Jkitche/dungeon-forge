// Shared test helpers: map invariants, fakes for the canvas and export context, and a zip reader.

import assert from 'node:assert/strict';
import { crc32 as zlibCrc32 } from 'node:zlib';
import { footprint } from '../src/renderer/clutter.ts';
import { canHaveDoor } from '../src/renderer/editor.ts';
import type { ExportContext, RenderRequest } from '../src/renderer/export/index.ts';
import { isFloor, DIRS, ROCK, CORRIDOR } from '../src/renderer/generator.ts';
import type { Dungeon, DungeonOptions } from '../src/renderer/generator.ts';
import type { PropPalette } from '../src/renderer/props/index.ts';

export function reachableFloor(d: Dungeon): number {
  const first = d.stairs[0];
  assert.ok(first, 'has an entrance');
  const start = first.y * d.width + first.x;
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const c = queue.pop() as number;
    for (const [dx, dy] of DIRS) {
      const n = c + dy * d.width + dx;
      if (!seen.has(n) && isFloor(d.cells[n] as number)) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  return seen.size;
}

export const floorCount = (d: Dungeon): number => d.cells.reduce((k, t) => k + (isFloor(t) ? 1 : 0), 0);

export const variants: Partial<DungeonOptions>[] = [
  { algorithm: 'rooms' },
  { algorithm: 'rooms', corridorStyle: 'winding', loopChance: 1, roundRoomChance: 1 },
  { algorithm: 'rooms', width: 100, height: 80, roomCount: 40, pillarChance: 1 },
  { algorithm: 'rooms', width: 16, height: 16, roomCount: 30 },
  { algorithm: 'caves' },
  { algorithm: 'caves', width: 90, height: 60, caveFill: 0.55 },
  { algorithm: 'caves', width: 16, height: 16, caveFill: 0.6 },
];

/** Everything the renderer, room key and exporters rely on after an edit. */
export function assertConsistent(d: Dungeon, label: string): void {
  d.rooms.forEach((r, i) => {
    assert.equal(r.id, i, `${label}: room ids are sequential`);
    const c = r.cy * d.width + r.cx;
    assert.equal(d.roomIds[c], r.id, `${label}: room ${i} label sits in the room`);
    assert.ok(r.cx >= r.x && r.cx < r.x + r.w && r.cy >= r.y && r.cy < r.y + r.h, `${label}: label inside bounds`);
  });
  for (let c = 0; c < d.cells.length; c++) {
    const id = d.roomIds[c] as number;
    assert.ok(id < d.rooms.length, `${label}: roomIds point at real rooms`);
    if (d.cells[c] === ROCK || d.cells[c] === CORRIDOR) assert.equal(id, -1, `${label}: rock/corridor belong to no room`);
  }
  for (let x = 0; x < d.width; x++) {
    assert.ok(!isFloor(d.cells[x] as number) && !isFloor(d.cells[(d.height - 1) * d.width + x] as number), `${label}: border stays rock`);
  }
  const doorKeys = new Set<string>();
  for (const o of d.doors) {
    assert.ok(canHaveDoor(d, o), `${label}: door on floor-floor edge`);
    const k = `${o.x1},${o.y1},${o.x2},${o.y2}`;
    assert.ok(!doorKeys.has(k), `${label}: one door per edge`);
    doorKeys.add(k);
  }
  for (const s of d.stairs) assert.ok(isFloor(d.cells[s.y * d.width + s.x] as number), `${label}: stairs on floor`);
  const stairSquares = new Set(d.stairs.map((s) => s.y * d.width + s.x));
  const propSquares = new Set<number>();
  for (const p of d.props) {
    for (const f of footprint(p)) {
      const c = f.y * d.width + f.x;
      assert.ok(isFloor(d.cells[c] as number) && !stairSquares.has(c), `${label}: props on floor, off stairs`);
      assert.ok(!propSquares.has(c), `${label}: props don't overlap`);
      propSquares.add(c);
    }
  }
  const lightSquares = new Set<number>();
  for (const l of d.lights) {
    const c = l.y * d.width + l.x;
    assert.ok(isFloor(d.cells[c] as number), `${label}: lights on floor`);
    assert.ok(!lightSquares.has(c), `${label}: one light per square`);
    assert.equal(l.room, d.roomIds[c], `${label}: light knows its room`);
    lightSquares.add(c);
  }
}

export const unitLength = (segs: { x1: number; y1: number; x2: number; y2: number }[]): number =>
  segs.reduce((n, s) => n + Math.abs(s.x2 - s.x1) + Math.abs(s.y2 - s.y1), 0);

// Reads a stored (uncompressed) zip back via its central directory.
export function readZip(zip: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const eocd = zip.length - 22;
  assert.equal(view.getUint32(eocd, true), 0x06054b50, 'end of central directory');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const files = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i++) {
    assert.equal(view.getUint32(p, true), 0x02014b50, 'central header');
    const crc = view.getUint32(p + 16, true);
    const size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const local = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(zip.subarray(p + 46, p + 46 + nameLen));
    assert.equal(view.getUint32(local, true), 0x04034b50, 'local header');
    const dataStart = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = zip.subarray(dataStart, dataStart + size);
    assert.equal(zlibCrc32(data), crc, `crc for ${name}`);
    files.set(name, data);
    p += 46 + nameLen;
  }
  return files;
}

export function fakeContext(d: Dungeon, overrides: Partial<ExportContext> = {}): ExportContext & { renders: RenderRequest[] } {
  const renders: RenderRequest[] = [];
  return {
    dungeon: d,
    ppg: 80,
    grid: false,
    gmView: false,
    renders,
    renderPng: async (req: RenderRequest = {}) => {
      renders.push(req);
      return new Uint8Array([137, 80, 78, 71, renders.length]);
    },
    ...overrides,
  };
}

export interface Recording {
  ctx: CanvasRenderingContext2D;
  calls: { name: string; args: unknown[] }[];
  styles: unknown[];
}

export function recordingContext(): Recording {
  const calls: Recording['calls'] = [];
  const styles: unknown[] = [];
  const state: Record<string, unknown> = {};
  const ctx = new Proxy(state, {
    get(_t, prop: string) {
      if (prop in state) return state[prop];
      if (prop === 'createRadialGradient' || prop === 'createLinearGradient') {
        return (...args: unknown[]) => {
          calls.push({ name: prop, args });
          const stops: [number, string][] = [];
          return { gradient: true, stops, addColorStop: (o: number, c: string) => stops.push([o, c]) };
        };
      }
      if (prop === 'measureText') return (text: string) => ({ width: String(text).length * 7 });
      return (...args: unknown[]) => calls.push({ name: prop, args });
    },
    set(_t, prop: string, value: unknown) {
      state[prop] = value;
      if (prop === 'fillStyle' || prop === 'strokeStyle' || prop === 'shadowColor') styles.push(value);
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, styles };
}

/** Every point a recorded call touches, for bounds checks. */

export function touchedPoints(calls: Recording['calls']): [number, number][] {
  const pts: [number, number][] = [];
  for (const { name, args } of calls) {
    const n = args as number[];
    if (name === 'moveTo' || name === 'lineTo') pts.push([n[0] as number, n[1] as number]);
    if (['rect', 'fillRect', 'strokeRect', 'roundRect'].includes(name)) {
      pts.push([n[0] as number, n[1] as number], [(n[0] as number) + (n[2] as number), (n[1] as number) + (n[3] as number)]);
    }
    if (name === 'arc') {
      const [x, y, r] = n as [number, number, number];
      pts.push([x - r, y - r], [x + r, y + r]);
    }
  }
  return pts;
}

export const TEST_PALETTE: PropPalette = {
  wood: '#a07040', metal: '#808890', cloth: '#803030', stone: '#909088', line: '#101010', glow: '#ffb040', paper: '#f0e8d0',
};

/** A canvas whose 2D context records every call; what renderDungeon needs. */
export function fakeCanvas(): { canvas: HTMLCanvasElement; rec: Recording } {
  const rec = recordingContext();
  const canvas = { width: 0, height: 0, getContext: () => rec.ctx };
  return { canvas: canvas as unknown as HTMLCanvasElement, rec };
}

/** Node has no Path2D; the renderer only builds rectangles with it and hands it back to the context. */
export function installPath2D(): void {
  const g = globalThis as Record<string, unknown>;
  g.Path2D ??= class {
    rects: number[][] = [];
    rect(...args: number[]): void {
      this.rects.push(args);
    }
  };
}

/** Text drawn with fillText, in order. */
export const drawnText = (rec: Recording): string[] =>
  rec.calls.filter((c) => c.name === 'fillText').map((c) => String(c.args[0]));
