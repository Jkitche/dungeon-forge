// Printing the map on paper: how it splits across pages. Pure layout maths in inches and
// grid squares; the app renders each page and hands them to the system print dialog.

export type PaperKey = "letter" | "legal" | "tabloid" | "a4" | "a3";

/** Paper sizes in inches, portrait. */
export const PAPERS: Record<PaperKey, { label: string; w: number; h: number }> =
  {
    letter: { label: "Letter (8.5 × 11 in)", w: 8.5, h: 11 },
    legal: { label: "Legal (8.5 × 14 in)", w: 8.5, h: 14 },
    tabloid: { label: "Tabloid (11 × 17 in)", w: 11, h: 17 },
    a4: { label: "A4 (210 × 297 mm)", w: 210 / 25.4, h: 297 / 25.4 },
    a3: { label: "A3 (297 × 420 mm)", w: 297 / 25.4, h: 420 / 25.4 },
  };

export type Orientation = "auto" | "portrait" | "landscape";

/**
 * How big the map prints: on one page, spread over a number of sheets across and down,
 * or at a fixed size per square (1 inch is the usual battle-map scale for miniatures).
 */
export type PrintSize =
  | { kind: "fit"; across: number; down: number }
  | { kind: "scale"; inchesPerSquare: number };

export interface PrintSetup {
  paper: PaperKey;
  orientation: Orientation;
  /** Blank border on every side, in inches; most printers can't print to the edge. */
  margin: number;
  /** How far neighbouring pages repeat each other, in inches, for trimming and taping. */
  overlap: number;
  size: PrintSize;
}

/** One printed page: the part of the map it shows and how big it prints. */
export interface PrintPage {
  /** Column and row, from 0, for labelling pages (A1, B2...) when assembling them. */
  col: number;
  row: number;
  /** The region of the map, in grid squares. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Printed size of that region, in inches. */
  widthIn: number;
  heightIn: number;
}

export interface PrintLayout {
  orientation: "portrait" | "landscape";
  /** Paper size in inches, as oriented. */
  paperW: number;
  paperH: number;
  inchesPerSquare: number;
  cols: number;
  rows: number;
  pages: PrintPage[];
}

/** The fewest sheets a map can go on is one; more than this is surely a mistake. */
export const MAX_SHEETS = 10;

const EPSILON = 1e-9;

/** Pages needed to cover `length` inches with pages `span` long that repeat `overlap`. */
function pagesFor(length: number, span: number, overlap: number): number {
  if (length <= span + EPSILON) return 1;
  return 1 + Math.ceil((length - span) / (span - overlap) - EPSILON);
}

function layoutFor(
  mapW: number,
  mapH: number,
  setup: PrintSetup,
  orientation: "portrait" | "landscape",
): PrintLayout {
  const paper = PAPERS[setup.paper];
  const [paperW, paperH] =
    orientation === "portrait" ? [paper.w, paper.h] : [paper.h, paper.w];
  // Overlap only matters between pages, but never let it swallow a page.
  const printW = Math.max(0.5, paperW - setup.margin * 2);
  const printH = Math.max(0.5, paperH - setup.margin * 2);
  const overlap = Math.min(
    Math.max(0, setup.overlap),
    Math.min(printW, printH) / 2,
  );

  let ips: number;
  if (setup.size.kind === "scale") {
    ips = setup.size.inchesPerSquare;
  } else {
    const across = Math.min(
      MAX_SHEETS,
      Math.max(1, Math.round(setup.size.across)),
    );
    const down = Math.min(MAX_SHEETS, Math.max(1, Math.round(setup.size.down)));
    ips = Math.min(
      (across * printW - (across - 1) * overlap) / mapW,
      (down * printH - (down - 1) * overlap) / mapH,
    );
  }

  const cols = pagesFor(mapW * ips, printW, overlap);
  const rows = pagesFor(mapH * ips, printH, overlap);
  const stepX = (printW - overlap) / ips;
  const stepY = (printH - overlap) / ips;
  const pages: PrintPage[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = col * stepX;
      const y = row * stepY;
      const w = Math.min(printW / ips, mapW - x);
      const h = Math.min(printH / ips, mapH - y);
      pages.push({ col, row, x, y, w, h, widthIn: w * ips, heightIn: h * ips });
    }
  }
  return {
    orientation,
    paperW,
    paperH,
    inchesPerSquare: ips,
    cols,
    rows,
    pages,
  };
}

/**
 * Splits a map of `mapW` × `mapH` squares across pages. With orientation "auto", picks
 * whichever way round needs fewer pages, or (when that ties) prints the map larger.
 */
export function layoutPrint(
  mapW: number,
  mapH: number,
  setup: PrintSetup,
): PrintLayout {
  if (setup.orientation !== "auto")
    return layoutFor(mapW, mapH, setup, setup.orientation);
  const portrait = layoutFor(mapW, mapH, setup, "portrait");
  const landscape = layoutFor(mapW, mapH, setup, "landscape");
  if (portrait.pages.length !== landscape.pages.length) {
    return portrait.pages.length < landscape.pages.length
      ? portrait
      : landscape;
  }
  return landscape.inchesPerSquare > portrait.inchesPerSquare + EPSILON
    ? landscape
    : portrait;
}

/** A page's label for assembly: column letter and row number, "A1" top left. */
export function pageLabel(page: Pick<PrintPage, "col" | "row">): string {
  let n = page.col;
  let letters = "";
  do {
    letters = String.fromCharCode(65 + (n % 26)) + letters;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return `${letters}${page.row + 1}`;
}

/** How a scale reads to a person, e.g. "1 in per 5 ft square". */
export function describeScale(inchesPerSquare: number): string {
  const rounded = Math.round(inchesPerSquare * 100) / 100;
  return `${rounded} in per 5 ft square`;
}
