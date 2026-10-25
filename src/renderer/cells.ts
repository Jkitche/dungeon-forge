// Cell types and grid directions, shared by the generator, editor, clutter and renderer.

export const ROCK = 0;
export const ROOM = 1;
export const CORRIDOR = 2;
export const PILLAR = 3;
export type CellType = typeof ROCK | typeof ROOM | typeof CORRIDOR | typeof PILLAR;

export const isFloor = (t: number): boolean => t === ROOM || t === CORRIDOR;
// Not solid rock: floor, or a pillar standing on the floor.
export const isOpen = (t: number): boolean => t !== ROCK;

// right, down, left, up
export const DIRS: readonly (readonly [number, number])[] = [[1, 0], [0, 1], [-1, 0], [0, -1]];
