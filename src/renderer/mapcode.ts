// Map codes: the current map as a line of text, to paste into a chat or note and back.
//
// A code is "DF1." followed by a deflate-compressed, base64url-encoded JSON payload.
// An unedited map is just its settings, since the seed rebuilds it exactly; a hand-edited
// one carries the whole map, the same data as a .dungeon.json file.

import {
  deserializeDungeon,
  generateDungeon,
  normalizeOptions,
  serializeDungeon,
} from "./generator.ts";
import type {
  Dungeon,
  DungeonOptions,
  SerializedDungeon,
} from "./generator.ts";

/** A saved map: what .dungeon.json files hold and what map codes decode to. */
export interface MapProject {
  app: "dungeon-forge";
  version: 1;
  style: unknown;
  dungeon: SerializedDungeon;
}

/** What a code carries: settings to rebuild from (`o`), or the whole map (`d`), plus the style. */
type Payload =
  { s: unknown; o: DungeonOptions } | { s: unknown; d: SerializedDungeon };

const PREFIX = "DF1.";

async function pipe(
  bytes: Uint8Array,
  stream: GenericTransformStream,
): Promise<Uint8Array> {
  const out = new Blob([bytes as Uint8Array<ArrayBuffer>])
    .stream()
    .pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** True when the seed and settings alone rebuild this map exactly. */
export const rebuildsFromSeed = (d: Dungeon): boolean => !d.edited;

/** The map and its style as a code. */
export async function encodeMapCode(
  d: Dungeon,
  style: unknown,
): Promise<string> {
  const payload: Payload = rebuildsFromSeed(d)
    ? { s: style, o: d.options }
    : { s: style, d: serializeDungeon(d) };
  const json = new TextEncoder().encode(JSON.stringify(payload));
  return (
    PREFIX + toBase64Url(await pipe(json, new CompressionStream("deflate-raw")))
  );
}

/**
 * Reads a map code, or the text of a .dungeon.json file, into a saved map. Spaces and line
 * breaks in a pasted code are ignored. Throws a readable error if it's neither.
 */
export async function decodeMapCode(text: string): Promise<MapProject> {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return checkProject(JSON.parse(trimmed));
  const code = trimmed.replace(/\s+/g, "");
  if (!code.startsWith(PREFIX))
    throw new Error("That isn't a Dungeon Forge map code");
  let payload: Partial<{ s: unknown; o: DungeonOptions; d: SerializedDungeon }>;
  try {
    const json = await pipe(
      fromBase64Url(code.slice(PREFIX.length)),
      new DecompressionStream("deflate-raw"),
    );
    payload = JSON.parse(new TextDecoder().decode(json)) as typeof payload;
  } catch {
    throw new Error("That map code is damaged or incomplete");
  }
  const dungeon = payload.d
    ? serializeDungeon(deserializeDungeon(payload.d))
    : payload.o
      ? serializeDungeon(generateDungeon(normalizeOptions(payload.o)))
      : null;
  if (!dungeon) throw new Error("That map code is damaged or incomplete");
  return { app: "dungeon-forge", version: 1, style: payload.s, dungeon };
}

function checkProject(obj: unknown): MapProject {
  const p = obj as Partial<MapProject> | null;
  if (p?.app !== "dungeon-forge")
    throw new Error("This file was not saved by Dungeon Forge");
  return {
    app: "dungeon-forge",
    version: 1,
    style: p.style,
    dungeon: serializeDungeon(deserializeDungeon(p.dungeon)),
  };
}
