// Foundry VTT: a scene JSON (walls, doors, grid) plus its background image.

import { RNG } from '../rng.ts';
import { computeWalls, computePillarOutlines } from '../walls.ts';
import type { Point } from '../walls.ts';
import type { Dungeon } from '../generator.ts';
import { html } from '../text.ts';
import type { ExportContext, ExportResult, ExportStrategy, ExportTarget } from './types.ts';

export interface FoundryWall {
  _id: string;
  c: [number, number, number, number];
  /** 0 = wall, 1 = door, 2 = secret door. */
  door: 0 | 1 | 2;
  /** 0 = closed, 2 = locked. */
  ds: 0 | 2;
}

export interface FoundryScene {
  name: string;
  width: number;
  height: number;
  padding: number;
  background: { src: string };
  grid: { type: number; size: number; distance: number; units: string };
  tokenVision: boolean;
  fogExploration: boolean;
  fog: { exploration: boolean };
  walls: FoundryWall[];
  lights: unknown[];
  tokens: unknown[];
  notes: unknown[];
  drawings: unknown[];
  flags: Record<string, unknown>;
}

const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.split('');

/** Foundry VTT (v11+) scene data, importable with "Import Data" on a scene. */
export function buildFoundryScene(d: Dungeon, ppg: number, imageSrc: string, name: string): FoundryScene {
  const rng = new RNG(`${d.seed}:foundry`);
  const id = (): string => Array.from({ length: 16 }, () => rng.pick(ID_CHARS)).join('');
  const px = (v: number): number => Math.round(v * ppg);
  const wall = (a: Point, b: Point, door: FoundryWall['door'] = 0, ds: FoundryWall['ds'] = 0): FoundryWall => ({
    _id: id(),
    c: [px(a.x), px(a.y), px(b.x), px(b.y)],
    door,
    ds,
  });
  const walls: FoundryWall[] = [
    ...computeWalls(d).map((s) => wall({ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 })),
    ...computePillarOutlines(d).flatMap((poly) => poly.slice(1).map((p, i) => wall(poly[i] as Point, p))),
    ...d.doors.map((o) =>
      wall({ x: o.x1, y: o.y1 }, { x: o.x2, y: o.y2 }, o.type === 'secret' ? 2 : 1, o.type === 'locked' ? 2 : 0),
    ),
  ];
  return {
    name,
    width: d.width * ppg,
    height: d.height * ppg,
    padding: 0,
    background: { src: imageSrc },
    grid: { type: 1, size: ppg, distance: 5, units: 'ft' },
    tokenVision: true,
    fogExploration: true, // v11
    fog: { exploration: true }, // v12+
    walls,
    lights: [],
    tokens: [],
    notes: [],
    drawings: [],
    flags: { 'dungeon-forge': { seed: d.seed } },
  };
}

export class FoundryExporter implements ExportStrategy {
  readonly id = 'foundry';
  readonly label = 'Foundry VTT scene';
  readonly description = 'Scene JSON with walls, doors (locked and secret) and grid preconfigured, plus the background image. Import via right-click on a scene → Import Data.';
  readonly extension = '.foundry.json';
  readonly fileType = 'Foundry scene JSON';
  readonly image = { defaultPpg: 100, defaultGrid: false, viewSelectable: true };

  async run(ctx: ExportContext, target: ExportTarget): Promise<ExportResult> {
    const { dungeon: d, ppg } = ctx;
    const imageName = target.name('.png');
    // Foundry resolves background paths against its Data folder.
    const imageSrc = `dungeons/${imageName}`;
    const scene = buildFoundryScene(d, ppg, imageSrc, `Dungeon: ${d.seed}`);
    return {
      files: [
        { path: target.path(this.extension), data: JSON.stringify(scene, null, 2) },
        { path: target.path('.png'), data: await ctx.renderPng() },
      ],
      summary: html`<ol>
        <li>Copy <code>${imageName}</code> into a <code>dungeons</code> folder in your Foundry user data directory (<code>Data/dungeons/</code>), or upload it there with the Foundry file browser.</li>
        <li>Create a new scene, right-click it in the Scenes sidebar and choose <b>Import Data</b>.</li>
        <li>Pick <code>${target.name(this.extension)}</code>. Walls, doors and a ${ppg} px grid are set up for you.</li>
      </ol>
      <p>If you put the image somewhere else, change the scene's background image path to match. The JSON currently points to <code>${imageSrc}</code>.</p>`,
    };
  }
}
