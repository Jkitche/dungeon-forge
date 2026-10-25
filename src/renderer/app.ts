import { generateDungeon, normalizeOptions, serializeDungeon, deserializeDungeon, doorSummary, DEFAULT_OPTIONS, ROOM } from './generator.ts';
import type { Dungeon, DungeonOptions, SerializedDungeon } from './generator.ts';
import { renderDungeon, THEMES, isThemeKey } from './renderer.ts';
import type { ThemeKey } from './renderer.ts';
import { EXPORTERS, getExporter, createExportTarget } from './export/index.ts';
import type { ExportContext, ExportStrategy, RenderRequest } from './export/index.ts';
import { html, slugify } from './text.ts';
import type { SafeHtml } from './text.ts';
import { randomSeed } from './rng.ts';
import { GENRES, GENRE_KEYS, getGenre, isGenreKey } from './genres.ts';
import type { DungeonForgeApi, MenuAction } from '../shared/ipc.ts';

declare global {
  interface Window {
    api: DungeonForgeApi;
  }
}

const VIEW_PPG = 48; // resolution of the on-screen map bitmap
const MAX_CANVAS_SIDE = 16384;

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  for (const c of children) if (c != null) node.append(c);
  return node;
}

interface StyleOptions {
  theme: ThemeKey;
  showGrid: boolean;
  showLabels: boolean;
}

interface ViewTransform {
  scale: number;
  ox: number;
  oy: number;
}

interface ProjectFile {
  app: 'dungeon-forge';
  version: 1;
  style: StyleOptions;
  dungeon: SerializedDungeon;
}

const state: {
  options: DungeonOptions;
  style: StyleOptions;
  gmView: boolean;
  dungeon: Dungeon | null;
  mapCanvas: HTMLCanvasElement;
  view: ViewTransform;
  selected: number;
  /** Id of the last-used export strategy. */
  exportFormat: string;
} = {
  options: { ...DEFAULT_OPTIONS, seed: randomSeed() },
  style: { theme: 'parchment', showGrid: true, showLabels: true },
  gmView: true,
  dungeon: null,
  mapCanvas: document.createElement('canvas'),
  view: { scale: 1, ox: 0, oy: 0 },
  selected: -1,
  exportFormat: 'roll20',
};

/** The current dungeon; one is generated at startup, so this only throws on a programming error. */
function dungeon(): Dungeon {
  if (!state.dungeon) throw new Error('No dungeon generated yet');
  return state.dungeon;
}

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

// ---------------------------------------------------------------------------
// Controls

interface SelectItem {
  type: 'select';
  key: string;
  label: string;
  options: [value: string, label: string][];
  /** Runs after the value is stored, before the map is regenerated or redrawn. */
  onChange?: (value: string) => void;
}
interface RangeItem {
  type: 'range';
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  fmt?: (v: number) => string;
}
interface CheckItem {
  type: 'check';
  key: string;
  label: string;
}
type ControlItem = SelectItem | RangeItem | CheckItem;

interface Section {
  title: string;
  /** Style sections edit display options and only redraw; others regenerate the map. */
  style?: boolean;
  show?: (o: DungeonOptions) => boolean;
  items: ControlItem[];
}

const pct = (v: number): string => `${Math.round(v * 100)}%`;
const isRooms = (o: DungeonOptions): boolean => o.algorithm === 'rooms';
const isCaves = (o: DungeonOptions): boolean => o.algorithm === 'caves';

const CONTROLS: Section[] = [
  {
    title: 'Map',
    items: [
      {
        key: 'genre',
        type: 'select',
        label: 'Setting',
        options: GENRE_KEYS.map((k) => [k, GENRES[k].label]),
        onChange: applyGenre,
      },
      { key: 'algorithm', type: 'select', label: 'Layout', options: [['rooms', 'Rooms & corridors'], ['caves', 'Caverns']] },
      { key: 'width', type: 'range', label: 'Width (squares)', min: 16, max: 120, step: 1 },
      { key: 'height', type: 'range', label: 'Height (squares)', min: 16, max: 120, step: 1 },
    ],
  },
  {
    title: 'Rooms',
    show: isRooms,
    items: [
      { key: 'roomCount', type: 'range', label: 'Room count (max)', min: 2, max: 40, step: 1 },
      { key: 'roomMin', type: 'range', label: 'Min room size', min: 3, max: 12, step: 1 },
      { key: 'roomMax', type: 'range', label: 'Max room size', min: 4, max: 20, step: 1 },
      { key: 'roundRoomChance', type: 'range', label: 'Round rooms', min: 0, max: 1, step: 0.05, fmt: pct },
      { key: 'pillarChance', type: 'range', label: 'Pillared halls', min: 0, max: 1, step: 0.05, fmt: pct },
    ],
  },
  {
    title: 'Corridors & doors',
    show: isRooms,
    items: [
      { key: 'corridorStyle', type: 'select', label: 'Corridors', options: [['straight', 'Straight'], ['winding', 'Winding']] },
      { key: 'loopChance', type: 'range', label: 'Extra loops', min: 0, max: 1, step: 0.05, fmt: pct },
      { key: 'doorChance', type: 'range', label: 'Doors on entrances', min: 0, max: 1, step: 0.05, fmt: pct },
      { key: 'lockedDoorChance', type: 'range', label: 'Locked doors', min: 0, max: 0.6, step: 0.05, fmt: pct },
      { key: 'secretDoorChance', type: 'range', label: 'Secret doors', min: 0, max: 0.4, step: 0.05, fmt: pct },
    ],
  },
  {
    title: 'Caverns',
    show: isCaves,
    items: [
      { key: 'roomCount', type: 'range', label: 'Keyed areas (max)', min: 1, max: 40, step: 1 },
      { key: 'caveFill', type: 'range', label: 'Rock density', min: 0.35, max: 0.55, step: 0.01, fmt: pct },
      { key: 'caveSteps', type: 'range', label: 'Smoothing passes', min: 1, max: 8, step: 1 },
    ],
  },
  {
    title: 'Style',
    style: true,
    items: [
      { key: 'theme', type: 'select', label: 'Theme', options: Object.entries(THEMES).map(([k, t]) => [k, t.label]) },
      { key: 'showGrid', type: 'check', label: 'Show grid' },
      { key: 'showLabels', type: 'check', label: 'Room numbers (GM view)' },
    ],
  },
];

interface BoundControl {
  item: ControlItem;
  input: HTMLInputElement | HTMLSelectElement;
  section: Section;
  valueNode: HTMLElement | null;
}

const controlInputs: BoundControl[] = [];
const sectionNodes = new Map<Section, HTMLElement>();

// Looked up on each use: generate() and openMap() replace these objects.
const targetOf = (section: Section): Record<string, unknown> =>
  (section.style ? state.style : state.options) as unknown as Record<string, unknown>;

function buildControls(): void {
  const root = $('controls');
  for (const section of CONTROLS) {
    const box = el('section');
    sectionNodes.set(section, box);
    box.append(el('h3', { textContent: section.title }));
    for (const item of section.items) {
      const wrap = el('div', { className: `control${item.type === 'check' ? ' check' : ''}` });
      let input: HTMLInputElement | HTMLSelectElement;
      let valueNode: HTMLElement | null = null;
      if (item.type === 'select') {
        const select = el('select');
        for (const [value, label] of item.options) select.append(el('option', { value, textContent: label }));
        wrap.append(el('label', { textContent: item.label }), select);
        input = select;
      } else if (item.type === 'check') {
        input = el('input', { type: 'checkbox' });
        wrap.append(el('label', {}, input, item.label));
      } else {
        input = el('input', { type: 'range', min: String(item.min), max: String(item.max), step: String(item.step) });
        valueNode = el('span', { className: 'value' });
        wrap.append(el('label', {}, el('span', { textContent: item.label }), valueNode), input);
      }
      const read = (): unknown => {
        if (item.type === 'check') return (input as HTMLInputElement).checked;
        if (item.type === 'range') return Number(input.value);
        return input.value;
      };
      input.addEventListener('input', () => {
        targetOf(section)[item.key] = read();
        if (item.type === 'select') item.onChange?.(input.value);
        syncControls();
        if (section.style) redrawMap();
        else scheduleGenerate();
      });
      controlInputs.push({ item, input, section, valueNode });
      box.append(wrap);
    }
    root.append(box);
  }
}

function syncControls(): void {
  for (const { item, input, section, valueNode } of controlInputs) {
    const v = targetOf(section)[item.key];
    if (item.type === 'check') (input as HTMLInputElement).checked = Boolean(v);
    else input.value = String(v);
    if (valueNode) valueNode.textContent = item.type === 'range' && item.fmt ? item.fmt(Number(v)) : String(v);
  }
  for (const section of CONTROLS) {
    const node = sectionNodes.get(section);
    if (node) node.hidden = section.show ? !section.show(state.options) : false;
  }
  $<HTMLInputElement>('seed').value = state.options.seed;
  $('view-gm').classList.toggle('active', state.gmView);
  $('view-player').classList.toggle('active', !state.gmView);
}

// Picking a setting also switches to its art theme and nudges the layout sliders to suit it.
// Width, height, room counts and sizes are left alone.
function applyGenre(value: string): void {
  if (!isGenreKey(value)) return;
  const g = GENRES[value];
  Object.assign(state.options, g.preset);
  state.style.theme = g.theme;
}

let generatePending = false;
function scheduleGenerate(): void {
  if (generatePending) return;
  generatePending = true;
  // setTimeout rather than requestAnimationFrame: rAF is paused while the window is hidden.
  setTimeout(() => {
    generatePending = false;
    generate();
  }, 0);
}

// ---------------------------------------------------------------------------
// Generation and drawing

function generate({ fit = false }: { fit?: boolean } = {}): void {
  // Keep min/max sliders consistent with each other.
  if (state.options.roomMin > state.options.roomMax) state.options.roomMax = state.options.roomMin;
  const t0 = performance.now();
  state.dungeon = generateDungeon(state.options);
  state.options = { ...state.dungeon.options };
  state.selected = -1;
  syncControls();
  redrawMap();
  renderKey();
  updateStatus(performance.now() - t0);
  if (fit) fitView();
}

function redrawMap(): void {
  if (!state.dungeon) return;
  renderDungeon(state.mapCanvas, state.dungeon, { ...state.style, ppg: VIEW_PPG, gmView: state.gmView });
  drawView();
}

const viewCanvas = $<HTMLCanvasElement>('view');
const viewport = $('viewport');

function drawView(): void {
  const dpr = window.devicePixelRatio || 1;
  const w = viewport.clientWidth;
  const h = viewport.clientHeight;
  if (viewCanvas.width !== Math.round(w * dpr) || viewCanvas.height !== Math.round(h * dpr)) {
    viewCanvas.width = Math.round(w * dpr);
    viewCanvas.height = Math.round(h * dpr);
  }
  const ctx = viewCanvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, viewCanvas.width, viewCanvas.height);
  if (!state.dungeon) return;
  const { scale, ox, oy } = state.view;
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 30;
  ctx.drawImage(state.mapCanvas, 0, 0);
  ctx.shadowBlur = 0;
  if (state.selected >= 0) drawSelection(ctx, state.dungeon);
}

function drawSelection(ctx: CanvasRenderingContext2D, d: Dungeon): void {
  const id = state.selected;
  ctx.fillStyle = 'rgba(212, 162, 76, 0.22)';
  for (let c = 0; c < d.roomIds.length; c++) {
    if (d.roomIds[c] !== id) continue;
    // Rooms highlight only their own floor; cavern areas include every cell they own.
    if (d.algorithm === 'rooms' && d.cells[c] !== ROOM) continue;
    ctx.fillRect((c % d.width) * VIEW_PPG, Math.floor(c / d.width) * VIEW_PPG, VIEW_PPG, VIEW_PPG);
  }
}

function fitView(): void {
  if (!state.dungeon) return;
  const mw = state.mapCanvas.width;
  const mh = state.mapCanvas.height;
  const vw = viewport.clientWidth;
  const vh = viewport.clientHeight;
  const scale = Math.min(vw / mw, vh / mh) * 0.94;
  state.view = { scale, ox: (vw - mw * scale) / 2, oy: (vh - mh * scale) / 2 };
  drawView();
}

function updateStatus(ms?: number): void {
  const d = dungeon();
  const doors = doorSummary(d);
  const parts = [
    getGenre(d.options.genre).label,
    `${d.width} × ${d.height} squares (${d.width * 5} × ${d.height * 5} ft)`,
    `${d.rooms.length} ${d.algorithm === 'caves' ? 'areas' : 'rooms'}`,
    `${doors.total} doors · ${doors.locked} locked · ${doors.secret} secret`,
    `seed "${d.seed}"`,
  ];
  if (ms != null) parts.push(`${Math.round(ms)} ms`);
  $('status').textContent = parts.join('   ·   ');
}

// ---------------------------------------------------------------------------
// Room key

function renderKey(): void {
  const root = $('key');
  root.replaceChildren();
  const g = getGenre(dungeon().options.genre);
  const kindLabel: Record<string, string> = { monster: g.encounterLabel, trap: 'trap', special: 'special', empty: 'empty' };
  for (const r of dungeon().rooms) {
    const c = r.contents;
    if (!c) continue;
    const size = r.shape === 'area' ? null : el('span', { className: 'size', textContent: `${r.w * 5}×${r.h * 5} ft` });
    const card = el('div', { className: 'room' });
    card.dataset.id = String(r.id);
    card.append(el('h4', {}, el('span', { className: 'num', textContent: `${r.id + 1}.` }), c.name, size));
    const tags = el('div');
    tags.append(el('span', { className: `tag ${c.kind}`, textContent: kindLabel[c.kind] ?? c.kind }));
    if (r.entrance || r.exit) tags.append(' ', el('span', { className: 'tag stairs', textContent: `${g.stairWord} ${r.entrance ? 'up' : 'down'}` }));
    card.append(tags);
    card.append(el('p', { textContent: `${c.atmosphere} The room contains ${c.feature}.` }));
    if (c.note) card.append(el('p', { textContent: c.note }));
    const entry = (label: string, text: string | null): void => {
      if (text) card.append(el('div', { className: 'entry' }, el('b', { textContent: `${label}: ` }), text));
    };
    entry(g.encounterLabel, c.monster);
    entry('Trap', c.trap);
    entry('Special', c.special);
    entry(g.treasureLabel, c.treasure);
    if (r.doorCount) entry('Doors', String(r.doorCount));
    card.addEventListener('click', () => selectRoom(r.id, { center: true }));
    root.append(card);
  }
}

function selectRoom(id: number, { center = false }: { center?: boolean } = {}): void {
  state.selected = state.selected === id && !center ? -1 : id;
  for (const card of $('key').children) {
    card.classList.toggle('selected', Number((card as HTMLElement).dataset.id) === state.selected);
  }
  const room = dungeon().rooms[id];
  if (state.selected >= 0 && room) {
    $('key').querySelector('.room.selected')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    if (center) {
      state.view.ox = viewport.clientWidth / 2 - (room.cx + 0.5) * VIEW_PPG * state.view.scale;
      state.view.oy = viewport.clientHeight / 2 - (room.cy + 0.5) * VIEW_PPG * state.view.scale;
    }
  }
  drawView();
}

// ---------------------------------------------------------------------------
// Pan / zoom / click

let drag: { x: number; y: number; ox: number; oy: number; moved: boolean } | null = null;

viewport.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY, ox: state.view.ox, oy: state.view.oy, moved: false };
  viewport.setPointerCapture(e.pointerId);
});
viewport.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x;
  const dy = e.clientY - drag.y;
  if (Math.abs(dx) + Math.abs(dy) > 3) {
    drag.moved = true;
    viewport.classList.add('dragging');
  }
  state.view.ox = drag.ox + dx;
  state.view.oy = drag.oy + dy;
  drawView();
});
viewport.addEventListener('pointerup', (e) => {
  viewport.classList.remove('dragging');
  if (drag && !drag.moved) handleClick(e);
  drag = null;
});
viewport.addEventListener('wheel', (e) => {
  e.preventDefault();
  const rect = viewport.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const factor = Math.exp(-e.deltaY * 0.0015);
  const scale = Math.min(6, Math.max(0.05, state.view.scale * factor));
  const k = scale / state.view.scale;
  state.view = { scale, ox: mx - (mx - state.view.ox) * k, oy: my - (my - state.view.oy) * k };
  drawView();
}, { passive: false });

function handleClick(e: PointerEvent): void {
  const d = dungeon();
  const rect = viewport.getBoundingClientRect();
  const x = Math.floor((e.clientX - rect.left - state.view.ox) / state.view.scale / VIEW_PPG);
  const y = Math.floor((e.clientY - rect.top - state.view.oy) / state.view.scale / VIEW_PPG);
  let id = -1;
  if (x >= 0 && y >= 0 && x < d.width && y < d.height) id = d.roomIds[y * d.width + x] ?? -1;
  if (id >= 0) selectRoom(id);
  else if (state.selected >= 0) selectRoom(state.selected); // toggles off
}

new ResizeObserver(() => drawView()).observe(viewport);

// ---------------------------------------------------------------------------
// Save / open

async function saveMap(): Promise<void> {
  const d = dungeon();
  const path = await window.api.chooseSavePath({
    title: 'Save map',
    defaultName: `${slugify(d.seed)}.dungeon.json`,
    filters: [{ name: 'Dungeon Forge map', extensions: ['json'] }],
  });
  if (!path) return;
  const project: ProjectFile = { app: 'dungeon-forge', version: 1, style: state.style, dungeon: serializeDungeon(d) };
  await window.api.writeFiles([{ path, data: JSON.stringify(project), encoding: 'utf8' }]);
  toast(`Saved ${basename(path)}`);
}

async function openMap(): Promise<void> {
  const file = await window.api.openFile({ title: 'Open map', filters: [{ name: 'Dungeon Forge map', extensions: ['json'] }] });
  if (!file) return;
  try {
    const project = JSON.parse(file.text) as Partial<ProjectFile>;
    if (project.app !== 'dungeon-forge') throw new Error('This file was not saved by Dungeon Forge');
    const d = deserializeDungeon(project.dungeon);
    state.dungeon = d;
    state.options = normalizeOptions(d.options);
    const style = project.style;
    state.style = {
      theme: isThemeKey(style?.theme) ? style.theme : state.style.theme,
      showGrid: style?.showGrid ?? state.style.showGrid,
      showLabels: style?.showLabels ?? state.style.showLabels,
    };
    state.selected = -1;
    syncControls();
    redrawMap();
    renderKey();
    updateStatus();
    fitView();
    toast(`Opened ${basename(file.path)}`);
  } catch (err) {
    toast(`Could not open map: ${errorMessage(err)}`, true);
  }
}

// ---------------------------------------------------------------------------
// Export
//
// The formats themselves are strategies in ./export; this section only runs the dialog,
// supplies an ExportContext and writes the files a strategy returns.

const exportGrid = $<HTMLInputElement>('export-grid');
const exportView = $<HTMLSelectElement>('export-view');
const exportPpgInput = $<HTMLInputElement>('export-ppg');

function openExport(): void {
  const formats = $('export-formats');
  formats.replaceChildren();
  for (const exporter of EXPORTERS) {
    const b = el('button', { textContent: exporter.label });
    b.dataset.format = exporter.id;
    b.addEventListener('click', () => selectExportFormat(exporter));
    formats.append(b);
  }
  exportView.value = 'player';
  selectExportFormat(getExporter(state.exportFormat));
  $('export-modal').hidden = false;
}

function selectExportFormat(exporter: ExportStrategy): void {
  state.exportFormat = exporter.id;
  for (const b of $('export-formats').children) b.classList.toggle('active', (b as HTMLElement).dataset.format === exporter.id);
  $('export-desc').textContent = exporter.description;
  const image = exporter.image;
  $('export-options').hidden = image == null;
  if (image) {
    exportPpgInput.value = String(image.defaultPpg);
    exportGrid.checked = image.defaultGrid;
    const viewRow = exportView.closest('label');
    if (viewRow) viewRow.hidden = !image.viewSelectable;
  }
  updateExportSize();
}

function exportPpg(): number {
  const d = dungeon();
  const requested = Math.round(Number(exportPpgInput.value) || 70);
  const maxPpg = Math.floor(MAX_CANVAS_SIDE / Math.max(d.width, d.height));
  return Math.max(10, Math.min(requested, maxPpg, 400));
}

function updateExportSize(): void {
  const d = dungeon();
  const ppg = exportPpg();
  const requested = Math.round(Number(exportPpgInput.value) || 0);
  let text = `Image size: ${d.width * ppg} × ${d.height * ppg} px.`;
  if (requested > ppg) text += ` (Capped at ${ppg} px per square for a map this size.)`;
  $('export-size').textContent = text;
}

const canvasToBytes = (canvas: HTMLCanvasElement): Promise<Uint8Array> =>
  new Promise((resolve, reject) =>
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error('Image encoding failed'));
      blob.arrayBuffer().then((b) => resolve(new Uint8Array(b)), reject);
    }, 'image/png'),
  );

/** Snapshot of the dialog's choices, with a renderer bound to the current dungeon and theme. */
function createExportContext(): ExportContext {
  const d = dungeon();
  const ppg = exportPpg();
  const grid = exportGrid.checked;
  const gmView = exportView.value === 'gm';
  const style = { ...state.style };
  return {
    dungeon: d,
    ppg,
    grid,
    gmView,
    renderPng: (req: RenderRequest = {}) =>
      canvasToBytes(renderDungeon(document.createElement('canvas'), d, {
        ...style,
        ppg: req.ppg ?? ppg,
        showGrid: req.grid ?? grid,
        gmView: req.gmView ?? gmView,
      })),
  };
}

const basename = (p: string): string => p.split(/[\\/]/).pop() ?? p;
const stripExtension = (p: string, ext: string): string => (p.endsWith(ext) ? p.slice(0, -ext.length) : p.replace(/(\.[^.\\/]+)+$/, ''));

async function runExport(): Promise<void> {
  const exporter = getExporter(state.exportFormat);
  const ctx = createExportContext();
  $('export-modal').hidden = true;
  const path = await window.api.chooseSavePath({
    title: `Export ${exporter.label}`,
    defaultName: `${slugify(ctx.dungeon.seed)}${exporter.nameTag ?? ''}${exporter.extension}`,
    filters: [{ name: exporter.fileType, extensions: [exporter.extension.split('.').pop() ?? ''] }],
  });
  if (!path) return;
  busy(true);
  const result = await exporter.run(ctx, createExportTarget(stripExtension(path, exporter.extension)));
  const written = await window.api.writeFiles(result.files);
  busy(false);
  const warnings = (result.warnings ?? []).map((w) => html`<p class="warn">${w}</p>`);
  showInfo(`Exported: ${exporter.label}`, html`${result.summary}${warnings}`, written[0]);
}

function showInfo(title: string, body: SafeHtml, revealPath: string | undefined): void {
  $('info-title').textContent = title;
  $('info-body').innerHTML = body.value;
  const reveal = $('info-reveal');
  reveal.hidden = !revealPath;
  reveal.onclick = () => {
    if (revealPath) void window.api.showInFolder(revealPath);
  };
  $('info-modal').hidden = false;
}

function busy(on: boolean): void {
  document.body.style.cursor = on ? 'progress' : '';
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(msg: string, isError = false): void {
  const t = $('toast');
  t.textContent = msg;
  t.classList.toggle('error', isError);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), isError ? 5000 : 2200);
}

// ---------------------------------------------------------------------------
// Wiring

function newDungeon(): void {
  state.options.seed = randomSeed();
  generate({ fit: true });
}

function setGmView(on: boolean): void {
  state.gmView = on;
  syncControls();
  redrawMap();
}

const guard = (fn: () => Promise<void>) => (): void => {
  fn().catch((err: unknown) => {
    busy(false);
    console.error(err);
    toast(errorMessage(err), true);
  });
};

const actions: Record<MenuAction, () => void> = {
  new: newDungeon,
  regenerate: () => generate(),
  open: guard(openMap),
  save: guard(saveMap),
  export: openExport,
  'toggle-gm': () => setGmView(!state.gmView),
  fit: fitView,
};

$('btn-new').addEventListener('click', actions.new);
$('btn-regen').addEventListener('click', actions.regenerate);
$('btn-fit').addEventListener('click', actions.fit);
$('btn-open').addEventListener('click', actions.open);
$('btn-save').addEventListener('click', actions.save);
$('btn-export').addEventListener('click', actions.export);
$('view-gm').addEventListener('click', () => setGmView(true));
$('view-player').addEventListener('click', () => setGmView(false));
const seedInput = $<HTMLInputElement>('seed');
seedInput.addEventListener('change', () => {
  state.options.seed = seedInput.value.trim() || randomSeed();
  generate({ fit: true });
});
$('export-cancel').addEventListener('click', () => ($('export-modal').hidden = true));
$('export-go').addEventListener('click', guard(runExport));
exportPpgInput.addEventListener('input', updateExportSize);
$('info-close').addEventListener('click', () => ($('info-modal').hidden = true));
for (const id of ['export-modal', 'info-modal']) {
  const modal = $(id);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.hidden = true;
  });
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    $('export-modal').hidden = true;
    $('info-modal').hidden = true;
  }
});
window.api.onMenu((action) => actions[action]?.());

buildControls();
generate({ fit: true });
