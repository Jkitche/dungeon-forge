// Settings: complete content tables, and contents that change without moving the floor plan.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRoomKeyMarkdown } from "../src/renderer/export/roomkey.ts";
import {
  generateDungeon,
  normalizeOptions,
} from "../src/renderer/generator.ts";
import {
  GENRE_KEYS,
  GENRES,
  getGenre,
  isGenreKey,
} from "../src/renderer/genres.ts";
import { isThemeKey } from "../src/renderer/renderer.ts";

test("every genre has complete tables and a real theme", () => {
  for (const key of GENRE_KEYS) {
    const g = GENRES[key];
    assert.ok(isThemeKey(g.theme), `${key} theme`);
    for (const table of [
      g.roomNames,
      g.caveNames,
      g.atmospheres,
      g.features,
      g.monsters,
      g.traps,
      g.specials,
      g.treasures,
    ]) {
      assert.ok(table.length >= 8, `${key} table too small`);
      assert.equal(
        new Set(table).size,
        table.length,
        `${key} table has duplicates`,
      );
    }
  }
});

test("genre changes the contents but not the floor plan", () => {
  for (const algorithm of ["rooms", "caves"] as const) {
    const base = generateDungeon({
      seed: "genre-layout",
      algorithm,
      genre: "fantasy",
    });
    for (const genre of GENRE_KEYS) {
      const d = generateDungeon({ seed: "genre-layout", algorithm, genre });
      assert.deepEqual(d.cells, base.cells);
      assert.deepEqual(d.doors, base.doors);
      const g = GENRES[genre];
      const names = new Set([
        ...(algorithm === "caves" ? g.caveNames : g.roomNames),
        g.entranceName,
        g.exitName,
      ]);
      for (const r of d.rooms) {
        const c = r.contents;
        assert.ok(
          c && names.has(c.name),
          `${genre}: unexpected room name ${c?.name}`,
        );
        assert.ok(g.atmospheres.includes(c.atmosphere));
        if (c.monster) assert.ok(g.monsters.includes(c.monster));
        if (c.treasure) assert.ok(g.treasures.includes(c.treasure));
      }
      assert.ok(buildRoomKeyMarkdown(d).includes(g.label));
    }
  }
});

test("unknown settings fall back to fantasy", () => {
  assert.equal(getGenre("cyberpunk"), GENRES.fantasy);
  assert.equal(getGenre(undefined), GENRES.fantasy);
  assert.ok(isGenreKey("scifi") && !isGenreKey("toString"));
});

test("names inherited by every object are not settings or themes", () => {
  for (const name of [
    "toString",
    "constructor",
    "__proto__",
    "hasOwnProperty",
  ]) {
    assert.ok(!isGenreKey(name), `${name} is not a setting`);
    assert.ok(!isThemeKey(name), `${name} is not a theme`);
    assert.equal(
      normalizeOptions({ genre: name as never }).genre,
      "fantasy",
      "a saved map naming one falls back",
    );
  }
});
