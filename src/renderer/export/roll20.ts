// Roll20: an image at Roll20's native 70 px per square, plus page setup notes.
// Roll20 can't import walls from a file without its API, so walls come via the UVTT export.

import type { Dungeon } from '../generator.ts';
import { html, megabytes } from '../text.ts';
import type { SafeHtml } from '../text.ts';
import { buildRoomKeyMarkdown } from './roomkey.ts';
import type { ExportContext, ExportResult, ExportStrategy, ExportTarget } from './types.ts';

/** Roll20's upload limit on free accounts. */
const FREE_UPLOAD_LIMIT = 10 * 1048576;

export function buildRoll20Notes(d: Dungeon, ppg: number, imageName: string, hasGrid: boolean): string {
  const W = d.width;
  const H = d.height;
  return [
    'DUNGEON FORGE: ROLL20 SETUP',
    '===========================',
    '',
    `Map image: ${imageName}`,
    `Size: ${W} × ${H} squares = ${W * ppg} × ${H * ppg} px at ${ppg} px per square.`,
    '',
    '1. Create a new page and open Page Settings.',
    `   Set Width = ${W} and Height = ${H} (units), and leave the grid at 1 unit = 5 ft.`,
    hasGrid ? '   The image already has a grid drawn on it; you can turn off or fade Roll20\'s grid if you like.' : '   The image has no grid of its own, so keep Roll20\'s grid on.',
    '2. Switch to the "Map & Background" layer and drag the image onto the page.',
    `3. Right-click the image, choose Advanced, then Set Dimensions, and enter ${W * ppg} × ${H * ppg} px (${W} × ${H} units).`,
    '   Drag it so its top-left corner sits on the page\'s top-left corner.',
    '',
    'Dynamic lighting (optional):',
    '  Roll20 cannot import walls from a file on its own. On a Pro account, install the',
    '  "UniversalVTTImporter" mod, export this map from Dungeon Forge as Universal VTT (.dd2vtt),',
    '  and follow the mod\'s instructions to bring in walls and doors.',
    '  Without Pro, trace the walls on the Dynamic Lighting layer by hand.',
    '',
    'Paste the room key below into a GM-only handout:',
    '',
    buildRoomKeyMarkdown(d),
  ].join('\n');
}

export class Roll20Exporter implements ExportStrategy {
  readonly id = 'roll20';
  readonly label = 'Roll20';
  readonly description = 'Map image at Roll20\'s native 70 px per square, plus a notes file with page setup steps and the room key. For dynamic lighting walls, Pro users can import the Universal VTT export with the UniversalVTTImporter mod.';
  readonly extension = '.png';
  readonly fileType = 'PNG image';
  readonly nameTag = '-roll20';
  readonly image = { defaultPpg: 70, defaultGrid: false, viewSelectable: true };

  async run(ctx: ExportContext, target: ExportTarget): Promise<ExportResult> {
    const { dungeon: d, ppg } = ctx;
    const png = await ctx.renderPng();
    const imageName = target.name(this.extension);
    const notesName = target.name('.roll20.txt');
    const warnings: SafeHtml[] = [];
    if (png.length > FREE_UPLOAD_LIMIT) {
      warnings.push(html`The image is ${megabytes(png.length)}. Roll20 limits uploads to 10 MB on free accounts and 20 MB on paid ones; lower the pixels per square if the upload fails.`);
    }
    return {
      files: [
        { path: target.path(this.extension), data: png },
        { path: target.path('.roll20.txt'), data: buildRoll20Notes(d, ppg, imageName, ctx.grid) },
      ],
      summary: html`<ol>
        <li>Create a page in Roll20, open <b>Page Settings</b> and set it to <b>${d.width} × ${d.height}</b> units.</li>
        <li>On the <b>Map &amp; Background</b> layer, drag in <code>${imageName}</code>.</li>
        <li>Right-click it, choose <b>Advanced</b>, then <b>Set Dimensions</b>, and enter <b>${d.width * ppg} × ${d.height * ppg}</b> px. Snap it to the top-left corner.</li>
      </ol>
      <p>The room key and setup steps are saved in <code>${notesName}</code>. For dynamic lighting walls, Pro accounts can use the Universal VTT export with the UniversalVTTImporter mod.</p>`,
      warnings,
    };
  }
}
