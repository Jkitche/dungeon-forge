// Room key as Markdown, used on its own and embedded in other formats' notes files.

import { doorSummary } from '../generator.ts';
import type { Dungeon, Room } from '../generator.ts';
import { getGenre } from '../genres.ts';
import type { Genre } from '../genres.ts';
import { html } from '../text.ts';
import type { ExportContext, ExportResult, ExportStrategy, ExportTarget } from './types.ts';

function roomLines(r: Room, g: Genre): string[] {
  const c = r.contents;
  const lines: string[] = [];
  const tags = [r.entrance && 'entrance', r.exit && 'exit'].filter(Boolean);
  lines.push(`## ${r.id + 1}. ${c?.name ?? 'Room'}${tags.length ? ` (${tags.join(', ')})` : ''}`);
  if (r.shape !== 'area') lines.push(`*${r.w * 5} × ${r.h * 5} ft${r.shape !== 'rect' ? `, ${r.shape}` : ''}.*`);
  lines.push('');
  lines.push(`${c?.atmosphere ?? ''} The room contains ${c?.feature ?? 'nothing of note'}.`.trim());
  if (c?.note) lines.push('', c.note);
  if (c?.monster) lines.push(`- **${g.encounterLabel}:** ${c.monster}`);
  if (c?.trap) lines.push(`- **Trap:** ${c.trap}`);
  if (c?.special) lines.push(`- **Special:** ${c.special}`);
  if (c?.treasure) lines.push(`- **${g.treasureLabel}:** ${c.treasure}`);
  lines.push('');
  return lines;
}

export function buildRoomKeyMarkdown(d: Dungeon): string {
  const doors = doorSummary(d);
  const g = getGenre(d.options.genre);
  const out = [
    `# Dungeon "${d.seed}"`,
    '',
    `${g.label} · ${d.algorithm === 'caves' ? 'Cavern' : 'Rooms & corridors'} · ${d.width} × ${d.height} squares (5 ft each) · ${d.rooms.length} ${d.algorithm === 'caves' ? 'areas' : 'rooms'} · ${doors.total} doors (${doors.locked} locked, ${doors.secret} secret)`,
    '',
  ];
  for (const r of d.rooms) out.push(...roomLines(r, g));
  return out.join('\n');
}

export class RoomKeyExporter implements ExportStrategy {
  readonly id = 'key';
  readonly label = 'Room key (Markdown)';
  readonly description = 'The GM room key as a Markdown document, for notes apps, handouts or journal entries.';
  readonly extension = '.md';
  readonly fileType = 'Markdown';
  readonly image = null;

  async run({ dungeon: d }: ExportContext, target: ExportTarget): Promise<ExportResult> {
    return {
      files: [{ path: target.path(this.extension), data: buildRoomKeyMarkdown(d) }],
      summary: html`<p>Saved the room key for ${d.rooms.length} ${d.algorithm === 'caves' ? 'areas' : 'rooms'}.</p>`,
    };
  }
}
