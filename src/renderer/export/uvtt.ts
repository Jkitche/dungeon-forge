// Universal VTT (.dd2vtt): one JSON file with the image, walls and doors.

import { computeWalls, computePillarOutlines } from '../walls.ts';
import type { Point } from '../walls.ts';
import type { Dungeon } from '../generator.ts';
import { bytesToBase64, html } from '../text.ts';
import type { ExportContext, ExportResult, ExportStrategy, ExportTarget } from './types.ts';

/** Universal VTT format 0.3, as written by Dungeondraft and read by most VTT importers. */
export interface UniversalVTT {
  format: number;
  resolution: { map_origin: Point; map_size: Point; pixels_per_grid: number };
  line_of_sight: Point[][];
  objects_line_of_sight: Point[][];
  portals: { position: Point; bounds: [Point, Point]; rotation: number; closed: boolean; freestanding: boolean }[];
  environment: { baked_lighting: boolean; ambient_light: string };
  lights: unknown[];
  image: string;
}

export function buildUVTT(d: Dungeon, ppg: number, imageBase64: string): UniversalVTT {
  return {
    format: 0.3,
    resolution: {
      map_origin: { x: 0, y: 0 },
      map_size: { x: d.width, y: d.height },
      pixels_per_grid: ppg,
    },
    line_of_sight: computeWalls(d).map((s) => [{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }]),
    objects_line_of_sight: computePillarOutlines(d),
    portals: d.doors.map((door) => ({
      position: { x: (door.x1 + door.x2) / 2, y: (door.y1 + door.y2) / 2 },
      bounds: [{ x: door.x1, y: door.y1 }, { x: door.x2, y: door.y2 }],
      rotation: door.y1 === door.y2 ? 0 : Math.PI / 2,
      closed: true,
      freestanding: false,
    })),
    environment: { baked_lighting: true, ambient_light: 'ffffffff' },
    lights: [],
    image: imageBase64,
  };
}

export class UniversalVttExporter implements ExportStrategy {
  readonly id = 'uvtt';
  readonly label = 'Universal VTT (.dd2vtt)';
  readonly description = 'One file with the image, walls and doors. Works with Foundry (Universal Battlemap Importer), Arkenforge, EncounterPlus, Roll20 (UniversalVTTImporter mod) and others.';
  readonly extension = '.dd2vtt';
  readonly fileType = 'Universal VTT';
  readonly image = { defaultPpg: 100, defaultGrid: false, viewSelectable: true };

  async run(ctx: ExportContext, target: ExportTarget): Promise<ExportResult> {
    const uvtt = buildUVTT(ctx.dungeon, ctx.ppg, bytesToBase64(await ctx.renderPng()));
    return {
      files: [{ path: target.path(this.extension), data: JSON.stringify(uvtt) }],
      summary: html`<p>Saved a Universal VTT map with ${uvtt.line_of_sight.length} walls and ${uvtt.portals.length} doors.</p>
      <ul>
        <li><b>Foundry VTT</b>: use the Universal Battlemap Importer module.</li>
        <li><b>Roll20 (Pro)</b>: import with the UniversalVTTImporter mod.</li>
        <li><b>Arkenforge, EncounterPlus, Owlbear Rodeo (with extensions)</b> and others: import it as a .dd2vtt file.</li>
      </ul>
      <p>The format has no flag for secret doors, so they come through as ordinary closed doors. For Fantasy Grounds, use a Fantasy Grounds export instead.</p>`,
    };
  }
}
