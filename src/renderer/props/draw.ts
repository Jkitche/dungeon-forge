// Drawing helpers shared by the prop renderers (and, for blob, the map renderer).

import type { RNG } from '../rng.ts';
import type { PropBox, PropPaintContext } from './types.ts';

/** Fills and outlines the path that `draw` builds, in the palette's line colour. */
export function outlined(c: PropPaintContext, fill: string, draw: () => void): void {
  const { ctx, ppg, palette } = c;
  ctx.fillStyle = fill;
  ctx.strokeStyle = palette.line;
  ctx.lineWidth = Math.max(1, ppg * 0.035);
  ctx.beginPath();
  draw();
  ctx.fill();
  ctx.stroke();
}

/** Inset a box by fractions of a square on each axis. */
export const inset = (b: PropBox, ppg: number, ix: number, iy = ix): PropBox => ({
  ...b, x: b.x + ppg * ix, y: b.y + ppg * iy, w: b.w - ppg * ix * 2, h: b.h - ppg * iy * 2,
});

/** '#rrggbb' to 'rgba(r, g, b, a)'. */
export function withAlpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1, 7), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export function glowCircle(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, r: number): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  // Fade to the same colour, fully transparent; fading to transparent black looks muddy.
  g.addColorStop(0, withAlpha(color, 0.55));
  g.addColorStop(1, withAlpha(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

/** A filled, lumpy polygon around (cx, cy), in grid units: stones, stains, debris. */
export function blob(
  c: { ctx: CanvasRenderingContext2D; ppg: number; rng: RNG },
  cx: number,
  cy: number,
  r: number,
  points: number,
): void {
  const { ctx, ppg, rng } = c;
  ctx.beginPath();
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2;
    const rr = r * (0.6 + rng.float() * 0.5);
    const x = (cx + Math.cos(a) * rr) * ppg;
    const y = (cy + Math.sin(a) * rr) * ppg;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}
