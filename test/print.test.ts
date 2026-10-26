// Printing: how a map splits across pages.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  describeScale,
  layoutPrint,
  MAX_SHEETS,
  pageLabel,
  PAPERS,
} from "../src/renderer/print.ts";
import type { PrintLayout, PrintSetup } from "../src/renderer/print.ts";

const setup = (over: Partial<PrintSetup> = {}): PrintSetup => ({
  paper: "letter",
  orientation: "auto",
  margin: 0.25,
  overlap: 0,
  size: { kind: "fit", across: 1, down: 1 },
  ...over,
});

const close = (a: number, b: number, label = ""): void =>
  assert.ok(Math.abs(a - b) < 1e-6, `${label} ${a} ≈ ${b}`);

/** Pages cover the whole map with no gaps, and each fits the paper inside the margins. */
function assertCovers(
  l: PrintLayout,
  mapW: number,
  mapH: number,
  s: PrintSetup,
): void {
  assert.equal(l.pages.length, l.cols * l.rows);
  const printW = l.paperW - s.margin * 2;
  const printH = l.paperH - s.margin * 2;
  for (const p of l.pages) {
    assert.ok(
      p.widthIn <= printW + 1e-6 && p.heightIn <= printH + 1e-6,
      "fits the page",
    );
    close(p.widthIn, p.w * l.inchesPerSquare, "width in inches");
  }
  const last = l.pages.at(-1);
  assert.ok(last);
  close(last.x + last.w, mapW, "reaches the right edge");
  close(last.y + last.h, mapH, "reaches the bottom edge");
  for (const p of l.pages) {
    const right = l.pages.find((q) => q.row === p.row && q.col === p.col + 1);
    if (right) assert.ok(right.x <= p.x + p.w + 1e-6, "no gap across");
    const below = l.pages.find((q) => q.col === p.col && q.row === p.row + 1);
    if (below) assert.ok(below.y <= p.y + p.h + 1e-6, "no gap down");
  }
}

test("one page fits the map inside the margins, turned the way that prints it biggest", () => {
  const s = setup();
  const l = layoutPrint(48, 36, s);
  assert.equal(l.pages.length, 1);
  assert.equal(l.orientation, "landscape", "a wide map goes landscape");
  close(l.inchesPerSquare, Math.min(10.5 / 48, 8 / 36), "scale");
  assertCovers(l, 48, 36, s);
  assert.equal(
    layoutPrint(20, 40, s).orientation,
    "portrait",
    "a tall map goes portrait",
  );
});

test("fitting to sheets across and down uses exactly that many when the shape suits", () => {
  const s = setup({
    size: { kind: "fit", across: 2, down: 2 },
    orientation: "landscape",
  });
  const l = layoutPrint(42, 32, s);
  assert.deepEqual([l.cols, l.rows], [2, 2]);
  close(l.inchesPerSquare, Math.min(21 / 42, 16 / 32));
  assertCovers(l, 42, 32, s);
  // A long thin map can't use all the rows it was given: no blank pages.
  const thin = layoutPrint(
    80,
    10,
    setup({
      size: { kind: "fit", across: 3, down: 3 },
      orientation: "landscape",
    }),
  );
  assert.equal(thin.cols, 3);
  assert.equal(thin.rows, 1);
});

test("tabletop scale prints 1 inch per square across as many pages as it takes", () => {
  const s = setup({
    size: { kind: "scale", inchesPerSquare: 1 },
    orientation: "portrait",
  });
  const l = layoutPrint(48, 36, s);
  assert.equal(l.inchesPerSquare, 1);
  // 8 × 10.5 printable inches: 48 squares need 6 columns, 36 need 4 rows.
  assert.deepEqual([l.cols, l.rows], [6, 4]);
  assertCovers(l, 48, 36, s);
  for (const p of l.pages) close(p.widthIn, p.w, "a square is an inch");
  // Auto picks whichever way round needs fewer sheets.
  const auto = layoutPrint(
    48,
    36,
    setup({ size: { kind: "scale", inchesPerSquare: 1 } }),
  );
  assert.ok(auto.pages.length <= l.pages.length);
  assert.equal(
    auto.orientation,
    "portrait",
    "24 sheets portrait beats 25 landscape",
  );
});

test("overlap repeats a strip between neighbouring pages, for trimming and taping", () => {
  const s = setup({
    size: { kind: "scale", inchesPerSquare: 1 },
    orientation: "portrait",
    overlap: 0.5,
  });
  const l = layoutPrint(30, 20, s);
  const [a, b] = l.pages;
  assert.ok(a && b && b.col === 1);
  close(a.x + a.w - b.x, 0.5, "half an inch shared");
  assertCovers(l, 30, 20, s);
  // Overlap can't eat the page.
  const silly = layoutPrint(
    30,
    20,
    setup({ size: { kind: "scale", inchesPerSquare: 1 }, overlap: 100 }),
  );
  assertCovers(silly, 30, 20, setup({ overlap: 100 }));
});

test("sheet counts are kept sensible, and every paper size works", () => {
  const l = layoutPrint(
    10,
    10,
    setup({ size: { kind: "fit", across: 99, down: 0 } }),
  );
  assert.ok(l.cols <= MAX_SHEETS && l.rows >= 1);
  for (const paper of Object.keys(PAPERS) as (keyof typeof PAPERS)[]) {
    const s = setup({ paper, size: { kind: "scale", inchesPerSquare: 1 } });
    assertCovers(layoutPrint(60, 45, s), 60, 45, s);
  }
  // Tiny printable areas still lay out.
  const s = setup({ margin: 10 });
  assertCovers(layoutPrint(10, 10, s), 10, 10, {
    ...s,
    margin: Math.min(s.margin, 0),
  });
});

test("pages are labelled for assembly: letters across, numbers down", () => {
  assert.equal(pageLabel({ col: 0, row: 0 }), "A1");
  assert.equal(pageLabel({ col: 2, row: 3 }), "C4");
  assert.equal(pageLabel({ col: 26, row: 0 }), "AA1");
  assert.equal(describeScale(1), "1 in per 5 ft square");
  assert.equal(describeScale(0.4166666), "0.42 in per 5 ft square");
});
