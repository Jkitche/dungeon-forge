// Edit mode: turns pointer input on the map into editor operations, keeps the undo
// history and draws tool previews. The app owns the view; it forwards pointer events
// here while editing and calls drawOverlay() after drawing the map.

import {
  canHaveDoor, canHaveWindow, toggleWindow, placeProp, removeProp, rotateProp, cycleDoor, cycleStairs, edgeAt, eraseCells, isEditable, lineCells, paintCorridor, paintRoom,
  rectCells, restore, snapshot, togglePillar, lightAt, lightSpotAt, placeLight, removeLight, setLightRadius,
} from './editor.ts';
import type { Cell, Snapshot } from './editor.ts';
import { editorFree, fitProp, footprint, propAt } from './clutter.ts';
import type { PropKind } from './clutter.ts';
import { DIRS, isFloor, lightOrigin } from './generator.ts';
import type { Dungeon } from './generator.ts';
import type { RoomContents } from './contents.ts';

export type ToolId = 'room' | 'corridor' | 'erase' | 'door' | 'window' | 'pillar' | 'stairs' | 'clutter' | 'lighting';

export interface Tool {
  id: ToolId;
  label: string;
  key: string;
  hint: string;
}

export const TOOLS: readonly Tool[] = [
  { id: 'room', label: 'Room', key: 'r', hint: 'Drag to draw a room. Drawing over another room takes those squares.' },
  { id: 'corridor', label: 'Corridor', key: 'c', hint: 'Drag to paint corridor through rock. Hold Shift to fill a rectangle.' },
  { id: 'erase', label: 'Erase', key: 'e', hint: 'Drag to turn squares back into rock. Hold Shift to erase a rectangle.' },
  { id: 'door', label: 'Door', key: 'd', hint: 'Click the edge between two floor squares: door, then locked, then secret, then none.' },
  { id: 'window', label: 'Window', key: 'w', hint: 'Click a wall between floor and rock to add or remove a window.' },
  { id: 'pillar', label: 'Pillar', key: 'p', hint: 'Click a floor square to add or remove a pillar.' },
  { id: 'clutter', label: 'Clutter', key: 'f', hint: 'Click floor to place the chosen prop, click a prop to remove it, Shift-click to turn it.' },
  { id: 'stairs', label: 'Stairs', key: 's', hint: 'Click a floor square: stairs up, then stairs down, then none.' },
  { id: 'lighting', label: 'Lighting', key: 'l', hint: 'Click floor to place a light of the chosen radius, or click close to a wall to mount a torch on it. Click a light to remove it, Shift-click to give it the chosen radius.' },
];

/** Radius choices for the Lighting tool, in squares, with familiar light sources for scale. */
export const LIGHT_RADII: readonly [radius: number, label: string][] = [
  [1, '5 ft (candle)'],
  [2, '10 ft'],
  [3, '15 ft'],
  [4, '20 ft (torch)'],
  [6, '30 ft (lantern)'],
  [8, '40 ft'],
  [12, '60 ft'],
];

export interface EditorHost {
  dungeon(): Dungeon;
  /** Fractional grid coordinates under the pointer. */
  toGrid(e: MouseEvent): { fx: number; fy: number };
  /** The map data changed: re-render the map, room key and status. */
  changed(): void;
  /** Only the preview changed: redraw the view. */
  redrawOverlay(): void;
  newRoomContents(d: Dungeon): RoomContents;
}

const UNDO_LIMIT = 100;
const ACCENT = 'rgba(212, 162, 76, 0.95)';

export class MapEditor {
  active = false;
  tool: ToolId = 'room';
  /** What the Clutter tool places. */
  propKind: PropKind = 'crate';
  /** How far the Lighting tool's lights reach, in squares. */
  lightRadius = 4;
  private readonly host: EditorHost;
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  private hover: { fx: number; fy: number } | null = null;
  /** Drag in progress: where it started, where it is, and (for brushes) the cells crossed. */
  private drag: { start: Cell; current: Cell; painted: Map<number, Cell>; rect: boolean } | null = null;

  constructor(host: EditorHost) {
    this.host = host;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get dragging(): boolean {
    return this.drag !== null;
  }

  /** Forget history, e.g. after a new map replaces the one being edited. */
  reset(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.drag = null;
  }

  setTool(id: ToolId): void {
    this.tool = id;
    this.drag = null;
    this.host.redrawOverlay();
  }

  /** Runs an edit with undo support. The operation returns whether it changed anything. */
  apply(op: (d: Dungeon) => boolean): void {
    const d = this.host.dungeon();
    const before = snapshot(d);
    if (!op(d)) return;
    this.undoStack.push(before);
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.host.changed();
  }

  undo(): void {
    this.step(this.undoStack, this.redoStack);
  }

  redo(): void {
    this.step(this.redoStack, this.undoStack);
  }

  private step(from: Snapshot[], to: Snapshot[]): void {
    const s = from.pop();
    if (!s) return;
    const d = this.host.dungeon();
    to.push(snapshot(d));
    restore(d, s);
    this.drag = null;
    this.host.changed();
  }

  // -------------------------------------------------------------------------
  // Pointer input (left button only; the app handles panning)

  private cellAt(e: MouseEvent): Cell {
    const { fx, fy } = this.host.toGrid(e);
    return { x: Math.floor(fx), y: Math.floor(fy) };
  }

  pointerDown(e: PointerEvent): void {
    const { fx, fy } = this.host.toGrid(e);
    const cell = { x: Math.floor(fx), y: Math.floor(fy) };
    switch (this.tool) {
      case 'door':
        this.apply((d) => cycleDoor(d, edgeAt(fx, fy)));
        return;
      case 'window':
        this.apply((d) => toggleWindow(d, edgeAt(fx, fy)));
        return;
      case 'pillar':
        this.apply((d) => togglePillar(d, cell));
        return;
      case 'stairs':
        this.apply((d) => cycleStairs(d, cell));
        return;
      case 'clutter': {
        const onProp = propAt(this.host.dungeon(), cell.x, cell.y) >= 0;
        if (onProp) this.apply((d) => (e.shiftKey ? rotateProp(d, cell) : removeProp(d, cell)));
        else this.apply((d) => placeProp(d, cell, this.propKind));
        return;
      }
      case 'lighting': {
        const spot = lightSpotAt(this.host.dungeon(), fx, fy);
        const onLight = lightAt(this.host.dungeon(), spot) >= 0;
        if (onLight) this.apply((d) => (e.shiftKey ? setLightRadius(d, spot, this.lightRadius) : removeLight(d, spot)));
        else this.apply((d) => placeLight(d, spot, this.lightRadius));
        return;
      }
      default: {
        const painted = new Map<number, Cell>();
        painted.set(this.key(cell), cell);
        this.drag = { start: cell, current: cell, painted, rect: this.tool === 'room' || e.shiftKey };
        this.host.redrawOverlay();
      }
    }
  }

  pointerMove(e: PointerEvent): void {
    this.hover = this.host.toGrid(e);
    const drag = this.drag;
    if (drag) {
      const cell = this.cellAt(e);
      if (!drag.rect) for (const c of lineCells(drag.current, cell)) drag.painted.set(this.key(c), c);
      drag.current = cell;
    }
    this.host.redrawOverlay();
  }

  pointerUp(): void {
    const drag = this.drag;
    this.drag = null;
    if (!drag) return;
    const cells = (d: Dungeon): Cell[] => (drag.rect ? rectCells(d, drag.start, drag.current) : [...drag.painted.values()]);
    if (this.tool === 'room') this.apply((d) => paintRoom(d, drag.start, drag.current, this.host.newRoomContents(d)));
    else if (this.tool === 'corridor') this.apply((d) => paintCorridor(d, cells(d)));
    else if (this.tool === 'erase') this.apply((d) => eraseCells(d, cells(d)));
    this.host.redrawOverlay();
  }

  pointerLeave(): void {
    this.hover = null;
    this.host.redrawOverlay();
  }

  cancelDrag(): void {
    this.drag = null;
    this.host.redrawOverlay();
  }

  private key(c: Cell): number {
    return c.y * this.host.dungeon().width + c.x;
  }

  // -------------------------------------------------------------------------
  // Preview, drawn in map pixels (ppg per square) on top of the rendered map

  drawOverlay(ctx: CanvasRenderingContext2D, ppg: number): void {
    if (!this.active) return;
    const d = this.host.dungeon();
    const lw = Math.max(2, ppg * 0.06);
    ctx.save();

    if (this.tool === 'lighting') this.drawLights(ctx, ppg, lw);

    const drag = this.drag;
    if (drag) {
      const erase = this.tool === 'erase';
      const cells = drag.rect ? rectCells(d, drag.start, drag.current) : [...drag.painted.values()].filter((c) => isEditable(d, c.x, c.y));
      ctx.fillStyle = erase ? 'rgba(220, 70, 60, 0.35)' : 'rgba(212, 162, 76, 0.35)';
      for (const c of cells) ctx.fillRect(c.x * ppg, c.y * ppg, ppg, ppg);
      if (drag.rect && cells.length) {
        const x = Math.min(...cells.map((c) => c.x));
        const y = Math.min(...cells.map((c) => c.y));
        const w = Math.max(...cells.map((c) => c.x)) - x + 1;
        const h = Math.max(...cells.map((c) => c.y)) - y + 1;
        ctx.strokeStyle = erase ? 'rgba(220, 70, 60, 0.95)' : ACCENT;
        ctx.lineWidth = lw;
        ctx.strokeRect(x * ppg, y * ppg, w * ppg, h * ppg);
        this.label(ctx, ppg, `${w * 5} × ${h * 5} ft`, (x + w / 2) * ppg, y * ppg - ppg * 0.35);
      }
    } else if (this.hover) {
      const { fx, fy } = this.hover;
      if (this.tool === 'door' || this.tool === 'window') {
        const e = edgeAt(fx, fy);
        const ok = this.tool === 'door' ? canHaveDoor(d, e) : canHaveWindow(d, e);
        ctx.strokeStyle = ok ? ACCENT : 'rgba(220, 70, 60, 0.8)';
        ctx.lineWidth = Math.max(3, ppg * 0.16);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(e.x1 * ppg, e.y1 * ppg);
        ctx.lineTo(e.x2 * ppg, e.y2 * ppg);
        ctx.stroke();
      } else {
        const x = Math.floor(fx);
        const y = Math.floor(fy);
        const prop = this.tool === 'clutter' ? d.props[propAt(d, x, y)] : undefined;
        if (this.tool === 'lighting') {
          // The light a click would remove or change, or where a new one would go and how far it reaches.
          const spot = lightSpotAt(d, fx, fy);
          const on = lightAt(d, spot) >= 0;
          const ok = on || (isEditable(d, spot.x, spot.y) && isFloor(d.cells[spot.y * d.width + spot.x] as number));
          ctx.strokeStyle = ok ? ACCENT : 'rgba(220, 70, 60, 0.8)';
          ctx.lineWidth = lw;
          if (spot.wall === undefined) {
            ctx.strokeRect(spot.x * ppg, spot.y * ppg, ppg, ppg);
          } else {
            // A torch: highlight the stretch of wall it would hang on.
            const [dx, dy] = DIRS[spot.wall] ?? [0, 0];
            const mx = (spot.x + 0.5 + dx * 0.5) * ppg;
            const my = (spot.y + 0.5 + dy * 0.5) * ppg;
            ctx.save();
            ctx.lineWidth = Math.max(3, ppg * 0.16);
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(mx - dy * ppg * 0.5, my - dx * ppg * 0.5);
            ctx.lineTo(mx + dy * ppg * 0.5, my + dx * ppg * 0.5);
            ctx.stroke();
            ctx.restore();
          }
          if (ok && !on) this.lightRing(ctx, ppg, lw, lightOrigin(spot), this.lightRadius, ACCENT);
        } else if (prop) {
          // Outline the whole prop the click would remove or turn.
          ctx.strokeStyle = ACCENT;
          ctx.lineWidth = lw;
          for (const f of footprint(prop)) ctx.strokeRect(f.x * ppg, f.y * ppg, ppg, ppg);
        } else if (this.tool === 'clutter' && isEditable(d, x, y)) {
          // Ghost of the chosen prop where it would land, or a red square if it won't fit.
          const ghost = fitProp(d, this.propKind, { x, y }, editorFree(d));
          const squares = ghost ? footprint(ghost) : [{ x, y }];
          ctx.fillStyle = ghost ? 'rgba(212, 162, 76, 0.3)' : 'rgba(220, 70, 60, 0.3)';
          ctx.strokeStyle = ghost ? ACCENT : 'rgba(220, 70, 60, 0.8)';
          ctx.lineWidth = lw;
          for (const f of squares) {
            ctx.fillRect(f.x * ppg, f.y * ppg, ppg, ppg);
            ctx.strokeRect(f.x * ppg, f.y * ppg, ppg, ppg);
          }
        } else if (isEditable(d, x, y)) {
          ctx.strokeStyle = ACCENT;
          ctx.lineWidth = lw;
          ctx.strokeRect(x * ppg, y * ppg, ppg, ppg);
        }
      }
    }
    ctx.restore();
  }

  /** Every placed light: a dot where it sits and a ring showing how far it reaches. */
  private drawLights(ctx: CanvasRenderingContext2D, ppg: number, lw: number): void {
    for (const l of this.host.dungeon().lights) {
      const o = lightOrigin(l);
      ctx.fillStyle = 'rgba(255, 214, 120, 0.95)';
      ctx.beginPath();
      ctx.arc(o.x * ppg, o.y * ppg, ppg * 0.14, 0, Math.PI * 2);
      ctx.fill();
      this.lightRing(ctx, ppg, lw, o, l.radius, 'rgba(255, 214, 120, 0.7)');
    }
  }

  /** A dashed ring showing how far a light at `origin` (grid units) reaches. */
  private lightRing(ctx: CanvasRenderingContext2D, ppg: number, lw: number, origin: { x: number; y: number }, radius: number, colour: string): void {
    ctx.save();
    ctx.strokeStyle = colour;
    ctx.lineWidth = lw;
    ctx.setLineDash([ppg * 0.2, ppg * 0.15]);
    ctx.beginPath();
    ctx.arc(origin.x * ppg, origin.y * ppg, radius * ppg, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private label(ctx: CanvasRenderingContext2D, ppg: number, text: string, x: number, y: number): void {
    ctx.font = `600 ${Math.round(ppg * 0.42)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(text).width + ppg * 0.4;
    ctx.fillStyle = 'rgba(22, 23, 27, 0.9)';
    ctx.fillRect(x - w / 2, y - ppg * 0.3, w, ppg * 0.6);
    ctx.fillStyle = '#f2e6cc';
    ctx.fillText(text, x, y);
  }
}
