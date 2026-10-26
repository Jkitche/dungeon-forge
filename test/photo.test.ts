// Photographic textures: loading, falling back, and filling with a tiled pattern.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clearPhotoTextures,
  fillPhoto,
  loadPhotoTextures,
  photoTexture,
} from "../src/renderer/photo.ts";
import { renderDungeon } from "../src/renderer/renderer.ts";
import { generateDungeon } from "../src/renderer/generator.ts";
import { fakeCanvas, installPath2D, recordingContext } from "./helpers.ts";

installPath2D();

const fakeImage = (url: string) =>
  ({ url, width: 1024, height: 1024 }) as unknown as CanvasImageSource;

test("textures load from the given folder, and one that fails is left to the fallback", async () => {
  const urls: string[] = [];
  await loadPhotoTextures("file:///app/assets/textures/", async (url) => {
    urls.push(url);
    if (url.endsWith("rock-dark.jpg")) throw new Error("missing");
    return fakeImage(url);
  });
  assert.deepEqual(urls.sort(), [
    "file:///app/assets/textures/floor-cobbles.jpg",
    "file:///app/assets/textures/rock-dark.jpg",
  ]);
  assert.ok(photoTexture("floor"));
  assert.equal(photoTexture("rock"), null);
  clearPhotoTextures();
  assert.equal(photoTexture("floor"), null);
});

test("a photo fill tiles the image at the requested size, turned, shifted and shaded", () => {
  const { ctx, calls, styles } = recordingContext();
  fillPhoto(ctx, fakeImage("x"), {
    ppg: 32,
    extent: 1000,
    squares: 4,
    turns: 5,
    ox: 2,
    oy: 3,
    shade: 0.4,
  });
  const args = (name: string) => calls.find((c) => c.name === name)?.args;
  assert.deepEqual(args("translate"), [64, 96]);
  assert.deepEqual(args("rotate"), [Math.PI / 2], "five quarter turns is one");
  assert.deepEqual(
    args("scale"),
    [0.125, 0.125],
    "1024 px spread over 4 squares of 32 px",
  );
  assert.equal(
    calls.filter((c) => c.name === "fillRect").length,
    2,
    "the pattern, then the shade",
  );
  assert.ok(styles.includes("rgba(0, 0, 0, 0.4)"));
});

test("a photo fill draws nothing when the pattern cannot be made", () => {
  const { ctx, calls } = recordingContext();
  (ctx as unknown as Record<string, unknown>).createPattern = () => null;
  fillPhoto(ctx, fakeImage("x"), { ppg: 32, extent: 1000, squares: 4 });
  assert.equal(calls.length, 0);
});

test("the Realistic look draws its photographs once they have loaded", async () => {
  const d = generateDungeon({
    seed: "photo",
    width: 30,
    height: 24,
    roomMin: 6,
    roomMax: 9,
  });
  const patterns = (theme: "realistic" | "stone") => {
    const { canvas, rec } = fakeCanvas();
    renderDungeon(canvas, d, { theme, ppg: 20 });
    return rec.calls
      .filter((c) => c.name === "createPattern")
      .map((c) => (c.args[0] as { url: string }).url);
  };
  assert.deepEqual(
    patterns("realistic"),
    [],
    "hand-drawn until the photographs arrive",
  );

  await loadPhotoTextures("file:///t/", async (url) => fakeImage(url));
  const used = patterns("realistic");
  assert.ok(used.includes("file:///t/rock-dark.jpg"));
  // The whole floor, then each room again with its own turn and shift.
  assert.equal(
    used.filter((u) => u.endsWith("floor-cobbles.jpg")).length,
    d.rooms.length + 1,
  );
  assert.deepEqual(patterns("stone"), [], "other looks never use them");
  clearPhotoTextures();
});
