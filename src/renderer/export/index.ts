// The export registry. To add a format, implement ExportStrategy in its own file
// and list it here; the export dialog and tests pick it up automatically.

import { Roll20Exporter } from "./roll20.ts";
import { FoundryExporter } from "./foundry.ts";
import {
  FantasyGroundsUnityExporter,
  FantasyGroundsClassicExporter,
} from "./fantasygrounds.ts";
import { UniversalVttExporter } from "./uvtt.ts";
import { ImageExporter } from "./image.ts";
import { RoomKeyExporter } from "./roomkey.ts";
import type { ExportStrategy } from "./types.ts";

/** In display order. */
export const EXPORTERS: readonly ExportStrategy[] = [
  new Roll20Exporter(),
  new FoundryExporter(),
  new FantasyGroundsUnityExporter(),
  new FantasyGroundsClassicExporter(),
  new UniversalVttExporter(),
  new ImageExporter(),
  new RoomKeyExporter(),
];

export function getExporter(id: string): ExportStrategy {
  return EXPORTERS.find((e) => e.id === id) ?? (EXPORTERS[0] as ExportStrategy);
}

export { createExportTarget } from "./types.ts";
export type {
  ExportContext,
  ExportResult,
  ExportStrategy,
  ExportTarget,
  RenderRequest,
} from "./types.ts";
