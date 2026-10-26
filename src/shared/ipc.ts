// Types shared by the main process, the preload bridge and the renderer.
// Type-only: nothing here exists at runtime.

import type { CrashInfo } from "./diagnostics.ts";

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface SaveRequest {
  title?: string;
  defaultName: string;
  filters: FileFilter[];
}

export interface OpenRequest {
  title?: string;
  filters: FileFilter[];
}

export interface WriteRequest {
  path: string;
  data: string | Uint8Array;
  encoding?: "utf8" | "base64";
}

export interface OpenedFile {
  path: string;
  text: string;
}

export type MenuAction =
  | "new"
  | "blank"
  | "regenerate"
  | "open"
  | "save"
  | "copy-code"
  | "paste-code"
  | "export"
  | "toggle-gm"
  | "toggle-edit"
  | "fit";

/** A map left over from a crash or an unclean exit, offered back at the next start. */
export interface Recovery {
  /** The map and style, as .dungeon.json text. */
  project: string;
  /** When it was last saved (ISO time). */
  savedAt: string;
  reason: "unclean-exit" | "renderer-gone";
}

/** The API the preload script exposes on `window.api`. */
export interface DungeonForgeApi {
  chooseSavePath(req: SaveRequest): Promise<string | null>;
  writeFiles(files: WriteRequest[]): Promise<string[]>;
  openFile(req: OpenRequest): Promise<OpenedFile | null>;
  showInFolder(path: string): Promise<void>;
  readClipboard(): Promise<string>;
  writeClipboard(text: string): Promise<void>;
  /** Keeps the current map on disk, so it can be recovered after a crash. */
  saveSession(project: string): Promise<void>;
  /** Writes a crash report for an error in the window, with the map at the time. */
  reportError(info: CrashInfo, project?: string): Promise<void>;
  /** A map to offer back after a crash, once per start. */
  takeRecovery(): Promise<Recovery | null>;
  onMenu(cb: (action: MenuAction) => void): void;
}
