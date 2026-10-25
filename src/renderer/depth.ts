// Depth and lighting: effects that make the flat top-down map read as 3D without moving
// anything, so walls and doors still line up with VTT line of sight.
//
// Light always falls from the top-left, so shadows fall down and to the right, walls are
// lit on their top/left edge, and floor beside a north or west wall sits in its shadow.

import { PROP_SPECS, footprint } from './clutter.ts';
import type { Prop } from './clutter.ts';
import type { Dungeon } from './generator.ts';
import { PILLAR } from './cells.ts';
import { eachWallUnit, PILLAR_RADIUS } from './walls.ts';
import type { Segment } from './walls.ts';
import { withAlpha } from './props/draw.ts';
export { bevel } from './props/draw.ts';
import type { PropPalette, PropRenderer } from './props/types.ts';

type Ctx = CanvasRenderingContext2D;

export type DepthLevel = 'off' | 'subtle' | 'strong';

export const DEPTH_LEVELS: readonly [DepthLevel, string][] = [['off', 'Off'], ['subtle', 'Subtle'], ['strong', 'Strong']];

export const isDepthLevel = (v: unknown): v is DepthLevel => DEPTH_LEVELS.some(([l]) => l === v);

/** How strongly each level applies the effects, 0–1. */
export function depthAmount(level: DepthLevel | undefined): number {
  return level === 'strong' ? 1 : level === 'subtle' ? 0.6 : 0;
}

/** Mixes '#rrggbb' toward another colour by t (0–1). */
export function mix(hex: string, toward: string, t: number): string {
  const a = parseInt(hex.slice(1, 7), 16);
  const b = parseInt(toward.slice(1, 7), 16);
  const ch = (shift: number): number => Math.round(((a >> shift) & 255) * (1 - t) + ((b >> shift) & 255) * t);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}

/**
 * Sets a shadow that falls down-right, longer for taller things. `height` is in
 * squares-ish (1 is a crate); `strength` scales the darkness, lower on pale themes.
 */
export function castShadow(ctx: Ctx, ppg: number, amount: number, height: number, strength: number): void {
  ctx.shadowColor = `rgba(0, 0, 0, ${(0.75 * strength).toFixed(3)})`;
  ctx.shadowBlur = ppg * 0.3;
  ctx.shadowOffsetX = ppg * 0.16 * height * amount;
  ctx.shadowOffsetY = ppg * 0.16 * height * amount;
}


/**
 * Ambient occlusion: the floor darkens where it meets a wall, more in corners (where two
 * bands overlap) and more on the shadowed side of north and west walls. Also a soft ring
 * around pillars. Call with the floor clipped.
 */
export function drawAmbientOcclusion(ctx: Ctx, d: Dungeon, ppg: number, amount: number, strength: number): void {
  const band = ppg * 0.6;
  eachWallUnit(d, (x1, y1, x2, y2, rx, ry) => {
    // The floor lies opposite the rock. Floor south or east of its wall is out of the light.
    const fx = -rx;
    const fy = -ry;
    const shaded = fx > 0 || fy > 0;
    const alpha = 0.5 * amount * strength * (shaded ? 1.3 : 0.75);
    const ex = x1 * ppg;
    const ey = y1 * ppg;
    const g = ctx.createLinearGradient(ex, ey, ex + fx * band, ey + fy * band);
    g.addColorStop(0, `rgba(0, 0, 0, ${alpha.toFixed(3)})`);
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = g;
    if (y1 === y2) ctx.fillRect(ex, fy > 0 ? ey : ey - band, (x2 - x1) * ppg, band);
    else ctx.fillRect(fx > 0 ? ex : ex - band, ey, band, (y2 - y1) * ppg);
  });
  for (let c = 0; c < d.cells.length; c++) {
    if (d.cells[c] !== PILLAR) continue;
    const cx = ((c % d.width) + 0.5) * ppg;
    const cy = (Math.floor(c / d.width) + 0.5) * ppg;
    const r = PILLAR_RADIUS * ppg;
    const g = ctx.createRadialGradient(cx, cy, r, cx, cy, r + ppg * 0.35);
    g.addColorStop(0, `rgba(0, 0, 0, ${(0.45 * amount * strength).toFixed(3)})`);
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - r - ppg * 0.35, cy - r - ppg * 0.35, (r + ppg * 0.35) * 2, (r + ppg * 0.35) * 2);
  }
}

/**
 * Raised walls: a lit line along each wall's top/left edge and a shaded line along its
 * bottom/right edge, inside the wall's own thickness.
 */
export function drawWallBevel(ctx: Ctx, walls: readonly Segment[], ppg: number, wall: string, wallWidth: number, amount: number): void {
  const w = ppg * wallWidth;
  const offset = w * 0.26;
  const edge = (colour: string, sign: number): void => {
    ctx.strokeStyle = colour;
    ctx.lineWidth = Math.max(1, w * 0.28);
    ctx.beginPath();
    for (const s of walls) {
      const horiz = s.y1 === s.y2;
      const dx = horiz ? 0 : sign * offset;
      const dy = horiz ? sign * offset : 0;
      ctx.moveTo(s.x1 * ppg + dx, s.y1 * ppg + dy);
      ctx.lineTo(s.x2 * ppg + dx, s.y2 * ppg + dy);
    }
    ctx.stroke();
  };
  ctx.save();
  ctx.lineCap = 'butt';
  edge(mix(wall, '#ffffff', 0.32 * amount), -1);
  edge(mix(wall, '#000000', 0.45 * amount), 1);
  ctx.restore();
}

/** Soft shadows under props, longer for taller ones. Flat props (rugs, bones) cast none. */
export function drawPropShadows(
  ctx: Ctx,
  props: readonly Prop[],
  renderers: Readonly<Record<Prop['kind'], PropRenderer>>,
  ppg: number,
  amount: number,
  strength: number,
): void {
  ctx.save();
  ctx.filter = `blur(${Math.max(1, ppg * 0.08).toFixed(1)}px)`;
  ctx.fillStyle = `rgba(0, 0, 0, ${(0.5 * amount * strength).toFixed(3)})`;
  for (const prop of props) {
    const r = renderers[prop.kind];
    if (r.height <= 0) continue;
    const off = ppg * 0.16 * r.height * amount;
    const squares = footprint(prop);
    const x0 = Math.min(...squares.map((s) => s.x)) * ppg + off;
    const y0 = Math.min(...squares.map((s) => s.y)) * ppg + off;
    const long = PROP_SPECS[prop.kind].long;
    const w = (long && !prop.vertical ? 2 : 1) * ppg;
    const h = (long && prop.vertical ? 2 : 1) * ppg;
    ctx.beginPath();
    if (r.round) ctx.arc(x0 + w / 2, y0 + h / 2, ppg * 0.34, 0, Math.PI * 2);
    else ctx.rect(x0 + ppg * 0.14, y0 + ppg * 0.14, w - ppg * 0.28, h - ppg * 0.28);
    ctx.fill();
  }
  ctx.restore();
}

export interface LightSource {
  /** Centre in grid units. */
  x: number;
  y: number;
  /** Reach in squares. */
  radius: number;
  colour: string;
}

/** Braziers, screens and cryo pods glow in the theme's light colour. */
export function lightSources(d: Dungeon, palette: PropPalette): LightSource[] {
  const lights: LightSource[] = [];
  for (const p of d.props) {
    const long = PROP_SPECS[p.kind].long;
    const cx = p.x + (long && !p.vertical ? 1 : 0.5);
    const cy = p.y + (long && p.vertical ? 1 : 0.5);
    if (p.kind === 'brazier') lights.push({ x: cx, y: cy, radius: 3.2, colour: palette.glow });
    else if (p.kind === 'console' || p.kind === 'pod') lights.push({ x: cx, y: cy, radius: 2, colour: palette.glow });
  }
  return lights;
}

/**
 * Dims the floor, then adds a pool of light around each source. Call with the floor
 * clipped, after props and before walls, so walls and labels stay crisp.
 */
export function drawLighting(ctx: Ctx, lights: readonly LightSource[], ppg: number, width: number, height: number, darkness: number): void {
  ctx.save();
  ctx.fillStyle = `rgba(0, 0, 0, ${darkness})`;
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = 'lighter';
  for (const l of lights) {
    const x = l.x * ppg;
    const y = l.y * ppg;
    const r = l.radius * ppg;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, withAlpha(l.colour, 0.4));
    g.addColorStop(1, withAlpha(l.colour, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.restore();
}
