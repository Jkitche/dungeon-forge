// Seeded pseudo-random numbers so the same seed always yields the same dungeon.

function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

function mulberry32(a: number): () => number {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class RNG {
  readonly next: () => number;

  constructor(seed: string | number) {
    this.next = mulberry32(xmur3(String(seed))());
  }
  float(): number {
    return this.next();
  }
  /** Integer in [min, max], inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error('RNG.pick from an empty array');
    return arr[Math.floor(this.next() * arr.length)] as T;
  }
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j] as T, arr[i] as T];
    }
    return arr;
  }
}

const SEED_ADJ = ['crimson', 'sunken', 'forgotten', 'howling', 'gilded', 'ashen', 'drowned', 'hollow', 'iron', 'shadow', 'bleak', 'ember', 'frozen', 'silent', 'cursed', 'verdant'];
const SEED_NOUN = ['crypt', 'vault', 'warren', 'keep', 'tomb', 'lair', 'depths', 'halls', 'catacomb', 'sanctum', 'mine', 'grotto', 'citadel', 'barrow', 'pit', 'labyrinth'];

/** A memorable, non-deterministic seed like "sunken-crypt-4821". */
export function randomSeed(): string {
  const pick = (a: readonly string[]): string => a[Math.floor(Math.random() * a.length)] ?? '';
  return `${pick(SEED_ADJ)}-${pick(SEED_NOUN)}-${Math.floor(1000 + Math.random() * 9000)}`;
}
