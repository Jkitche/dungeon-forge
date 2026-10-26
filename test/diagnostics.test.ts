// Crash reports: their contents, the map summary, path scrubbing and the issue link.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCrashReport,
  issueUrl,
  reportId,
  scrubDeep,
  scrubPaths,
  trimEvent,
  summarizeSession,
} from "../src/shared/diagnostics.ts";
import type { Environment } from "../src/shared/diagnostics.ts";
import {
  generateDungeon,
  serializeDungeon,
} from "../src/renderer/generator.ts";

const ENV: Environment = {
  appVersion: "1.0.0",
  electron: "45.0.0",
  chrome: "140.0",
  node: "24.0.0",
  platform: "linux",
  arch: "x64",
  osRelease: "7.0.0",
};
const NOW = new Date("2026-10-25T21:04:05.123Z");
const HOME = "/home/someone";

const session = (): string =>
  JSON.stringify({
    app: "dungeon-forge",
    version: 1,
    style: {},
    dungeon: serializeDungeon(
      generateDungeon({ seed: "crash-map", genre: "horror" }),
    ),
  });

test("a report holds what happened, the setup, and the map at the time", () => {
  const project = session();
  const r = buildCrashReport(
    {
      kind: "renderer-error",
      message: "boom",
      stack: "Error: boom\n    at draw (renderer.js:1:2)",
    },
    ENV,
    NOW,
    project,
  );
  assert.equal(r.id, "2026-10-25T21-04-05-123Z");
  assert.equal(r.time, NOW.toISOString());
  assert.equal(r.kind, "renderer-error");
  assert.equal(r.message, "boom");
  assert.match(r.stack ?? "", /at draw/);
  assert.deepEqual(r.environment, ENV);
  assert.equal(
    r.session,
    project,
    "the whole map, to recover or reproduce from",
  );
  assert.equal(r.map?.seed, "crash-map");
  assert.equal(r.map?.genre, "horror");
  assert.equal(r.map?.edited, false);

  const bare = buildCrashReport({ kind: "main-error", message: "x" }, ENV, NOW);
  assert.ok(
    !("stack" in bare) &&
      !("session" in bare) &&
      !("map" in bare) &&
      !("details" in bare),
  );
});

test("report ids sort by time and are safe in file names", () => {
  const a = reportId(new Date("2026-01-02T03:04:05.006Z"));
  const b = reportId(new Date("2026-01-02T03:04:05.007Z"));
  assert.ok(a < b);
  assert.match(a, /^[0-9TZ-]+$/);
});

test("anything that isn't a saved map has no summary", () => {
  assert.equal(summarizeSession("not json"), undefined);
  assert.equal(summarizeSession("{}"), undefined);
  assert.equal(summarizeSession('{"dungeon":{"seed":"s"}}'), undefined);
  assert.deepEqual(
    summarizeSession('{"dungeon":{"seed":"s","width":4,"height":5}}'),
    {
      seed: "s",
      genre: "unknown",
      width: 4,
      height: 5,
      rooms: 0,
      edited: false,
    },
  );
});

test("home folders become ~ in every spelling", () => {
  assert.equal(
    scrubPaths("at /home/someone/app/main.js", HOME),
    "at ~/app/main.js",
  );
  assert.equal(
    scrubPaths("C:\\Users\\Jo Smith\\app", "C:\\Users\\Jo Smith"),
    "~\\app",
  );
  assert.equal(
    scrubPaths("file:///C:/Users/Jo%20Smith/app", "C:\\Users\\Jo Smith"),
    "file:///~/app",
  );
  assert.equal(scrubPaths("unchanged", ""), "unchanged");
});

test("the issue link carries the report, without the map or home folder", () => {
  const r = buildCrashReport(
    {
      kind: "renderer-gone",
      message: "The window crashed (oom)",
      details: { reason: "oom" },
      stack: `at ${HOME}/x.js`,
    },
    ENV,
    NOW,
    session(),
  );
  const url = issueUrl("https://github.com/o/r/issues/new", r, ENV, HOME);
  assert.ok(url.startsWith("https://github.com/o/r/issues/new?title="));
  const body = decodeURIComponent(new URL(url).searchParams.get("body") ?? "");
  const title = new URL(url).searchParams.get("title");
  assert.equal(title, "Crash: The window crashed (oom)");
  assert.match(body, /Dungeon Forge 1\.0\.0 \(Electron 45\.0\.0/);
  assert.match(body, /seed `crash-map`, horror/);
  assert.match(body, /"reason":"oom"/);
  assert.match(
    body,
    /crash-2026-10-25T21-04-05-123Z\.json/,
    "points at the file to attach",
  );
  assert.ok(!body.includes(HOME), "home folder scrubbed");
  assert.ok(!body.includes('"cells"'), "the map itself stays out");
});

test("with no report, the link still describes the setup", () => {
  const url = issueUrl("https://x/new", null, ENV, HOME);
  const params = new URL(url).searchParams;
  assert.equal(params.get("title"), "Problem report");
  assert.match(params.get("body") ?? "", /linux x64 7\.0\.0/);
});

test("a huge stack trace is trimmed so the link stays usable", () => {
  const r = buildCrashReport(
    {
      kind: "renderer-error",
      message: "deep",
      stack: "at frame\n".repeat(5000),
    },
    ENV,
    NOW,
  );
  const url = issueUrl("https://x/new", r, ENV, HOME);
  assert.ok(url.length <= 7000, `${url.length}`);
  assert.match(
    new URL(url).searchParams.get("body") ?? "",
    /trimmed; see the report file/,
  );
});

test("events sent off the machine have the home folder scrubbed everywhere inside them", () => {
  const event = {
    message: `failed in ${HOME}/app`,
    exception: {
      values: [
        { stacktrace: { frames: [{ filename: `${HOME}/a.js`, lineno: 3 }] } },
      ],
    },
    tags: { ok: true, n: 1, none: null },
    when: new Date(0),
  };
  const out = scrubDeep(event, HOME);
  assert.equal(out.message, "failed in ~/app");
  assert.equal(
    out.exception.values[0]?.stacktrace.frames[0]?.filename,
    "~/a.js",
  );
  assert.deepEqual(out.tags, { ok: true, n: 1, none: null });
  assert.equal(out.when, event.when, "other objects are left as they are");
  assert.equal(
    event.message,
    `failed in ${HOME}/app`,
    "the original is untouched",
  );
});

test("outgoing events keep only what the consent prompt promises", () => {
  const event = {
    message: "boom",
    contexts: {
      app: {
        app_name: "Dungeon Forge",
        app_version: "1.0.0",
        app_start_time: "t",
        app_arch: "x64",
        app_memory: 1,
        free_memory: 2,
      },
      device: {
        cpu_description: "i9",
        screen_resolution: "3440x1440",
        boot_time: "t",
      },
      gpu_1: { name: "GPU" },
      gpu_2: { name: "GPU" },
      culture: { locale: "en-US", timezone: "America/Detroit" },
      cloud_resource: {},
      os: { name: "Ubuntu Linux", version: "22.3" },
      runtime: { name: "Electron", version: "45.0.0" },
      map: { seed: "s" },
    },
    user: { geo: { city: "Somewhere" } },
  };
  const out = trimEvent(event);
  assert.deepEqual(Object.keys(out.contexts).sort(), [
    "app",
    "map",
    "os",
    "runtime",
  ]);
  assert.deepEqual(out.contexts.app, {
    app_name: "Dungeon Forge",
    app_version: "1.0.0",
    app_start_time: "t",
    app_arch: "x64",
  });
  assert.deepEqual(
    out.user,
    { ip_address: null },
    "no IP, so no location either",
  );
  assert.equal(out.message, "boom");
  assert.deepEqual(trimEvent({}).contexts, {});
});
