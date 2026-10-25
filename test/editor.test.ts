// Hand-editing operations and the consistency pass that follows every edit.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROP_KINDS, editorFree, fitProp, footprint, propAt, settingProps } from '../src/renderer/clutter.ts';
import { clearMap, createBlankDungeon, cycleDoor, cycleStairs, edgeAt, eraseCells, lineCells, normalizeDungeon, paintCorridor, paintRoom, placeProp, rectCells, removeProp, restore, rotateProp, snapshot, stockNewRoom, togglePillar, toggleWindow } from '../src/renderer/editor.ts';
import { buildFguModule } from '../src/renderer/export/fantasygrounds.ts';
import { buildFoundryScene } from '../src/renderer/export/foundry.ts';
import { buildRoomKeyMarkdown } from '../src/renderer/export/roomkey.ts';
import { buildUVTT } from '../src/renderer/export/uvtt.ts';
import { generateDungeon, ROCK } from '../src/renderer/generator.ts';
import type { Room } from '../src/renderer/generator.ts';
import { RNG } from '../src/renderer/rng.ts';
import { reachableFloor, floorCount, variants, assertConsistent } from './helpers.ts';

test('normalizing a freshly generated dungeon changes nothing', () => {
  for (const v of variants) {
    const d = generateDungeon({ ...v, seed: 'normalize' });
    const before = structuredClone({ rooms: d.rooms, doors: d.doors, stairs: d.stairs, roomIds: d.roomIds, windows: d.windows, props: d.props });
    normalizeDungeon(d);
    assert.deepEqual({ rooms: d.rooms, doors: d.doors, stairs: d.stairs, roomIds: d.roomIds, windows: d.windows, props: d.props }, before, JSON.stringify(v));
  }
});

test('drawing rooms, corridors, doors and stairs on a blank map', () => {
  const d = createBlankDungeon({ seed: 'blank', width: 30, height: 20 });
  assert.equal(d.rooms.length, 0);
  assert.ok(d.edited);
  const contents = stockNewRoom(d, new RNG('stock'));
  assert.ok(paintRoom(d, { x: 2, y: 2 }, { x: 7, y: 6 }, contents));
  assert.ok(paintRoom(d, { x: 20, y: 10 }, { x: 15, y: 14 }, stockNewRoom(d, new RNG('stock2'))));
  assert.equal(d.rooms.length, 2);
  assert.deepEqual([d.rooms[0]?.w, d.rooms[0]?.h, d.rooms[1]?.x, d.rooms[1]?.y], [6, 5, 15, 10]);
  assert.notEqual(d.rooms[0]?.contents?.name, d.rooms[1]?.contents?.name, 'new rooms avoid duplicate names');

  // Corridor from room 1's east wall to room 2, with a door where it leaves room 1.
  assert.ok(paintCorridor(d, [...lineCells({ x: 8, y: 4 }, { x: 11, y: 4 }), ...lineCells({ x: 11, y: 5 }, { x: 11, y: 11 }), ...lineCells({ x: 12, y: 11 }, { x: 14, y: 11 })]));
  assert.ok(cycleDoor(d, edgeAt(7.98, 4.5)));
  assert.equal(d.doors[0]?.type, 'normal');
  assert.equal(d.rooms[0]?.doorCount, 1);
  cycleDoor(d, edgeAt(7.98, 4.5));
  cycleDoor(d, edgeAt(7.98, 4.5));
  assert.equal(d.doors[0]?.type, 'secret');
  cycleDoor(d, edgeAt(7.98, 4.5));
  assert.equal(d.doors.length, 0, 'fourth click removes the door');
  assert.ok(!cycleDoor(d, edgeAt(1.02, 4.5)), 'no door on the outer wall');

  assert.ok(cycleStairs(d, { x: 3, y: 3 }));
  assert.ok(d.rooms[0]?.entrance);
  cycleStairs(d, { x: 3, y: 3 });
  assert.ok(d.rooms[0]?.exit && !d.rooms[0]?.entrance);

  // The whole floor plan is connected, so the existing exporters can trust it.
  assert.equal(reachableFloor(d), floorCount(d));
  assertConsistent(d, 'blank');
  assert.ok(buildFoundryScene(d, 100, 'x.png', 'X').walls.length > 0);
});

test('drawing over and erasing rooms keeps the room list consistent', () => {
  const d = createBlankDungeon({ seed: 'overlap', width: 30, height: 20 });
  paintRoom(d, { x: 2, y: 2 }, { x: 9, y: 9 }, stockNewRoom(d, new RNG(1)));
  paintRoom(d, { x: 6, y: 6 }, { x: 14, y: 12 }, stockNewRoom(d, new RNG(2)));
  assert.equal(d.rooms[0]?.shape, 'irregular', 'first room lost a corner');
  assert.equal(d.rooms[1]?.shape, 'rect');
  // Pillar inside the first room keeps its room membership.
  assert.ok(togglePillar(d, { x: 3, y: 3 }));
  assert.equal(d.roomIds[3 * d.width + 3], 0);
  // Covering the first room completely removes it and renumbers the second.
  paintRoom(d, { x: 1, y: 1 }, { x: 10, y: 10 }, stockNewRoom(d, new RNG(3)));
  assert.equal(d.rooms.length, 2);
  assertConsistent(d, 'covered');
  // Erasing the label square moves the label to another square of the room.
  const r = d.rooms[0] as Room;
  eraseCells(d, [{ x: r.cx, y: r.cy }]);
  assertConsistent(d, 'label moved');
  assert.ok(eraseCells(d, rectCells(d, { x: 0, y: 0 }, { x: 29, y: 19 })));
  assert.equal(d.rooms.length, 0);
  assertConsistent(d, 'erased');
});

test('random edits on generated maps never leave the dungeon inconsistent', () => {
  const rng = new RNG('fuzz');
  for (const v of variants) {
    const d = generateDungeon({ ...v, seed: 'fuzz' });
    for (let i = 0; i < 300; i++) {
      const a = { x: rng.int(-2, d.width + 1), y: rng.int(-2, d.height + 1) };
      const b = { x: a.x + rng.int(-6, 6), y: a.y + rng.int(-6, 6) };
      switch (rng.int(0, 6)) {
        case 0: paintRoom(d, a, b, stockNewRoom(d, rng)); break;
        case 1: paintCorridor(d, lineCells(a, b)); break;
        case 2: eraseCells(d, lineCells(a, b)); break;
        case 3: cycleDoor(d, edgeAt(a.x + rng.float(), a.y + rng.float())); break;
        case 4: togglePillar(d, a); break;
        case 5: {
          const k = rng.int(0, 2);
          if (k === 0) placeProp(d, a, rng.pick(PROP_KINDS));
          else if (k === 1) rotateProp(d, a);
          else removeProp(d, a);
          break;
        }
        default: cycleStairs(d, a);
      }
    }
    assertConsistent(d, JSON.stringify(v));
    // Exports still work on the edited map.
    buildUVTT(d, 50, '');
    buildFguModule(d, 50, new Uint8Array(1), new Uint8Array(1));
    buildRoomKeyMarkdown(d);
  }
});

test('undo snapshots restore the exact previous map', () => {
  const d = generateDungeon({ seed: 'undo' });
  const before = snapshot(d);
  const original = structuredClone({ cells: d.cells, roomIds: d.roomIds, rooms: d.rooms, doors: d.doors, stairs: d.stairs });
  eraseCells(d, rectCells(d, { x: 0, y: 0 }, { x: 20, y: 20 }));
  restore(d, before);
  assert.deepEqual({ cells: d.cells, roomIds: d.roomIds, rooms: d.rooms, doors: d.doors, stairs: d.stairs }, original);
  assert.ok(!d.edited);
});

test('4-connected lines have no diagonal steps', () => {
  for (const [a, b] of [[{ x: 0, y: 0 }, { x: 7, y: 3 }], [{ x: 5, y: 5 }, { x: -2, y: 9 }], [{ x: 3, y: 3 }, { x: 3, y: 3 }]] as const) {
    const line = lineCells(a, b);
    assert.deepEqual(line[0], a);
    assert.deepEqual(line[line.length - 1], b);
    for (let i = 1; i < line.length; i++) {
      const p = line[i - 1] as { x: number; y: number };
      const q = line[i] as { x: number; y: number };
      assert.equal(Math.abs(p.x - q.x) + Math.abs(p.y - q.y), 1);
    }
  }
});

test('window tool and edits keep windows on real walls', () => {
  const d = createBlankDungeon({ seed: 'window-edit', width: 30, height: 20 });
  paintRoom(d, { x: 5, y: 5 }, { x: 10, y: 9 }, stockNewRoom(d, new RNG('w')));
  const north = edgeAt(7.5, 5.02);
  assert.ok(toggleWindow(d, north));
  assert.equal(d.windows[0]?.room, 0);
  assert.ok(!toggleWindow(d, edgeAt(7.5, 7.02)), 'no window between two floor squares');
  // Digging a corridor behind the window turns its wall into an opening, so the window goes.
  paintCorridor(d, [{ x: 7, y: 4 }]);
  assert.equal(d.windows.length, 0);
  assertConsistent(d, 'window edit');
  eraseCells(d, [{ x: 7, y: 4 }]);
  toggleWindow(d, north);
  assert.ok(toggleWindow(d, north), 'second click removes it');
  assert.equal(d.windows.length, 0);
});

test('clutter tool places exactly the chosen prop, turns it, and removes it', () => {
  const d = createBlankDungeon({ seed: 'clutter-edit', width: 30, height: 20 });
  paintRoom(d, { x: 4, y: 4 }, { x: 12, y: 10 }, stockNewRoom(d, new RNG('c')));

  // Against the west wall a bed runs along the wall (vertically); mid-room it lies horizontally.
  assert.ok(placeProp(d, { x: 4, y: 6 }, 'bed'));
  assert.deepEqual(d.props[0], { x: 4, y: 6, kind: 'bed', vertical: true, room: 0 });
  assert.ok(placeProp(d, { x: 8, y: 7 }, 'bed'), 'the editor lets beds go anywhere');
  assert.deepEqual(d.props[1], { x: 8, y: 7, kind: 'bed', vertical: false, room: 0 });
  assert.ok(!placeProp(d, { x: 4, y: 7 }, 'crate'), 'no stacking on another prop');

  // Same click, same result: placement is predictable.
  const twin = createBlankDungeon({ seed: 'other', width: 30, height: 20 });
  paintRoom(twin, { x: 4, y: 4 }, { x: 12, y: 10 }, stockNewRoom(twin, new RNG('c')));
  placeProp(twin, { x: 4, y: 6 }, 'bed');
  placeProp(twin, { x: 8, y: 7 }, 'bed');
  assert.deepEqual(twin.props, d.props);

  // Turning keeps the clicked square covered; clicking the far end still works.
  assert.ok(rotateProp(d, { x: 9, y: 7 }));
  assert.ok(footprint(d.props[1] as never).some((f) => f.x === 9 && f.y === 7));
  assert.equal(d.props[1]?.vertical, true);
  assert.ok(!rotateProp(d, { x: 6, y: 9 }), 'nothing to turn on an empty square');
  placeProp(d, { x: 11, y: 9 }, 'barrel');
  assert.ok(!rotateProp(d, { x: 11, y: 9 }), 'one-square props do not turn');

  assert.ok(removeProp(d, { x: 4, y: 7 }), 'clicking either square removes it');
  assert.equal(propAt(d, 4, 6), -1);

  // Stairs win over clutter, and erasing the floor removes the prop.
  cycleStairs(d, { x: 11, y: 9 });
  assert.equal(propAt(d, 11, 9), -1);
  const bed = d.props[0];
  assert.ok(bed);
  eraseCells(d, footprint(bed));
  assert.equal(d.props.length, 0);
  assertConsistent(d, 'clutter edit');
});

test('every prop can be placed from the editor somewhere in an open room', () => {
  for (const kind of PROP_KINDS) {
    const d = createBlankDungeon({ seed: `place-${kind}`, width: 20, height: 16 });
    paintRoom(d, { x: 3, y: 3 }, { x: 10, y: 9 }, stockNewRoom(d, new RNG(kind)));
    assert.ok(placeProp(d, { x: 6, y: 6 }, kind), kind);
    assert.ok(fitProp(d, kind, { x: 3, y: 3 }, editorFree(d)), `${kind} fits a corner too`);
  }
  assert.ok(settingProps('scifi').includes('pod') && !settingProps('fantasy').includes('pod'));
});

test('stairs cycle up, down, then off; only on editable floor', () => {
  const d = createBlankDungeon({ seed: 'stairs', width: 20, height: 16 });
  paintRoom(d, { x: 3, y: 3 }, { x: 8, y: 8 }, stockNewRoom(d, new RNG('s')));
  const spot = { x: 3, y: 5 };
  cycleStairs(d, spot);
  assert.equal(d.stairs[0]?.dir, 2, 'leans against the west wall');
  cycleStairs(d, spot);
  assert.ok(cycleStairs(d, spot));
  assert.equal(d.stairs.length, 0);
  assert.ok(!cycleStairs(d, { x: 12, y: 12 }), 'not on rock');
  assert.ok(!cycleStairs(d, { x: 0, y: 5 }), 'not on the border');
});

test('a prop will not turn into another room', () => {
  const d = createBlankDungeon({ seed: 'turn', width: 20, height: 16 });
  paintRoom(d, { x: 3, y: 3 }, { x: 8, y: 8 }, stockNewRoom(d, new RNG('a')));
  paintRoom(d, { x: 3, y: 9 }, { x: 8, y: 12 }, stockNewRoom(d, new RNG('b'))); // directly below, sharing an edge
  assert.ok(placeProp(d, { x: 5, y: 8 }, 'table'));
  // Turning upright would need (5, 9) or (5, 7)+(5, 8): the first is in the other room.
  assert.ok(rotateProp(d, { x: 5, y: 8 }));
  const p = d.props[0];
  assert.deepEqual([p?.x, p?.y, p?.vertical], [5, 7, true], 'it turned upward, staying in its own room');
});

test('a prop with no room to turn stays as it is', () => {
  const d = createBlankDungeon({ seed: 'narrow', width: 20, height: 16 });
  paintRoom(d, { x: 3, y: 5 }, { x: 12, y: 5 }, stockNewRoom(d, new RNG('n'))); // one square tall
  assert.ok(placeProp(d, { x: 6, y: 5 }, 'table'));
  assert.ok(!rotateProp(d, { x: 6, y: 5 }));
  assert.equal(d.props[0]?.vertical, false);
});

test('Clear wipes everything, and does nothing on an empty map', () => {
  const d = generateDungeon({ seed: 'clear', windowChance: 1, clutter: 1 });
  assert.ok(clearMap(d));
  assert.ok(d.cells.every((t) => t === ROCK) && d.roomIds.every((id) => id === -1));
  assert.deepEqual([d.rooms, d.doors, d.windows, d.stairs, d.props], [[], [], [], [], []]);
  assert.ok(d.edited);
  assert.ok(!clearMap(d));
});
