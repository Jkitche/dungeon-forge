// Sci-fi consoles and cryo pods.

import { inset, outlined } from './draw.ts';
import type { PropBox, PropPaintContext, PropRenderer } from './types.ts';

export class ConsoleRenderer implements PropRenderer {
  readonly kind = 'console';

  draw(c: PropPaintContext, box: PropBox): void {
    const { ctx, ppg, palette } = c;
    const b = inset(box, ppg, box.vertical ? 0.22 : 0.1, box.vertical ? 0.1 : 0.22);
    outlined(c, palette.metal, () => ctx.roundRect(b.x, b.y, b.w, b.h, ppg * 0.05));
    const s = inset(b, ppg, 0.08);
    ctx.save();
    ctx.shadowColor = palette.glow;
    ctx.shadowBlur = ppg * 0.25;
    ctx.fillStyle = palette.glow;
    if (box.vertical) ctx.fillRect(s.x, s.y, s.w, s.h * 0.55);
    else ctx.fillRect(s.x, s.y, s.w * 0.55, s.h);
    ctx.restore();
    ctx.fillStyle = palette.line;
    for (let i = 0; i < 3; i++) {
      const t = 0.68 + i * 0.1;
      ctx.beginPath();
      if (box.vertical) ctx.arc(s.x + s.w / 2, s.y + s.h * t, ppg * 0.035, 0, Math.PI * 2);
      else ctx.arc(s.x + s.w * t, s.y + s.h / 2, ppg * 0.035, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

export class CryoPodRenderer implements PropRenderer {
  readonly kind = 'pod';

  draw(c: PropPaintContext, box: PropBox): void {
    const { ctx, ppg, palette } = c;
    const b = inset(box, ppg, 0.12);
    outlined(c, palette.metal, () => ctx.roundRect(b.x, b.y, b.w, b.h, Math.min(b.w, b.h) / 2));
    const g = inset(b, ppg, 0.1);
    ctx.save();
    ctx.globalAlpha = 0.75;
    ctx.shadowColor = palette.glow;
    ctx.shadowBlur = ppg * 0.2;
    ctx.fillStyle = palette.glow;
    ctx.beginPath();
    ctx.roundRect(g.x, g.y, g.w, g.h, Math.min(g.w, g.h) / 2);
    ctx.fill();
    ctx.restore();
  }
}
