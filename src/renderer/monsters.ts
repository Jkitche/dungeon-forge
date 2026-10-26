// Monster tokens: markers for a room's monsters, placed on the map in the editor. Only the
// GM sees them; the player view and player exports leave them out.

/** Most tokens a room gets from Place all, however big the dice. */
export const MAX_AUTO_MONSTERS = 12;

/** Words skipped when picking a token's letter: articles and group nouns. */
const FILLER = new Set([
  "a",
  "an",
  "the",
  "pack",
  "swarm",
  "band",
  "group",
  "pair",
  "horde",
  "of",
]);

/** The letter on a monster's tokens: "Goblin scouts (1d6+2)" is G, "A pack of ghouls" is G. */
export function monsterInitial(monster: string): string {
  // Dice like "(2d4)" aren't part of the name.
  const word = monster
    .replace(/\([^)]*\)/g, " ")
    .toLowerCase()
    .split(/[^a-z]+/)
    .find((w) => w && !FILLER.has(w));
  return (word ?? "m").charAt(0).toUpperCase();
}

/**
 * How many tokens Place all puts down for a monster entry: the average of its dice, so
 * "Goblin scouts (1d6+2)" gives 6, "A pair of gargoyles" 2, and a lone monster like
 * "A banshee" 1.
 */
export function monsterCount(monster: string): number {
  const m = /\((\d+)d(\d+)(?:\s*\+\s*(\d+))?\)/.exec(monster);
  if (!m) return /\bpair of\b/i.test(monster) ? 2 : 1;
  const [, n, sides, bonus] = m;
  const average = (Number(n) * (Number(sides) + 1)) / 2 + Number(bonus ?? 0);
  return Math.min(MAX_AUTO_MONSTERS, Math.max(1, Math.round(average)));
}
