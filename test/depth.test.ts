// Depth and lighting effects: light from the top-left, shadows down-right, nothing moved.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  castShadow, depthAmount, drawAmbientOcclusion, drawLighting, drawPropShadows, drawWallBevel, isDepthLevel, lightSources, mix,
} from '../src/renderer/depth.ts';
import { createBlankDungeon, paintRoom, placeProp, stockNewRoom, togglePillar, toggleWindow, edgeAt } from '../src/renderer/editor.ts';
import { PROP_RENDERERS } from '../src/renderer/props/index.ts';
import { PROP_KINDS } from '../src/renderer/clutter.ts';
import { computeWalls, eachWallUnit } from '../src/renderer/walls.ts';
import { RNG } from '../src/renderer/rng.ts';
import { recordingContext, TEST_PALETTE } from './helpers.ts';

/** A 6x4 room with a pillar, a window, a brazier, a console and a rug. */
function furnishedRoom() {
  const d = createBlankDungeon({ seed: 'depth', width: 16, height: 12 });
  paintRoom(d, { x: 3, y: 3 }, { x: 8, y: 6 }, stockNewRoom(d, new RNG('d')));
  togglePillar(d, { x: 6, y: 5 });
  toggleWindow(d, edgeAt(4.5, 3.02));
  placeProp(d, { x: 4, y: 4 }, 'brazier');
  placeProp(d, { x: 7, y: 3 }, 'console');
  placeProp(d, { x: 3, y: 6 }, 'rug');
  return d;
}

test('depth levels map to strengths, and only known levels are accepted', () => {
  assert.deepEqual([depthAmount('off'), depthAmount('subtle'), depthAmount('strong'), depthAmount(undefined)], [0, 0.6, 1, 0]);
  assert.ok(isDepthLevel('strong') && !isDepthLevel('extreme') && !isDepthLevel(undefined));
});

test('mix blends colours channel by channel', () => {
  assert.equal(mix('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(mix('#2b2219', '#ffffff', 0), '#2b2219');
  assert.equal(mix('#2b2219', '#000000', 1), '#000000');
});

test('shadows fall down and to the right, longer for taller things and stronger depth', () => {
  const shadow = (amount: number, height: number) => {
    const rec = recordingContext();
    castShadow(rec.ctx, 50, amount, height, 1);
    return rec.ctx;
  };
  const crate = shadow(1, 1);
  assert.ok(crate.shadowOffsetX > 0 && crate.shadowOffsetX === crate.shadowOffsetY, 'down-right, at 45°');
  assert.ok(shadow(1, 2).shadowOffsetX > crate.shadowOffsetX, 'taller casts further');
  assert.ok(shadow(0.6, 1).shadowOffsetX < crate.shadowOffsetX, 'subtle is shorter than strong');
});

test('ambient occlusion shades every wall edge, more on the side away from the light, and rings pillars', () => {
  const d = furnishedRoom();
  const rec = recordingContext();
  drawAmbientOcclusion(rec.ctx, d, 40, 1, 1);
  let edges = 0;
  eachWallUnit(d, () => edges++);
  const linear = rec.calls.filter((c) => c.name === 'createLinearGradient');
  assert.equal(linear.length, edges, 'one band per wall edge');
  assert.equal(rec.calls.filter((c) => c.name === 'createRadialGradient').length, 1, 'one ring for the pillar');

  // Bands point from the wall into the room; those running down or right (shadow side) are darker.
  const alphaOf = (i: number): number => Number(/rgba\(0, 0, 0, ([\d.]+)\)/.exec(String((rec.styles.filter((s) => typeof s === 'object')[i] as { stops: [number, string][] }).stops[0]?.[1]))?.[1]);
  const shaded: number[] = [];
  const lit: number[] = [];
  linear.forEach((c, i) => {
    const [x0, y0, x1, y1] = c.args as number[];
    ((x1 as number) > (x0 as number) || (y1 as number) > (y0 as number) ? shaded : lit).push(alphaOf(i));
  });
  assert.ok(shaded.length > 0 && lit.length > 0);
  assert.ok(Math.min(...shaded) > Math.max(...lit), 'north and west walls shade the floor more');
});

test('wall bevels add a lit and a shaded edge inside each wall', () => {
  const d = furnishedRoom();
  const walls = computeWalls(d);
  const rec = recordingContext();
  drawWallBevel(rec.ctx, walls, 40, '#2b2219', 0.14, 1);
  assert.equal(rec.calls.filter((c) => c.name === 'stroke').length, 2);
  assert.equal(rec.calls.filter((c) => c.name === 'moveTo').length, walls.length * 2);
  const [lit, shade] = rec.styles as string[];
  assert.ok(lit && shade && lit > '#2b2219' && shade < '#2b2219', 'one lighter, one darker than the wall');
  // Both lines stay within the wall's thickness (half of 0.14 * 40 = 2.8 px either side).
  for (const c of rec.calls.filter((x) => x.name === 'moveTo')) {
    const [x, y] = c.args as number[];
    assert.ok(walls.some((s) => (s.y1 === s.y2 ? Math.abs((y as number) - s.y1 * 40) < 2.8 : Math.abs((x as number) - s.x1 * 40) < 2.8)));
  }
});

test('props cast shadows by height: flat props none, tall props further', () => {
  for (const kind of PROP_KINDS) assert.ok(PROP_RENDERERS[kind].height >= 0, kind);
  assert.equal(PROP_RENDERERS.rug.height, 0);
  assert.equal(PROP_RENDERERS.bones.height, 0);
  assert.ok(PROP_RENDERERS.statue.height > PROP_RENDERERS.crate.height && PROP_RENDERERS.crate.height > PROP_RENDERERS.rubble.height);

  const d = furnishedRoom();
  const rec = recordingContext();
  drawPropShadows(rec.ctx, d.props, PROP_RENDERERS, 40, 1, 1);
  const shapes = rec.calls.filter((c) => c.name === 'arc' || c.name === 'rect');
  assert.equal(shapes.length, 2, 'brazier and console, not the rug');
  assert.equal(rec.calls.filter((c) => c.name === 'arc').length, 1, 'the brazier is round');
  assert.match(String(rec.ctx.filter), /^blur\(/);
});

test('light comes from braziers and screens, not windows', () => {
  const d = furnishedRoom();
  assert.equal(d.windows.length, 1);
  const lights = lightSources(d, TEST_PALETTE);
  assert.equal(lights.length, 2, 'underground and in space there is no daylight');
  const [brazier, screen] = lights;
  assert.deepEqual([brazier?.x, brazier?.y, brazier?.colour], [4.5, 4.5, TEST_PALETTE.glow]);
  assert.deepEqual([screen?.x, screen?.y], [8, 3.5], 'the middle of a two-square console');
});

test('lighting dims the floor once, then adds one pool per light, restoring the canvas after', () => {
  const d = furnishedRoom();
  const lights = lightSources(d, TEST_PALETTE);
  const rec = recordingContext();
  drawLighting(rec.ctx, lights, 40, 640, 480, 0.4);
  assert.equal(rec.calls[0]?.name, 'save');
  assert.equal(rec.calls.at(-1)?.name, 'restore');
  assert.deepEqual(rec.calls[1], { name: 'fillRect', args: [0, 0, 640, 480] });
  assert.equal(rec.ctx.globalCompositeOperation, 'lighter', 'light is added, not painted over');
  assert.equal(rec.calls.filter((c) => c.name === 'createRadialGradient').length, lights.length);
});
