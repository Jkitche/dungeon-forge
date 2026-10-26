// Edit mode: pointer gestures to editor operations, undo history, and the preview overlay.

import { test } from "node:test";
import assert from "node:assert/strict";
import { LIGHT_RADII, MapEditor, TOOLS } from "../src/renderer/editor-ui.ts";
import type { EditorHost } from "../src/renderer/editor-ui.ts";
import { createBlankDungeon, stockNewRoom } from "../src/renderer/editor.ts";
import { CORRIDOR, ROCK, ROOM } from "../src/renderer/cells.ts";
import { propAt } from "../src/renderer/clutter.ts";
import { RNG } from "../src/renderer/rng.ts";
import type { Dungeon } from "../src/renderer/generator.ts";
import { drawnText, recordingContext } from "./helpers.ts";

interface Harness {
  d: Dungeon;
  editor: MapEditor;
  changes: () => number;
  redraws: () => number;
}

function harness(): Harness {
  const d = createBlankDungeon({ seed: "ui", width: 30, height: 20 });
  let changes = 0;
  let redraws = 0;
  const host: EditorHost = {
    dungeon: () => d,
    // Fake events carry their grid position directly.
    toGrid: (e) => e as unknown as { fx: number; fy: number },
    changed: () => changes++,
    redrawOverlay: () => redraws++,
    newRoomContents: (dd) => stockNewRoom(dd, new RNG("ui-room")),
  };
  const editor = new MapEditor(host);
  editor.active = true;
  return { d, editor, changes: () => changes, redraws: () => redraws };
}

const at = (fx: number, fy: number, shiftKey = false): PointerEvent =>
  ({ fx, fy, shiftKey }) as unknown as PointerEvent;

/** Press, move through the given points, release. */
function drag(
  editor: MapEditor,
  points: [number, number][],
  shift = false,
): void {
  const [first, ...rest] = points;
  editor.pointerDown(at(...(first as [number, number]), shift));
  for (const p of rest) editor.pointerMove(at(...p, shift));
  editor.pointerUp();
}

const click = (
  editor: MapEditor,
  fx: number,
  fy: number,
  shift = false,
): void => {
  editor.pointerDown(at(fx, fy, shift));
  editor.pointerUp();
};

const cell = (d: Dungeon, x: number, y: number): number =>
  d.cells[y * d.width + x] as number;

test("every tool has a unique id and shortcut key", () => {
  assert.equal(new Set(TOOLS.map((t) => t.id)).size, TOOLS.length);
  assert.equal(new Set(TOOLS.map((t) => t.key)).size, TOOLS.length);
  for (const t of TOOLS) assert.match(t.key, /^[a-z]$/);
});

test("dragging with the Room tool draws one room, as one undo step", () => {
  const h = harness();
  drag(h.editor, [
    [3.5, 3.5],
    [6.2, 5.1],
    [8.5, 6.5],
  ]);
  assert.equal(h.d.rooms.length, 1);
  assert.deepEqual(
    [h.d.rooms[0]?.x, h.d.rooms[0]?.y, h.d.rooms[0]?.w, h.d.rooms[0]?.h],
    [3, 3, 6, 4],
  );
  assert.equal(h.changes(), 1);
  assert.ok(h.editor.canUndo && !h.editor.canRedo);
  assert.ok(!h.editor.dragging);
});

test("a fast corridor stroke leaves no gaps; Shift fills a rectangle", () => {
  const h = harness();
  h.editor.setTool("corridor");
  // Two far-apart samples, as from a fast mouse movement.
  drag(h.editor, [
    [2.5, 10.5],
    [12.5, 13.5],
  ]);
  const painted = (): number => h.d.cells.filter((t) => t === CORRIDOR).length;
  assert.equal(
    painted(),
    10 + 3 + 1,
    "a 4-connected path: one square per step across and down, plus the start",
  );
  drag(
    h.editor,
    [
      [15.5, 2.5],
      [17.5, 4.5],
    ],
    true,
  );
  assert.equal(painted(), 14 + 9, "the 3x3 rectangle");
});

test("the Erase tool peels a room back one layer per stroke: room, corridor, rock", () => {
  const h = harness();
  drag(h.editor, [
    [3.5, 3.5],
    [8.5, 6.5],
  ]);
  h.editor.setTool("erase");
  const sweep = () =>
    drag(
      h.editor,
      [
        [3.5, 3.5],
        [8.5, 6.5],
      ],
      true,
    );
  sweep();
  assert.equal(h.d.rooms.length, 0, "the room is gone");
  assert.equal(
    h.d.cells.filter((t) => t === CORRIDOR).length,
    24,
    "its floor is corridor now",
  );
  sweep();
  assert.ok(
    h.d.cells.every((t) => t === ROCK),
    "then rock",
  );
  assert.ok(!h.editor.canRedo);
});

test("erasing a square takes off what stands on it first, and leaves the floor", () => {
  const h = harness();
  drag(h.editor, [
    [3.5, 3.5],
    [10.5, 9.5],
  ]);
  const room = h.d.rooms[0];
  assert.ok(room?.contents);
  room.contents.monster = "Skeletons (1d4+1)";
  h.editor.setTool("clutter");
  h.editor.propKind = "table";
  click(h.editor, 5.5, 5.5); // covers (5,5) and (6,5)
  h.editor.setTool("lighting");
  click(h.editor, 5.5, 5.5);
  h.editor.setTool("monster");
  click(h.editor, 8.5, 8.5);
  assert.deepEqual(
    [h.d.props.length, h.d.lights.length, h.d.monsters.length],
    [1, 1, 1],
  );

  // One stroke across the table's second square and the token: they go, the floor stays.
  h.editor.setTool("erase");
  drag(h.editor, [
    [6.5, 5.5],
    [6.5, 8.5],
    [8.5, 8.5],
  ]);
  assert.deepEqual([h.d.props.length, h.d.monsters.length], [0, 0]);
  assert.equal(h.d.lights.length, 1, "the light was on another square");
  assert.equal(cell(h.d, 6, 5), ROOM, "still room floor");
  assert.equal(cell(h.d, 8, 8), ROOM);
  assert.equal(
    cell(h.d, 6, 6),
    CORRIDOR,
    "an empty square along the stroke goes down one layer",
  );
  assert.equal(h.d.rooms.length, 1, "the room is still there");

  // A pillar comes off before the floor under it.
  h.editor.setTool("pillar");
  click(h.editor, 9.5, 4.5);
  h.editor.setTool("erase");
  click(h.editor, 9.5, 4.5);
  assert.equal(cell(h.d, 9, 4), ROOM);
});

test("click tools act straight away: doors, windows, pillars and stairs", () => {
  const h = harness();
  drag(h.editor, [
    [3.5, 3.5],
    [8.5, 6.5],
  ]);
  h.editor.setTool("corridor");
  drag(h.editor, [
    [9.5, 4.5],
    [12.5, 4.5],
  ]);

  h.editor.setTool("door");
  click(h.editor, 8.98, 4.5);
  assert.equal(h.d.doors[0]?.type, "normal");
  click(h.editor, 8.98, 4.5);
  assert.equal(h.d.doors[0]?.type, "locked");

  h.editor.setTool("window");
  click(h.editor, 5.5, 3.02);
  assert.equal(h.d.windows.length, 1);

  h.editor.setTool("pillar");
  click(h.editor, 5.5, 5.5);
  assert.notEqual(cell(h.d, 5, 5), ROOM);

  h.editor.setTool("stairs");
  click(h.editor, 4.5, 4.5);
  assert.equal(h.d.stairs[0]?.kind, "up");
  assert.equal(h.changes(), 7);
});

test("the Clutter tool places the chosen prop; clicking removes it, Shift-click turns it", () => {
  const h = harness();
  drag(h.editor, [
    [3.5, 3.5],
    [12.5, 9.5],
  ]);
  h.editor.setTool("clutter");
  h.editor.propKind = "table";
  click(h.editor, 6.5, 6.5);
  assert.deepEqual(h.d.props[0], {
    x: 6,
    y: 6,
    kind: "table",
    vertical: false,
    room: 0,
  });
  click(h.editor, 7.5, 6.5, true);
  assert.equal(h.d.props[0]?.vertical, true, "turned");
  click(h.editor, 7.5, 6.5);
  assert.equal(propAt(h.d, 7, 6), -1, "removed");
});

test("undo and redo step through edits; a new edit clears redo", () => {
  const h = harness();
  drag(h.editor, [
    [3.5, 3.5],
    [8.5, 6.5],
  ]);
  drag(h.editor, [
    [15.5, 10.5],
    [20.5, 14.5],
  ]);
  assert.equal(h.d.rooms.length, 2);
  h.editor.undo();
  assert.equal(h.d.rooms.length, 1);
  assert.ok(h.editor.canRedo);
  h.editor.redo();
  assert.equal(h.d.rooms.length, 2);
  h.editor.undo();
  drag(h.editor, [
    [3.5, 12.5],
    [6.5, 15.5],
  ]);
  assert.ok(!h.editor.canRedo, "redo history is dropped");
  h.editor.undo();
  h.editor.undo();
  assert.equal(h.d.rooms.length, 0);
  assert.ok(!h.editor.canUndo);
  h.editor.undo(); // nothing left: no error, no change
  assert.equal(h.d.rooms.length, 0);
});

test("edits that change nothing are not added to the history", () => {
  const h = harness();
  h.editor.setTool("pillar");
  click(h.editor, 5.5, 5.5); // solid rock
  h.editor.setTool("door");
  click(h.editor, 5.5, 5.5);
  assert.ok(!h.editor.canUndo);
  assert.equal(h.changes(), 0);
});

test("the history keeps the last 100 edits", () => {
  const h = harness();
  h.editor.setTool("stairs");
  drag(h.editor, [
    [1.5, 1.5],
    [28.5, 18.5],
  ]); // nothing: stairs is a click tool, and this is rock
  h.editor.setTool("room");
  drag(h.editor, [
    [2.5, 2.5],
    [27.5, 17.5],
  ]);
  h.editor.setTool("stairs");
  for (let i = 0; i < 105; i++) click(h.editor, 5.5, 5.5);
  let undos = 0;
  while (h.editor.canUndo) {
    h.editor.undo();
    undos++;
  }
  assert.equal(undos, 100);
  assert.equal(h.d.rooms.length, 1, "the oldest edits fell off the end");
});

test("cancelling or switching tools mid-drag discards the drag", () => {
  const h = harness();
  h.editor.pointerDown(at(3.5, 3.5));
  h.editor.pointerMove(at(8.5, 6.5));
  h.editor.cancelDrag();
  h.editor.pointerUp();
  h.editor.pointerDown(at(3.5, 3.5));
  h.editor.setTool("corridor");
  h.editor.pointerUp();
  assert.equal(h.d.rooms.length, 0);
  assert.ok(!h.editor.canUndo);
});

test("reset forgets the history", () => {
  const h = harness();
  drag(h.editor, [
    [3.5, 3.5],
    [8.5, 6.5],
  ]);
  h.editor.reset();
  assert.ok(!h.editor.canUndo && !h.editor.canRedo);
});

test("the overlay previews drags and hovers, and draws nothing when inactive", () => {
  const h = harness();
  const overlay = (): ReturnType<typeof recordingContext> => {
    const rec = recordingContext();
    h.editor.drawOverlay(rec.ctx, 40);
    return rec;
  };

  h.editor.active = false;
  h.editor.pointerMove(at(5.5, 5.5));
  assert.equal(overlay().calls.length, 0);
  h.editor.active = true;

  // A room drag shows its squares and its size in feet.
  h.editor.pointerDown(at(3.5, 3.5));
  h.editor.pointerMove(at(8.5, 6.5));
  const room = overlay();
  assert.ok(
    room.calls.filter((c) => c.name === "fillRect").length >= 24,
    "the 6x4 squares are shaded",
  );
  assert.ok(drawnText(room).includes("30 × 20 ft"));
  h.editor.pointerUp();

  // The door tool highlights the edge under the pointer.
  h.editor.setTool("door");
  h.editor.pointerMove(at(5.5, 3.03));
  const door = overlay();
  assert.ok(door.calls.some((c) => c.name === "lineTo"));

  // The clutter tool shows where the chosen prop would land.
  h.editor.setTool("clutter");
  h.editor.propKind = "bed";
  h.editor.pointerMove(at(5.5, 5.5));
  const ghost = overlay().calls.filter((c) => c.name === "fillRect");
  assert.equal(ghost.length, 2, "a two-square ghost");

  // Over solid rock the ghost turns into a red square: nothing can go there.
  h.editor.pointerMove(at(20.5, 15.5));
  const blocked = overlay();
  assert.equal(blocked.calls.filter((c) => c.name === "fillRect").length, 1);
  assert.ok(
    blocked.styles.some((st) => String(st).startsWith("rgba(220, 70, 60")),
    "shown in red",
  );

  // Hovering an existing prop outlines all of it, ready to remove or turn.
  click(h.editor, 5.5, 5.5);
  h.editor.pointerMove(at(5.5, 5.5));
  assert.equal(
    overlay().calls.filter((c) => c.name === "strokeRect").length,
    2,
    "both squares of the bed",
  );

  // Other tools outline the single square under the pointer.
  h.editor.setTool("pillar");
  h.editor.pointerMove(at(4.5, 4.5));
  assert.equal(
    overlay().calls.filter((c) => c.name === "strokeRect").length,
    1,
  );

  h.editor.pointerLeave();
  const drawing = overlay().calls.filter(
    (c) => c.name !== "save" && c.name !== "restore",
  );
  assert.equal(drawing.length, 0, "nothing once the pointer leaves");
  assert.ok(h.redraws() > 0);
});

test("the Lighting tool places lights of the chosen radius; clicking removes one, Shift-click resizes it", () => {
  const h = harness();
  drag(h.editor, [
    [3.5, 3.5],
    [10.5, 9.5],
  ]);
  h.editor.setTool("lighting");
  h.editor.lightRadius = 6;
  click(h.editor, 5.5, 5.5);
  assert.deepEqual(
    h.d.lights.map((l) => [l.x, l.y, l.radius]),
    [[5, 5, 6]],
  );
  click(h.editor, 20.5, 15.5);
  assert.equal(h.d.lights.length, 1, "not on rock");

  h.editor.lightRadius = 2;
  click(h.editor, 5.5, 5.5, true);
  assert.equal(
    h.d.lights[0]?.radius,
    2,
    "Shift-click gives it the chosen radius",
  );
  click(h.editor, 5.5, 5.5);
  assert.equal(h.d.lights.length, 0, "a plain click removes it");
  h.editor.undo();
  assert.equal(h.d.lights.length, 1);
});

test("radius choices run from candle to 60 ft, smallest first", () => {
  const radii = LIGHT_RADII.map(([r]) => r);
  assert.deepEqual(
    radii,
    [...radii].sort((a, b) => a - b),
  );
  assert.equal(radii[0], 1);
  assert.equal(radii.at(-1), 12);
  assert.ok(
    LIGHT_RADII.some(([r, label]) => r === 4 && label.includes("torch")),
  );
});

test("the Lighting tool shows every light and its reach, and where a new one would go", () => {
  const h = harness();
  drag(h.editor, [
    [3.5, 3.5],
    [10.5, 9.5],
  ]);
  h.editor.setTool("lighting");
  click(h.editor, 5.5, 5.5);
  const overlay = (): ReturnType<typeof recordingContext> => {
    const rec = recordingContext();
    h.editor.drawOverlay(rec.ctx, 40);
    return rec;
  };
  const arcs = (rec: ReturnType<typeof recordingContext>) =>
    rec.calls.filter((c) => c.name === "arc").map((c) => c.args[2]);

  h.editor.lightRadius = 3;
  h.editor.pointerMove(at(8.5, 7.5));
  assert.deepEqual(
    arcs(overlay()),
    [40 * 0.14, 4 * 40, 3 * 40],
    "the light, its reach, and a new one's reach",
  );
  h.editor.pointerMove(at(5.5, 5.5));
  assert.deepEqual(
    arcs(overlay()),
    [40 * 0.14, 4 * 40],
    "over a light: no new ring",
  );
  h.editor.pointerMove(at(20.5, 15.5));
  assert.ok(
    overlay().styles.some((st) => String(st).startsWith("rgba(220, 70, 60")),
    "red over rock",
  );

  h.editor.setTool("clutter");
  h.editor.pointerMove(at(8.5, 7.5));
  assert.deepEqual(arcs(overlay()), [], "other tools hide the lights");
});

test("the Lighting tool mounts a torch when clicked close to a wall, and shows which wall", () => {
  const h = harness();
  drag(h.editor, [
    [3.5, 3.5],
    [10.5, 9.5],
  ]);
  h.editor.setTool("lighting");
  const overlay = (): ReturnType<typeof recordingContext> => {
    const rec = recordingContext();
    h.editor.drawOverlay(rec.ctx, 40);
    return rec;
  };
  h.editor.pointerMove(at(6.5, 3.1));
  const hover = overlay();
  assert.ok(
    hover.calls.some((c) => c.name === "lineTo"),
    "the wall is highlighted",
  );
  assert.ok(
    !hover.calls.some((c) => c.name === "strokeRect"),
    "not the square",
  );
  click(h.editor, 6.5, 3.1);
  assert.deepEqual(
    h.d.lights.map((l) => [l.x, l.y, l.wall]),
    [[6, 3, 3]],
  );
  click(h.editor, 6.5, 3.15);
  assert.equal(h.d.lights.length, 0, "clicking the torch again takes it down");
});

test("the Monster tool places and removes tokens, and Place all is one undo step", () => {
  const h = harness();
  drag(h.editor, [
    [3.5, 3.5],
    [10.5, 9.5],
  ]);
  const room = h.d.rooms[0];
  assert.ok(room?.contents);
  room.contents.monster = "Skeletons (1d4+1)";
  h.editor.setTool("monster");
  click(h.editor, 5.5, 5.5);
  assert.deepEqual(h.d.monsters, [{ x: 5, y: 5, room: 0 }]);
  click(h.editor, 5.5, 5.5);
  assert.deepEqual(h.d.monsters, [], "clicking a token removes it");
  click(h.editor, 20.5, 15.5);
  assert.deepEqual(h.d.monsters, [], "not on rock");

  h.editor.placeAllMonsters();
  assert.equal(h.d.monsters.length, 4, "1d4+1 averages 4");
  h.editor.undo();
  assert.equal(h.d.monsters.length, 0, "one undo takes them all back");

  const overlay = (fx: number, fy: number) => {
    h.editor.pointerMove(at(fx, fy));
    const rec = recordingContext();
    h.editor.drawOverlay(rec.ctx, 40);
    return rec;
  };
  assert.ok(
    overlay(5.5, 5.5).styles.includes("rgba(212, 162, 76, 0.95)"),
    "a ring where it would go",
  );
  assert.ok(
    overlay(20.5, 15.5).styles.some((s) =>
      String(s).startsWith("rgba(220, 70, 60"),
    ),
    "red where it can't",
  );
});
