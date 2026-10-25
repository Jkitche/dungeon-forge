// Dungeon generation: determinism, connectivity, doors, windows and saved-map compatibility.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canHaveWindow } from '../src/renderer/editor.ts';
import { CORRIDOR, deserializeDungeon, doorSummary, generateDungeon, isFloor, normalizeOptions, ROOM, serializeDungeon } from '../src/renderer/generator.ts';
import { GENRE_KEYS } from '../src/renderer/genres.ts';
import { reachableFloor, floorCount, variants } from './helpers.ts';

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

test('project files round-trip', () => {
  const d = generateDungeon({ seed: 'roundtrip', algorithm: 'caves' });
  const back = deserializeDungeon(JSON.parse(JSON.stringify(serializeDungeon(d))));
  assert.deepEqual(back.cells, d.cells);
  assert.deepEqual(back.roomIds, d.roomIds);
  assert.deepEqual(back.rooms, d.rooms);
  assert.throws(() => deserializeDungeon({ cells: '00', roomIds: [], width: 5, height: 5 }));
});

test('unknown or missing genre falls back to fantasy', () => {
  assert.equal(normalizeOptions({ genre: 'cyberpunk' as never }).genre, 'fantasy');
  assert.equal(normalizeOptions({}).genre, 'fantasy');
});

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

test('maps saved before windows existed still open', () => {
  const d = generateDungeon({ seed: 'old-save' });
  const saved = JSON.parse(JSON.stringify(serializeDungeon(d)));
  delete saved.windows;
  assert.deepEqual(deserializeDungeon(saved).windows, []);
});

test('maps saved before clutter existed still open', () => {
  const saved = JSON.parse(JSON.stringify(serializeDungeon(generateDungeon({ seed: 'old-clutter' }))));
  delete saved.props;
  assert.deepEqual(deserializeDungeon(saved).props, []);
});

test('options are clamped to sensible ranges', () => {
  const o = normalizeOptions({
    seed: '  ', width: 5, height: 999, roomCount: -3, roomMin: 50, roomMax: 2,
    doorChance: 7, secretDoorChance: -1, clutter: Number.NaN, caveFill: 0.9,
    algorithm: 'maze' as never, corridorStyle: 'spiral' as never,
  });
  assert.match(o.seed, /^[a-z]+-[a-z]+-\d{4}$/, 'a blank seed gets a random one');
  assert.deepEqual([o.width, o.height, o.roomCount], [16, 120, 1]);
  assert.ok(o.roomMin <= o.roomMax && o.roomMax <= Math.min(o.width, o.height) - 4);
  assert.deepEqual([o.doorChance, o.secretDoorChance, o.clutter, o.caveFill], [1, 0, 0.4, 0.6]);
  assert.deepEqual([o.algorithm, o.corridorStyle], ['rooms', 'straight']);
});

test('opening something that is not a map fails clearly', () => {
  for (const bad of [null, 42, {}, { cells: '000', roomIds: [], width: 'x', height: 1 }]) {
    assert.throws(() => deserializeDungeon(bad), /Not a Dungeon Forge map/);
  }
  assert.throws(() => deserializeDungeon({ cells: '0000', roomIds: [-1, -1, -1], width: 2, height: 2 }), /size mismatch/);
});

test('doorSummary counts doors by type', () => {
  const d = generateDungeon({ seed: 'summary', doorChance: 1, lockedDoorChance: 0.4, secretDoorChance: 0.3 });
  const s = doorSummary(d);
  assert.equal(s.total, d.doors.length);
  assert.equal(s.locked, d.doors.filter((o) => o.type === 'locked').length);
  assert.equal(s.secret, d.doors.filter((o) => o.type === 'secret').length);
  assert.ok(s.locked > 0 && s.secret > 0);
});
