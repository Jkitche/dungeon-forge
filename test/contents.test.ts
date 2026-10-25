// Room stocking: names, descriptions and the d6 monster / trap / special / empty roll.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStocker, stockRoom } from '../src/renderer/contents.ts';
import { GENRES, GENRE_KEYS } from '../src/renderer/genres.ts';
import { RNG } from '../src/renderer/rng.ts';

test("entrance and exit rooms use the setting's names and notes", () => {
  for (const key of GENRE_KEYS) {
    const g = GENRES[key];
    const rng = new RNG(key);
    const decks = createStocker(rng, g, false);
    const entrance = stockRoom(rng, decks, { isEntrance: true, isExit: false });
    assert.deepEqual([entrance.name, entrance.note, entrance.kind], [g.entranceName, g.entranceNote, 'empty']);
    assert.equal(entrance.monster ?? entrance.trap ?? entrance.special ?? entrance.treasure, null, 'the entrance is safe');
    const exit = stockRoom(rng, decks, { isEntrance: false, isExit: true });
    assert.deepEqual([exit.name, exit.note], [g.exitName, g.exitNote]);
  }
});

test('room names come from a shuffled deck: no repeats until the deck runs out', () => {
  const g = GENRES.fantasy;
  const rng = new RNG('deck');
  const decks = createStocker(rng, g, false);
  const names = Array.from({ length: g.roomNames.length }, () => decks.name());
  assert.deepEqual([...names].sort(), [...g.roomNames].sort());
  assert.ok(g.roomNames.includes(decks.name()), 'then it reshuffles');
  const caves = createStocker(new RNG('deck'), g, true);
  assert.ok(g.caveNames.includes(caves.name()), 'caverns use cave names');
});

test('every kind of room turns up, each with the right kind of contents', () => {
  const g = GENRES.horror;
  const rng = new RNG('kinds');
  const decks = createStocker(rng, g, false);
  const kinds = new Map<string, number>();
  for (let i = 0; i < 600; i++) {
    const r = stockRoom(rng, decks, { isEntrance: false, isExit: false });
    kinds.set(r.kind, (kinds.get(r.kind) ?? 0) + 1);
    assert.equal(r.kind === 'monster', r.monster !== null);
    assert.equal(r.kind === 'trap', r.trap !== null);
    assert.equal(r.kind === 'special', r.special !== null);
    if (r.monster) assert.ok(g.monsters.includes(r.monster));
    if (r.trap) assert.ok(g.traps.includes(r.trap));
    if (r.treasure) assert.ok(g.treasures.includes(r.treasure));
    assert.ok(g.atmospheres.includes(r.atmosphere) && g.features.includes(r.feature));
  }
  // A d6: monster on 1-2, trap on 3, special on 4, empty on 5-6.
  const share = (k: string): number => (kinds.get(k) ?? 0) / 600;
  assert.ok(Math.abs(share('monster') - 2 / 6) < 0.06);
  assert.ok(Math.abs(share('trap') - 1 / 6) < 0.05);
  assert.ok(Math.abs(share('special') - 1 / 6) < 0.05);
  assert.ok(Math.abs(share('empty') - 2 / 6) < 0.06);
});
