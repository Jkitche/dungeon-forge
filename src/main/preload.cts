// Sandboxed preloads must be CommonJS, hence the .cts extension and require().
const { contextBridge, ipcRenderer } =
  require("electron") as typeof import("electron");
import type { DungeonForgeApi, MenuAction } from "../shared/ipc.ts" with {
  "resolution-mode": "import",
};

const api: DungeonForgeApi = {
  chooseSavePath: (req) => ipcRenderer.invoke("choose-save-path", req),
  writeFiles: (files) => ipcRenderer.invoke("write-files", files),
  openFile: (req) => ipcRenderer.invoke("open-file", req),
  showInFolder: (p) => ipcRenderer.invoke("show-in-folder", p),
  onMenu: (cb) => {
    ipcRenderer.on("menu", (_e, action: MenuAction) => cb(action));
  },
};

contextBridge.exposeInMainWorld("api", api);
