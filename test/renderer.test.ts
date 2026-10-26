// Map rendering, checked against a recording fake canvas.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GENRES, GENRE_KEYS } from '../src/renderer/genres.ts';
import { isThemeKey, isLook, LOOKS, resolveTheme, renderDungeon, THEMES } from '../src/renderer/renderer.ts';
import type { RenderOptions, ThemeKey } from '../src/renderer/renderer.ts';
import { generateDungeon } from '../src/renderer/generator.ts';
import { createBlankDungeon, lineCells, paintCorridor, paintRoom } from '../src/renderer/editor.ts';
import { computeWalls } from '../src/renderer/walls.ts';
import { drawnText, fakeCanvas, installPath2D } from './helpers.ts';

test('the Look follows the setting unless Blueprint, Dark Stone or Realistic is chosen', () => {
  for (const key of GENRE_KEYS) {
    const theme = GENRES[key].theme;
    assert.equal(resolveTheme('setting', theme), theme);
    assert.equal(resolveTheme('blueprint', theme), 'blueprint');
    assert.equal(resolveTheme('stone', theme), 'stone');
    assert.equal(resolveTheme('realistic', theme), 'realistic');
  }
  for (const [look] of LOOKS) assert.ok(isThemeKey(resolveTheme(look, 'parchment')));
  assert.ok(!isLook('parchment'), 'setting themes are not separate looks');
});

installPath2D();

/** A map with every feature the renderer draws: doors of all kinds, windows, pillars, stairs, clutter. */
function busyMap(seed: string, algorithm: 'rooms' | 'caves' = 'rooms') {
  return generateDungeon({
    seed, algorithm, width: 40, height: 30, doorChance: 1, lockedDoorChance: 0.3, secretDoorChance: 0.3,
    windowChance: 1, pillarChance: 1, roomMin: 6, roomMax: 10, clutter: 1,
  });
}

function render(d: ReturnType<typeof busyMap>, opts: RenderOptions) {
  const { canvas, rec } = fakeCanvas();
  renderDungeon(canvas, d, opts);
  return { canvas, rec };
}

/** moveTo followed directly by lineTo, as [x1, y1, x2, y2] in pixels. */
function strokedSegments(rec: ReturnType<typeof fakeCanvas>['rec']): string[] {
  const out: string[] = [];
  rec.calls.forEach((c, i) => {
    const next = rec.calls[i + 1];
    if (c.name === 'moveTo' && next?.name === 'lineTo') out.push([...c.args, ...next.args].join(','));
  });
  return out;
}

test('the canvas is sized to the map at the requested scale', () => {
  const d = busyMap('size');
  const { canvas } = render(d, { ppg: 30 });
  assert.deepEqual([canvas.width, canvas.height], [d.width * 30, d.height * 30]);
});

test('every theme draws every kind of map feature, the same way every time', () => {
  for (const map of [busyMap('themes'), busyMap('themes-caves', 'caves')]) {
    for (const theme of Object.keys(THEMES) as ThemeKey[]) {
      const first = render(map, { theme, ppg: 24 });
      const again = render(map, { theme, ppg: 24 });
      assert.ok(first.rec.calls.length > 1000, `${theme} draws the map`);
      assert.deepEqual(again.rec.calls, first.rec.calls, `${theme} is deterministic`);
    }
  }
});

test('an unknown theme falls back to parchment', () => {
  const d = busyMap('fallback');
  const unknown = render(d, { theme: 'neon' as ThemeKey, ppg: 20 });
  const parchment = render(d, { theme: 'parchment', ppg: 20 });
  assert.deepEqual(unknown.rec.calls, parchment.rec.calls);
});

test('room numbers and secret-door marks appear only in the GM view', () => {
  const d = generateDungeon({ seed: 'gm-view', doorChance: 1, secretDoorChance: 1 });
  assert.ok(d.doors.length > 0 && d.doors.every((o) => o.type === 'secret'));
  const numbers = d.rooms.map((r) => String(r.id + 1));

  const gm = drawnText(render(d, { gmView: true, ppg: 20 }).rec);
  for (const n of numbers) assert.ok(gm.includes(n), `room ${n} is numbered`);
  assert.equal(gm.filter((t) => t === 'S').length, d.doors.length, 'one S per secret door');

  assert.deepEqual(drawnText(render(d, { gmView: false, ppg: 20 }).rec), [], 'players see neither');

  const noLabels = drawnText(render(d, { gmView: true, showLabels: false, ppg: 20 }).rec);
  assert.deepEqual(noLabels, d.doors.map(() => 'S'), 'hiding labels keeps the secret-door marks');
});

test('grid lines are drawn only when the grid is on', () => {
  const d = busyMap('grid');
  const count = (showGrid: boolean): number => render(d, { theme: 'parchment', showGrid, ppg: 20 }).rec.calls.filter((c) => c.name === 'moveTo').length;
  assert.equal(count(true) - count(false), d.width + 1 + d.height + 1, 'one line per column and row edge');
});

test('every wall segment is stroked', () => {
  const d = busyMap('walls');
  const ppg = 20;
  const drawn = new Set(strokedSegments(render(d, { theme: 'parchment', ppg }).rec));
  for (const s of computeWalls(d)) assert.ok(drawn.has([s.x1, s.y1, s.x2, s.y2].map((v) => v * ppg).join(',')), `wall ${JSON.stringify(s)}`);
});

test('each window is drawn centred on its edge', () => {
  const d = busyMap('windows');
  const ppg = 20;
  const { rec } = render(d, { theme: 'stone', ppg });
  const centres = new Set(
    rec.calls.filter((c) => c.name === 'fillRect').map((c) => {
      const [x, y, w, h] = c.args as number[];
      return `${(x as number) + (w as number) / 2},${(y as number) + (h as number) / 2}`;
    }),
  );
  assert.ok(d.windows.length > 0);
  for (const w of d.windows) assert.ok(centres.has(`${((w.x1 + w.x2) / 2) * ppg},${((w.y1 + w.y2) / 2) * ppg}`), `window ${JSON.stringify(w)}`);
});

test('depth off and lights off draw exactly what the defaults draw', () => {
  const d = busyMap('off');
  for (const theme of Object.keys(THEMES) as ThemeKey[]) {
    assert.deepEqual(render(d, { theme, ppg: 20, depth: 'off', lighting: false }).rec.calls, render(d, { theme, ppg: 20 }).rec.calls, theme);
  }
});

test('every theme draws with strong depth and lighting, the same way every time', () => {
  for (const map of [busyMap('depth'), busyMap('depth-caves', 'caves')]) {
    for (const theme of Object.keys(THEMES) as ThemeKey[]) {
      const opts: RenderOptions = { theme, ppg: 24, depth: 'strong', lighting: true };
      assert.deepEqual(render(map, opts).rec.calls, render(map, opts).rec.calls, theme);
    }
  }
});

test('depth adds shadows that fall down-right, longer at Strong than Subtle', () => {
  const d = busyMap('depth-levels');
  const offsets = (depth: RenderOptions['depth']): number[] => recordedOffsets(d, depth);
  const subtle = Math.max(...offsets('subtle'));
  const strong = Math.max(...offsets('strong'));
  assert.ok(subtle > 0 && strong > subtle);
  assert.deepEqual(offsets('off'), [], 'no offset shadows without depth');
});

/** Every positive shadowOffsetX the renderer sets, in order. */
function recordedOffsets(d: ReturnType<typeof busyMap>, depth: RenderOptions['depth']): number[] {
  const offs: number[] = [];
  const { canvas, rec } = fakeCanvas();
  const ctx = rec.ctx as unknown as Record<string, unknown>;
  // Watch shadowOffsetX assignments as they happen.
  let current = 0;
  Object.defineProperty(ctx, 'shadowOffsetX', {
    get: () => current,
    set: (v: number) => {
      current = v;
      if (v > 0) offs.push(v);
    },
  });
  renderDungeon(canvas, d, { theme: 'stone', ppg: 20, depth });
  return offs;
}

test('lighting is added with the "lighter" blend, only when turned on', () => {
  const d = busyMap('lights');
  const blends = (lighting: boolean): unknown[] => {
    const { canvas, rec } = fakeCanvas();
    const seen: unknown[] = [];
    const ctx = rec.ctx as unknown as Record<string, unknown>;
    let mode: unknown = 'source-over';
    Object.defineProperty(ctx, 'globalCompositeOperation', { get: () => mode, set: (v) => { mode = v; seen.push(v); } });
    renderDungeon(canvas, d, { theme: 'gothic', ppg: 20, lighting });
    return seen;
  };
  assert.deepEqual(blends(false), []);
  assert.deepEqual(blends(true), ['lighter']);
});

test('lighting leaves a map with no light sources untouched', () => {
  const d = generateDungeon({ seed: 'dark', clutter: 0 });
  assert.equal(d.props.length, 0);
  assert.deepEqual(render(d, { ppg: 20, lighting: true }).rec.calls, render(d, { ppg: 20 }).rec.calls);
});

test('wall torches are drawn small, on their wall; free-standing lights draw nothing', () => {
  const d = createBlankDungeon({ seed: 'torch-draw', width: 16, height: 10 });
  paintRoom(d, { x: 2, y: 2 }, { x: 8, y: 6 }, {
    name: 'Hall', kind: 'empty', atmosphere: '', feature: 'a bare floor', monster: null, trap: null, special: null, treasure: null, note: null,
  });
  const plain = render(d, { ppg: 20 }).rec.calls;
  d.lights.push({ x: 4, y: 4, radius: 4, room: 0 });
  assert.deepEqual(render(d, { ppg: 20 }).rec.calls, plain, 'a free-standing light is only light');
  d.lights.push({ x: 5, y: 2, radius: 4, room: 0, wall: 3 });
  const calls = render(d, { ppg: 20 }).rec.calls;
  const arcs = calls.filter((c) => c.name === 'arc').slice(-2);
  assert.equal(arcs.length, 2, 'the flame and its heart');
  for (const a of arcs) {
    const [x, y, r] = a.args as number[];
    assert.ok(Math.abs((x as number) - 110) < 1e-9 && (y as number) > 40 && (y as number) < 50, 'just inside the top wall');
    assert.ok((r as number) < 20 * 0.1, 'smaller than a tenth of a square');
  }
  // The bracket starts on the wall line itself.
  assert.ok(calls.some((c) => c.name === 'moveTo' && c.args[0] === 110 && c.args[1] === 40));
});

test('frozen rooms wash blue and scorching rooms red, only when turned on', () => {
  const d = createBlankDungeon({ seed: 'tint', width: 24, height: 12 });
  const room = (atmosphere: string) => ({
    name: 'Chamber', kind: 'empty' as const, atmosphere, feature: 'a bare floor', monster: null, trap: null, special: null, treasure: null, note: null,
  });
  paintRoom(d, { x: 2, y: 3 }, { x: 7, y: 7 }, room('Frost rimes every metal surface.'));
  paintRoom(d, { x: 14, y: 3 }, { x: 19, y: 7 }, room('Heat radiates from the walls like an oven.'));
  paintCorridor(d, lineCells({ x: 8, y: 5 }, { x: 13, y: 5 }));
  assert.deepEqual(d.rooms.map((r) => r.environment), ['frost', 'heat']);
  assert.deepEqual(render(d, { ppg: 20, effects: false }).rec.calls, render(d, { ppg: 20 }).rec.calls, 'off by default');
  const on = render(d, { ppg: 20, effects: true }).rec;
  assert.deepEqual(render(d, { ppg: 20, effects: true }).rec.calls, on.calls, 'the same every time');
  const gradients = on.calls.filter((c) => c.name === 'createRadialGradient').length;
  assert.ok(gradients > 60, 'every square of both rooms, the corridor and each doorway');
  const colours = (on.styles as { stops?: [number, string][] }[]).flatMap((s) => s.stops ?? []).map(([, c]) => c);
  assert.ok(colours.some((c) => c.startsWith('rgba(61, 155, 255')), 'blue for frost');
  assert.ok(colours.some((c) => c.startsWith('rgba(255, 59, 31')), 'red for heat');
});

