// Wall geometry derived from the grid, and how pillars and windows split it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFguOccluders } from "../src/renderer/export/fantasygrounds.ts";
import { buildFoundryScene } from "../src/renderer/export/foundry.ts";
import { buildUVTT } from "../src/renderer/export/uvtt.ts";
import { generateDungeon, PILLAR } from "../src/renderer/generator.ts";
import { computePillarOutlines, computeWalls } from "../src/renderer/walls.ts";
import { unitLength } from "./helpers.ts";
import {
  createBlankDungeon,
  paintRoom,
  stockNewRoom,
  togglePillar,
} from "../src/renderer/editor.ts";
import { RNG } from "../src/renderer/rng.ts";

test("walls never cross a door opening", () => {
  const d = generateDungeon({ seed: "walls", doorChance: 1 });
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

test("pillars become line-of-sight outlines, not room walls", () => {
  const d = generateDungeon({
    seed: "pillars",
    width: 100,
    height: 80,
    roomCount: 40,
    roomMin: 8,
    roomMax: 14,
    pillarChance: 1,
  });
  const pillars = d.cells.filter((t) => t === PILLAR).length;
  assert.ok(pillars > 0);
  assert.equal(computePillarOutlines(d).length, pillars);
  assert.equal(buildUVTT(d, 100, "").objects_line_of_sight.length, pillars);
  const scene = buildFoundryScene(d, 100, "x.png", "X");
  assert.equal(
    scene.walls.length,
    computeWalls(d, d.windows).length +
      pillars * 8 +
      d.doors.length +
      d.windows.length,
  );
});

test("walls are split exactly around windows, and every export represents them", () => {
  const d = generateDungeon({ seed: "window-export", windowChance: 1 });
  assert.ok(d.windows.length > 0);
  assert.equal(
    unitLength(computeWalls(d, d.windows)) + d.windows.length,
    unitLength(computeWalls(d)),
  );

  const uvtt = buildUVTT(d, 100, "");
  assert.equal(
    uvtt.portals.filter((p) => !p.closed).length,
    d.windows.length,
    "UVTT: open portals",
  );
  assert.equal(uvtt.portals.filter((p) => p.closed).length, d.doors.length);

  const scene = buildFoundryScene(d, 100, "x.png", "X");
  const windows = scene.walls.filter((w) => w.sight === 0);
  assert.equal(windows.length, d.windows.length, "Foundry: see-through walls");
  for (const w of windows)
    assert.deepEqual([w.move, w.light, w.door], [20, 0, 0]);

  const occ = buildFguOccluders(d, 100);
  assert.equal(
    occ.filter((o) => o.flags.includes("allow_vision")).length,
    d.windows.length,
    "FGU: allow_vision",
  );
});

test("a lone rectangular room has exactly four merged walls", () => {
  const d = createBlankDungeon({ seed: "box", width: 20, height: 16 });
  paintRoom(d, { x: 4, y: 3 }, { x: 9, y: 6 }, stockNewRoom(d, new RNG("box")));
  const walls = computeWalls(d).map((s) => [s.x1, s.y1, s.x2, s.y2]);
  assert.deepEqual(
    walls.sort(),
    [
      [4, 3, 10, 3],
      [4, 7, 10, 7],
      [4, 3, 4, 7],
      [10, 3, 10, 7],
    ].sort(),
  );
});

test("pillar outlines are closed octagons around each pillar", () => {
  const d = createBlankDungeon({ seed: "pillar", width: 20, height: 16 });
  paintRoom(d, { x: 4, y: 3 }, { x: 9, y: 8 }, stockNewRoom(d, new RNG("p")));
  togglePillar(d, { x: 6, y: 5 });
  const [poly] = computePillarOutlines(d);
  assert.ok(poly && poly.length === 9);
  assert.deepEqual(poly[0], poly[8], "closed");
  for (const p of poly)
    assert.ok(
      Math.abs(Math.hypot(p.x - 6.5, p.y - 5.5) - 0.34) < 0.01,
      "on the pillar radius",
    );
});
