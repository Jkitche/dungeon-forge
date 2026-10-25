// Plain PNG for anything else: Owlbear Rodeo, Shard, Let's Role, printing.

import { html, megabytes } from '../text.ts';
import type { ExportContext, ExportResult, ExportStrategy, ExportTarget } from './types.ts';

export class ImageExporter implements ExportStrategy {
  readonly id = 'png';
  readonly label = 'Image (PNG)';
  readonly description = 'A plain map image for Owlbear Rodeo, Shard Tabletop, Let\'s Role, Discord, printing, or anything else. Set the grid size in your VTT to the pixels per square below.';
  readonly extension = '.png';
  readonly fileType = 'PNG image';
  // Images for print or generic use usually want the grid baked in.
  readonly image = { defaultPpg: 100, defaultGrid: true, viewSelectable: true };

  async run(ctx: ExportContext, target: ExportTarget): Promise<ExportResult> {
    const { dungeon: d, ppg } = ctx;
    const png = await ctx.renderPng();
    return {
      files: [{ path: target.path(this.extension), data: png }],
      summary: html`<p>Saved a ${d.width * ppg} × ${d.height * ppg} px image (${megabytes(png.length)}).</p>
      <p>In your VTT, set the grid to <b>${ppg} px</b> per square, or ${d.width} × ${d.height} squares.</p>`,
    };
  }
}
