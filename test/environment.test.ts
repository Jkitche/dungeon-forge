// Room environments: detected from a room's own description and shown in the room key;
// cold and heat also fill their room and seep out through its doorways.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ENVIRONMENTS,
  SPREAD,
  detectEnvironment,
  environmentField,
  environmentOpenings,
} from "../src/renderer/environment.ts";
import type { Environment } from "../src/renderer/environment.ts";
import type { RoomContents } from "../src/renderer/contents.ts";
import {
  deserializeDungeon,
  generateDungeon,
  serializeDungeon,
} from "../src/renderer/generator.ts";
import { GENRE_KEYS } from "../src/renderer/genres.ts";
import {
  createBlankDungeon,
  cycleDoor,
  edgeAt,
  lineCells,
  paintCorridor,
  paintRoom,
} from "../src/renderer/editor.ts";
import { ROCK } from "../src/renderer/cells.ts";

const room = (
  atmosphere: string,
  extra: Partial<RoomContents> = {},
): RoomContents => ({
  name: "Chamber",
  kind: "empty",
  atmosphere,
  feature: "a bare floor",
  monster: null,
  trap: null,
  special: null,
  treasure: null,
  note: null,
  ...extra,
});

test("rooms take their environment from their own description", () => {
  const cases: [string, Partial<RoomContents>, Environment | null][] = [
    ["Frost rimes every metal surface.", {}, "frost"],
    ["Frost spreads across the glass in the shape of handprints.", {}, "frost"],
    ["The air recyclers have failed; breath fogs in the cold.", {}, "frost"],
    ["", { name: "Cryo Bay" }, "frost"],
    ["Heat radiates from the walls like an oven.", {}, "heat"],
    ["", { name: "Boiler Room" }, "heat"],
    ["Steam hisses from leaking valves.", {}, "heat"],
    ["Moss glows a faint, sickly green.", {}, "fungus"],
    ["Puddles glow a faint, sickly green.", {}, "toxic"],
    ["", { name: "Rad Pool" }, "toxic"],
    ["The floor is slick with black water.", {}, "water"],
    ["", { name: "Cistern" }, "water"],
    ["Coal smoke hangs thick under the ceiling.", {}, "smoke"],
    ["Scorch marks from blaster fire stripe the bulkheads.", {}, "smoke"],
    ["Dust lies thick and undisturbed.", {}, null],
    ["", { name: "Magma Vent" }, "lava"],
    ["", { name: "Molten Slag Run" }, "lava"],
    ["Flames lick up from cracks in the floor.", {}, "fire"],
    ["A furnace door hangs open, flames roaring within.", {}, "fire"],
    ["A sheet of ice covers the floor.", {}, "ice"],
    ["", { name: "Ice Cavern" }, "ice"],
    ["", { name: "Frozen Lake" }, "ice"],
    ["Icicles hang from the ceiling like teeth.", {}, "ice"],
    ["Cobwebs drape every corner.", {}, "webs"],
    ["", { name: "Spider Nest" }, "webs"],
    ["", { name: "Crystal Hollow" }, "crystals"],
  ];
  for (const [atmosphere, extra, env] of cases)
    assert.equal(
      detectEnvironment(room(atmosphere, extra)),
      env,
      `${atmosphere} ${extra.name ?? ""}`,
    );
});

test("near misses do not count", () => {
  assert.equal(
    detectEnvironment(room("", { feature: "a steam-powered loom" })),
    null,
  );
  assert.equal(
    detectEnvironment(room("", { feature: "a cold firepit" })),
    null,
  );
  assert.equal(
    detectEnvironment(room("", { feature: "a dry fountain" })),
    null,
  );
  assert.equal(
    detectEnvironment(room("Gaslights sputter and cast dancing shadows.")),
    null,
  );
  // "Frozen" as in stuck, not icy.
  assert.equal(
    detectEnvironment(
      room("", { feature: "a maintenance robot frozen mid-task" }),
    ),
    null,
  );
  assert.equal(
    detectEnvironment(
      room("Every screen shows the same frozen error message."),
    ),
    null,
  );
  assert.equal(
    detectEnvironment(
      room("", { feature: "a cryo tube fogged from the inside" }),
    ),
    null,
    "one fixture is not an icy room",
  );
  assert.equal(
    detectEnvironment(room("A thin film of coolant slicks the floor.")),
    "water",
    "coolant is a liquid",
  );
  assert.equal(
    detectEnvironment(
      room("The deck plates thrum with the reactor's heartbeat."),
    ),
    null,
    "a mention is not a reactor core",
  );
  assert.equal(detectEnvironment(room("", { name: "Reactor Core" })), "heat");
  assert.equal(
    detectEnvironment(room("Sparks spit from a severed conduit overhead.")),
    null,
    "a few sparks do not make a room hot",
  );
  assert.equal(
    detectEnvironment(room("The walls are scorched from an old fire.")),
    "smoke",
    "old burns are smoke, not fire",
  );
  assert.equal(
    detectEnvironment(room("The air tastes of ozone and burnt insulation.")),
    "smoke",
  );
  assert.equal(
    detectEnvironment(
      room("Frost rimes the walls and a sheet of ice covers the floor."),
    ),
    "ice",
    "solid ice outranks rime",
  );
  assert.equal(
    detectEnvironment(
      room("", { name: "Crystal Hollow", feature: "a cracked crystal ball" }),
    ),
    "crystals",
  );
  assert.equal(
    detectEnvironment(
      room("Dust lies thick and undisturbed.", {
        feature: "a cracked crystal ball",
      }),
    ),
    null,
  );
  assert.equal(detectEnvironment(null), null);
});

test("a room's furniture does not set its environment", () => {
  assert.equal(
    detectEnvironment(
      room("Dust lies thick and undisturbed.", {
        feature: "a well with a frayed rope",
      }),
    ),
    null,
  );
  assert.equal(
    detectEnvironment(
      room("Dust lies thick and undisturbed.", {
        special: "A fountain whose water heals 1d8 once per creature.",
      }),
    ),
    null,
  );
});

test("hidden traps never count", () => {
  const trapped = room("Dust lies thick and undisturbed.", {
    kind: "trap",
    trap: "A coolant leak fills the room with freezing gas.",
  });
  assert.equal(
    detectEnvironment(trapped),
    null,
    "an unsprung freezing-gas trap must not give itself away",
  );
});

test("generated rooms carry the environment their description implies, in every setting", () => {
  const seen = new Set<Environment>();
  for (const genre of GENRE_KEYS) {
    for (let i = 0; i < 15; i++) {
      for (const algorithm of ["rooms", "caves"] as const) {
        const d = generateDungeon({
          seed: `env-${i}`,
          genre,
          algorithm,
          roomCount: 20,
        });
        for (const r of d.rooms) {
          assert.equal(r.environment, detectEnvironment(r.contents));
          if (r.environment) seen.add(r.environment);
        }
      }
    }
  }
  assert.deepEqual(
    [...seen].sort(),
    (Object.keys(ENVIRONMENTS) as Environment[]).sort(),
    "every environment turns up somewhere",
  );
});

test("maps saved before environments existed work them out on opening", () => {
  const d = generateDungeon({ seed: "old-env", genre: "scifi", roomCount: 20 });
  const saved = JSON.parse(JSON.stringify(serializeDungeon(d)));
  for (const r of saved.rooms) delete r.environment;
  saved.rooms[0].environment = "quicksand"; // not a real environment
  const back = deserializeDungeon(saved);
  back.rooms.forEach((r, i) =>
    assert.equal(
      r.environment,
      detectEnvironment(d.rooms[i]?.contents),
      `room ${i}`,
    ),
  );
});

/**
 * A frozen 6x5 room with an open archway east, a closed door north and a secret door
 * south, each leading into a corridor.
 */
function frozenRoom() {
  const d = createBlankDungeon({ seed: "spill", width: 20, height: 16 });
  paintRoom(
    d,
    { x: 5, y: 5 },
    { x: 10, y: 9 },
    room("Frost rimes every metal surface."),
  );
  paintCorridor(d, lineCells({ x: 7, y: 4 }, { x: 7, y: 1 }));
  paintCorridor(d, lineCells({ x: 11, y: 7 }, { x: 18, y: 7 }));
  paintCorridor(d, lineCells({ x: 8, y: 10 }, { x: 8, y: 14 }));
  cycleDoor(d, edgeAt(7.5, 5.02));
  for (let k = 0; k < 3; k++) cycleDoor(d, edgeAt(8.5, 9.98));
  assert.deepEqual(d.doors.map((o) => o.type).sort(), ["normal", "secret"]);
  return d;
}

test("the effect fills its room and fades out along each corridor", () => {
  const d = frozenRoom();
  const field = environmentField(d);
  const at = (x: number, y: number) => field.get(y * d.width + x);
  for (let y = 5; y <= 9; y++)
    for (let x = 5; x <= 10; x++)
      assert.deepEqual(at(x, y), { env: "frost", intensity: 1, source: true });

  // East, through the open archway: strongest first, fading, gone past the spread.
  const east = [11, 12, 13, 14].map((x) => at(x, 7)?.intensity ?? 0);
  assert.ok(
    east.every((v, i) => i === 0 || v < (east[i - 1] as number)),
    `fades: ${east}`,
  );
  assert.equal(
    at(11 + (SPREAD.frost as number), 7),
    undefined,
    "stops after the spread",
  );

  // North, under a closed door: the same shape, but weaker.
  const north = at(7, 4)?.intensity ?? 0;
  assert.ok(
    north > 0 && north < (east[0] as number),
    "a door lets less through than an archway",
  );

  // South, behind the secret door: nothing.
  for (let y = 10; y <= 14; y++)
    assert.equal(at(8, y), undefined, "secret doors keep their secret");

  for (const c of field.keys())
    assert.notEqual(d.cells[c], ROCK, "never on rock");
});

test("rooms without an environment affect nothing", () => {
  const d = frozenRoom();
  (d.rooms[0] as { environment: Environment | null }).environment = null;
  assert.equal(environmentField(d).size, 0);
  assert.equal(environmentOpenings(d).length, 0);
});

test("cold and heat pour out of each doorway once, never out of secret doors", () => {
  const d = frozenRoom();
  const openings = environmentOpenings(d);
  assert.equal(openings.length, 2, "the archway and the door");
  const east = openings.find((o) => o.dx === 1);
  const north = openings.find((o) => o.dy === -1);
  assert.deepEqual([east?.x, east?.y, east?.strength], [11, 7.5, 1]);
  assert.ok(north && north.strength < 1 && north.y === 5);

  // A corridor running alongside the room touches it on several squares: one plume, not several.
  const side = createBlankDungeon({ seed: "side", width: 20, height: 16 });
  paintRoom(
    side,
    { x: 5, y: 5 },
    { x: 10, y: 9 },
    room("Heat radiates from the walls like an oven."),
  );
  paintCorridor(side, lineCells({ x: 5, y: 10 }, { x: 10, y: 10 }));
  const plumes = environmentOpenings(side);
  assert.ok(
    plumes.length > 0 && plumes.length < 6,
    `${plumes.length} plumes for 6 touching squares`,
  );
  for (const p of plumes) {
    for (const q of plumes)
      if (p !== q)
        assert.ok(Math.hypot(p.x - q.x, p.y - q.y) >= 1.5, "spaced apart");
  }
});

test("only cold and heat bleed out; other conditions stay as room key tags", () => {
  const d = frozenRoom();
  (d.rooms[0] as { environment: Environment | null }).environment = "water";
  assert.equal(environmentField(d).size, 0);
  assert.equal(environmentOpenings(d).length, 0);
});
