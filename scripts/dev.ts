// Development mode: build, launch the app, then rebuild on every change under src/.
// Run with `npm run dev` (extra Electron flags go after `--`).
//
// Renderer changes (code, styles, HTML, textures) reload the window, which keeps the map
// you're working on. Main process and preload changes restart the app. Type errors are
// reported but don't stop the app; fix them and save again.

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { rmSync, watch, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { build, root } from './build.ts';

/** The app watches this file in dev mode and reloads its window when it changes. */
const RELOAD_STAMP = path.join(root, 'dist', '.reload');
/** Saving in an editor often writes several files, or one file twice, in quick succession. */
const SETTLE_MS = 120;

// The electron package's main export is the path to its binary.
const electronBinary = createRequire(import.meta.url)('electron') as string;

const log = (message: string): void => console.log(`[dev] ${message}`);

let app: ChildProcess | null = null;
let restarting = false;

function launch(): void {
  // Anything after `npm run dev --` goes to Electron, e.g. --remote-debugging-port=9222.
  app = spawn(electronBinary, ['.', ...process.argv.slice(2)], { cwd: root, stdio: 'inherit', env: { ...process.env, DUNGEON_FORGE_DEV: '1' } });
  app.on('exit', (code) => {
    app = null;
    if (restarting) {
      restarting = false;
      launch();
    } else {
      // The window was closed: stop watching too.
      process.exit(code ?? 0);
    }
  });
}

function restart(): void {
  if (!app) return launch();
  restarting = true;
  app.kill();
}

/** Changes to these need the app restarted, not just its window reloaded. */
const needsRestart = (file: string): boolean => /^(main|shared)[\\/]/.test(file);

const pending = new Set<string>();
let timer: NodeJS.Timeout | null = null;
let building = false;

function rebuild(): void {
  timer = null;
  if (building) return; // picked up when the current build finishes
  building = true;
  const files = [...pending];
  pending.clear();
  const started = performance.now();
  const ok = build({ clean: false });
  const ms = Math.round(performance.now() - started);
  if (files.some(needsRestart)) {
    log(`${ok ? 'Rebuilt' : 'Rebuilt with type errors'} in ${ms} ms; restarting the app`);
    restart();
  } else {
    log(`${ok ? 'Rebuilt' : 'Rebuilt with type errors'} in ${ms} ms; reloading the window`);
    writeFileSync(RELOAD_STAMP, String(Date.now()));
  }
  building = false;
  if (pending.size > 0) rebuild();
}

rmSync(path.join(root, 'dist'), { recursive: true, force: true });
if (!build({ clean: false })) log('Built with type errors; the app may not work until they are fixed');
writeFileSync(RELOAD_STAMP, String(Date.now()));
launch();
log('Watching src/ for changes. Close the app window or press Ctrl+C to stop.');

watch(path.join(root, 'src'), { recursive: true }, (_event, file) => {
  if (!file) return;
  pending.add(file);
  if (timer) clearTimeout(timer);
  timer = setTimeout(rebuild, SETTLE_MS);
});
