// The export strategies, run headless with a fake renderer.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFoundryScene } from "../../src/renderer/export/foundry.ts";
import {
  createExportTarget,
  EXPORTERS,
  getExporter,
} from "../../src/renderer/export/index.ts";
import { buildRoll20Notes } from "../../src/renderer/export/roll20.ts";
import { buildRoomKeyMarkdown } from "../../src/renderer/export/roomkey.ts";
import { buildUVTT } from "../../src/renderer/export/uvtt.ts";
import { generateDungeon } from "../../src/renderer/generator.ts";
import { fakeContext } from "../helpers.ts";

test("exports have the expected shape", () => {
  const d = generateDungeon({
    seed: "export",
    secretDoorChance: 0.3,
    lockedDoorChance: 0.3,
  });
  const uvtt = buildUVTT(d, 100, "AAAA");
  assert.equal(uvtt.format, 0.3);
  assert.deepEqual(uvtt.resolution.map_size, { x: d.width, y: d.height });
  assert.equal(uvtt.portals.length, d.doors.length + d.windows.length);
  assert.ok(uvtt.line_of_sight.length > 0);

  const scene = buildFoundryScene(d, 100, "dungeons/x.png", "Test");
  assert.equal(scene.width, d.width * 100);
  assert.equal(scene.grid.size, 100);
  const doorWalls = scene.walls.filter((w) => w.door > 0);
  assert.equal(doorWalls.length, d.doors.length);
  assert.equal(
    scene.walls.filter((w) => w.door === 2).length,
    d.doors.filter((o) => o.type === "secret").length,
  );
  assert.equal(new Set(scene.walls.map((w) => w._id)).size, scene.walls.length);
  for (const w of scene.walls) assert.match(w._id, /^[A-Za-z0-9]{16}$/);

  const md = buildRoomKeyMarkdown(d);
  for (const r of d.rooms) assert.ok(md.includes(`## ${r.id + 1}. `));
  assert.ok(
    buildRoll20Notes(d, 70, "x.png", false).includes(
      `${d.width * 70} × ${d.height * 70} px`,
    ),
  );
});

test("export registry: unique ids, sensible metadata", () => {
  const ids = EXPORTERS.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
  // Suggested file names never collide, so exporting several formats doesn't overwrite files.
  const names = EXPORTERS.map((e) => `${e.nameTag ?? ""}${e.extension}`);
  assert.equal(new Set(names).size, names.length, names.join(" "));
  for (const e of EXPORTERS) {
    assert.match(e.extension, /^\.[a-z0-9.]+$/, e.id);
    assert.ok(e.label && e.description && e.fileType, e.id);
    if (e.image)
      assert.ok(e.image.defaultPpg >= 20 && e.image.defaultPpg <= 400, e.id);
  }
});

test("every export strategy writes only next to the chosen save location", async () => {
  const d = generateDungeon({
    seed: "strategy",
    secretDoorChance: 0.3,
    doorChance: 1,
  });
  for (const e of EXPORTERS) {
    const ctx = fakeContext(d);
    const result = await e.run(ctx, createExportTarget("/maps/my-dungeon"));
    assert.ok(result.files.length > 0, e.id);
    assert.equal(
      result.files[0]?.path,
      `/maps/my-dungeon${e.extension}`,
      `${e.id}: primary file first`,
    );
    for (const f of result.files)
      assert.ok(f.path.startsWith("/maps/my-dungeon."), `${e.id}: ${f.path}`);
    assert.equal(
      new Set(result.files.map((f) => f.path)).size,
      result.files.length,
      `${e.id}: duplicate paths`,
    );
    assert.ok(result.summary.value.length > 0, e.id);
    // Formats without an image never render one.
    if (!e.image) assert.equal(ctx.renders.length, 0, e.id);
  }
});

test("strategies escape user-controlled names in their summaries", async () => {
  const d = generateDungeon({ seed: "escape" });
  for (const e of EXPORTERS) {
    const result = await e.run(
      fakeContext(d),
      createExportTarget("/tmp/<b>bad</b>"),
    );
    assert.ok(!result.summary.value.includes("<b>bad</b>"), e.id);
  }
});

test("Classic always renders both views; Unity follows the dialog", async () => {
  const d = generateDungeon({ seed: "views" });
  const byId = (id: string) => EXPORTERS.find((e) => e.id === id)!;
  const fgc = fakeContext(d);
  await byId("fgc").run(fgc, createExportTarget("/x/a"));
  assert.deepEqual(
    fgc.renders.map((r) => r.gmView),
    [false, true, false],
  );
  const fgu = fakeContext(d, { gmView: true });
  await byId("fgu").run(fgu, createExportTarget("/x/a"));
  assert.equal(
    fgu.renders[0]?.gmView,
    undefined,
    "main map uses the dialog choice",
  );
});

test("an unknown export id falls back to the first format", () => {
  assert.equal(getExporter("nope"), EXPORTERS[0]);
  assert.equal(getExporter("fgu").id, "fgu");
});

test("export targets name every file after the chosen save location", () => {
  const t = createExportTarget("/maps/sub dir/My Dungeon");
  assert.equal(t.path(".roll20.txt"), "/maps/sub dir/My Dungeon.roll20.txt");
  assert.equal(t.name(".png"), "My Dungeon.png");
  assert.equal(
    createExportTarget("C:\\\\maps\\\\crypt").name(".mod"),
    "crypt.mod",
  );
});

test("Roll20 warns when the image is over the free upload limit", async () => {
  const d = generateDungeon({ seed: "big" });
  const roll20 = getExporter("roll20");
  const small = await roll20.run(fakeContext(d), createExportTarget("/x/a"));
  assert.equal(small.warnings?.length ?? 0, 0);
  const huge = fakeContext(d, {
    renderPng: async () => new Uint8Array(11 * 1048576),
  });
  const big = await roll20.run(huge, createExportTarget("/x/a"));
  assert.equal(big.warnings?.length, 1);
  assert.match(big.warnings?.[0]?.value ?? "", /11\.0 MB/);
});
