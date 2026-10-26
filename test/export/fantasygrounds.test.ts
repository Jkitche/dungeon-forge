// Fantasy Grounds Unity and Classic modules.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildFguModule,
  buildFguOccluders,
  fguImageBaseName,
  fguModuleName,
  fguPointMapper,
  xmlText,
  buildFgcModule,
  fgcImagePaths,
  fgcModuleName,
  describeDoor,
} from "../../src/renderer/export/fantasygrounds.ts";
import { generateDungeon } from "../../src/renderer/generator.ts";
import { readZip } from "../helpers.ts";

test("Fantasy Grounds module contains the map, its LoS sidecar and a definition", () => {
  const d = generateDungeon({
    seed: "fgu",
    width: 40,
    height: 30,
    doorChance: 1,
    secretDoorChance: 0.3,
    pillarChance: 1,
    roomMin: 7,
    roomMax: 12,
  });
  const ppg = 100;
  const files = readZip(
    buildFguModule(d, ppg, new Uint8Array([1, 2, 3]), new Uint8Array([4])),
  );
  const base = fguImageBaseName(d);
  assert.deepEqual(
    [...files.keys()].sort(),
    [
      "definition.xml",
      `images/${base}.png`,
      `images/${base}.xml`,
      "thumbnail.png",
    ].sort(),
  );

  const def = new TextDecoder().decode(files.get("definition.xml"));
  assert.match(def, /<ruleset>Any<\/ruleset>/);
  assert.match(def, new RegExp(`<name>${fguModuleName(d)}</name>`));

  const xml = new TextDecoder().decode(files.get(`images/${base}.xml`));
  assert.match(xml, /<gridsize>100,100<\/gridsize>/);
  const occluders = buildFguOccluders(d, ppg);
  assert.equal((xml.match(/<occluder>/g) ?? []).length, occluders.length);
  assert.equal(
    occluders.filter((o) => o.flags.includes("toggleable")).length,
    d.doors.length,
  );
  // Pixel space centred on the image with y up: every point lies within ±half the image.
  for (const o of occluders) {
    for (const [x, y] of o.points) {
      assert.ok(
        Math.abs(x) <= (d.width * ppg) / 2 + 1e-9 &&
          Math.abs(y) <= (d.height * ppg) / 2 + 1e-9,
      );
    }
  }
});

test("Fantasy Grounds coordinates are centred with y pointing up", () => {
  const d = generateDungeon({ seed: "fgu-coords", width: 20, height: 16 });
  const map = fguPointMapper(d, 50);
  assert.deepEqual(map({ x: 0, y: 0 }), [-500, 400]);
  assert.deepEqual(map({ x: 20, y: 16 }), [500, -400]);
  assert.deepEqual(map({ x: 10, y: 8 }), [0, 0]);
});

test("XML text escaping handles markup and non-ASCII seeds", () => {
  assert.equal(xmlText('<a & "b">'), "&lt;a &amp; &quot;b&quot;&gt;");
  assert.equal(xmlText("café"), "caf&#233;");
});

test("Fantasy Grounds Classic module has both maps and one story entry per room", () => {
  const d = generateDungeon({
    seed: "fgc & <friends>",
    genre: "horror",
    secretDoorChance: 0.4,
    doorChance: 1,
  });
  const files = readZip(
    buildFgcModule(d, 50, {
      player: new Uint8Array([1]),
      gm: new Uint8Array([2]),
      thumbnail: new Uint8Array([3]),
    }),
  );
  const paths = fgcImagePaths(d);
  assert.deepEqual(
    [...files.keys()].sort(),
    [
      "db.xml",
      "definition.xml",
      paths.gm,
      paths.player,
      "thumbnail.png",
    ].sort(),
  );

  const db = new TextDecoder("latin1").decode(files.get("db.xml"));
  // Every bitmap path in db.xml points at a file in the archive.
  const bitmaps = [...db.matchAll(/<bitmap>([^<]+)<\/bitmap>/g)].map(
    (m) => m[1],
  );
  assert.deepEqual(bitmaps.sort(), [paths.gm, paths.player].sort());
  // Overview plus one formatted-text story entry per room.
  assert.equal(
    (db.match(/<text type="formattedtext">/g) ?? []).length,
    d.rooms.length + 1,
  );
  // Seed text is escaped, never raw markup.
  assert.ok(
    db.includes("fgc &amp; &lt;friends&gt;") && !db.includes("<friends>"),
  );
  // Pure ASCII, so the ISO-8859-1 declaration is always accurate.
  assert.ok(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(db));
  const def = new TextDecoder().decode(files.get("definition.xml"));
  assert.match(def, /<root version="3.3">/);
  // Distinct from the Unity module so both can be loaded in the same FG install.
  assert.ok(
    def.includes(`<name>${fgcModuleName(d)}</name>`) &&
      fgcModuleName(d) !== fguModuleName(d),
  );
  for (const door of d.doors.filter((o) => o.type === "secret"))
    assert.ok(db.includes(xmlText(describeDoor(d, door))));
});
