// Types shared by the main process, the preload bridge and the renderer.
// Type-only: nothing here exists at runtime.

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
  encoding?: 'utf8' | 'base64';
}

export interface OpenedFile {
  path: string;
  text: string;
}

export type MenuAction = 'new' | 'regenerate' | 'open' | 'save' | 'export' | 'toggle-gm' | 'fit';

/** The API the preload script exposes on `window.api`. */
export interface DungeonForgeApi {
  chooseSavePath(req: SaveRequest): Promise<string | null>;
  writeFiles(files: WriteRequest[]): Promise<string[]>;
  openFile(req: OpenRequest): Promise<OpenedFile | null>;
  showInFolder(path: string): Promise<void>;
  onMenu(cb: (action: MenuAction) => void): void;
}
