// Tables, beds, shelves and rugs.

import { inset, outlined } from './draw.ts';
import type { PropBox, PropPaintContext, PropRenderer } from './types.ts';

export class TableRenderer implements PropRenderer {
  readonly kind = 'table';
  readonly height = 0.8;
  readonly round = false;

  draw(c: PropPaintContext, box: PropBox): void {
    const { ctx, ppg, palette } = c;
    const b = inset(box, ppg, 0.14);
    outlined(c, palette.wood, () => ctx.roundRect(b.x, b.y, b.w, b.h, ppg * 0.06));
    // Something on the table: a candle, a plate.
    ctx.fillStyle = palette.paper;
    ctx.beginPath();
    ctx.arc(b.x + b.w * 0.3, b.y + b.h * 0.5, ppg * 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = palette.glow;
    ctx.beginPath();
    ctx.arc(b.x + b.w * 0.72, b.y + b.h * 0.45, ppg * 0.05, 0, Math.PI * 2);
    ctx.fill();
  }
}

export class BedRenderer implements PropRenderer {
  readonly kind = 'bed';
  readonly height = 0.5;
  readonly round = false;

  draw(c: PropPaintContext, box: PropBox): void {
    const { ctx, ppg, palette } = c;
    const b = inset(box, ppg, 0.1);
    outlined(c, palette.cloth, () => ctx.roundRect(b.x, b.y, b.w, b.h, ppg * 0.06));
    const pw = box.vertical ? b.w * 0.8 : ppg * 0.32;
    const ph = box.vertical ? ppg * 0.32 : b.h * 0.8;
    const px = box.vertical ? b.x + (b.w - pw) / 2 : b.x + ppg * 0.08;
    const py = box.vertical ? b.y + ppg * 0.08 : b.y + (b.h - ph) / 2;
    outlined(c, palette.paper, () => ctx.roundRect(px, py, pw, ph, ppg * 0.06));
  }
}

export class ShelfRenderer implements PropRenderer {
  readonly kind = 'shelf';
  readonly height = 1.6;
  readonly round = false;

  draw(c: PropPaintContext, box: PropBox): void {
    const { ctx, ppg, palette, rng } = c;
    const b = inset(box, ppg, box.vertical ? 0.3 : 0.08, box.vertical ? 0.08 : 0.3);
    outlined(c, palette.wood, () => ctx.rect(b.x, b.y, b.w, b.h));
    // Books or boxes along the shelf.
    const along = box.vertical ? b.h : b.w;
    const n = 6;
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = rng.pick([palette.cloth, palette.metal, palette.paper, palette.stone]);
      const t = (i + 0.15) * (along / n);
      const s = (along / n) * 0.7;
      if (box.vertical) ctx.fillRect(b.x + b.w * 0.2, b.y + t, b.w * 0.6, s);
      else ctx.fillRect(b.x + t, b.y + b.h * 0.2, s, b.h * 0.6);
    }
  }
}

export class RugRenderer implements PropRenderer {
  readonly kind = 'rug';
  readonly height = 0;
  readonly round = false;

  draw(c: PropPaintContext, box: PropBox): void {
    const { ctx, ppg, palette } = c;
    const b = inset(box, ppg, 0.08);
    ctx.globalAlpha = 0.85;
    outlined(c, palette.cloth, () => ctx.rect(b.x, b.y, b.w, b.h));
    ctx.globalAlpha = 1;
    const i = inset(b, ppg, 0.08);
    ctx.strokeStyle = palette.glow;
    ctx.lineWidth = Math.max(1, ppg * 0.025);
    ctx.strokeRect(i.x, i.y, i.w, i.h);
    ctx.beginPath();
    const cx = i.x + i.w / 2;
    const cy = i.y + i.h / 2;
    const rx = Math.min(i.w, i.h) * 0.35;
    ctx.moveTo(cx - rx, cy);
    ctx.lineTo(cx, cy - rx);
    ctx.lineTo(cx + rx, cy);
    ctx.lineTo(cx, cy + rx);
    ctx.closePath();
    ctx.stroke();
  }
}
