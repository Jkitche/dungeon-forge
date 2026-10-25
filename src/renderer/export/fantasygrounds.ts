// Fantasy Grounds exports: Unity (map + line-of-sight module) and Classic (maps + story module).
//
// Unity:
// FGU reads line-of-sight data from an XML file that sits next to a map image and
// shares its base name. We package both into an asset module (.mod, a zip with
// definition.xml, thumbnail.png and an images/ folder) so one file can be dropped
// into FG's modules folder. Format references:
//   https://fantasygroundsunity.atlassian.net/wiki/spaces/FGCP/pages/996645681
//   https://fantasygroundsunity.atlassian.net/wiki/spaces/FGCP/pages/996645724
//   https://github.com/Imagix/uvtt2fgu/wiki/Fantasy-Grounds-Unity-XML-File-Format

import { computeWalls, computePillarOutlines } from '../walls.ts';
import type { Point } from '../walls.ts';
import type { Dungeon, Door } from '../generator.ts';
import { getGenre } from '../genres.ts';
import { buildZip } from '../../shared/zip.ts';
import { html, slugify } from '../text.ts';
import type { SafeHtml } from '../text.ts';
import { buildRoomKeyMarkdown } from './roomkey.ts';
import type { ExportContext, ExportResult, ExportStrategy, ExportTarget } from './types.ts';

/** Half the thickness of a door occluder, in squares (matches what uvtt2fgu emits). */
const DOOR_HALF_THICKNESS = 0.125;

/** Escape for XML text, writing non-ASCII as character references so ISO-8859-1 headers stay valid. */
export function xmlText(s: string): string {
  return s
    .replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[ch] ?? ch)
    .replace(/[^\x20-\x7e\n\t]/gu, (ch) => `&#${ch.codePointAt(0)};`);
}

/**
 * FGU image coordinates are pixels with (0, 0) at the centre of the image and y pointing up.
 * Returns a converter from grid units to that space.
 */
export function fguPointMapper(d: Dungeon, ppg: number): (p: Point) => [number, number] {
  const halfW = (d.width * ppg) / 2;
  const halfH = (d.height * ppg) / 2;
  const r = (v: number): number => Math.round(v * 10) / 10;
  return (p) => [r(p.x * ppg - halfW), r(halfH - p.y * ppg)];
}

export interface FguOccluder {
  points: [number, number][];
  flags: string[];
}

export function buildFguOccluders(d: Dungeon, ppg: number): FguOccluder[] {
  const map = fguPointMapper(d, ppg);
  const out: FguOccluder[] = [];
  for (const s of computeWalls(d)) {
    out.push({ points: [map({ x: s.x1, y: s.y1 }), map({ x: s.x2, y: s.y2 })], flags: [] });
  }
  for (const poly of computePillarOutlines(d)) {
    out.push({ points: poly.map(map), flags: [] });
  }
  // Doors are thin rectangles straddling the doorway, flagged so FGU makes them openable.
  // FGU's secret-door option has no documented XML flag, so secret doors export as ordinary doors.
  const t = DOOR_HALF_THICKNESS;
  for (const door of d.doors) {
    const rect: Point[] = door.y1 === door.y2
      ? [{ x: door.x1, y: door.y1 - t }, { x: door.x2, y: door.y1 - t }, { x: door.x2, y: door.y1 + t }, { x: door.x1, y: door.y1 + t }]
      : [{ x: door.x1 - t, y: door.y1 }, { x: door.x1 - t, y: door.y2 }, { x: door.x1 + t, y: door.y2 }, { x: door.x1 + t, y: door.y1 }];
    out.push({ points: rect.map(map), flags: ['toggleable', 'closed', 'single_sided', 'counterclockwise'] });
  }
  return out;
}

/** The image sidecar: grid size plus line-of-sight occluders. */
export function buildFguImageXml(d: Dungeon, ppg: number): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<root version="4.1" dataversion="20210302">',
    '  <grid>on</grid>',
    `  <gridsize>${ppg},${ppg}</gridsize>`,
    '  <occluders>',
  ];
  buildFguOccluders(d, ppg).forEach((o, i) => {
    lines.push('    <occluder>', `      <id>${i}</id>`, `      <points>${o.points.flat().join(',')}</points>`);
    for (const f of o.flags) lines.push(`      <${f} />`);
    lines.push('    </occluder>');
  });
  lines.push('  </occluders>', '</root>', '');
  return lines.join('\n');
}

export function buildFguDefinitionXml(d: Dungeon): string {
  const genre = getGenre(d.options.genre).label;
  return [
    '<?xml version="1.0" encoding="ISO-8859-1"?>',
    '<root version="4.1">',
    `  <name>${xmlText(fguModuleName(d))}</name>`,
    `  <displayname>${xmlText(`Dungeon Forge: ${d.seed}`)}</displayname>`,
    `  <category>${xmlText(`Dungeon Forge (${genre})`)}</category>`,
    '  <author>Dungeon Forge</author>',
    '  <ruleset>Any</ruleset>',
    '</root>',
    '',
  ].join('\n');
}

/** Module names must be unique in FG's library, so include the seed. */
export function fguModuleName(d: Dungeon): string {
  return `DungeonForge-${slugify(d.seed)}`;
}

export function fguImageBaseName(d: Dungeon): string {
  return `dungeon-${slugify(d.seed)}`;
}

export function buildFguModule(d: Dungeon, ppg: number, mapPng: Uint8Array, thumbnailPng: Uint8Array): Uint8Array {
  const base = fguImageBaseName(d);
  return buildZip([
    { path: 'definition.xml', data: buildFguDefinitionXml(d) },
    { path: 'thumbnail.png', data: thumbnailPng },
    { path: `images/${base}.png`, data: mapPng },
    { path: `images/${base}.xml`, data: buildFguImageXml(d, ppg) },
  ]);
}

/** "Room 3, east wall, column 14 row 7" for a door, using 1-based squares on the room's side. */
export function describeDoor(d: Dungeon, door: Door): string {
  const horiz = door.y1 === door.y2;
  const a = horiz ? { x: door.x1, y: door.y1 - 1 } : { x: door.x1 - 1, y: door.y1 };
  const b = { x: door.x1, y: door.y1 };
  const roomIsA = d.roomIds[a.y * d.width + a.x] === door.room;
  const cell = roomIsA ? a : b;
  const side = horiz ? (roomIsA ? 'south' : 'north') : roomIsA ? 'east' : 'west';
  return `Room ${door.room + 1}, ${side} wall, column ${cell.x + 1} row ${cell.y + 1}`;
}

export function buildFguNotes(d: Dungeon, ppg: number, moduleFile: string): string {
  const base = fguImageBaseName(d);
  const listDoors = (type: Door['type']): string[] => {
    const doors = d.doors.filter((o) => o.type === type);
    return doors.length ? doors.map((o) => `    - ${describeDoor(d, o)}`) : ['    (none)'];
  };
  return [
    'DUNGEON FORGE: FANTASY GROUNDS UNITY SETUP',
    '==========================================',
    '',
    `Module: ${moduleFile}`,
    `Map: ${d.width} × ${d.height} squares, ${d.width * ppg} × ${d.height * ppg} px at ${ppg} px per square.`,
    'The module contains the map image plus its line-of-sight data (walls, pillars and doors) and grid size.',
    '',
    '1. Copy the .mod file into the "modules" folder of your Fantasy Grounds data directory.',
    '2. Open your campaign, open the Modules list in the Library, and load the module.',
    `3. Open Assets > Images, find "${base}", and drag it into the Images window.`,
    '   The image record is created with walls, doors and the grid already in place.',
    '',
    'Notes:',
    '  - Fantasy Grounds Unity 4.1 or later is needed for line of sight.',
    '  - Secret doors come through as ordinary doors. To hide one, unlock the image, select the door in',
    '    the line-of-sight editor and turn on its secret option.',
    '  - Doors arrive closed. Fantasy Grounds does not lock them; enforce locks at the table.',
    '  - Alternative without a module: rename the .mod to .zip, extract it, and copy the .png and .xml',
    '    from its images folder into your campaign\'s images folder, then click refresh under Assets > Images.',
    '',
    'Doors to adjust (columns count from the left edge of the map and rows from the top, starting at 1):',
    '  Secret doors:',
    ...listDoors('secret'),
    '  Locked doors:',
    ...listDoors('locked'),
    '',
    'Paste the room key below into a Story entry:',
    '',
    buildRoomKeyMarkdown(d),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Fantasy Grounds Classic
//
// Classic has no line of sight, so the module carries images and story entries only.
// db.xml layout follows FGModGen (github.com/zacharyhooker/FGModGen), a Classic-era map
// pack generator: <image> and <encounter> roots, each holding a category of id-NNNNN records.

/** Pixels per square most Classic map packs use. */
export const FGC_DEFAULT_PPG = 50;

const CATEGORY_OPEN = '    <category name="" mergeid="" baseicon="1" decalicon="1">';

function fgcRecord(index: number, name: string, body: string[]): string[] {
  const id = `id-${String(index).padStart(5, '0')}`;
  return [`      <${id}>`, `        <name type="string">${xmlText(name)}</name>`, ...body.map((l) => `        ${l}`), `      </${id}>`];
}

/** FG formatted text: <h> headings, <p> paragraphs, <list><li> bullets, <b> bold. */
function formattedText(blocks: string[]): string {
  return `<text type="formattedtext">${blocks.join('')}</text>`;
}

const p = (s: string): string => `<p>${xmlText(s)}</p>`;
const labelled = (label: string, s: string): string => `<li><b>${xmlText(label)}:</b> ${xmlText(s)}</li>`;

function roomStoryText(d: Dungeon, roomId: number): string {
  const r = d.rooms[roomId];
  const c = r?.contents;
  if (!r || !c) return formattedText([p('Empty.')]);
  const g = getGenre(d.options.genre);
  const blocks: string[] = [];
  if (r.shape !== 'area') blocks.push(p(`${r.w * 5} × ${r.h * 5} ft${r.shape !== 'rect' ? `, ${r.shape}` : ''}.`));
  blocks.push(p(`${c.atmosphere} The room contains ${c.feature}.`));
  if (c.note) blocks.push(p(c.note));
  const items: string[] = [];
  if (c.monster) items.push(labelled(g.encounterLabel, c.monster));
  if (c.trap) items.push(labelled('Trap', c.trap));
  if (c.special) items.push(labelled('Special', c.special));
  if (c.treasure) items.push(labelled(g.treasureLabel, c.treasure));
  const doors = d.doors.filter((o) => o.room === roomId && o.type !== 'normal');
  for (const o of doors) items.push(labelled(o.type === 'secret' ? 'Secret door' : 'Locked door', describeDoor(d, o)));
  if (items.length) blocks.push(`<list>${items.join('')}</list>`);
  return formattedText(blocks);
}

function overviewStoryText(d: Dungeon, ppg: number): string {
  const g = getGenre(d.options.genre);
  const count = (t: Door['type']): number => d.doors.filter((o) => o.type === t).length;
  return formattedText([
    p(`${g.label} ${d.algorithm === 'caves' ? 'cavern' : 'dungeon'} generated by Dungeon Forge from seed "${d.seed}".`),
    p(`${d.width} × ${d.height} squares (5 ft each), ${d.rooms.length} ${d.algorithm === 'caves' ? 'areas' : 'rooms'}, ${d.doors.length} doors (${count('locked')} locked, ${count('secret')} secret).`),
    p(`Map scale: ${ppg} pixels per square. Set the image grid to ${ppg} if you turn on the grid in Fantasy Grounds.`),
    p('Use the Player map on the table. The GM map shows room numbers and marks secret doors with an S.'),
  ]);
}

export interface FgcImages {
  player: Uint8Array;
  gm: Uint8Array;
  thumbnail: Uint8Array;
}

export function fgcImagePaths(d: Dungeon): { player: string; gm: string } {
  const base = fguImageBaseName(d);
  return { player: `images/${base}.png`, gm: `images/${base}-gm.png` };
}

export function buildFgcDbXml(d: Dungeon, ppg: number): string {
  const paths = fgcImagePaths(d);
  const title = `Dungeon ${d.seed}`;
  const lines = ['<?xml version="1.0" encoding="ISO-8859-1"?>', '<root version="3.3">', '  <image>', CATEGORY_OPEN];
  lines.push(...fgcRecord(1, `${title} (Player map)`, [`<image type="image"><bitmap>${xmlText(paths.player)}</bitmap></image>`]));
  lines.push(...fgcRecord(2, `${title} (GM map)`, [`<image type="image"><bitmap>${xmlText(paths.gm)}</bitmap></image>`]));
  lines.push('    </category>', '  </image>', '  <encounter>', CATEGORY_OPEN);
  lines.push(...fgcRecord(1, `00. ${title}: Overview`, [overviewStoryText(d, ppg)]));
  d.rooms.forEach((r, i) => {
    const num = String(r.id + 1).padStart(2, '0');
    lines.push(...fgcRecord(i + 2, `${num}. ${r.contents?.name ?? 'Room'}`, [roomStoryText(d, i)]));
  });
  lines.push('    </category>', '  </encounter>', '</root>', '');
  return lines.join('\n');
}

export function fgcModuleName(d: Dungeon): string {
  return `${fguModuleName(d)}-classic`;
}

/** Same as Unity's but with Classic's data version and its own name, so both can be loaded at once. */
export function buildFgcDefinitionXml(d: Dungeon): string {
  return buildFguDefinitionXml(d)
    .replace('<root version="4.1">', '<root version="3.3">')
    .replace(`<name>${xmlText(fguModuleName(d))}</name>`, `<name>${xmlText(fgcModuleName(d))}</name>`)
    .replace('</displayname>', ' (Classic)</displayname>');
}

export function buildFgcModule(d: Dungeon, ppg: number, images: FgcImages): Uint8Array {
  const paths = fgcImagePaths(d);
  return buildZip([
    { path: 'definition.xml', data: buildFgcDefinitionXml(d) },
    { path: 'db.xml', data: buildFgcDbXml(d, ppg) },
    { path: 'thumbnail.png', data: images.thumbnail },
    { path: paths.player, data: images.player },
    { path: paths.gm, data: images.gm },
  ]);
}

export function buildFgcNotes(d: Dungeon, ppg: number, moduleFile: string): string {
  return [
    'DUNGEON FORGE: FANTASY GROUNDS CLASSIC SETUP',
    '============================================',
    '',
    `Module: ${moduleFile}`,
    `Map: ${d.width} × ${d.height} squares, ${d.width * ppg} × ${d.height * ppg} px at ${ppg} px per square.`,
    'The module contains a Player map, a GM map (room numbers, secret doors marked "S"), and one Story',
    'entry per room plus an overview.',
    '',
    '1. Copy the .mod file into the "modules" folder of your Fantasy Grounds data directory.',
    '2. Open your campaign, open the Modules list in the Library, and load the module.',
    '3. The maps appear in the Images list and the room key in the Story list.',
    `4. If you use Fantasy Grounds' grid, set it to ${ppg} pixels per square on the Player map.`,
    '',
    'Notes:',
    '  - Classic has no line of sight, so walls and doors are only drawn on the image.',
    '    Use the image mask (fog of war) to reveal rooms as the party explores.',
    '  - For Fantasy Grounds Unity, use the Fantasy Grounds Unity export instead: it adds walls and doors.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Strategies

/** Thumbnail for FG's module list: the whole map in at most ~256 px. */
export function thumbnailPpg(d: Dungeon): number {
  return Math.max(2, Math.floor(256 / Math.max(d.width, d.height)));
}

const INSTALL_STEPS = html`
  <li>In your campaign, open the <b>Modules</b> list in the Library and load it.</li>`;

export class FantasyGroundsUnityExporter implements ExportStrategy {
  readonly id = 'fgu';
  readonly label = 'Fantasy Grounds Unity';
  readonly nameTag = '-fgu';
  readonly description = 'A module (.mod) holding the map with its walls, doors and grid, ready for line of sight in FGU 4.1+. Also saves a notes file with setup steps, the secret and locked door locations, and the room key.';
  readonly extension = '.mod';
  readonly fileType = 'Fantasy Grounds module';
  readonly image = { defaultPpg: 100, defaultGrid: false, viewSelectable: true };

  async run(ctx: ExportContext, target: ExportTarget): Promise<ExportResult> {
    const { dungeon: d, ppg } = ctx;
    const modName = target.name(this.extension);
    const notesName = target.name('.fantasygrounds.txt');
    const map = await ctx.renderPng();
    const thumb = await ctx.renderPng({ ppg: thumbnailPpg(d) });
    const secret = d.doors.filter((o) => o.type === 'secret').length;
    const warnings: SafeHtml[] = [];
    if (secret) {
      warnings.push(html`${secret} secret door${secret === 1 ? '' : 's'} came through as ordinary doors. The notes file says where they are; turn on the secret option for each one in FG's line-of-sight editor.`);
    }
    return {
      files: [
        { path: target.path(this.extension), data: buildFguModule(d, ppg, map, thumb) },
        { path: target.path('.fantasygrounds.txt'), data: buildFguNotes(d, ppg, modName) },
      ],
      summary: html`<ol>
        <li>Copy <code>${modName}</code> into the <code>modules</code> folder of your Fantasy Grounds data directory.</li>
        ${INSTALL_STEPS}
        <li>Open <b>Assets › Images</b>, find <code>${fguImageBaseName(d)}</code>, and drag it into the <b>Images</b> window. Walls, doors and a ${ppg} px grid come with it.</li>
      </ol>
      <p>Setup steps, door locations and the room key are in <code>${notesName}</code>. Line of sight needs Fantasy Grounds Unity 4.1 or later.</p>`,
      warnings,
    };
  }
}

export class FantasyGroundsClassicExporter implements ExportStrategy {
  readonly id = 'fgc';
  readonly label = 'Fantasy Grounds Classic';
  readonly nameTag = '-fgc';
  readonly description = 'A module (.mod) with a Player map, a GM map, and the room key as Story entries. Classic has no line of sight, so walls and doors are only drawn on the image. 50 px per square is the usual Classic scale.';
  readonly extension = '.mod';
  readonly fileType = 'Fantasy Grounds module';
  // The grid is drawn on because the module can't set FG's grid size. The module always
  // carries both a player and a GM map, so the view isn't a choice.
  readonly image = { defaultPpg: FGC_DEFAULT_PPG, defaultGrid: true, viewSelectable: false };

  async run(ctx: ExportContext, target: ExportTarget): Promise<ExportResult> {
    const { dungeon: d, ppg } = ctx;
    const modName = target.name(this.extension);
    const images: FgcImages = {
      player: await ctx.renderPng({ gmView: false }),
      gm: await ctx.renderPng({ gmView: true }),
      thumbnail: await ctx.renderPng({ ppg: thumbnailPpg(d), gmView: false }),
    };
    return {
      files: [
        { path: target.path(this.extension), data: buildFgcModule(d, ppg, images) },
        { path: target.path('.fantasygrounds-classic.txt'), data: buildFgcNotes(d, ppg, modName) },
      ],
      summary: html`<ol>
        <li>Copy <code>${modName}</code> into the <code>modules</code> folder of your Fantasy Grounds data directory.</li>
        ${INSTALL_STEPS}
        <li>The Player and GM maps appear under <b>Images</b>, and the room key (${d.rooms.length} entries plus an overview) under <b>Story</b>.</li>
      </ol>
      <p>If you use Fantasy Grounds' grid, set it to <b>${ppg} px</b> per square. Classic has no line of sight, so use the image mask to reveal rooms as the party explores.</p>`,
    };
  }
}
