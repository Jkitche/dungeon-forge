// The seeded random number generator every map is built from.

import { test } from "node:test";
import assert from "node:assert/strict";
import { RNG, randomSeed } from "../src/renderer/rng.ts";

const take = (rng: RNG, n: number): number[] =>
  Array.from({ length: n }, () => rng.float());

test("the same seed gives the same sequence; different seeds differ", () => {
  assert.deepEqual(take(new RNG("crypt"), 50), take(new RNG("crypt"), 50));
  assert.notDeepEqual(take(new RNG("crypt"), 50), take(new RNG("vault"), 50));
  assert.deepEqual(
    take(new RNG(42), 5),
    take(new RNG("42"), 5),
    "numbers and their strings are the same seed",
  );
});

test("floats stay in [0, 1)", () => {
  for (const x of take(new RNG("range"), 10_000)) assert.ok(x >= 0 && x < 1);
});

test("int() is inclusive at both ends and reaches every value", () => {
  const rng = new RNG("ints");
  const seen = new Set<number>();
  for (let i = 0; i < 2000; i++) {
    const v = rng.int(-2, 3);
    assert.ok(Number.isInteger(v) && v >= -2 && v <= 3);
    seen.add(v);
  }
  assert.deepEqual(
    [...seen].sort((a, b) => a - b),
    [-2, -1, 0, 1, 2, 3],
  );
  assert.equal(new RNG("x").int(7, 7), 7);
});

test("chance() matches its probability over many draws", () => {
  const rng = new RNG("chance");
  const hits = Array.from({ length: 20_000 }, () => rng.chance(0.25)).filter(
    Boolean,
  ).length;
  assert.ok(Math.abs(hits / 20_000 - 0.25) < 0.02, `${hits}`);
  assert.ok(!new RNG("a").chance(0) && new RNG("a").chance(1));
});

test("pick() returns members and refuses an empty list", () => {
  const rng = new RNG("pick");
  const items = ["a", "b", "c"];
  for (let i = 0; i < 100; i++) assert.ok(items.includes(rng.pick(items)));
  assert.throws(() => rng.pick([]), /empty/);
});

test("shuffle() permutes in place without losing anything", () => {
  const list = Array.from({ length: 30 }, (_, i) => i);
  const shuffled = new RNG("shuffle").shuffle([...list]);
  assert.deepEqual(
    [...shuffled].sort((a, b) => a - b),
    list,
  );
  assert.notDeepEqual(shuffled, list);
  const same = [1, 2, 3];
  assert.equal(new RNG("s").shuffle(same), same, "returns the same array");
});

test('random seeds read like "sunken-crypt-4821"', () => {
  for (let i = 0; i < 50; i++)
    assert.match(randomSeed(), /^[a-z]+-[a-z]+-\d{4}$/);
});
