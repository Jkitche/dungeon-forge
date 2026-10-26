// Room stocking, loosely following the classic d6 "monster / trap / special / empty" method.
// The tables themselves come from the dungeon's genre (see genres.ts).

import type { RNG } from "./rng.ts";
import type { Genre } from "./genres.ts";

export type RoomKind = "monster" | "trap" | "special" | "empty";

export interface RoomContents {
  name: string;
  kind: RoomKind;
  atmosphere: string;
  feature: string;
  monster: string | null;
  trap: string | null;
  special: string | null;
  treasure: string | null;
  note: string | null;
}

// Draws from a shuffled copy of the table, reshuffling only once it runs out, so
// neighbouring rooms rarely repeat a description.
function deck(rng: RNG, table: readonly string[]): () => string {
  let pool: string[] = [];
  return () => {
    if (pool.length === 0) pool = rng.shuffle([...table]);
    return pool.pop() as string;
  };
}

export interface Stocker {
  genre: Genre;
  name: () => string;
  atmosphere: () => string;
  feature: () => string;
}

export function createStocker(
  rng: RNG,
  genre: Genre,
  isCave: boolean,
): Stocker {
  return {
    genre,
    name: deck(rng, isCave ? genre.caveNames : genre.roomNames),
    atmosphere: deck(rng, genre.atmospheres),
    feature: deck(rng, genre.features),
  };
}

export function stockRoom(
  rng: RNG,
  decks: Stocker,
  { isEntrance, isExit }: { isEntrance: boolean; isExit: boolean },
): RoomContents {
  const g = decks.genre;
  const room: RoomContents = {
    name: isEntrance ? g.entranceName : isExit ? g.exitName : decks.name(),
    kind: "empty",
    atmosphere: decks.atmosphere(),
    feature: decks.feature(),
    monster: null,
    trap: null,
    special: null,
    treasure: null,
    note: isEntrance ? g.entranceNote : isExit ? g.exitNote : null,
  };
  if (isEntrance) return room;

  const roll = rng.int(1, 6);
  if (roll <= 2) {
    room.kind = "monster";
    room.monster = rng.pick(g.monsters);
    if (rng.chance(0.5)) room.treasure = rng.pick(g.treasures);
  } else if (roll === 3) {
    room.kind = "trap";
    room.trap = rng.pick(g.traps);
    if (rng.chance(1 / 3)) room.treasure = rng.pick(g.treasures);
  } else if (roll === 4) {
    room.kind = "special";
    room.special = rng.pick(g.specials);
  } else if (rng.chance(1 / 6)) {
    room.treasure = rng.pick(g.treasures);
  }
  return room;
}
