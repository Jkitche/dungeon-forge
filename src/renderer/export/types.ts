// The export strategy contract.
//
// Each export format is one ExportStrategy. A strategy knows what files its format
// needs and how to build them, but nothing about dialogs, the DOM or the file system:
// the app supplies an ExportContext (map data and an image renderer) and an ExportTarget
// (where the user chose to save), then writes whatever files the strategy returns.

import type { Dungeon } from '../generator.ts';
import type { SafeHtml } from '../text.ts';

export interface RenderRequest {
  ppg?: number;
  gmView?: boolean;
  grid?: boolean;
}

export interface ExportContext {
  readonly dungeon: Dungeon;
  /** Pixels per square chosen in the dialog (already clamped to what a canvas can hold). */
  readonly ppg: number;
  /** Whether the user asked for a grid drawn on the image. */
  readonly grid: boolean;
  /** Whether the user asked for the GM view (numbers, secret doors marked). */
  readonly gmView: boolean;
  /** Renders the map as PNG bytes in the current theme. Unset fields use the dialog's choices. */
  renderPng(req?: RenderRequest): Promise<Uint8Array>;
}

/** The save location, as a path with no extension. Strategies derive every output file from it. */
export interface ExportTarget {
  /** Full path for a file with this suffix, e.g. path('.png'). */
  path(suffix: string): string;
  /** Just the file name for that suffix, for use in instructions and cross-references. */
  name(suffix: string): string;
}

export function createExportTarget(base: string): ExportTarget {
  const stem = base.split(/[\\/]/).pop() ?? base;
  return {
    path: (suffix) => `${base}${suffix}`,
    name: (suffix) => `${stem}${suffix}`,
  };
}

export interface ExportFile {
  path: string;
  data: string | Uint8Array;
}

export interface ExportResult {
  /** Files to write; the first is the primary output (revealed with "Show in folder"). */
  files: ExportFile[];
  /** Next steps for the user, shown after the export. */
  summary: SafeHtml;
  warnings?: SafeHtml[];
}

/** Image settings offered in the export dialog; null for formats without an image. */
export interface ImageOptions {
  defaultPpg: number;
  /** Draw the grid on the image by default (VTTs usually draw their own). */
  defaultGrid: boolean;
  /** Whether the user picks GM or player view (false when the strategy decides). */
  viewSelectable: boolean;
}

export interface ExportStrategy {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  /** Extension of the primary file, including any compound part, e.g. ".foundry.json". */
  readonly extension: string;
  /** Name for the file type filter in the save dialog. */
  readonly fileType: string;
  /** Added to the suggested file name so formats sharing an extension don't overwrite each other. */
  readonly nameTag?: string;
  readonly image: ImageOptions | null;
  run(ctx: ExportContext, target: ExportTarget): Promise<ExportResult>;
}
