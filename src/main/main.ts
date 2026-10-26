import {
  clipboard,
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  Menu,
  shell,
} from "electron";
import type { MenuItemConstructorOptions } from "electron";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  watchFile,
  writeFileSync,
} from "node:fs";
import type {
  MenuAction,
  OpenRequest,
  OpenedFile,
  Recovery,
  SaveRequest,
  WriteRequest,
} from "../shared/ipc.ts";
import {
  buildCrashReport,
  issueUrl,
  summarizeSession,
} from "../shared/diagnostics.ts";
import {
  askForConsent,
  captureRendererError,
  crashReportsEnabled,
  flushTelemetry,
  setCrashReports,
  startTelemetry,
  telemetryAvailable,
} from "./telemetry.ts";
import type {
  CrashInfo,
  CrashReport,
  Environment,
} from "../shared/diagnostics.ts";

// Compiled layout: dist/main/main.js, dist/main/preload.cjs, dist/renderer/index.html
const here = import.meta.dirname;

let win: BrowserWindow | null = null;

// The renderer may only write files whose directory and name stem the user picked in a save dialog,
// so e.g. choosing "crypt.foundry.json" also allows the companion "crypt.png".
const approvedStems = new Set<string>();
const stemOf = (p: string): string =>
  path.join(path.dirname(p), path.basename(p).split(".")[0] ?? "");
const writtenPaths = new Set<string>();

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1000,
    minHeight: 640,
    backgroundColor: "#16171b",
    title: "Dungeon Forge",
    webPreferences: {
      preload: path.join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  void win.loadFile(path.join(here, "..", "renderer", "index.html"));
  win.on("closed", () => {
    win = null;
  });
  // The window's process crashed or was killed: report it, then offer to reload, which
  // brings the map back.
  win.webContents.on("render-process-gone", (_e, details) => {
    if (details.reason === "clean-exit") return;
    writeCrashReport({
      kind: "renderer-gone",
      message: `The window crashed (${details.reason})`,
      details: { reason: details.reason, exitCode: details.exitCode },
    });
    if (lastSession) {
      pendingRecovery = {
        project: lastSession,
        savedAt: new Date().toISOString(),
        reason: "renderer-gone",
      };
    }
    // Not the blocking version: the main process must keep running meanwhile, so the
    // crash report can be sent.
    void dialog
      .showMessageBox({
        type: "error",
        title: "Dungeon Forge",
        message: "The window crashed.",
        detail:
          "A crash report was saved. Reload to get your map back, or quit and it will be offered back next time.",
        buttons: ["Reload", "Quit"],
        defaultId: 0,
      })
      .then(async ({ response }) => {
        if (response === 0) win?.webContents.reload();
        else {
          // Quit without the normal shutdown, so the map is still offered back next time.
          await flushTelemetry();
          app.exit(1);
        }
      });
  });
}

// ---------------------------------------------------------------------------
// Crash recovery and reports
//
// The window keeps the current map in a session file as you work; quitting normally
// deletes it. Finding it at the next start means the app didn't shut down properly, so
// the map is offered back. Errors and crashes also write a report (what happened, the
// setup, and the map at the time) to the crash-reports folder, which Help › Report a
// Problem turns into a GitHub issue for the user to review and send.

// Only one copy runs at a time: a second one would mistake the first one's session file
// for a crash, and delete it on quitting. Launching again just brings the window forward.
if (!app.requestSingleInstanceLock()) {
  app.exit(0);
  process.exit(0);
}
app.on("second-instance", () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

// Automatic crash reports (with the user's consent; see telemetry.ts). As early as
// possible, so crashes during startup are caught too.
startTelemetry();

const ISSUES_URL = "https://github.com/Jkitche/dungeon-forge/issues/new";
/** Older reports beyond this many are deleted. */
const KEEP_REPORTS = 20;
const sessionFile = path.join(app.getPath("userData"), "session.dungeon.json");
const crashDir = path.join(app.getPath("userData"), "crash-reports");

let lastSession: string | undefined;
let pendingRecovery: Recovery | null = null;

function environment(): Environment {
  return {
    appVersion: app.getVersion(),
    electron: process.versions.electron ?? "",
    chrome: process.versions.chrome ?? "",
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
  };
}

function writeCrashReport(info: CrashInfo, session = lastSession): void {
  try {
    mkdirSync(crashDir, { recursive: true });
    const report = buildCrashReport(info, environment(), new Date(), session);
    writeFileSync(
      path.join(crashDir, `crash-${report.id}.json`),
      JSON.stringify(report, null, 2),
    );
    const old = reportFiles().slice(KEEP_REPORTS);
    for (const f of old) rmSync(path.join(crashDir, f), { force: true });
    console.error(`[crash report] ${info.kind}: ${info.message}`);
  } catch (err) {
    console.error("Could not write a crash report:", err);
  }
}

/** Report file names, newest first. */
function reportFiles(): string[] {
  if (!existsSync(crashDir)) return [];
  return readdirSync(crashDir)
    .filter((f) => /^crash-.*\.json$/.test(f))
    .sort()
    .reverse();
}

function latestReport(): CrashReport | null {
  const newest = reportFiles()[0];
  if (!newest) return null;
  try {
    return JSON.parse(
      readFileSync(path.join(crashDir, newest), "utf8"),
    ) as CrashReport;
  } catch {
    return null;
  }
}

/** Writes the session file in one step, so a crash mid-write never leaves half a map. */
function saveSession(project: string): void {
  lastSession = project;
  try {
    mkdirSync(path.dirname(sessionFile), { recursive: true });
    writeFileSync(`${sessionFile}.tmp`, project);
    renameSync(`${sessionFile}.tmp`, sessionFile);
  } catch (err) {
    console.error("Could not save the session:", err);
  }
}

// A session file left from last time means the app didn't shut down normally.
if (existsSync(sessionFile)) {
  try {
    const project = readFileSync(sessionFile, "utf8");
    pendingRecovery = {
      project,
      savedAt: statSync(sessionFile).mtime.toISOString(),
      reason: "unclean-exit",
    };
    lastSession = project;
    writeCrashReport(
      {
        kind: "unclean-exit",
        message: "Dungeon Forge didn't shut down normally last time",
      },
      project,
    );
  } catch (err) {
    console.error("Could not read the last session:", err);
  }
}

ipcMain.handle("session-save", (_e, project: string): void =>
  saveSession(String(project)),
);
ipcMain.handle(
  "report-error",
  (_e, info: CrashInfo, project?: string): void => {
    if (typeof project === "string") saveSession(project);
    const report: CrashInfo = {
      kind:
        info.kind === "unhandled-rejection"
          ? "unhandled-rejection"
          : "renderer-error",
      message: String(info.message ?? "Unknown error"),
      ...(info.stack ? { stack: String(info.stack) } : {}),
    };
    writeCrashReport(report);
    captureRendererError(
      report,
      lastSession === undefined ? undefined : summarizeSession(lastSession),
    );
  },
);
ipcMain.handle("take-recovery", (): Recovery | null => {
  const r = pendingRecovery;
  pendingRecovery = null;
  return r;
});

function mainError(err: unknown): void {
  const e = err instanceof Error ? err : new Error(String(err));
  writeCrashReport({
    kind: "main-error",
    message: e.message,
    ...(e.stack ? { stack: e.stack } : {}),
  });
  // Sentry catches the error itself; let the report go out before the message box, which
  // blocks until dismissed. Then exit without the normal shutdown, so the session file
  // stays for recovery.
  void flushTelemetry().finally(() => {
    dialog.showErrorBox(
      "Dungeon Forge has to close",
      `Something went wrong: ${e.message}\n\nYour map was saved and will be offered back next time. Help › Report a Problem can send the details to the developer.`,
    );
    app.exit(1);
  });
}
process.on("uncaughtException", mainError);
process.on("unhandledRejection", mainError);
// Being told to stop (e.g. by `npm run dev` restarting the app) is a normal shutdown.
process.on("SIGTERM", () => app.quit());
app.on("will-quit", () => rmSync(sessionFile, { force: true }));

// Under `npm run dev`, the dev script touches this file after each renderer rebuild.
if (process.env.DUNGEON_FORGE_DEV) {
  watchFile(path.join(here, "..", ".reload"), { interval: 100 }, () =>
    win?.webContents.reloadIgnoringCache(),
  );
}

const send = (action: MenuAction) => () =>
  win?.webContents.send("menu", action);

function buildMenu(): void {
  const isMac = process.platform === "darwin";
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: "appMenu" } as const] : []),
    {
      label: "File",
      submenu: [
        {
          label: "New Dungeon",
          accelerator: "CmdOrCtrl+N",
          click: send("new"),
        },
        {
          label: "New Blank Map",
          accelerator: "CmdOrCtrl+Shift+N",
          click: send("blank"),
        },
        {
          label: "Regenerate (Same Seed)",
          accelerator: "CmdOrCtrl+R",
          click: send("regenerate"),
        },
        { type: "separator" },
        { label: "Open Map…", accelerator: "CmdOrCtrl+O", click: send("open") },
        { label: "Save Map…", accelerator: "CmdOrCtrl+S", click: send("save") },
        {
          label: "Copy Map Code",
          accelerator: "CmdOrCtrl+Shift+C",
          click: send("copy-code"),
        },
        {
          label: "Paste Map Code",
          accelerator: "CmdOrCtrl+Shift+V",
          click: send("paste-code"),
        },
        { type: "separator" },
        { label: "Export…", accelerator: "CmdOrCtrl+E", click: send("export") },
        { label: "Print…", accelerator: "CmdOrCtrl+P", click: send("print") },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    {
      label: "View",
      submenu: [
        {
          label: "Edit Map",
          accelerator: "CmdOrCtrl+Shift+E",
          click: send("toggle-edit"),
        },
        {
          label: "Toggle GM / Player View",
          accelerator: "CmdOrCtrl+G",
          click: send("toggle-gm"),
        },
        {
          label: "Fit Map to Window",
          accelerator: "CmdOrCtrl+0",
          click: send("fit"),
        },
        { type: "separator" },
        { role: "togglefullscreen" },
        { role: "toggleDevTools" },
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Report a Problem…",
          click: () =>
            void shell.openExternal(
              issueUrl(ISSUES_URL, latestReport(), environment(), os.homedir()),
            ),
        },
        {
          label: "Open Crash Reports Folder",
          click: () => {
            mkdirSync(crashDir, { recursive: true });
            void shell.openPath(crashDir);
          },
        },
        {
          label: "Send Crash Reports Automatically",
          type: "checkbox",
          checked: crashReportsEnabled(),
          enabled: telemetryAvailable(),
          click: (item) => setCrashReports(item.checked),
        },
        { type: "separator" },
        {
          label: "About Universal VTT format",
          click: () =>
            void shell.openExternal(
              "https://arkenforge.com/universal-vtt-files/",
            ),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.handle(
  "choose-save-path",
  async (_e, req: SaveRequest): Promise<string | null> => {
    if (!win) return null;
    const result = await dialog.showSaveDialog(win, {
      title: req.title ?? "Save",
      defaultPath: path.join(
        app.getPath("documents"),
        path.basename(String(req.defaultName ?? "dungeon")),
      ),
      filters: req.filters,
    });
    if (result.canceled || !result.filePath) return null;
    approvedStems.add(stemOf(result.filePath));
    return result.filePath;
  },
);

ipcMain.handle(
  "write-files",
  async (_e, files: WriteRequest[]): Promise<string[]> => {
    const written: string[] = [];
    for (const f of files) {
      const target = path.resolve(String(f.path));
      if (!approvedStems.has(stemOf(target)))
        throw new Error(`Refusing to write unapproved path: ${target}`);
      let data: string | Buffer;
      if (typeof f.data === "string")
        data = f.encoding === "base64" ? Buffer.from(f.data, "base64") : f.data;
      else data = Buffer.from(f.data);
      await fs.writeFile(target, data);
      writtenPaths.add(target);
      written.push(target);
    }
    return written;
  },
);

ipcMain.handle(
  "open-file",
  async (_e, req: OpenRequest): Promise<OpenedFile | null> => {
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      title: req.title ?? "Open",
      filters: req.filters,
      properties: ["openFile"],
    });
    const filePath = result.filePaths[0];
    if (result.canceled || !filePath) return null;
    return { path: filePath, text: await fs.readFile(filePath, "utf8") };
  },
);

// Map codes go through the clipboard as plain text.
ipcMain.handle("clipboard-read", (): Promise<string> => clipboard.readText());
ipcMain.handle("clipboard-write", (_e, text: string): Promise<void> =>
  clipboard.writeText(String(text)),
);

ipcMain.handle("show-in-folder", (_e, p: string): void => {
  const target = path.resolve(String(p));
  if (writtenPaths.has(target)) shell.showItemInFolder(target);
});

void app.whenReady().then(() => {
  buildMenu();
  createWindow();
  // Asked once, after the window is up; the answer also updates the Help menu.
  win?.webContents.once("did-finish-load", () => {
    if (!win) return;
    void askForConsent(win).then(buildMenu);
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
