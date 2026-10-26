// Map codes: the map as a line of text, and back.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decodeMapCode,
  encodeMapCode,
  rebuildsFromSeed,
} from "../src/renderer/mapcode.ts";
import {
  generateDungeon,
  serializeDungeon,
} from "../src/renderer/generator.ts";
import {
  placeAllMonsters,
  placeLight,
  placeProp,
} from "../src/renderer/editor.ts";

const STYLE = { look: "realistic", depth: "strong", lighting: true };

test("an unedited map's code is short: its settings rebuild it exactly", async () => {
  const d = generateDungeon({
    seed: "code-seed",
    genre: "horror",
    clutter: 0.7,
  });
  assert.ok(rebuildsFromSeed(d));
  const code = await encodeMapCode(d, STYLE);
  assert.match(code, /^DF1\.[A-Za-z0-9_-]+$/, "safe to paste anywhere");
  assert.ok(code.length < 400, `${code.length} characters`);
  const back = await decodeMapCode(code);
  assert.deepEqual(back.dungeon, serializeDungeon(d));
  assert.deepEqual(back.style, STYLE);
});

test("an edited map's code carries everything, edits, lights, torches and monsters included", async () => {
  const d = generateDungeon({
    seed: "code-edits",
    clutter: 1,
    windowChance: 1,
  });
  const room = d.rooms.find((r) => r.contents?.monster) ?? d.rooms[0];
  assert.ok(room);
  placeProp(d, { x: room.cx, y: room.cy }, "statue");
  placeLight(d, { x: room.x, y: room.y }, 4);
  placeAllMonsters(d);
  assert.ok(!rebuildsFromSeed(d));
  const code = await encodeMapCode(d, STYLE);
  const json = JSON.stringify(serializeDungeon(d));
  assert.ok(
    code.length < json.length / 3,
    `compressed: ${code.length} vs ${json.length}`,
  );
  const back = await decodeMapCode(code);
  assert.deepEqual(back.dungeon, serializeDungeon(d));
});

test("pasted codes may be wrapped across lines; .dungeon.json text works too", async () => {
  const d = generateDungeon({ seed: "code-wrap" });
  const code = await encodeMapCode(d, STYLE);
  const wrapped = `  ${code.match(/.{1,40}/g)?.join("\n ")}\n`;
  assert.deepEqual((await decodeMapCode(wrapped)).dungeon, serializeDungeon(d));

  const file = JSON.stringify({
    app: "dungeon-forge",
    version: 1,
    style: STYLE,
    dungeon: serializeDungeon(d),
  });
  const fromFile = await decodeMapCode(file);
  assert.deepEqual(fromFile.dungeon, serializeDungeon(d));
  assert.deepEqual(fromFile.style, STYLE);
});

test("anything else is turned away with a readable reason", async () => {
  await assert.rejects(
    decodeMapCode("hello there"),
    /isn't a Dungeon Forge map code/,
  );
  await assert.rejects(
    decodeMapCode("DF1.not-really-a-code"),
    /damaged or incomplete/,
  );
  const code = await encodeMapCode(generateDungeon({ seed: "cut" }), {});
  await assert.rejects(
    decodeMapCode(code.slice(0, code.length - 20)),
    /damaged or incomplete/,
  );
  await assert.rejects(
    decodeMapCode('{"app":"something-else"}'),
    /not saved by Dungeon Forge/,
  );
  // Valid compression, but not a map inside.
  const payload = new TextEncoder().encode(JSON.stringify({ s: {} }));
  const packed = new Uint8Array(
    await new Response(
      new Blob([payload])
        .stream()
        .pipeThrough(new CompressionStream("deflate-raw")),
    ).arrayBuffer(),
  );
  const noMap = `DF1.${Buffer.from(packed).toString("base64url")}`;
  await assert.rejects(decodeMapCode(noMap), /damaged or incomplete/);
});
