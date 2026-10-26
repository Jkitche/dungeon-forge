// Uploads the build's source maps to Sentry, so stack traces from users show the
// TypeScript source rather than compiled JavaScript. Run after `npm run build`, before
// packaging (`npm run dist` does both).
//
// Debug IDs are injected into dist/ first, tying each file to its map whatever its path.
// The upload needs a Sentry organization auth token in SENTRY_AUTH_TOKEN; never commit
// one. Without it this fails, so a release can't ship with unreadable stack traces; use
// `npm run dist:dir` for a local test build, which skips the upload.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const dist = path.join(root, "dist");
const { version } = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8"),
) as { version: string };
/** Must match the release the app reports (see src/main/telemetry.ts). */
const release = `dungeon-forge@${version}`;
const org = process.env.SENTRY_ORG ?? "jkitcheio";
const project = process.env.SENTRY_PROJECT ?? "dungeon-forge";

// The @sentry/cli package knows where its binary is.
const { SentryCli } = createRequire(import.meta.url)("@sentry/cli") as {
  SentryCli: { getPath(): string };
};
const cli = SentryCli.getPath();
const run = (...args: string[]): void => {
  execFileSync(cli, args, { stdio: "inherit", cwd: root });
};

if (!process.env.SENTRY_AUTH_TOKEN) {
  // Fail loudly: a release shipped without its maps has unreadable stack traces, and
  // nobody notices until they need one. Local test builds use `npm run dist:dir`.
  console.error(
    `[sourcemaps] SENTRY_AUTH_TOKEN isn't set, so source maps for ${release} can't be uploaded. ` +
      "Set it to a Sentry organization auth token (never commit it), or use `npm run dist:dir` for a local test build.",
  );
  process.exit(1);
} else {
  run("sourcemaps", "inject", dist);
  // The URL prefix matches how the app's paths appear in events (app:///dist/...), for
  // frames that arrive without a Debug ID: errors forwarded from the window.
  run(
    "sourcemaps",
    "upload",
    "--org",
    org,
    "--project",
    project,
    "--release",
    release,
    "--url-prefix",
    "app:///dist",
    dist,
  );
  console.log(`[sourcemaps] Uploaded source maps for ${release}.`);
}
