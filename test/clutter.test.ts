// Generated room clutter: placement rules, seed stability and per-setting choices.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editorFree, fitProp, footprint, PROP_SPECS, propPool, roomFurnishings } from '../src/renderer/clutter.ts';
import { GENRES, GENRE_KEYS } from '../src/renderer/genres.ts';
import { generateDungeon, DIRS, ROCK, ROOM, CORRIDOR } from '../src/renderer/generator.ts';
import type { DungeonOptions } from '../src/renderer/generator.ts';
import { variants } from './helpers.ts';
import { createBlankDungeon, paintRoom, stockNewRoom } from '../src/renderer/editor.ts';
import { RNG } from '../src/renderer/rng.ts';

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
  assert.ok((libraries.get('shelf') ?? 0) > 0, 'libraries get shelves');
  assert.deepEqual([...libraries.keys()].filter((k) => !['shelf', 'table', 'rug', 'chest'].includes(k)), [], 'and nothing out of place');
  const barracks = kindsIn('scifi', /Crew Quarters/);
  assert.ok((barracks.get('bed') ?? 0) > 0 && !barracks.has('console'), 'crew quarters get bunks, not consoles');
});

test('every room name in every setting is furnished to suit it', () => {
  for (const genre of GENRE_KEYS) {
    const g = GENRES[genre];
    for (const [names, cave] of [[g.roomNames, false], [g.caveNames, true], [[g.entranceName, g.exitName], false]] as const) {
      for (const name of names) {
        const wanted = roomFurnishings(name);
        assert.ok(wanted, `${genre} "${name}" has furnishings`);
        const pool = propPool(genre, name, cave);
        assert.ok(pool.length > 0, `${genre} "${name}" gets props`);
        for (const k of pool) assert.ok(Object.hasOwn(wanted, k), `${genre} "${name}" gets only what it calls for, not ${k}`);
        if (cave) for (const k of pool) assert.ok(PROP_SPECS[k].cave, `${k} fits a cave`);
      }
    }
  }
});

test('prop pools follow the room name, within what the setting uses', () => {
  const count = (pool: string[], k: string): number => pool.filter((x) => x === k).length;
  assert.deepEqual([...new Set(propPool('fantasy', 'Library', false))].sort(), ['chest', 'rug', 'shelf', 'table']);
  assert.ok(count(propPool('fantasy', 'Storeroom', false), 'crate') > 0);
  assert.equal(count(propPool('fantasy', 'Storeroom', false), 'coffin'), 0);
  assert.ok(count(propPool('fantasy', 'Crypt', false), 'coffin') > 0);
  assert.deepEqual([...new Set(propPool('scifi', 'Alien Ossuary', true))], ['bones'], 'no coffins or braziers on a starship');
  // A name that calls for nothing gets the setting's general mix.
  assert.equal(roomFurnishings('Mysterious Room'), null);
  const general = propPool('fantasy', 'Mysterious Room', false);
  assert.ok(count(general, 'crate') > 0 && count(general, 'coffin') === 0, 'weight 0: only where a room calls for it');
  // So does one whose furnishings the setting lacks entirely, or that won't fit a cavern.
  assert.ok(propPool('fantasy', 'Cryo Bay', false).length > 0);
  assert.equal(count(propPool('fantasy', 'Cryo Bay', false), 'pod'), 0);
  for (const k of propPool('fantasy', 'Library', true)) assert.ok(PROP_SPECS[k].cave, `${k} fits a cave`);
});

test('fitProp: strict generation rules versus the editor', () => {
  const d = createBlankDungeon({ seed: 'fit', width: 20, height: 16 });
  paintRoom(d, { x: 3, y: 3 }, { x: 12, y: 10 }, stockNewRoom(d, new RNG('f')));
  const free = editorFree(d);
  assert.equal(fitProp(d, 'bed', { x: 7, y: 6 }, free, { strict: true }), null, 'generation keeps beds against walls');
  assert.ok(fitProp(d, 'bed', { x: 7, y: 6 }, free), 'the editor allows it');
  assert.equal(fitProp(d, 'table', { x: 3, y: 6 }, free, { strict: true }), null, 'generation keeps tables off walls');
  assert.equal(fitProp(d, 'crate', { x: 1, y: 1 }, free), null, 'never on rock');
});

test('editorFree can ignore one prop, so it can be moved or turned in place', () => {
  const d = createBlankDungeon({ seed: 'ignore', width: 20, height: 16 });
  paintRoom(d, { x: 3, y: 3 }, { x: 12, y: 10 }, stockNewRoom(d, new RNG('i')));
  d.props.push({ x: 6, y: 6, kind: 'crate', vertical: false, room: 0 });
  assert.ok(!editorFree(d)(6, 6));
  assert.ok(editorFree(d, 0)(6, 6));
  assert.ok(!editorFree(d)(-1, 6) && !editorFree(d)(6, 99), 'off the map is never free');
});
