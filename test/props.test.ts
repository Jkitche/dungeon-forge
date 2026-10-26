// Prop renderers, drawn onto a recording fake canvas.

import { test } from "node:test";
import assert from "node:assert/strict";
import { PROP_KINDS, PROP_SPECS, footprint } from "../src/renderer/clutter.ts";
import { PROP_RENDERERS } from "../src/renderer/props/index.ts";
import type { PropBox } from "../src/renderer/props/index.ts";
import { RNG } from "../src/renderer/rng.ts";
import { recordingContext, touchedPoints, TEST_PALETTE } from "./helpers.ts";
import type { Recording } from "./helpers.ts";

test("prop registry has one renderer per kind, under its own key", () => {
  assert.deepEqual(Object.keys(PROP_RENDERERS).sort(), [...PROP_KINDS].sort());
  for (const [kind, r] of Object.entries(PROP_RENDERERS))
    assert.equal(r.kind, kind);
});

test("each prop draws inside its footprint, in palette colours, the same way every time", () => {
  const ppg = 50;
  for (const kind of PROP_KINDS) {
    for (const vertical of [false, true]) {
      const long = PROP_SPECS[kind].long;
      // Away from the origin, so a renderer that ignores the box position is caught.
      const box: PropBox = {
        x: 700,
        y: 400,
        w: (long && !vertical ? 2 : 1) * ppg,
        h: (long && vertical ? 2 : 1) * ppg,
        vertical,
      };
      const draw = (): Recording => {
        const rec = recordingContext();
        PROP_RENDERERS[kind].draw(
          {
            ctx: rec.ctx,
            ppg,
            palette: TEST_PALETTE,
            rng: new RNG(`prop:${kind}`),
          },
          box,
        );
        return rec;
      };
      const rec = draw();
      const label = `${kind}${vertical ? " (vertical)" : ""}`;
      assert.ok(rec.calls.length > 0, `${label} draws something`);

      // Glows may spill a square past the footprint; nothing else should.
      for (const [x, y] of touchedPoints(rec.calls)) {
        assert.ok(
          x >= box.x - ppg &&
            x <= box.x + box.w + ppg &&
            y >= box.y - ppg &&
            y <= box.y + box.h + ppg,
          `${label} draws at (${x}, ${y})`,
        );
      }
      const pts = touchedPoints(rec.calls.filter((c) => c.name !== "fillRect"));
      assert.ok(
        pts.every(
          ([x, y]) =>
            x >= box.x &&
            x <= box.x + box.w &&
            y >= box.y &&
            y <= box.y + box.h,
        ),
        `${label} shapes stay in the footprint`,
      );

      const colours = new Set(Object.values(TEST_PALETTE));
      for (const s of rec.styles)
        assert.ok(
          typeof s !== "string" || colours.has(s),
          `${label} uses a colour outside the palette: ${String(s)}`,
        );

      assert.deepEqual(draw().calls, rec.calls, `${label} is deterministic`);
    }
  }
});
