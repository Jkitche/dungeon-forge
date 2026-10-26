// Line of sight for light sources: visibility polygons and what blocks light.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COVER_LIGHT, lightLayers, lightOccluders, visibilityPolygon } from '../src/renderer/raycast.ts';
import type { Occluder } from '../src/renderer/raycast.ts';
import type { Point, Segment } from '../src/renderer/walls.ts';
import { computeWalls } from '../src/renderer/walls.ts';
import { generateDungeon, PILLAR } from '../src/renderer/generator.ts';
import { PROP_KINDS, PROP_SPECS } from '../src/renderer/clutter.ts';
import type { PropKind } from '../src/renderer/clutter.ts';
import { createBlankDungeon, paintRoom, placeProp, stockNewRoom } from '../src/renderer/editor.ts';
import { RNG } from '../src/renderer/rng.ts';

/** Even-odd point-in-polygon test. */
function inside(poly: Point[], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i] as Point;
    const b = poly[j] as Point;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

test('with nothing in the way, a light sees its whole square', () => {
  const poly = visibilityPolygon(5, 5, 3, []);
  for (const [x, y] of [[2.1, 2.1], [7.9, 2.1], [7.9, 7.9], [2.1, 7.9], [5, 5]]) assert.ok(inside(poly, x as number, y as number), `${x},${y}`);
  for (const p of poly) assert.ok(Math.abs(p.x - 5) <= 3 + 1e-9 && Math.abs(p.y - 5) <= 3 + 1e-9, 'never past its reach');
});

test('a wall casts a shadow behind it, and light still reaches around its ends', () => {
  const wall: Segment = { x1: 6, y1: 4, x2: 6, y2: 6 };
  const poly = visibilityPolygon(5, 5, 4, [wall]);
  assert.ok(inside(poly, 5.9, 5), 'in front of the wall');
  assert.ok(!inside(poly, 6.5, 5), 'just behind it');
  assert.ok(!inside(poly, 8.5, 5.5), 'far behind it, inside the shadow wedge');
  assert.ok(inside(poly, 6.5, 2), 'past its end');
  // Walls out of reach are ignored.
  assert.deepEqual(visibilityPolygon(5, 5, 1, [{ x1: 20, y1: 0, x2: 20, y2: 9 }]), visibilityPolygon(5, 5, 1, []));
});

test('a light in a closed room lights none of the rock outside it', () => {
  const room: Segment[] = [
    { x1: 0, y1: 0, x2: 4, y2: 0 }, { x1: 4, y1: 0, x2: 4, y2: 4 }, { x1: 4, y1: 4, x2: 0, y2: 4 }, { x1: 0, y1: 4, x2: 0, y2: 0 },
  ];
  const poly = visibilityPolygon(1, 1, 6, room);
  for (const p of poly) assert.ok(p.x >= -1e-9 && p.x <= 4 + 1e-9 && p.y >= -1e-9 && p.y <= 4 + 1e-9, `${p.x},${p.y} stays inside`);
  assert.ok(inside(poly, 3.5, 3.5));
});

test('walls, every door and every pillar block light completely', () => {
  const d = generateDungeon({ seed: 'occluders', pillarChance: 1, doorChance: 1, secretDoorChance: 0.3, clutter: 0 });
  const pillars = d.cells.filter((c) => c === PILLAR).length;
  assert.ok(pillars > 0 && d.doors.length > 0);
  const occ = lightOccluders(d);
  assert.equal(occ.length, computeWalls(d).length + d.doors.length + pillars * 8, 'octagonal pillars');
  for (const o of d.doors) assert.ok(occ.some((s) => s.x1 === o.x1 && s.y1 === o.y1 && s.x2 === o.x2 && s.y2 === o.y2));
  assert.ok(occ.every((o) => o.cover === 'full' && o.prop === undefined));
});

test('clutter blocks light by its cover: square props as boxes, round ones as octagons', () => {
  const d = generateDungeon({ seed: 'cover', clutter: 1, pillarChance: 0 });
  const occ = lightOccluders(d).filter((o) => o.prop !== undefined);
  d.props.forEach((p, i) => {
    const mine = occ.filter((o) => o.prop === i);
    const cover = PROP_SPECS[p.kind].cover;
    if (cover === 'none') return assert.equal(mine.length, 0, `${p.kind} lets light through`);
    assert.ok(mine.length === 4 || mine.length === 8, `${p.kind} is outlined`);
    assert.ok(mine.every((o) => o.cover === cover));
  });
  assert.ok(occ.length > 0);
});

test('tables, rugs and beds give no cover; shelves give full cover', () => {
  const cover = (k: PropKind) => PROP_SPECS[k].cover;
  assert.deepEqual([cover('table'), cover('rug'), cover('bed'), cover('brazier')], ['none', 'none', 'none', 'none']);
  assert.equal(cover('shelf'), 'full');
  assert.equal(cover('crate'), 'half');
  assert.equal(cover('statue'), 'three-quarters');
  for (const k of PROP_KINDS) assert.ok(Object.hasOwn(COVER_LIGHT, cover(k)), k);
});

test('light layers add up to the whole light, merging layers no cover tells apart', () => {
  const seg = (cover: Occluder['cover'], prop?: number): Occluder => ({ x1: 0, y1: 0, x2: 1, y2: 0, cover, ...(prop === undefined ? {} : { prop }) });
  const weights = (occ: Occluder[], prop?: number) => lightLayers(occ, prop).map((l) => l.weight);
  assert.deepEqual(weights([seg('full')]), [1], 'walls alone: one layer');
  assert.deepEqual(weights([seg('full'), seg('half', 0)]), [0.5, 0.5]);
  assert.deepEqual(weights([seg('full'), seg('three-quarters', 0)]), [0.25, 0.75]);
  assert.deepEqual(weights([seg('full'), seg('three-quarters', 0), seg('half', 1)]), [0.25, 0.25, 0.5]);
  assert.deepEqual(weights([seg('full'), seg('half', 0)], 0), [1], 'a prop never shades its own light');
});

test('a spot behind each kind of cover gets the share of light that cover lets through', () => {
  const lit = (kind: PropKind): number => {
    const d = createBlankDungeon({ seed: `cover-${kind}`, width: 16, height: 10 });
    paintRoom(d, { x: 2, y: 2 }, { x: 13, y: 7 }, stockNewRoom(d, new RNG('c')));
    assert.ok(placeProp(d, { x: 7, y: 4 }, kind));
    const occ = lightOccluders(d);
    // A light at (5.5, 4.5), and a spot straight past the prop on the far side.
    return lightLayers(occ)
      .filter((l) => inside(visibilityPolygon(5.5, 4.5, 6, l.segments), 9.2, 4.5))
      .reduce((sum, l) => sum + l.weight, 0);
  };
  assert.equal(lit('table'), 1, 'no cover');
  assert.equal(lit('crate'), 0.5, 'half cover');
  assert.equal(lit('statue'), 0.25, 'three-quarters cover');
  assert.equal(lit('shelf'), 0, 'full cover');
});
