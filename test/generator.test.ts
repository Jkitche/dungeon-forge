import { test } from 'node:test';
import { crc32 as zlibCrc32 } from 'node:zlib';
import assert from 'node:assert/strict';
import { generateDungeon, normalizeOptions, serializeDungeon, deserializeDungeon, isFloor, DIRS, ROOM, CORRIDOR, PILLAR } from '../src/renderer/generator.ts';
import type { Dungeon, DungeonOptions } from '../src/renderer/generator.ts';
import { computeWalls, computePillarOutlines } from '../src/renderer/walls.ts';
import { GENRES, GENRE_KEYS } from '../src/renderer/genres.ts';
import { buildZip, crc32 } from '../src/shared/zip.ts';
import { buildFguModule, buildFguOccluders, fguImageBaseName, fguModuleName, fguPointMapper, xmlText, buildFgcModule, fgcImagePaths, fgcModuleName, describeDoor } from '../src/renderer/export/fantasygrounds.ts';
import { isThemeKey } from '../src/renderer/renderer.ts';
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
  assert.equal(uvtt.portals.length, d.doors.length);
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
  assert.equal(scene.walls.length, computeWalls(d).length + pillars * 8 + d.doors.length);
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
