// Automatic crash reports through Sentry (https://sentry.io), sent only with the user's
// consent. Covers errors in the main process, native crashes of the main process and the
// window, and errors in the window's code (which arrive over IPC; the window has no
// bundler to load the SDK itself). Maps are never sent: only the error, the setup, and a
// few facts about the map as tags. Local crash files (see main.ts) are written either way.

import * as Sentry from "@sentry/electron/main";
import { app, dialog } from "electron";
import type { BrowserWindow } from "electron";
import os from "node:os";
import path from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { scrubDeep, trimEvent } from "../shared/diagnostics.ts";
import type { CrashInfo, MapSummary } from "../shared/diagnostics.ts";

/**
 * The Sentry project's DSN (Settings › Client Keys). It's safe to ship in the app: it only
 * allows sending events. Empty turns automatic reports off. The environment variable
 * overrides it, e.g. to test against another project.
 */
const SENTRY_DSN =
  process.env.DUNGEON_FORGE_SENTRY_DSN ??
  "https://d64017159c1a0256ed022119bb341708@o4512320156532736.ingest.us.sentry.io/4512320357007360";

const settingsFile = path.join(app.getPath("userData"), "settings.json");

interface Settings {
  /** Whether the user agreed to send crash reports; undefined until they're asked. */
  crashReports?: boolean;
}

function readSettings(): Settings {
  try {
    return JSON.parse(readFileSync(settingsFile, "utf8")) as Settings;
  } catch {
    return {};
  }
}

let settings = readSettings();
let started = false;

/** True when this build can send reports at all (it has a DSN). */
export const telemetryAvailable = (): boolean => SENTRY_DSN !== "";

export const crashReportsEnabled = (): boolean =>
  settings.crashReports === true;

/** Saves the user's choice, starting or stopping Sentry to match. */
export function setCrashReports(on: boolean): void {
  settings = { ...settings, crashReports: on };
  try {
    writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
  } catch (err) {
    console.error("Could not save settings:", err);
  }
  if (on) startTelemetry();
  else if (started) {
    started = false;
    void Sentry.close();
  }
}

/**
 * Starts Sentry if the user has agreed to send reports. Call as early as possible, before
 * the app is ready, so crashes during startup are caught too.
 */
export function startTelemetry(): void {
  // Without consent Sentry doesn't run at all: even its session tracking sends data.
  if (started || !telemetryAvailable() || !crashReportsEnabled()) return;
  const home = os.homedir();
  Sentry.init({
    dsn: SENTRY_DSN,
    release: `dungeon-forge@${app.getVersion()}`,
    environment:
      app.isPackaged && !process.env.DUNGEON_FORGE_DEV
        ? "production"
        : "development",
    // The machine name and user details can identify the user; leave them out.
    serverName: "dungeon-forge",
    dataCollection: { userInfo: false },
    // Only what the consent prompt promises goes out (see trimEvent). No performance
    // tracing: the prompt covers crashes and errors, not data from sessions without one.
    beforeSend: (event) =>
      crashReportsEnabled() ? trimEvent(scrubDeep(event, home)) : null,
  });
  started = true;
}

/** Sends an error from the window's code, with a few facts about the map as tags. */
export function captureRendererError(
  info: CrashInfo,
  map: MapSummary | undefined,
): void {
  if (!started) return;
  const error = new Error(info.message);
  error.name =
    info.kind === "unhandled-rejection"
      ? "UnhandledRejection"
      : "RendererError";
  if (info.stack) error.stack = info.stack;
  Sentry.captureException(error, {
    tags: {
      process: "renderer",
      kind: info.kind,
      ...(map
        ? { "map.genre": map.genre, "map.edited": String(map.edited) }
        : {}),
    },
    ...(map ? { contexts: { map: { ...map } } } : {}),
  });
}

/** Waits (up to `ms`) for queued reports to go out, before the app exits on an error. */
export async function flushTelemetry(ms = 2000): Promise<void> {
  if (started) await Sentry.flush(ms);
}

/**
 * Asks once whether to send crash reports automatically. The answer can be changed later
 * in Help › Send Crash Reports Automatically.
 */
export async function askForConsent(win: BrowserWindow): Promise<void> {
  if (!telemetryAvailable() || settings.crashReports !== undefined) return;
  const { response } = await dialog.showMessageBox(win, {
    type: "question",
    title: "Dungeon Forge",
    message: "Send crash reports to the developer automatically?",
    detail:
      "If Dungeon Forge crashes or hits an error, a report is sent so it can be fixed: the error, " +
      "the app and system versions, and the map's setting and size. Your maps are never sent. " +
      "You can change this any time in Help › Send Crash Reports Automatically.",
    buttons: ["Send Reports", "Don't Send"],
    defaultId: 0,
    cancelId: 1,
  });
  setCrashReports(response === 0);
}
