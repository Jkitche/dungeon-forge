// Crates, barrels and chests.

import { inset, outlined } from "./draw.ts";
import type { PropBox, PropPaintContext, PropRenderer } from "./types.ts";

export class CrateRenderer implements PropRenderer {
  readonly kind = "crate";
  readonly height = 1;
  readonly round = false;

  draw(c: PropPaintContext, box: PropBox): void {
    const { ctx, ppg, palette } = c;
    const b = inset(box, ppg, 0.14);
    outlined(c, palette.wood, () => ctx.rect(b.x, b.y, b.w, b.h));
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x + b.w, b.y + b.h);
    ctx.moveTo(b.x + b.w, b.y);
    ctx.lineTo(b.x, b.y + b.h);
    ctx.stroke();
  }
}

export class BarrelRenderer implements PropRenderer {
  readonly kind = "barrel";
  readonly height = 1;
  readonly round = true;

  draw(c: PropPaintContext, b: PropBox): void {
    const { ctx, ppg, palette } = c;
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    outlined(c, palette.wood, () =>
      ctx.arc(cx, cy, ppg * 0.34, 0, Math.PI * 2),
    );
    ctx.strokeStyle = palette.metal;
    ctx.beginPath();
    ctx.arc(cx, cy, ppg * 0.22, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = palette.line;
    ctx.beginPath();
    ctx.arc(cx, cy, ppg * 0.08, 0, Math.PI * 2);
    ctx.stroke();
  }
}

export class ChestRenderer implements PropRenderer {
  readonly kind = "chest";
  readonly height = 0.6;
  readonly round = false;

  draw(c: PropPaintContext, box: PropBox): void {
    const { ctx, ppg, palette } = c;
    const b = inset(box, ppg, 0.16, 0.26);
    outlined(c, palette.wood, () =>
      ctx.roundRect(b.x, b.y, b.w, b.h, ppg * 0.05),
    );
    ctx.fillStyle = palette.metal;
    ctx.fillRect(b.x, b.y + b.h * 0.42, b.w, b.h * 0.16);
    ctx.beginPath();
    ctx.arc(b.x + b.w / 2, b.y + b.h / 2, ppg * 0.05, 0, Math.PI * 2);
    ctx.fillStyle = palette.line;
    ctx.fill();
  }
}
