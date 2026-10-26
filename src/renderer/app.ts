import { generateDungeon, normalizeOptions, serializeDungeon, deserializeDungeon, doorSummary, DEFAULT_OPTIONS, ROOM } from './generator.ts';
import type { Dungeon, DungeonOptions, SerializedDungeon } from './generator.ts';
import { renderDungeon, LOOKS, isLook, resolveTheme } from './renderer.ts';
import type { Look, RenderOptions } from './renderer.ts';
import { DEPTH_LEVELS, isDepthLevel } from './depth.ts';
import type { DepthLevel } from './depth.ts';
import { ENVIRONMENTS } from './environment.ts';
import { EXPORTERS, getExporter, createExportTarget } from './export/index.ts';
import type { ExportContext, ExportStrategy, RenderRequest } from './export/index.ts';
import { html, slugify } from './text.ts';
import type { SafeHtml } from './text.ts';
import { randomSeed } from './rng.ts';
import { clearMap, createBlankDungeon, stockNewRoom } from './editor.ts';
import { LIGHT_RADII, MapEditor, TOOLS } from './editor-ui.ts';
import { COVER_LABELS, PROP_KINDS, PROP_LABELS, PROP_SPECS, settingProps } from './clutter.ts';
import type { PropKind } from './clutter.ts';
import { GENRES, GENRE_KEYS, getGenre, isGenreKey } from './genres.ts';
import { loadPhotoTextures } from './photo.ts';
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
  look: Look;
  depth: DepthLevel;
  lighting: boolean;
  effects: boolean;
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
  style: { look: 'setting', depth: 'subtle', lighting: false, effects: true, showGrid: true, showLabels: true },
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
/** A row of buttons, one per option; for short choices that are easier to see than a dropdown. */
interface SegmentedItem {
  type: 'segmented';
  key: string;
  label: string;
  options: readonly [value: string, label: string][];
}
type ControlItem = SelectItem | RangeItem | CheckItem | SegmentedItem;

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
      { key: 'clutter', type: 'range', label: 'Clutter', min: 0, max: 1, step: 0.05, fmt: pct },
    ],
  },
  {
    title: 'Corridors, doors & windows',
    show: isRooms,
    items: [
      { key: 'corridorStyle', type: 'select', label: 'Corridors', options: [['straight', 'Straight'], ['winding', 'Winding']] },
      { key: 'loopChance', type: 'range', label: 'Extra loops', min: 0, max: 1, step: 0.05, fmt: pct },
      { key: 'doorChance', type: 'range', label: 'Doors on entrances', min: 0, max: 1, step: 0.05, fmt: pct },
      { key: 'lockedDoorChance', type: 'range', label: 'Locked doors', min: 0, max: 0.6, step: 0.05, fmt: pct },
      { key: 'secretDoorChance', type: 'range', label: 'Secret doors', min: 0, max: 0.4, step: 0.05, fmt: pct },
      { key: 'windowChance', type: 'range', label: 'Windows', min: 0, max: 1, step: 0.05, fmt: pct },
    ],
  },
  {
    title: 'Caverns',
    show: isCaves,
    items: [
      { key: 'roomCount', type: 'range', label: 'Keyed areas (max)', min: 1, max: 40, step: 1 },
      { key: 'caveFill', type: 'range', label: 'Rock density', min: 0.35, max: 0.55, step: 0.01, fmt: pct },
      { key: 'caveSteps', type: 'range', label: 'Smoothing passes', min: 1, max: 8, step: 1 },
      { key: 'clutter', type: 'range', label: 'Clutter', min: 0, max: 1, step: 0.05, fmt: pct },
    ],
  },
  {
    title: 'Style',
    style: true,
    items: [
      { key: 'look', type: 'segmented', label: 'Look', options: LOOKS },
      { key: 'depth', type: 'segmented', label: 'Depth', options: DEPTH_LEVELS },
      { key: 'lighting', type: 'check', label: 'Light sources' },
      { key: 'effects', type: 'check', label: 'Room cold and heat' },
      { key: 'showGrid', type: 'check', label: 'Show grid' },
      { key: 'showLabels', type: 'check', label: 'Room numbers (GM view)' },
    ],
  },
];

interface BoundControl {
  item: ControlItem;
  section: Section;
  /** Shows a value from the state in the control. */
  show(value: unknown): void;
}

const controlInputs: BoundControl[] = [];
const sectionNodes = new Map<Section, HTMLElement>();

// Looked up on each use: generate() and openMap() replace these objects.
const targetOf = (section: Section): Record<string, unknown> =>
  (section.style ? state.style : state.options) as unknown as Record<string, unknown>;

/** Stores a control's new value, then redraws (style) or regenerates (everything else). */
function controlChanged(section: Section, item: ControlItem, value: unknown): void {
  targetOf(section)[item.key] = value;
  if (item.type === 'select') item.onChange?.(String(value));
  syncControls();
  if (section.style) redrawMap();
  else scheduleGenerate();
}

function buildControl(section: Section, item: ControlItem): { node: HTMLElement; control: BoundControl } {
  const bind = (show: BoundControl['show']): BoundControl => ({ item, section, show });
  switch (item.type) {
    case 'select': {
      const select = el('select');
      for (const [value, label] of item.options) select.append(el('option', { value, textContent: label }));
      select.addEventListener('input', () => controlChanged(section, item, select.value));
      const node = el('div', { className: 'control' }, el('label', { textContent: item.label }), select);
      return { node, control: bind((v) => (select.value = String(v))) };
    }
    case 'check': {
      const box = el('input', { type: 'checkbox' });
      box.addEventListener('input', () => controlChanged(section, item, box.checked));
      const node = el('div', { className: 'control check' }, el('label', {}, box, item.label));
      return { node, control: bind((v) => (box.checked = Boolean(v))) };
    }
    case 'segmented': {
      // More than three choices won't fit across the sidebar, so they go two to a row.
      const group = el('div', { className: item.options.length > 3 ? 'segmented grid' : 'segmented' });
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', item.label);
      for (const [value, label] of item.options) {
        const b = el('button', { textContent: label, type: 'button' });
        b.dataset.value = value;
        b.addEventListener('click', () => controlChanged(section, item, value));
        group.append(b);
      }
      const node = el('div', { className: 'control' }, el('label', { textContent: item.label }), group);
      const show = (v: unknown): void => {
        for (const b of group.children) {
          const on = (b as HTMLElement).dataset.value === v;
          b.classList.toggle('active', on);
          b.setAttribute('aria-pressed', String(on));
        }
      };
      return { node, control: bind(show) };
    }
    case 'range': {
      const range = el('input', { type: 'range', min: String(item.min), max: String(item.max), step: String(item.step) });
      const value = el('span', { className: 'value' });
      range.addEventListener('input', () => controlChanged(section, item, Number(range.value)));
      const node = el('div', { className: 'control' }, el('label', {}, el('span', { textContent: item.label }), value), range);
      const show = (v: unknown): void => {
        range.value = String(v);
        value.textContent = item.fmt ? item.fmt(Number(v)) : String(v);
      };
      return { node, control: bind(show) };
    }
  }
}

function buildControls(): void {
  const root = $('controls');
  for (const section of CONTROLS) {
    const box = el('section');
    sectionNodes.set(section, box);
    box.append(el('h3', { textContent: section.title }));
    for (const item of section.items) {
      const { node, control } = buildControl(section, item);
      controlInputs.push(control);
      box.append(node);
    }
    root.append(box);
  }
}

function syncControls(): void {
  for (const { item, section, show } of controlInputs) show(targetOf(section)[item.key]);
  for (const section of CONTROLS) {
    const node = sectionNodes.get(section);
    if (node) node.hidden = section.show ? !section.show(state.options) : false;
  }
  $<HTMLInputElement>('seed').value = state.options.seed;
  $('view-gm').classList.toggle('active', state.gmView);
  $('view-player').classList.toggle('active', !state.gmView);
}

/** Render settings for the current map: the theme follows its setting unless a look overrides it. */
function renderStyle(d: Dungeon): RenderOptions {
  return {
    theme: resolveTheme(state.style.look, getGenre(d.options.genre).theme),
    depth: state.style.depth,
    lighting: state.style.lighting,
    effects: state.style.effects,
    showGrid: state.style.showGrid,
    showLabels: state.style.showLabels,
  };
}

// Picking a setting nudges the layout sliders to suit it (its art follows via the Look).
// Width, height, room counts and sizes are left alone.
function applyGenre(value: string): void {
  if (!isGenreKey(value)) return;
  Object.assign(state.options, GENRES[value].preset);
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

/** True if it's fine to replace the current map: it has no hand edits, or the user agreed to lose them. */
function confirmDiscard(): boolean {
  return !state.dungeon?.edited || window.confirm('This map has hand edits that will be lost. Continue?');
}

function generate({ fit = false }: { fit?: boolean } = {}): void {
  if (!confirmDiscard()) {
    // Put the controls back to match the map that's staying.
    state.options = { ...dungeon().options };
    syncControls();
    return;
  }
  editor.reset();
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
  renderDungeon(state.mapCanvas, state.dungeon, { ...renderStyle(state.dungeon), ppg: VIEW_PPG, gmView: state.gmView });
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
  editor.drawOverlay(ctx, VIEW_PPG);
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
    `${doors.total} doors · ${doors.locked} locked · ${doors.secret} secret · ${d.windows.length} windows`,
    d.edited ? `seed "${d.seed}" (hand-edited)` : `seed "${d.seed}"`,
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
  if (dungeon().rooms.length === 0) {
    root.append(el('p', { className: 'key-empty', textContent: 'No rooms yet. Open Edit map and drag with the Room tool to draw one.' }));
  }
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
    if (r.environment) tags.append(' ', el('span', { className: `tag env-${r.environment}`, textContent: ENVIRONMENTS[r.environment].label }));
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
/** Holding Space pans with the left button while editing. */
let spaceHeld = false;

function toGrid(e: MouseEvent): { fx: number; fy: number } {
  const rect = viewport.getBoundingClientRect();
  return {
    fx: (e.clientX - rect.left - state.view.ox) / state.view.scale / VIEW_PPG,
    fy: (e.clientY - rect.top - state.view.oy) / state.view.scale / VIEW_PPG,
  };
}

viewport.addEventListener('pointerdown', (e) => {
  // Ignore clicks on the edit toolbar floating over the map.
  if (e.target !== viewCanvas) return;
  viewport.setPointerCapture(e.pointerId);
  if (editor.active && e.button === 0 && !spaceHeld) {
    editor.pointerDown(e);
    return;
  }
  drag = { x: e.clientX, y: e.clientY, ox: state.view.ox, oy: state.view.oy, moved: false };
});
viewport.addEventListener('pointermove', (e) => {
  if (editor.dragging) {
    editor.pointerMove(e);
    return;
  }
  if (!drag) {
    if (editor.active && e.target === viewCanvas) editor.pointerMove(e);
    return;
  }
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
  if (editor.dragging) {
    editor.pointerUp();
    return;
  }
  viewport.classList.remove('dragging');
  if (drag && !drag.moved && !editor.active) handleClick(e);
  drag = null;
});
viewport.addEventListener('pointerleave', () => {
  if (editor.active) editor.pointerLeave();
});
// Right-drag pans in edit mode, so keep the context menu out of the way.
viewport.addEventListener('contextmenu', (e) => e.preventDefault());
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
  const { fx, fy } = toGrid(e);
  const x = Math.floor(fx);
  const y = Math.floor(fy);
  let id = -1;
  if (x >= 0 && y >= 0 && x < d.width && y < d.height) id = d.roomIds[y * d.width + x] ?? -1;
  if (id >= 0) selectRoom(id);
  else if (state.selected >= 0) selectRoom(state.selected); // toggles off
}

// ---------------------------------------------------------------------------
// Edit mode

const editor = new MapEditor({
  dungeon,
  toGrid,
  changed: () => {
    state.selected = -1;
    // A placed light would be invisible with Light sources off, so placing one turns it on.
    if (editor.tool === 'lighting' && dungeon().lights.length > 0 && !state.style.lighting) {
      state.style.lighting = true;
      syncControls();
    }
    redrawMap();
    renderKey();
    updateStatus();
    syncEditBar();
  },
  redrawOverlay: () => drawView(),
  newRoomContents: (d) => stockNewRoom(d),
});

const toolSelect = $<HTMLSelectElement>('edit-tool');
const propSelect = $<HTMLSelectElement>('edit-prop');
const radiusSelect = $<HTMLSelectElement>('edit-radius');

function buildEditBar(): void {
  for (const tool of TOOLS) {
    toolSelect.append(el('option', { value: tool.id, textContent: `${tool.label} (${tool.key.toUpperCase()})` }));
  }
  toolSelect.addEventListener('change', () => {
    const tool = TOOLS.find((t) => t.id === toolSelect.value);
    if (tool) editor.setTool(tool.id);
    syncEditBar();
    toolSelect.blur(); // so tool keys and Space work straight away
  });
  propSelect.addEventListener('change', () => {
    editor.propKind = propSelect.value as PropKind;
    propSelect.blur();
    drawView();
  });
  for (const [radius, label] of LIGHT_RADII) radiusSelect.append(el('option', { value: String(radius), textContent: label }));
  radiusSelect.addEventListener('change', () => {
    editor.lightRadius = Number(radiusSelect.value);
    radiusSelect.blur();
    drawView();
  });
}

/** Prop choices, the current setting's own props first. Rebuilt when the setting changes. */
let propOptionsGenre = '';
function fillPropOptions(): void {
  const genre = dungeon().options.genre;
  if (genre === propOptionsGenre) return;
  propOptionsGenre = genre;
  const own = settingProps(genre);
  const group = (label: string, kinds: PropKind[]): HTMLOptGroupElement => {
    const g = el('optgroup', { label });
    for (const k of kinds) g.append(el('option', { value: k, textContent: `${PROP_LABELS[k]} (${COVER_LABELS[PROP_SPECS[k].cover]})` }));
    return g;
  };
  propSelect.replaceChildren(
    group(`${getGenre(genre).label} props`, own),
    group('Other props', PROP_KINDS.filter((k) => !own.includes(k))),
  );
}

function syncEditBar(): void {
  toolSelect.value = editor.tool;
  const clutter = editor.tool === 'clutter';
  $('edit-prop-field').hidden = !clutter;
  if (clutter) {
    fillPropOptions();
    propSelect.value = editor.propKind;
  }
  $('edit-radius-field').hidden = editor.tool !== 'lighting';
  radiusSelect.value = String(editor.lightRadius);
  const tool = TOOLS.find((t) => t.id === editor.tool);
  $('edit-hint').textContent = `${tool?.hint ?? ''} Right-drag or hold Space to pan.`;
  $<HTMLButtonElement>('btn-undo').disabled = !editor.canUndo;
  $<HTMLButtonElement>('btn-redo').disabled = !editor.canRedo;
}

function setEditing(on: boolean): void {
  editor.active = on;
  if (!on) editor.cancelDrag();
  state.selected = -1;
  viewport.classList.toggle('editing', on);
  $('editbar').hidden = !on;
  $('btn-edit').classList.toggle('active', on);
  syncEditBar();
  renderKey();
  drawView();
}

/** Starts a fresh all-rock map at the current size and opens edit mode. */
function blankMap(): void {
  if (!confirmDiscard()) return;
  state.dungeon = createBlankDungeon(state.options);
  state.options = { ...state.dungeon.options };
  state.selected = -1;
  editor.reset();
  syncControls();
  redrawMap();
  renderKey();
  updateStatus();
  fitView();
  setEditing(true);
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
  await window.api.writeFiles([{ path, data: projectJson(), encoding: 'utf8' }]);
  toast(`Saved ${basename(path)}`);
}

/** The current map and style, as saved in a .dungeon.json file. */
function projectJson(): string {
  const project: ProjectFile = { app: 'dungeon-forge', version: 1, style: state.style, dungeon: serializeDungeon(dungeon()) };
  return JSON.stringify(project);
}

/** Replaces the current map and style with a saved project. Throws if it isn't one. */
function loadProject(text: string): void {
  const project = JSON.parse(text) as Partial<ProjectFile>;
  if (project.app !== 'dungeon-forge') throw new Error('This file was not saved by Dungeon Forge');
  const d = deserializeDungeon(project.dungeon);
  state.dungeon = d;
  editor.reset();
  state.options = normalizeOptions(d.options);
  // Maps saved before the Look switch stored a theme name instead.
  const style = project.style as Partial<StyleOptions> & { theme?: string } | undefined;
  const legacyLook = style?.theme === 'blueprint' || style?.theme === 'stone' ? style.theme : 'setting';
  state.style = {
    look: isLook(style?.look) ? style.look : legacyLook,
    depth: isDepthLevel(style?.depth) ? style.depth : state.style.depth,
    lighting: style?.lighting ?? state.style.lighting,
    effects: style?.effects ?? state.style.effects,
    showGrid: style?.showGrid ?? state.style.showGrid,
    showLabels: style?.showLabels ?? state.style.showLabels,
  };
  state.selected = -1;
  syncControls();
  redrawMap();
  renderKey();
  updateStatus();
}

async function openMap(): Promise<void> {
  if (!confirmDiscard()) return;
  const file = await window.api.openFile({ title: 'Open map', filters: [{ name: 'Dungeon Forge map', extensions: ['json'] }] });
  if (!file) return;
  try {
    loadProject(file.text);
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
  const style = renderStyle(d);
  return {
    dungeon: d,
    ppg,
    grid,
    gmView,
    renderPng: async (req: RenderRequest = {}) => {
      await photosReady;
      return canvasToBytes(renderDungeon(document.createElement('canvas'), d, {
        ...style,
        ppg: req.ppg ?? ppg,
        showGrid: req.grid ?? grid,
        gmView: req.gmView ?? gmView,
      }));
    },
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
  blank: blankMap,
  regenerate: () => generate(),
  open: guard(openMap),
  save: guard(saveMap),
  export: openExport,
  'toggle-gm': () => setGmView(!state.gmView),
  'toggle-edit': () => setEditing(!editor.active),
  fit: fitView,
};

$('btn-new').addEventListener('click', actions.new);
$('btn-regen').addEventListener('click', actions.regenerate);
$('btn-fit').addEventListener('click', actions.fit);
$('btn-open').addEventListener('click', actions.open);
$('btn-save').addEventListener('click', actions.save);
$('btn-export').addEventListener('click', actions.export);
$('btn-edit').addEventListener('click', actions['toggle-edit']);
$('btn-edit-done').addEventListener('click', () => setEditing(false));
$('btn-undo').addEventListener('click', () => editor.undo());
$('btn-redo').addEventListener('click', () => editor.redo());
$('btn-clear').addEventListener('click', () => {
  if (window.confirm('Clear the whole map back to solid rock? You can undo this.')) editor.apply(clearMap);
});
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
    if (editor.dragging) editor.cancelDrag();
    $('export-modal').hidden = true;
    $('info-modal').hidden = true;
    return;
  }
  const t = e.target;
  const typing = t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement;
  if (typing || !editor.active || !$('export-modal').hidden) return;
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (mod && key === 'z') {
    e.preventDefault();
    if (e.shiftKey) editor.redo();
    else editor.undo();
  } else if (mod && key === 'y') {
    e.preventDefault();
    editor.redo();
  } else if (e.key === ' ') {
    e.preventDefault();
    (document.activeElement as HTMLElement | null)?.blur();
    spaceHeld = true;
    viewport.classList.add('panning');
  } else if (!mod && !e.altKey) {
    const tool = TOOLS.find((x) => x.key === key);
    if (tool) {
      editor.setTool(tool.id);
      syncEditBar();
    }
  }
});
document.addEventListener('keyup', (e) => {
  if (e.key === ' ') {
    spaceHeld = false;
    viewport.classList.remove('panning');
  }
});
window.api.onMenu((action) => actions[action]?.());

buildControls();
buildEditBar();

// Reloading the window (as `npm run dev` does after every change) keeps the map, its
// style, the view and edit mode, rather than starting over with a new random dungeon.
const RELOAD_KEY = 'dungeon-forge:reload';
window.addEventListener('beforeunload', () => {
  try {
    sessionStorage.setItem(RELOAD_KEY, JSON.stringify({ project: projectJson(), view: state.view, gmView: state.gmView, editing: editor.active }));
  } catch {
    // Too big to keep, or storage is off: the reload just starts fresh.
  }
});
function restoreAfterReload(): boolean {
  try {
    const saved = sessionStorage.getItem(RELOAD_KEY);
    sessionStorage.removeItem(RELOAD_KEY);
    if (!saved) return false;
    const { project, view, gmView, editing } = JSON.parse(saved) as { project: string; view: typeof state.view; gmView: boolean; editing: boolean };
    loadProject(project);
    state.gmView = gmView;
    syncControls();
    redrawMap();
    if (editing) setEditing(true);
    state.view = view;
    drawView();
    return true;
  } catch {
    return false;
  }
}
if (!restoreAfterReload()) generate({ fit: true });
// The Realistic look draws hand-drawn stand-ins until its photographs arrive, then redraws.
const photosReady = loadPhotoTextures(new URL('./assets/textures/', import.meta.url)).then(redrawMap);
