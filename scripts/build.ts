// Clean build: compile the main process and renderer, then copy static assets.
// Run with `node scripts/build.ts` (Node strips the types itself).

import { execFileSync } from 'node:child_process';
import { cpSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
// TypeScript 7 doesn't export its bin path, so locate it through package.json's "bin" field.
const tsPackageJson = createRequire(import.meta.url).resolve('typescript/package.json');
const tsc = path.join(path.dirname(tsPackageJson), (JSON.parse(readFileSync(tsPackageJson, 'utf8')) as { bin: { tsc: string } }).bin.tsc);

rmSync(path.join(root, 'dist'), { recursive: true, force: true });
for (const project of ['tsconfig.main.json', 'tsconfig.renderer.json']) {
  execFileSync(process.execPath, [tsc, '-p', path.join(root, project)], { stdio: 'inherit' });
}
for (const file of ['index.html', 'styles.css']) {
  cpSync(path.join(root, 'src', 'renderer', file), path.join(root, 'dist', 'renderer', file));
}
console.log('Built to dist/');
