// Rubble and bones.

import { blob, outlined } from "./draw.ts";
import type { PropBox, PropPaintContext, PropRenderer } from "./types.ts";

export class RubbleRenderer implements PropRenderer {
  readonly kind = "rubble";
  readonly height = 0.3;
  readonly round = true;

  draw(c: PropPaintContext, b: PropBox): void {
    const { ctx, ppg, palette, rng } = c;
    ctx.strokeStyle = palette.line;
    ctx.lineWidth = Math.max(1, ppg * 0.025);
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = rng.pick([palette.stone, palette.line, palette.stone]);
      blob(
        c,
        (b.x + b.w * (0.2 + rng.float() * 0.6)) / ppg,
        (b.y + b.h * (0.2 + rng.float() * 0.6)) / ppg,
        0.06 + rng.float() * 0.1,
        6,
      );
      ctx.stroke(); // outlined so pale stones still read on light themes
    }
  }
}

export class BonesRenderer implements PropRenderer {
  readonly kind = "bones";
  readonly height = 0;
  readonly round = true;

  draw(c: PropPaintContext, b: PropBox): void {
    const { ctx, ppg, palette, rng } = c;
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    ctx.lineCap = "round";
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const a = rng.float() * Math.PI;
      const r = ppg * (0.18 + rng.float() * 0.1);
      const ox = (rng.float() - 0.5) * ppg * 0.3;
      const oy = (rng.float() - 0.5) * ppg * 0.3;
      ctx.moveTo(cx + ox - Math.cos(a) * r, cy + oy - Math.sin(a) * r);
      ctx.lineTo(cx + ox + Math.cos(a) * r, cy + oy + Math.sin(a) * r);
    }
    // A dark outline under the pale bone, so bones read on light floors too.
    ctx.strokeStyle = palette.line;
    ctx.lineWidth = Math.max(2, ppg * 0.09);
    ctx.stroke();
    ctx.strokeStyle = palette.paper;
    ctx.lineWidth = Math.max(1, ppg * 0.05);
    ctx.stroke();
    outlined(c, palette.paper, () =>
      ctx.arc(cx + ppg * 0.12, cy - ppg * 0.1, ppg * 0.11, 0, Math.PI * 2),
    );
  }
}
