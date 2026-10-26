// The Print dialog: choose how the map goes onto paper, see the sheets in a preview, then
// render each sheet and open the system print dialog. Layout maths lives in print.ts.

import { renderDungeon } from "./renderer.ts";
import type { RenderOptions } from "./renderer.ts";
import type { Dungeon } from "./generator.ts";
import { describeScale, layoutPrint, pageLabel, PAPERS } from "./print.ts";
import type {
  Orientation,
  PaperKey,
  PrintLayout,
  PrintSetup,
} from "./print.ts";

export interface PrintHost {
  dungeon(): Dungeon;
  /** The map's render settings as on screen. */
  renderStyle(d: Dungeon): RenderOptions;
  gmView(): boolean;
  /** The room key's entries, copied after the map when asked for. */
  roomKey(): HTMLElement;
  toast(message: string, isError?: boolean): void;
  busy(on: boolean): void;
}

type SizeChoice = "one" | "fit" | "tabletop";

interface PrintChoices {
  size: SizeChoice;
  across: number;
  down: number;
  paper: PaperKey;
  orientation: Orientation;
  margin: number;
  overlap: number;
  view: "player" | "gm";
  look: "shown" | "ink";
  grid: boolean;
  labels: boolean;
  key: boolean;
}

/** Print resolution: sharp on paper without making huge images. */
const DPI = 200;
/** More sheets than this gets a gentle warning in the summary. */
const LOTS_OF_PAPER = 30;

const byId = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
};

/** Letter in the US and Canada, A4 everywhere else. */
const defaultPaper = (): PaperKey =>
  /^en-(US|CA)$|^es-US$|^fr-CA$/.test(navigator.language) ? "letter" : "a4";

export function setupPrint(host: PrintHost): { open(): void } {
  const modal = byId("print-modal");
  const size = byId<HTMLSelectElement>("print-size");
  const across = byId<HTMLInputElement>("print-across");
  const down = byId<HTMLInputElement>("print-down");
  const paper = byId<HTMLSelectElement>("print-paper");
  const orientation = byId<HTMLSelectElement>("print-orientation");
  const margin = byId<HTMLSelectElement>("print-margin");
  const overlap = byId<HTMLSelectElement>("print-overlap");
  const view = byId<HTMLSelectElement>("print-view");
  const look = byId<HTMLSelectElement>("print-look");
  const grid = byId<HTMLInputElement>("print-grid");
  const labels = byId<HTMLInputElement>("print-labels");
  const key = byId<HTMLInputElement>("print-key");
  const preview = byId<HTMLCanvasElement>("print-preview");
  const summary = byId("print-summary");

  for (const [k, p] of Object.entries(PAPERS)) {
    paper.append(
      Object.assign(document.createElement("option"), {
        value: k,
        textContent: p.label,
      }),
    );
  }

  let choices: PrintChoices = {
    size: "one",
    across: 2,
    down: 2,
    paper: defaultPaper(),
    orientation: "auto",
    margin: 0.25,
    overlap: 0,
    view: "player",
    look: "shown",
    grid: true,
    labels: true,
    key: false,
  };

  const clampSheets = (v: string): number =>
    Math.min(10, Math.max(1, Math.round(Number(v)) || 1));

  function read(): PrintChoices {
    return {
      size: size.value as SizeChoice,
      across: clampSheets(across.value),
      down: clampSheets(down.value),
      paper: paper.value as PaperKey,
      orientation: orientation.value as Orientation,
      margin: Number(margin.value),
      overlap: Number(overlap.value),
      view: view.value === "gm" ? "gm" : "player",
      look: look.value === "ink" ? "ink" : "shown",
      grid: grid.checked,
      labels: labels.checked,
      key: key.checked,
    };
  }

  function write(c: PrintChoices): void {
    size.value = c.size;
    across.value = String(c.across);
    down.value = String(c.down);
    paper.value = c.paper;
    orientation.value = c.orientation;
    margin.value = String(c.margin);
    overlap.value = String(c.overlap);
    view.value = c.view;
    look.value = c.look;
    grid.checked = c.grid;
    labels.checked = c.labels;
    key.checked = c.key;
  }

  const setupFor = (c: PrintChoices): PrintSetup => ({
    paper: c.paper,
    orientation: c.orientation,
    margin: c.margin,
    overlap: c.overlap,
    size:
      c.size === "tabletop"
        ? { kind: "scale", inchesPerSquare: 1 }
        : c.size === "fit"
          ? { kind: "fit", across: c.across, down: c.down }
          : { kind: "fit", across: 1, down: 1 },
  });

  /** How the printed map is drawn: as on screen, or plain and light to save ink. */
  function renderOptions(d: Dungeon, c: PrintChoices): RenderOptions {
    const base = host.renderStyle(d);
    const look: RenderOptions =
      c.look === "ink"
        ? {
            ...base,
            theme: "ink",
            depth: "off",
            lighting: false,
            effects: false,
          }
        : base;
    return { ...look, gmView: c.view === "gm", showGrid: c.grid };
  }

  // The preview's map thumbnail only changes with how the map is drawn, not with the paper.
  let thumb: { key: string; canvas: HTMLCanvasElement } | null = null;

  function update(): void {
    // Only the open dialog's controls hold real choices; never read them while it's closed.
    if (modal.hidden) return;
    choices = read();
    const d = host.dungeon();
    byId("print-sheets").hidden = choices.size !== "fit";
    // The room key gives away rooms and secrets, so it only goes with the GM's copy.
    byId("print-key-row").hidden = choices.view !== "gm";
    const layout = layoutPrint(d.width, d.height, setupFor(choices));
    drawPreview(d, layout);
    const n = layout.pages.length;
    const p = PAPERS[choices.paper].label.split(" (")[0];
    const sheets =
      n === 1
        ? "1 sheet"
        : `${n} sheets (${layout.cols} across × ${layout.rows} down)`;
    const printed = `${(d.width * layout.inchesPerSquare).toFixed(1)} × ${(d.height * layout.inchesPerSquare).toFixed(1)} in`;
    summary.textContent =
      `${sheets} of ${p}, ${layout.orientation}. ${describeScale(layout.inchesPerSquare)}; the map prints ${printed}.` +
      (n > LOTS_OF_PAPER
        ? " That's a lot of paper: try a smaller size or larger sheets."
        : "");
  }

  function drawPreview(d: Dungeon, layout: PrintLayout): void {
    const opts = renderOptions(d, choices);
    const thumbKey = JSON.stringify([d.seed, d.width, d.height, opts]);
    if (!thumb || thumb.key !== thumbKey) {
      // About 600 device pixels across, whatever the map's size.
      const ppg = Math.max(2, Math.min(600 / d.width, 450 / d.height));
      thumb = {
        key: thumbKey,
        canvas: renderDungeon(document.createElement("canvas"), d, {
          ...opts,
          ppg,
        }),
      };
    }
    const t = thumb.canvas;
    preview.width = t.width;
    preview.height = t.height;
    const ctx = preview.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(t, 0, 0);
    const s = t.width / d.width;
    ctx.lineWidth = Math.max(2, t.width / 220);
    ctx.font = `bold ${Math.round(Math.max(12, t.width / 28))}px system-ui, sans-serif`;
    ctx.textBaseline = "top";
    for (const page of layout.pages) {
      ctx.strokeStyle = "rgba(212, 162, 76, 0.95)";
      ctx.setLineDash(layout.pages.length > 1 ? [8, 5] : []);
      ctx.strokeRect(page.x * s, page.y * s, page.w * s, page.h * s);
      if (layout.pages.length > 1) {
        const label = pageLabel(page);
        ctx.fillStyle = "rgba(22, 23, 27, 0.8)";
        const w = ctx.measureText(label).width + 8;
        ctx.fillRect(page.x * s + 4, page.y * s + 4, w, t.width / 24);
        ctx.fillStyle = "#f2e6cc";
        ctx.fillText(label, page.x * s + 8, page.y * s + 6);
      }
    }
    ctx.setLineDash([]);
  }

  /**
   * Writes a sheet's assembly label into its top-left corner. It goes on the image itself,
   * not on the page, because print dialogs leave out CSS backgrounds by default and the
   * label needs its white box to stay readable over the map.
   */
  function drawSheetLabel(canvas: HTMLCanvasElement, text: string): void {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const px = DPI / 72; // canvas pixels per point
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.font = `${Math.round(9 * px)}px system-ui, sans-serif`;
    // The renderer leaves its own text settings behind; set every one this needs.
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const pad = 4 * px;
    const w = ctx.measureText(text).width + pad * 2;
    const h = 14 * px;
    const x = 6 * px;
    const y = 6 * px;
    ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "#000";
    ctx.lineWidth = px;
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = "#000";
    ctx.fillText(text, x + pad, y + h / 2);
  }

  const canvasUrl = (canvas: HTMLCanvasElement): Promise<string> =>
    new Promise((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(URL.createObjectURL(blob))
            : reject(new Error("Could not draw a page")),
        "image/png",
      ),
    );

  async function print(): Promise<void> {
    choices = read();
    const d = host.dungeon();
    const setup = setupFor(choices);
    const layout = layoutPrint(d.width, d.height, setup);
    const opts = renderOptions(d, choices);
    const root = byId("print-root");
    const urls: string[] = [];
    modal.hidden = true;
    host.busy(true);
    try {
      const ppg = layout.inchesPerSquare * DPI;
      const printW = layout.paperW - setup.margin * 2;
      const printH = layout.paperH - setup.margin * 2;
      const single = layout.pages.length === 1;
      const sheets: HTMLElement[] = [];
      for (const page of layout.pages) {
        const canvas = renderDungeon(document.createElement("canvas"), d, {
          ...opts,
          ppg,
          region: { x: page.x, y: page.y, w: page.w, h: page.h },
        });
        if (!single && choices.labels)
          drawSheetLabel(canvas, `${pageLabel(page)} · ${d.seed}`);
        const url = await canvasUrl(canvas);
        urls.push(url);
        const img = Object.assign(document.createElement("img"), {
          src: url,
          alt: "",
        });
        img.style.width = `${page.widthIn}in`;
        img.style.height = `${page.heightIn}in`;
        const sheet = document.createElement("section");
        sheet.className = "print-page";
        sheet.style.width = `${page.widthIn}in`;
        // A map on one sheet sits in the middle; tiled sheets start in the corner so they line up.
        if (single) sheet.style.margin = "0 auto";
        sheet.append(img);
        // Where the neighbouring sheet starts, for trimming the overlap.
        if (choices.overlap > 0 && page.col < layout.cols - 1) {
          const line = Object.assign(document.createElement("div"), {
            className: "print-trim x",
          });
          line.style.left = `${printW - setup.overlap}in`;
          sheet.append(line);
        }
        if (choices.overlap > 0 && page.row < layout.rows - 1) {
          const line = Object.assign(document.createElement("div"), {
            className: "print-trim y",
          });
          line.style.top = `${printH - setup.overlap}in`;
          sheet.append(line);
        }
        sheets.push(sheet);
      }
      root.replaceChildren(...sheets);
      if (choices.key && choices.view === "gm") {
        const keyPages = document.createElement("div");
        keyPages.className = "print-key";
        keyPages.append(
          Object.assign(document.createElement("h2"), {
            textContent: `Room key · ${d.seed}`,
          }),
        );
        for (const entry of host.roomKey().querySelectorAll(".room"))
          keyPages.append(entry.cloneNode(true));
        root.append(keyPages);
      }
      const style = document.createElement("style");
      style.id = "print-page-style";
      style.textContent = `@page { size: ${layout.paperW}in ${layout.paperH}in; margin: ${setup.margin}in; }`;
      document.head.append(style);
      await Promise.all(
        [...root.querySelectorAll("img")].map((img) => img.decode()),
      );
    } catch (err) {
      cleanUp(urls);
      throw err;
    } finally {
      host.busy(false);
    }
    window.addEventListener("afterprint", () => cleanUp(urls), { once: true });
    window.print();
  }

  function cleanUp(urls: string[]): void {
    byId("print-root").replaceChildren();
    document.getElementById("print-page-style")?.remove();
    for (const url of urls) URL.revokeObjectURL(url);
  }

  for (const input of [
    size,
    across,
    down,
    paper,
    orientation,
    margin,
    overlap,
    view,
    look,
    grid,
    labels,
    key,
  ]) {
    input.addEventListener("input", update);
    input.addEventListener("change", update);
  }
  byId("print-cancel").addEventListener("click", () => (modal.hidden = true));
  byId("print-go").addEventListener("click", () => {
    print().catch((err: unknown) =>
      host.toast(
        `Could not print: ${err instanceof Error ? err.message : String(err)}`,
        true,
      ),
    );
  });
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.hidden = true;
  });

  return {
    open(): void {
      // Start from the view on screen; everything else is remembered between prints.
      write({ ...choices, view: host.gmView() ? "gm" : "player" });
      thumb = null;
      modal.hidden = false;
      update();
    },
  };
}
