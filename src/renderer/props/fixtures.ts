// Statues, braziers and coffins.

import { glowCircle, inset, outlined } from './draw.ts';
import type { PropBox, PropPaintContext, PropRenderer } from './types.ts';

export class StatueRenderer implements PropRenderer {
  readonly kind = 'statue';

  draw(c: PropPaintContext, b: PropBox): void {
    const { ctx, ppg, palette } = c;
    const base = inset(b, ppg, 0.12);
    outlined(c, palette.stone, () => ctx.rect(base.x, base.y, base.w, base.h));
    outlined(c, palette.paper, () => ctx.arc(b.x + b.w / 2, b.y + b.h / 2, ppg * 0.2, 0, Math.PI * 2));
    ctx.beginPath();
    ctx.arc(b.x + b.w / 2, b.y + b.h / 2, ppg * 0.08, 0, Math.PI * 2);
    ctx.stroke();
  }
}

export class BrazierRenderer implements PropRenderer {
  readonly kind = 'brazier';

  draw(c: PropPaintContext, b: PropBox): void {
    const { ctx, ppg, palette } = c;
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    glowCircle(ctx, palette.glow, cx, cy, ppg * 0.9);
    outlined(c, palette.metal, () => ctx.arc(cx, cy, ppg * 0.26, 0, Math.PI * 2));
    ctx.fillStyle = palette.glow;
    ctx.beginPath();
    ctx.arc(cx, cy, ppg * 0.14, 0, Math.PI * 2);
    ctx.fill();
  }
}

export class CoffinRenderer implements PropRenderer {
  readonly kind = 'coffin';

  draw(c: PropPaintContext, box: PropBox): void {
    const { ctx, ppg, palette } = c;
    // The classic six-sided coffin, widest at the shoulders.
    const v = box.vertical;
    const len = v ? box.h : box.w;
    const wid = (v ? box.w : box.h) * 0.62;
    const ox = box.x + box.w / 2;
    const oy = box.y + box.h / 2;
    const pts: [number, number][] = [[-0.46, -0.3], [-0.22, -0.5], [0.46, -0.34], [0.46, 0.34], [-0.22, 0.5], [-0.46, 0.3]];
    outlined(c, palette.wood, () => {
      pts.forEach(([a, c], i) => {
        const px = v ? ox + c * wid : ox + a * len;
        const py = v ? oy + a * len : oy + c * wid;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.closePath();
    });
    // A cross on the lid, its crossbar toward the head end.
    const L = ppg * 0.5;
    const S = ppg * 0.24;
    const cx = v ? ox : ox - len * 0.04;
    const cy = v ? oy - len * 0.04 : oy;
    ctx.beginPath();
    if (v) {
      ctx.moveTo(cx, cy - L / 2);
      ctx.lineTo(cx, cy + L / 2);
      ctx.moveTo(cx - S / 2, cy - L * 0.2);
      ctx.lineTo(cx + S / 2, cy - L * 0.2);
    } else {
      ctx.moveTo(cx - L / 2, cy);
      ctx.lineTo(cx + L / 2, cy);
      ctx.moveTo(cx - L * 0.2, cy - S / 2);
      ctx.lineTo(cx - L * 0.2, cy + S / 2);
    }
    ctx.stroke();
  }
}
