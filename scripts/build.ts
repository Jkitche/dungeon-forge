// Build: compile the main process and renderer, then copy static assets.
// Run with `node scripts/build.ts` (Node strips the types itself) for a clean build;
// scripts/dev.ts calls build() to rebuild in place on every change.

import { execFileSync } from 'node:child_process';
import { cpSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

export const root = path.resolve(import.meta.dirname, '..');
// TypeScript 7 doesn't export its bin path, so locate it through package.json's "bin" field.
const tsPackageJson = createRequire(import.meta.url).resolve('typescript/package.json');
const tsc = path.join(path.dirname(tsPackageJson), (JSON.parse(readFileSync(tsPackageJson, 'utf8')) as { bin: { tsc: string } }).bin.tsc);

/**
 * Builds into dist/. A clean build starts from an empty dist/ and stops at the first type
 * error. Otherwise the build runs over the old output and always finishes: the compiler
 * still writes JavaScript when it finds type errors, so the app keeps working while they
 * are fixed. Returns whether it compiled without errors.
 */
export function build({ clean = true }: { clean?: boolean } = {}): boolean {
  if (clean) rmSync(path.join(root, 'dist'), { recursive: true, force: true });
  let ok = true;
  for (const project of ['tsconfig.main.json', 'tsconfig.renderer.json']) {
    try {
      execFileSync(process.execPath, [tsc, '-p', path.join(root, project)], { stdio: 'inherit' });
    } catch (err) {
      if (clean) throw err;
      ok = false;
    }
  }
  for (const file of ['index.html', 'styles.css']) {
    cpSync(path.join(root, 'src', 'renderer', file), path.join(root, 'dist', 'renderer', file));
  }
  cpSync(path.join(root, 'src', 'renderer', 'assets'), path.join(root, 'dist', 'renderer', 'assets'), { recursive: true });
  return ok;
}

if (import.meta.main) {
  build();
  console.log('Built to dist/');
}
