// Crash reports: what went wrong, on what setup, and the map at the time, written to disk
// so the map can be recovered and the problem reported. Pure functions; the main process
// does the file writing.

export type CrashKind =
  /** An uncaught error in the window's code. */
  | "renderer-error"
  /** A promise in the window's code failed with nothing to catch it. */
  | "unhandled-rejection"
  /** The window's process crashed or was killed. */
  | "renderer-gone"
  /** An uncaught error in the main process. */
  | "main-error"
  /** The app didn't shut down normally last time (found at the next launch). */
  | "unclean-exit";

/** What the window reports when something goes wrong. */
export interface CrashInfo {
  kind: CrashKind;
  message: string;
  stack?: string;
  /** Anything else known: e.g. why the window's process ended. */
  details?: Record<string, unknown>;
}

export interface Environment {
  appVersion: string;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
  arch: string;
  osRelease: string;
}

/** Enough about the map to know what was on screen, without the whole thing. */
export interface MapSummary {
  seed: string;
  genre: string;
  width: number;
  height: number;
  rooms: number;
  edited: boolean;
}

export interface CrashReport extends CrashInfo {
  id: string;
  time: string;
  environment: Environment;
  map?: MapSummary;
  /** The map and style at the time, as .dungeon.json text, to recover or reproduce from. */
  session?: string;
}

/** Report ids sort by time and are safe in file names: "2026-10-25T21-04-05-123Z". */
export const reportId = (now: Date): string =>
  now.toISOString().replace(/[:.]/g, "-");

export function buildCrashReport(
  info: CrashInfo,
  environment: Environment,
  now: Date,
  session?: string,
): CrashReport {
  const map = session === undefined ? undefined : summarizeSession(session);
  return {
    id: reportId(now),
    time: now.toISOString(),
    kind: info.kind,
    message: info.message,
    ...(info.stack ? { stack: info.stack } : {}),
    ...(info.details ? { details: info.details } : {}),
    environment,
    ...(map ? { map } : {}),
    ...(session === undefined ? {} : { session }),
  };
}

/** The headline facts of a saved map, or undefined if the text isn't one. */
export function summarizeSession(session: string): MapSummary | undefined {
  try {
    const project = JSON.parse(session) as {
      dungeon?: {
        seed?: unknown;
        width?: unknown;
        height?: unknown;
        rooms?: unknown;
        edited?: unknown;
        options?: { genre?: unknown };
      };
    };
    const d = project.dungeon;
    if (
      !d ||
      typeof d.seed !== "string" ||
      typeof d.width !== "number" ||
      typeof d.height !== "number"
    )
      return undefined;
    return {
      seed: d.seed,
      genre: typeof d.options?.genre === "string" ? d.options.genre : "unknown",
      width: d.width,
      height: d.height,
      rooms: Array.isArray(d.rooms) ? d.rooms.length : 0,
      edited: d.edited === true,
    };
  } catch {
    return undefined;
  }
}

/** Replaces the user's home folder in paths with ~, so reports don't reveal account names. */
export function scrubPaths(text: string, home: string): string {
  if (!home) return text;
  const variants = [
    home,
    home.replace(/\\/g, "/"),
    encodeURI(home.replace(/\\/g, "/")),
  ];
  let out = text;
  for (const v of new Set(variants)) out = out.split(v).join("~");
  return out;
}

/** URLs much longer than this are cut off by some browsers and by GitHub. */
const MAX_URL = 7000;

/**
 * A link that opens a new GitHub issue filled in with a report's details (or just the
 * setup, when there's no report), for the user to read over and send. The map itself
 * isn't included; the issue asks for the report file to be attached instead.
 */
export function issueUrl(
  base: string,
  report: CrashReport | null,
  environment: Environment,
  home: string,
): string {
  const env = report?.environment ?? environment;
  const lines = [
    "**What were you doing when it happened?**",
    "",
    "",
    "**Diagnostics**",
    "",
    `- Dungeon Forge ${env.appVersion} (Electron ${env.electron}, Chrome ${env.chrome}, Node ${env.node})`,
    `- ${env.platform} ${env.arch} ${env.osRelease}`,
  ];
  if (report) {
    lines.push(`- Problem: ${report.kind} at ${report.time}`);
    if (report.map) {
      const m = report.map;
      lines.push(
        `- Map: seed \`${m.seed}\`, ${m.genre}, ${m.width}×${m.height}, ${m.rooms} rooms${m.edited ? ", hand-edited" : ""}`,
      );
    }
    if (report.details)
      lines.push(`- Details: \`${JSON.stringify(report.details)}\``);
    lines.push(
      "",
      "```",
      report.message,
      ...(report.stack ? [report.stack] : []),
      "```",
    );
    lines.push(
      "",
      `Please attach the report file \`crash-${report.id}.json\` (Help › Open Crash Reports Folder) if you're happy to share the map.`,
    );
  }
  const title = report
    ? `Crash: ${report.message.split("\n")[0]?.slice(0, 80)}`
    : "Problem report";
  const build = (body: string): string =>
    `${base}?title=${encodeURIComponent(scrubPaths(title, home))}&body=${encodeURIComponent(scrubPaths(body, home))}`;
  const full = lines.join("\n");
  let url = build(full);
  // Long stack traces are cut from the end until the link fits.
  for (let keep = full.length; url.length > MAX_URL && keep > 200;) {
    keep = Math.floor(keep * 0.8);
    url = build(`${full.slice(0, keep)}\n…(trimmed; see the report file)`);
  }
  return url;
}

/**
 * Copies a value with the home folder replaced in every string inside it, for events
 * sent off the machine (see scrubPaths).
 */
export function scrubDeep<T>(value: T, home: string): T {
  if (typeof value === "string") return scrubPaths(value, home) as T;
  if (Array.isArray(value))
    return value.map((v: unknown) => scrubDeep(v, home)) as T;
  if (
    value &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, scrubDeep(v, home)]),
    ) as T;
  }
  return value;
}

/** Event sections the crash-report consent doesn't cover: hardware, GPUs, locale and timezone, cloud. */
const UNSHARED_CONTEXT = /^(device|gpu(_\d+)?|culture|cloud_resource)$/;
/** All the app section keeps: which app and build, nothing about the machine's memory. */
const APP_KEYS = new Set([
  "app_name",
  "app_version",
  "app_start_time",
  "app_arch",
]);

/**
 * Cuts an outgoing event down to what the consent prompt promises: the error, the app and
 * system versions, and the map's facts. Hardware, GPU, locale and timezone details go, and
 * the IP address is marked as withheld so Sentry neither stores it nor looks up a location.
 */
export function trimEvent<
  T extends { contexts?: Record<string, unknown>; user?: unknown },
>(
  event: T,
): T & { contexts: Record<string, unknown>; user: { ip_address: null } } {
  const contexts = Object.fromEntries(
    Object.entries(event.contexts ?? {})
      .filter(([k]) => !UNSHARED_CONTEXT.test(k))
      .map(([k, v]) =>
        k === "app" && v && typeof v === "object"
          ? [
              k,
              Object.fromEntries(
                Object.entries(v).filter(([key]) => APP_KEYS.has(key)),
              ),
            ]
          : [k, v],
      ),
  );
  return { ...event, contexts, user: { ip_address: null } };
}
