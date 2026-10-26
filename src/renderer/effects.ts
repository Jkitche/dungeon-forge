// Cold and heat on the map: a frozen room is washed blue and a scorching one red, and the
// colour bleeds out through its doorways, fading along the corridor beyond.

import type { Dungeon } from './generator.ts';
import type { Environment } from './environment.ts';
import { SPREAD, environmentField, environmentOpenings } from './environment.ts';
import { withAlpha } from './props/draw.ts';

type Ctx = CanvasRenderingContext2D;

/** The wash each environment shows in, and how strong it is at full intensity. */
export const TINTS: Partial<Record<Environment, { colour: string; alpha: number }>> = {
  frost: { colour: '#3d9bff', alpha: 0.42 },
  heat: { colour: '#ff3b1f', alpha: 0.38 },
};

/**
 * Washes every affected square, then pours a soft cloud out of each doorway. Call with
 * the floor clipped, so the colour never covers rock.
 */
export function drawEnvironments(ctx: Ctx, d: Dungeon, ppg: number): void {
  ctx.save();
  for (const [c, cell] of environmentField(d)) {
    const tint = TINTS[cell.env];
    if (!tint) continue;
    // A soft round glow wider than the square, so neighbours blend into one smooth wash.
    const cx = ((c % d.width) + 0.5) * ppg;
    const cy = (Math.floor(c / d.width) + 0.5) * ppg;
    const r = ppg * 0.9;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, withAlpha(tint.colour, tint.alpha * cell.intensity));
    g.addColorStop(1, withAlpha(tint.colour, 0));
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  for (const o of environmentOpenings(d)) {
    const tint = TINTS[o.env];
    if (!tint) continue;
    // Centred just outside the doorway and reaching about as far as the effect spreads.
    const cx = (o.x + o.dx * 0.6) * ppg;
    const cy = (o.y + o.dy * 0.6) * ppg;
    const r = ((SPREAD[o.env] ?? 1) * 0.75 + 0.6) * ppg;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, withAlpha(tint.colour, tint.alpha * o.strength));
    g.addColorStop(0.45, withAlpha(tint.colour, tint.alpha * 0.4 * o.strength));
    g.addColorStop(1, withAlpha(tint.colour, 0));
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  ctx.restore();
}
