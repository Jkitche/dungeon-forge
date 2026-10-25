import { test } from 'node:test';
import { crc32 as zlibCrc32 } from 'node:zlib';
import assert from 'node:assert/strict';
import { generateDungeon, normalizeOptions, serializeDungeon, deserializeDungeon, isFloor, DIRS, ROCK, ROOM, CORRIDOR, PILLAR } from '../src/renderer/generator.ts';
import type { Dungeon, DungeonOptions, Room } from '../src/renderer/generator.ts';
import { canHaveDoor, canHaveWindow, toggleWindow, placeProp, removeProp, rotateProp, createBlankDungeon, cycleDoor, cycleStairs, edgeAt, eraseCells, lineCells, normalizeDungeon, paintCorridor, paintRoom, rectCells, restore, snapshot, stockNewRoom, togglePillar } from '../src/renderer/editor.ts';
import { RNG } from '../src/renderer/rng.ts';
import { PROP_RENDERERS } from '../src/renderer/props/index.ts';
import type { PropBox, PropPalette } from '../src/renderer/props/index.ts';
import { PROP_KINDS, PROP_SPECS, editorFree, fitProp, footprint, propAt, settingProps } from '../src/renderer/clutter.ts';
import { computeWalls, computePillarOutlines } from '../src/renderer/walls.ts';
import { GENRES, GENRE_KEYS } from '../src/renderer/genres.ts';
import { buildZip, crc32 } from '../src/shared/zip.ts';
import { buildFguModule, buildFguOccluders, fguImageBaseName, fguModuleName, fguPointMapper, xmlText, buildFgcModule, fgcImagePaths, fgcModuleName, describeDoor } from '../src/renderer/export/fantasygrounds.ts';
import { isThemeKey, isLook, LOOKS, resolveTheme } from '../src/renderer/renderer.ts';
import { buildUVTT } from '../src/renderer/export/uvtt.ts';
import { buildFoundryScene } from '../src/renderer/export/foundry.ts';
import { buildRoomKeyMarkdown } from '../src/renderer/export/roomkey.ts';
import { buildRoll20Notes } from '../src/renderer/export/roll20.ts';
import { EXPORTERS, createExportTarget } from '../src/renderer/export/index.ts';
import type { ExportContext, RenderRequest } from '../src/renderer/export/index.ts';
import { html } from '../src/renderer/text.ts';

function reachableFloor(d: Dungeon): number {
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

const floorCount = (d: Dungeon): number => d.cells.reduce((k, t) => k + (isFloor(t) ? 1 : 0), 0);

const variants: Partial<DungeonOptions>[] = [
  { algorithm: 'rooms' },
  { algorithm: 'rooms', corridorStyle: 'winding', loopChance: 1, roundRoomChance: 1 },
  { algorithm: 'rooms', width: 100, height: 80, roomCount: 40, pillarChance: 1 },
  { algorithm: 'rooms', width: 16, height: 16, roomCount: 30 },
  { algorithm: 'caves' },
  { algorithm: 'caves', width: 90, height: 60, caveFill: 0.55 },
  { algorithm: 'caves', width: 16, height: 16, caveFill: 0.6 },
];

test('same seed produces the same dungeon', () => {
  for (const v of variants) {
    const a = generateDungeon({ ...v, seed: 'determinism' });
    const b = generateDungeon({ ...v, seed: 'determinism' });
    assert.deepEqual(a.cells, b.cells);
    assert.deepEqual(a.doors, b.doors);
    assert.deepEqual(a.rooms, b.rooms);
  }
});

test('every floor cell is reachable from the entrance, across many seeds', () => {
  for (const v of variants) {
    for (let i = 0; i < 40; i++) {
      const d = generateDungeon({ ...v, seed: `conn-${i}` });
      assert.ok(d.rooms.length >= 1, 'has at least one room');
      assert.ok(d.stairs.length >= 1, 'has an entrance');
      assert.equal(reachableFloor(d), floorCount(d), `${JSON.stringify(v)} seed conn-${i}`);
      // The outer ring stays solid so the map is always enclosed.
      for (let x = 0; x < d.width; x++) {
        assert.ok(!isFloor(d.cells[x] as number) && !isFloor(d.cells[(d.height - 1) * d.width + x] as number));
      }
    }
  }
});

test('doors sit on an edge between a room cell and a corridor cell', () => {
  for (let i = 0; i < 30; i++) {
    const d = generateDungeon({ seed: `doors-${i}`, doorChance: 1 });
    for (const door of d.doors) {
      const len = Math.abs(door.x2 - door.x1) + Math.abs(door.y2 - door.y1);
      assert.equal(len, 1);
      const cellsAt: [number, number][] = door.y1 === door.y2
        ? [[door.x1, door.y1 - 1], [door.x1, door.y1]]
        : [[door.x1 - 1, door.y1], [door.x1, door.y1]];
      const types = cellsAt.map(([x, y]) => d.cells[y * d.width + x]).sort();
      assert.deepEqual(types, [ROOM, CORRIDOR]);
    }
  }
});

test('walls never cross a door opening', () => {
  const d = generateDungeon({ seed: 'walls', doorChance: 1 });
  const walls = computeWalls(d);
  for (const door of d.doors) {
    const overlap = walls.some((w) =>
      door.y1 === door.y2
        ? w.y1 === w.y2 && w.y1 === door.y1 && w.x1 < door.x2 && w.x2 > door.x1
        : w.x1 === w.x2 && w.x1 === door.x1 && w.y1 < door.y2 && w.y2 > door.y1,
    );
    assert.ok(!overlap);
  }
});

test('exports have the expected shape', () => {
  const d = generateDungeon({ seed: 'export', secretDoorChance: 0.3, lockedDoorChance: 0.3 });
  const uvtt = buildUVTT(d, 100, 'AAAA');
  assert.equal(uvtt.format, 0.3);
  assert.deepEqual(uvtt.resolution.map_size, { x: d.width, y: d.height });
  assert.equal(uvtt.portals.length, d.doors.length + d.windows.length);
  assert.ok(uvtt.line_of_sight.length > 0);

  const scene = buildFoundryScene(d, 100, 'dungeons/x.png', 'Test');
  assert.equal(scene.width, d.width * 100);
  assert.equal(scene.grid.size, 100);
  const doorWalls = scene.walls.filter((w) => w.door > 0);
  assert.equal(doorWalls.length, d.doors.length);
  assert.equal(scene.walls.filter((w) => w.door === 2).length, d.doors.filter((o) => o.type === 'secret').length);
  assert.equal(new Set(scene.walls.map((w) => w._id)).size, scene.walls.length);
  for (const w of scene.walls) assert.match(w._id, /^[A-Za-z0-9]{16}$/);

  const md = buildRoomKeyMarkdown(d);
  for (const r of d.rooms) assert.ok(md.includes(`## ${r.id + 1}. `));
  assert.ok(buildRoll20Notes(d, 70, 'x.png', false).includes(`${d.width * 70} × ${d.height * 70} px`));
});

test('pillars become line-of-sight outlines, not room walls', () => {
  const d = generateDungeon({ seed: 'pillars', width: 100, height: 80, roomCount: 40, roomMin: 8, roomMax: 14, pillarChance: 1 });
  const pillars = d.cells.filter((t) => t === PILLAR).length;
  assert.ok(pillars > 0);
  assert.equal(computePillarOutlines(d).length, pillars);
  assert.equal(buildUVTT(d, 100, '').objects_line_of_sight.length, pillars);
  const scene = buildFoundryScene(d, 100, 'x.png', 'X');
  assert.equal(scene.walls.length, computeWalls(d, d.windows).length + pillars * 8 + d.doors.length + d.windows.length);
});

test('project files round-trip', () => {
  const d = generateDungeon({ seed: 'roundtrip', algorithm: 'caves' });
  const back = deserializeDungeon(JSON.parse(JSON.stringify(serializeDungeon(d))));
  assert.deepEqual(back.cells, d.cells);
  assert.deepEqual(back.roomIds, d.roomIds);
  assert.deepEqual(back.rooms, d.rooms);
  assert.throws(() => deserializeDungeon({ cells: '00', roomIds: [], width: 5, height: 5 }));
});

test('every genre has complete tables and a real theme', () => {
  for (const key of GENRE_KEYS) {
    const g = GENRES[key];
    assert.ok(isThemeKey(g.theme), `${key} theme`);
    for (const table of [g.roomNames, g.caveNames, g.atmospheres, g.features, g.monsters, g.traps, g.specials, g.treasures]) {
      assert.ok(table.length >= 8, `${key} table too small`);
      assert.equal(new Set(table).size, table.length, `${key} table has duplicates`);
    }
  }
});

test('genre changes the contents but not the floor plan', () => {
  for (const algorithm of ['rooms', 'caves'] as const) {
    const base = generateDungeon({ seed: 'genre-layout', algorithm, genre: 'fantasy' });
    for (const genre of GENRE_KEYS) {
      const d = generateDungeon({ seed: 'genre-layout', algorithm, genre });
      assert.deepEqual(d.cells, base.cells);
      assert.deepEqual(d.doors, base.doors);
      const g = GENRES[genre];
      const names = new Set([...(algorithm === 'caves' ? g.caveNames : g.roomNames), g.entranceName, g.exitName]);
      for (const r of d.rooms) {
        const c = r.contents;
        assert.ok(c && names.has(c.name), `${genre}: unexpected room name ${c?.name}`);
        assert.ok(g.atmospheres.includes(c.atmosphere));
        if (c.monster) assert.ok(g.monsters.includes(c.monster));
        if (c.treasure) assert.ok(g.treasures.includes(c.treasure));
      }
      assert.ok(buildRoomKeyMarkdown(d).includes(g.label));
    }
  }
});

test('unknown or missing genre falls back to fantasy', () => {
  assert.equal(normalizeOptions({ genre: 'cyberpunk' as never }).genre, 'fantasy');
  assert.equal(normalizeOptions({}).genre, 'fantasy');
});

// Reads a stored (uncompressed) zip back via its central directory.
function readZip(zip: Uint8Array): Map<string, Uint8Array> {
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

test('zip writer produces a valid archive', () => {
  const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 250]);
  const files = readZip(buildZip([{ path: 'a.txt', data: 'héllo' }, { path: 'images/b.png', data: png }]));
  assert.equal(new TextDecoder().decode(files.get('a.txt')), 'héllo');
  assert.deepEqual(files.get('images/b.png'), png);
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('Fantasy Grounds module contains the map, its LoS sidecar and a definition', () => {
  const d = generateDungeon({ seed: 'fgu', width: 40, height: 30, doorChance: 1, secretDoorChance: 0.3, pillarChance: 1, roomMin: 7, roomMax: 12 });
  const ppg = 100;
  const files = readZip(buildFguModule(d, ppg, new Uint8Array([1, 2, 3]), new Uint8Array([4])));
  const base = fguImageBaseName(d);
  assert.deepEqual([...files.keys()].sort(), ['definition.xml', `images/${base}.png`, `images/${base}.xml`, 'thumbnail.png'].sort());

  const def = new TextDecoder().decode(files.get('definition.xml'));
  assert.match(def, /<ruleset>Any<\/ruleset>/);
  assert.match(def, new RegExp(`<name>${fguModuleName(d)}</name>`));

  const xml = new TextDecoder().decode(files.get(`images/${base}.xml`));
  assert.match(xml, /<gridsize>100,100<\/gridsize>/);
  const occluders = buildFguOccluders(d, ppg);
  assert.equal((xml.match(/<occluder>/g) ?? []).length, occluders.length);
  assert.equal(occluders.filter((o) => o.flags.includes('toggleable')).length, d.doors.length);
  // Pixel space centred on the image with y up: every point lies within ±half the image.
  for (const o of occluders) {
    for (const [x, y] of o.points) {
      assert.ok(Math.abs(x) <= (d.width * ppg) / 2 + 1e-9 && Math.abs(y) <= (d.height * ppg) / 2 + 1e-9);
    }
  }
});

test('Fantasy Grounds coordinates are centred with y pointing up', () => {
  const d = generateDungeon({ seed: 'fgu-coords', width: 20, height: 16 });
  const map = fguPointMapper(d, 50);
  assert.deepEqual(map({ x: 0, y: 0 }), [-500, 400]);
  assert.deepEqual(map({ x: 20, y: 16 }), [500, -400]);
  assert.deepEqual(map({ x: 10, y: 8 }), [0, 0]);
});

test('XML text escaping handles markup and non-ASCII seeds', () => {
  assert.equal(xmlText('<a & "b">'), '&lt;a &amp; &quot;b&quot;&gt;');
  assert.equal(xmlText('café'), 'caf&#233;');
});

test('Fantasy Grounds Classic module has both maps and one story entry per room', () => {
  const d = generateDungeon({ seed: 'fgc & <friends>', genre: 'horror', secretDoorChance: 0.4, doorChance: 1 });
  const files = readZip(buildFgcModule(d, 50, { player: new Uint8Array([1]), gm: new Uint8Array([2]), thumbnail: new Uint8Array([3]) }));
  const paths = fgcImagePaths(d);
  assert.deepEqual([...files.keys()].sort(), ['db.xml', 'definition.xml', paths.gm, paths.player, 'thumbnail.png'].sort());

  const db = new TextDecoder('latin1').decode(files.get('db.xml'));
  // Every bitmap path in db.xml points at a file in the archive.
  const bitmaps = [...db.matchAll(/<bitmap>([^<]+)<\/bitmap>/g)].map((m) => m[1]);
  assert.deepEqual(bitmaps.sort(), [paths.gm, paths.player].sort());
  // Overview plus one formatted-text story entry per room.
  assert.equal((db.match(/<text type="formattedtext">/g) ?? []).length, d.rooms.length + 1);
  // Seed text is escaped, never raw markup.
  assert.ok(db.includes('fgc &amp; &lt;friends&gt;') && !db.includes('<friends>'));
  // Pure ASCII, so the ISO-8859-1 declaration is always accurate.
  assert.ok(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(db));
  const def = new TextDecoder().decode(files.get('definition.xml'));
  assert.match(def, /<root version="3.3">/);
  // Distinct from the Unity module so both can be loaded in the same FG install.
  assert.ok(def.includes(`<name>${fgcModuleName(d)}</name>`) && fgcModuleName(d) !== fguModuleName(d));
  for (const door of d.doors.filter((o) => o.type === 'secret')) assert.ok(db.includes(xmlText(describeDoor(d, door))));
});

// ---------------------------------------------------------------------------
// Export strategies, run headless with a fake renderer.

function fakeContext(d: Dungeon, overrides: Partial<ExportContext> = {}): ExportContext & { renders: RenderRequest[] } {
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

test('export registry: unique ids, sensible metadata', () => {
  const ids = EXPORTERS.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
  // Suggested file names never collide, so exporting several formats doesn't overwrite files.
  const names = EXPORTERS.map((e) => `${e.nameTag ?? ''}${e.extension}`);
  assert.equal(new Set(names).size, names.length, names.join(' '));
  for (const e of EXPORTERS) {
    assert.match(e.extension, /^\.[a-z0-9.]+$/, e.id);
    assert.ok(e.label && e.description && e.fileType, e.id);
    if (e.image) assert.ok(e.image.defaultPpg >= 20 && e.image.defaultPpg <= 400, e.id);
  }
});

test('every export strategy writes only next to the chosen save location', async () => {
  const d = generateDungeon({ seed: 'strategy', secretDoorChance: 0.3, doorChance: 1 });
  for (const e of EXPORTERS) {
    const ctx = fakeContext(d);
    const result = await e.run(ctx, createExportTarget('/maps/my-dungeon'));
    assert.ok(result.files.length > 0, e.id);
    assert.equal(result.files[0]?.path, `/maps/my-dungeon${e.extension}`, `${e.id}: primary file first`);
    for (const f of result.files) assert.ok(f.path.startsWith('/maps/my-dungeon.'), `${e.id}: ${f.path}`);
    assert.equal(new Set(result.files.map((f) => f.path)).size, result.files.length, `${e.id}: duplicate paths`);
    assert.ok(result.summary.value.length > 0, e.id);
    // Formats without an image never render one.
    if (!e.image) assert.equal(ctx.renders.length, 0, e.id);
  }
});

test('strategies escape user-controlled names in their summaries', async () => {
  const d = generateDungeon({ seed: 'escape' });
  for (const e of EXPORTERS) {
    const result = await e.run(fakeContext(d), createExportTarget('/tmp/<b>bad</b>'));
    assert.ok(!result.summary.value.includes('<b>bad</b>'), e.id);
  }
});

test('Classic always renders both views; Unity follows the dialog', async () => {
  const d = generateDungeon({ seed: 'views' });
  const byId = (id: string) => EXPORTERS.find((e) => e.id === id)!;
  const fgc = fakeContext(d);
  await byId('fgc').run(fgc, createExportTarget('/x/a'));
  assert.deepEqual(fgc.renders.map((r) => r.gmView), [false, true, false]);
  const fgu = fakeContext(d, { gmView: true });
  await byId('fgu').run(fgu, createExportTarget('/x/a'));
  assert.equal(fgu.renders[0]?.gmView, undefined, 'main map uses the dialog choice');
});

test('html template escapes values but keeps nested SafeHtml', () => {
  const inner = html`<b>${'x&y'}</b>`;
  assert.equal(html`<p>${'<i>'}${inner}${[1, ' & ', 2]}</p>`.value, '<p>&lt;i&gt;<b>x&amp;y</b>1 &amp; 2</p>');
});

// ---------------------------------------------------------------------------
// Map editor

/** Everything the renderer, room key and exporters rely on after an edit. */
function assertConsistent(d: Dungeon, label: string): void {
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
}

test('normalizing a freshly generated dungeon changes nothing', () => {
  for (const v of variants) {
    const d = generateDungeon({ ...v, seed: 'normalize' });
    const before = structuredClone({ rooms: d.rooms, doors: d.doors, stairs: d.stairs, roomIds: d.roomIds, windows: d.windows, props: d.props });
    normalizeDungeon(d);
    assert.deepEqual({ rooms: d.rooms, doors: d.doors, stairs: d.stairs, roomIds: d.roomIds, windows: d.windows, props: d.props }, before, JSON.stringify(v));
  }
});

test('drawing rooms, corridors, doors and stairs on a blank map', () => {
  const d = createBlankDungeon({ seed: 'blank', width: 30, height: 20 });
  assert.equal(d.rooms.length, 0);
  assert.ok(d.edited);
  const contents = stockNewRoom(d, new RNG('stock'));
  assert.ok(paintRoom(d, { x: 2, y: 2 }, { x: 7, y: 6 }, contents));
  assert.ok(paintRoom(d, { x: 20, y: 10 }, { x: 15, y: 14 }, stockNewRoom(d, new RNG('stock2'))));
  assert.equal(d.rooms.length, 2);
  assert.deepEqual([d.rooms[0]?.w, d.rooms[0]?.h, d.rooms[1]?.x, d.rooms[1]?.y], [6, 5, 15, 10]);
  assert.notEqual(d.rooms[0]?.contents?.name, d.rooms[1]?.contents?.name, 'new rooms avoid duplicate names');

  // Corridor from room 1's east wall to room 2, with a door where it leaves room 1.
  assert.ok(paintCorridor(d, [...lineCells({ x: 8, y: 4 }, { x: 11, y: 4 }), ...lineCells({ x: 11, y: 5 }, { x: 11, y: 11 }), ...lineCells({ x: 12, y: 11 }, { x: 14, y: 11 })]));
  assert.ok(cycleDoor(d, edgeAt(7.98, 4.5)));
  assert.equal(d.doors[0]?.type, 'normal');
  assert.equal(d.rooms[0]?.doorCount, 1);
  cycleDoor(d, edgeAt(7.98, 4.5));
  cycleDoor(d, edgeAt(7.98, 4.5));
  assert.equal(d.doors[0]?.type, 'secret');
  cycleDoor(d, edgeAt(7.98, 4.5));
  assert.equal(d.doors.length, 0, 'fourth click removes the door');
  assert.ok(!cycleDoor(d, edgeAt(1.02, 4.5)), 'no door on the outer wall');

  assert.ok(cycleStairs(d, { x: 3, y: 3 }));
  assert.ok(d.rooms[0]?.entrance);
  cycleStairs(d, { x: 3, y: 3 });
  assert.ok(d.rooms[0]?.exit && !d.rooms[0]?.entrance);

  // The whole floor plan is connected, so the existing exporters can trust it.
  assert.equal(reachableFloor(d), floorCount(d));
  assertConsistent(d, 'blank');
  assert.ok(buildFoundryScene(d, 100, 'x.png', 'X').walls.length > 0);
});

test('drawing over and erasing rooms keeps the room list consistent', () => {
  const d = createBlankDungeon({ seed: 'overlap', width: 30, height: 20 });
  paintRoom(d, { x: 2, y: 2 }, { x: 9, y: 9 }, stockNewRoom(d, new RNG(1)));
  paintRoom(d, { x: 6, y: 6 }, { x: 14, y: 12 }, stockNewRoom(d, new RNG(2)));
  assert.equal(d.rooms[0]?.shape, 'irregular', 'first room lost a corner');
  assert.equal(d.rooms[1]?.shape, 'rect');
  // Pillar inside the first room keeps its room membership.
  assert.ok(togglePillar(d, { x: 3, y: 3 }));
  assert.equal(d.roomIds[3 * d.width + 3], 0);
  // Covering the first room completely removes it and renumbers the second.
  paintRoom(d, { x: 1, y: 1 }, { x: 10, y: 10 }, stockNewRoom(d, new RNG(3)));
  assert.equal(d.rooms.length, 2);
  assertConsistent(d, 'covered');
  // Erasing the label square moves the label to another square of the room.
  const r = d.rooms[0] as Room;
  eraseCells(d, [{ x: r.cx, y: r.cy }]);
  assertConsistent(d, 'label moved');
  assert.ok(eraseCells(d, rectCells(d, { x: 0, y: 0 }, { x: 29, y: 19 })));
  assert.equal(d.rooms.length, 0);
  assertConsistent(d, 'erased');
});

test('random edits on generated maps never leave the dungeon inconsistent', () => {
  const rng = new RNG('fuzz');
  for (const v of variants) {
    const d = generateDungeon({ ...v, seed: 'fuzz' });
    for (let i = 0; i < 300; i++) {
      const a = { x: rng.int(-2, d.width + 1), y: rng.int(-2, d.height + 1) };
      const b = { x: a.x + rng.int(-6, 6), y: a.y + rng.int(-6, 6) };
      switch (rng.int(0, 6)) {
        case 0: paintRoom(d, a, b, stockNewRoom(d, rng)); break;
        case 1: paintCorridor(d, lineCells(a, b)); break;
        case 2: eraseCells(d, lineCells(a, b)); break;
        case 3: cycleDoor(d, edgeAt(a.x + rng.float(), a.y + rng.float())); break;
        case 4: togglePillar(d, a); break;
        case 5: {
          const k = rng.int(0, 2);
          if (k === 0) placeProp(d, a, rng.pick(PROP_KINDS));
          else if (k === 1) rotateProp(d, a);
          else removeProp(d, a);
          break;
        }
        default: cycleStairs(d, a);
      }
    }
    assertConsistent(d, JSON.stringify(v));
    // Exports still work on the edited map.
    buildUVTT(d, 50, '');
    buildFguModule(d, 50, new Uint8Array(1), new Uint8Array(1));
    buildRoomKeyMarkdown(d);
  }
});

test('undo snapshots restore the exact previous map', () => {
  const d = generateDungeon({ seed: 'undo' });
  const before = snapshot(d);
  const original = structuredClone({ cells: d.cells, roomIds: d.roomIds, rooms: d.rooms, doors: d.doors, stairs: d.stairs });
  eraseCells(d, rectCells(d, { x: 0, y: 0 }, { x: 20, y: 20 }));
  restore(d, before);
  assert.deepEqual({ cells: d.cells, roomIds: d.roomIds, rooms: d.rooms, doors: d.doors, stairs: d.stairs }, original);
  assert.ok(!d.edited);
});

test('4-connected lines have no diagonal steps', () => {
  for (const [a, b] of [[{ x: 0, y: 0 }, { x: 7, y: 3 }], [{ x: 5, y: 5 }, { x: -2, y: 9 }], [{ x: 3, y: 3 }, { x: 3, y: 3 }]] as const) {
    const line = lineCells(a, b);
    assert.deepEqual(line[0], a);
    assert.deepEqual(line[line.length - 1], b);
    for (let i = 1; i < line.length; i++) {
      const p = line[i - 1] as { x: number; y: number };
      const q = line[i] as { x: number; y: number };
      assert.equal(Math.abs(p.x - q.x) + Math.abs(p.y - q.y), 1);
    }
  }
});

// ---------------------------------------------------------------------------
// Windows

const unitLength = (segs: { x1: number; y1: number; x2: number; y2: number }[]): number =>
  segs.reduce((n, s) => n + Math.abs(s.x2 - s.x1) + Math.abs(s.y2 - s.y1), 0);

test('generated windows sit in room walls facing rock, away from doors', () => {
  let total = 0;
  for (let i = 0; i < 30; i++) {
    const d = generateDungeon({ seed: `windows-${i}`, windowChance: 1, doorChance: 1 });
    total += d.windows.length;
    for (const w of d.windows) {
      assert.ok(canHaveWindow(d, w), 'floor on one side, rock on the other');
      assert.ok(w.room >= 0 && w.room < d.rooms.length);
      for (const o of d.doors) {
        assert.ok(Math.abs(o.x1 + o.x2 - w.x1 - w.x2) / 2 + Math.abs(o.y1 + o.y2 - w.y1 - w.y2) / 2 >= 2, 'not beside a door');
      }
    }
    assert.equal(new Set(d.windows.map((w) => `${w.x1},${w.y1},${w.x2},${w.y2}`)).size, d.windows.length, 'no duplicates');
  }
  assert.ok(total > 100, `windows were placed (${total})`);
  assert.equal(generateDungeon({ seed: 'no-windows', windowChance: 0 }).windows.length, 0);
  assert.equal(generateDungeon({ seed: 'cave-windows', algorithm: 'caves', windowChance: 1 }).windows.length, 0, 'caverns have none');
});

test('windows never change the floor plan or room contents a seed produces', () => {
  for (const genre of GENRE_KEYS) {
    const without = generateDungeon({ seed: 'window-stream', genre, windowChance: 0 });
    const withWindows = generateDungeon({ seed: 'window-stream', genre, windowChance: 1 });
    assert.ok(withWindows.windows.length > 0);
    assert.deepEqual(withWindows.cells, without.cells);
    assert.deepEqual(withWindows.doors, without.doors);
    assert.deepEqual(withWindows.rooms, without.rooms, `${genre}: same rooms and contents`);
  }
});

test('walls are split exactly around windows, and every export represents them', () => {
  const d = generateDungeon({ seed: 'window-export', windowChance: 1 });
  assert.ok(d.windows.length > 0);
  assert.equal(unitLength(computeWalls(d, d.windows)) + d.windows.length, unitLength(computeWalls(d)));

  const uvtt = buildUVTT(d, 100, '');
  assert.equal(uvtt.portals.filter((p) => !p.closed).length, d.windows.length, 'UVTT: open portals');
  assert.equal(uvtt.portals.filter((p) => p.closed).length, d.doors.length);

  const scene = buildFoundryScene(d, 100, 'x.png', 'X');
  const windows = scene.walls.filter((w) => w.sight === 0);
  assert.equal(windows.length, d.windows.length, 'Foundry: see-through walls');
  for (const w of windows) assert.deepEqual([w.move, w.light, w.door], [20, 0, 0]);

  const occ = buildFguOccluders(d, 100);
  assert.equal(occ.filter((o) => o.flags.includes('allow_vision')).length, d.windows.length, 'FGU: allow_vision');
});

test('window tool and edits keep windows on real walls', () => {
  const d = createBlankDungeon({ seed: 'window-edit', width: 30, height: 20 });
  paintRoom(d, { x: 5, y: 5 }, { x: 10, y: 9 }, stockNewRoom(d, new RNG('w')));
  const north = edgeAt(7.5, 5.02);
  assert.ok(toggleWindow(d, north));
  assert.equal(d.windows[0]?.room, 0);
  assert.ok(!toggleWindow(d, edgeAt(7.5, 7.02)), 'no window between two floor squares');
  // Digging a corridor behind the window turns its wall into an opening, so the window goes.
  paintCorridor(d, [{ x: 7, y: 4 }]);
  assert.equal(d.windows.length, 0);
  assertConsistent(d, 'window edit');
  eraseCells(d, [{ x: 7, y: 4 }]);
  toggleWindow(d, north);
  assert.ok(toggleWindow(d, north), 'second click removes it');
  assert.equal(d.windows.length, 0);
});

test('maps saved before windows existed still open', () => {
  const d = generateDungeon({ seed: 'old-save' });
  const saved = JSON.parse(JSON.stringify(serializeDungeon(d)));
  delete saved.windows;
  assert.deepEqual(deserializeDungeon(saved).windows, []);
});

// ---------------------------------------------------------------------------
// Clutter

test('props sit on their room floor, never overlap, and keep entrances clear', () => {
  let total = 0;
  for (const v of variants) {
    for (let i = 0; i < 10; i++) {
      const d = generateDungeon({ ...v, seed: `clutter-${i}`, clutter: 1 });
      total += d.props.length;
      const W = d.width;
      const covered = new Set<number>();
      const labels = new Set(d.rooms.map((r) => r.cy * W + r.cx));
      const stairs = new Set(d.stairs.map((st) => st.y * W + st.x));
      const doorSides = new Set(d.doors.flatMap((o) => [o.y1 * W + o.x1, o.y1 === o.y2 ? (o.y1 - 1) * W + o.x1 : o.y1 * W + o.x1 - 1]));
      for (const p of d.props) {
        for (const f of footprint(p)) {
          const c = f.y * W + f.x;
          assert.equal(d.cells[c], ROOM, 'on room floor');
          assert.equal(d.roomIds[c], p.room, 'inside its own room');
          assert.ok(!covered.has(c), 'no overlap');
          covered.add(c);
          assert.ok(!labels.has(c) && !stairs.has(c) && !doorSides.has(c), 'labels, stairs and doorways stay clear');
          assert.ok(DIRS.every(([dx, dy]) => d.cells[c + dy * W + dx] !== CORRIDOR), 'corridor openings stay clear');
          if (PROP_SPECS[p.kind].place === 'wall') {
            assert.ok(DIRS.some(([dx, dy]) => d.cells[c + dy * W + dx] === ROCK), `${p.kind} stands against a wall`);
          }
        }
      }
    }
  }
  assert.ok(total > 300, `props were placed (${total})`);
});

test('clutter never changes the floor plan or room contents a seed produces', () => {
  for (const v of variants) {
    const none = generateDungeon({ ...v, seed: 'clutter-stream', clutter: 0 });
    const full = generateDungeon({ ...v, seed: 'clutter-stream', clutter: 1 });
    assert.equal(none.props.length, 0);
    assert.deepEqual(full.cells, none.cells);
    assert.deepEqual(full.doors, none.doors);
    assert.deepEqual(full.windows, none.windows);
    assert.deepEqual(full.rooms, none.rooms, JSON.stringify(v));
  }
});

test('room names and settings steer the props', () => {
  const kindsIn = (genre: DungeonOptions['genre'], match: RegExp): Map<string, number> => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 60; i++) {
      const d = generateDungeon({ seed: `steer-${i}`, genre, clutter: 1, roomCount: 20 });
      for (const p of d.props) {
        if (!match.test(d.rooms[p.room]?.contents?.name ?? '')) continue;
        counts.set(p.kind, (counts.get(p.kind) ?? 0) + 1);
      }
    }
    return counts;
  };
  const crypts = kindsIn('fantasy', /Crypt|Ossuary/);
  assert.ok((crypts.get('coffin') ?? 0) > 0, 'fantasy crypts get coffins, which other fantasy rooms never do');
  assert.equal(kindsIn('fantasy', /./).get('console') ?? 0, 0, 'no consoles in fantasy');
  assert.equal(kindsIn('scifi', /./).get('coffin') ?? 0, 0, 'no coffins in sci-fi');
  const libraries = kindsIn('fantasy', /Library|Scriptorium/);
  const all = kindsIn('fantasy', /./);
  const share = (m: Map<string, number>, k: string): number => (m.get(k) ?? 0) / [...m.values()].reduce((a, b) => a + b, 0);
  assert.ok(share(libraries, 'shelf') > share(all, 'shelf') * 1.5, 'libraries are heavier on shelves');
});

test('clutter tool places exactly the chosen prop, turns it, and removes it', () => {
  const d = createBlankDungeon({ seed: 'clutter-edit', width: 30, height: 20 });
  paintRoom(d, { x: 4, y: 4 }, { x: 12, y: 10 }, stockNewRoom(d, new RNG('c')));

  // Against the west wall a bed runs along the wall (vertically); mid-room it lies horizontally.
  assert.ok(placeProp(d, { x: 4, y: 6 }, 'bed'));
  assert.deepEqual(d.props[0], { x: 4, y: 6, kind: 'bed', vertical: true, room: 0 });
  assert.ok(placeProp(d, { x: 8, y: 7 }, 'bed'), 'the editor lets beds go anywhere');
  assert.deepEqual(d.props[1], { x: 8, y: 7, kind: 'bed', vertical: false, room: 0 });
  assert.ok(!placeProp(d, { x: 4, y: 7 }, 'crate'), 'no stacking on another prop');

  // Same click, same result: placement is predictable.
  const twin = createBlankDungeon({ seed: 'other', width: 30, height: 20 });
  paintRoom(twin, { x: 4, y: 4 }, { x: 12, y: 10 }, stockNewRoom(twin, new RNG('c')));
  placeProp(twin, { x: 4, y: 6 }, 'bed');
  placeProp(twin, { x: 8, y: 7 }, 'bed');
  assert.deepEqual(twin.props, d.props);

  // Turning keeps the clicked square covered; clicking the far end still works.
  assert.ok(rotateProp(d, { x: 9, y: 7 }));
  assert.ok(footprint(d.props[1] as never).some((f) => f.x === 9 && f.y === 7));
  assert.equal(d.props[1]?.vertical, true);
  assert.ok(!rotateProp(d, { x: 6, y: 9 }), 'nothing to turn on an empty square');
  placeProp(d, { x: 11, y: 9 }, 'barrel');
  assert.ok(!rotateProp(d, { x: 11, y: 9 }), 'one-square props do not turn');

  assert.ok(removeProp(d, { x: 4, y: 7 }), 'clicking either square removes it');
  assert.equal(propAt(d, 4, 6), -1);

  // Stairs win over clutter, and erasing the floor removes the prop.
  cycleStairs(d, { x: 11, y: 9 });
  assert.equal(propAt(d, 11, 9), -1);
  const bed = d.props[0];
  assert.ok(bed);
  eraseCells(d, footprint(bed));
  assert.equal(d.props.length, 0);
  assertConsistent(d, 'clutter edit');
});

test('every prop can be placed from the editor somewhere in an open room', () => {
  for (const kind of PROP_KINDS) {
    const d = createBlankDungeon({ seed: `place-${kind}`, width: 20, height: 16 });
    paintRoom(d, { x: 3, y: 3 }, { x: 10, y: 9 }, stockNewRoom(d, new RNG(kind)));
    assert.ok(placeProp(d, { x: 6, y: 6 }, kind), kind);
    assert.ok(fitProp(d, kind, { x: 3, y: 3 }, editorFree(d)), `${kind} fits a corner too`);
  }
  assert.ok(settingProps('scifi').includes('pod') && !settingProps('fantasy').includes('pod'));
});

test('maps saved before clutter existed still open', () => {
  const saved = JSON.parse(JSON.stringify(serializeDungeon(generateDungeon({ seed: 'old-clutter' }))));
  delete saved.props;
  assert.deepEqual(deserializeDungeon(saved).props, []);
});

test('the Look follows the setting unless Blueprint or Dark Stone is chosen', () => {
  for (const key of GENRE_KEYS) {
    const theme = GENRES[key].theme;
    assert.equal(resolveTheme('setting', theme), theme);
    assert.equal(resolveTheme('blueprint', theme), 'blueprint');
    assert.equal(resolveTheme('stone', theme), 'stone');
  }
  for (const [look] of LOOKS) assert.ok(isThemeKey(resolveTheme(look, 'parchment')));
  assert.ok(!isLook('parchment'), 'setting themes are not separate looks');
});

// ---------------------------------------------------------------------------
// Prop renderers, drawn onto a fake canvas that records every call.

interface Recording {
  ctx: CanvasRenderingContext2D;
  calls: { name: string; args: unknown[] }[];
  styles: unknown[];
}

function recordingContext(): Recording {
  const calls: Recording['calls'] = [];
  const styles: unknown[] = [];
  const state: Record<string, unknown> = {};
  const ctx = new Proxy(state, {
    get(_t, prop: string) {
      if (prop in state) return state[prop];
      if (prop === 'createRadialGradient') return () => ({ gradient: true, addColorStop: () => {} });
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
function touchedPoints(calls: Recording['calls']): [number, number][] {
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

const TEST_PALETTE: PropPalette = {
  wood: '#a07040', metal: '#808890', cloth: '#803030', stone: '#909088', line: '#101010', glow: '#ffb040', paper: '#f0e8d0',
};

test('prop registry has one renderer per kind, under its own key', () => {
  assert.deepEqual(Object.keys(PROP_RENDERERS).sort(), [...PROP_KINDS].sort());
  for (const [kind, r] of Object.entries(PROP_RENDERERS)) assert.equal(r.kind, kind);
});

test('each prop draws inside its footprint, in palette colours, the same way every time', () => {
  const ppg = 50;
  for (const kind of PROP_KINDS) {
    for (const vertical of [false, true]) {
      const long = PROP_SPECS[kind].long;
      // Away from the origin, so a renderer that ignores the box position is caught.
      const box: PropBox = { x: 700, y: 400, w: (long && !vertical ? 2 : 1) * ppg, h: (long && vertical ? 2 : 1) * ppg, vertical };
      const draw = (): Recording => {
        const rec = recordingContext();
        PROP_RENDERERS[kind].draw({ ctx: rec.ctx, ppg, palette: TEST_PALETTE, rng: new RNG(`prop:${kind}`) }, box);
        return rec;
      };
      const rec = draw();
      const label = `${kind}${vertical ? ' (vertical)' : ''}`;
      assert.ok(rec.calls.length > 0, `${label} draws something`);

      // Glows may spill a square past the footprint; nothing else should.
      for (const [x, y] of touchedPoints(rec.calls)) {
        assert.ok(x >= box.x - ppg && x <= box.x + box.w + ppg && y >= box.y - ppg && y <= box.y + box.h + ppg, `${label} draws at (${x}, ${y})`);
      }
      const pts = touchedPoints(rec.calls.filter((c) => c.name !== 'fillRect'));
      assert.ok(pts.every(([x, y]) => x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h), `${label} shapes stay in the footprint`);

      const colours = new Set(Object.values(TEST_PALETTE));
      for (const s of rec.styles) assert.ok(typeof s !== 'string' || colours.has(s), `${label} uses a colour outside the palette: ${String(s)}`);

      assert.deepEqual(draw().calls, rec.calls, `${label} is deterministic`);
    }
  }
});
