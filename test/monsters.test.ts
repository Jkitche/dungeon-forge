// Monster tokens: the letter on each token and how many Place all puts down.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_AUTO_MONSTERS,
  monsterCount,
  monsterInitial,
} from "../src/renderer/monsters.ts";
import { GENRES, GENRE_KEYS } from "../src/renderer/genres.ts";

test("a token's letter skips articles and group words", () => {
  assert.equal(monsterInitial("Goblin scouts (1d6+2)"), "G");
  assert.equal(monsterInitial("A gelatinous cube"), "G");
  assert.equal(monsterInitial("A pack of ghouls (1d4+1)"), "G");
  assert.equal(monsterInitial("An ogre, half-asleep"), "O");
  assert.equal(monsterInitial("A swarm of nanite mites"), "N");
  assert.equal(monsterInitial("(2d4)"), "M", "falls back to M");
});

test("Place all uses the dice average, one for a lone monster, and never too many", () => {
  assert.equal(monsterCount("Goblin scouts (1d6+2)"), 6);
  assert.equal(monsterCount("Giant rats (2d4)"), 5);
  assert.equal(monsterCount("Vampire spawn (1d2)"), 2);
  assert.equal(monsterCount("Restless ghosts (1d3)"), 2);
  assert.equal(monsterCount("A banshee"), 1);
  assert.equal(monsterCount("A pair of gargoyles"), 2);
  assert.equal(monsterCount("Rats (10d20)"), MAX_AUTO_MONSTERS);
  for (const key of GENRE_KEYS) {
    for (const m of GENRES[key].monsters) {
      const n = monsterCount(m);
      assert.ok(n >= 1 && n <= MAX_AUTO_MONSTERS, `${m}: ${n}`);
    }
  }
});
