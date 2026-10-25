// The minimal zip writer used for Fantasy Grounds modules.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildZip, crc32 } from '../src/shared/zip.ts';
import { readZip } from './helpers.ts';

test('zip writer produces a valid archive', () => {
  const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 250]);
  const files = readZip(buildZip([{ path: 'a.txt', data: 'héllo' }, { path: 'images/b.png', data: png }]));
  assert.equal(new TextDecoder().decode(files.get('a.txt')), 'héllo');
  assert.deepEqual(files.get('images/b.png'), png);
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('an empty archive is still a valid zip', () => {
  assert.equal(readZip(buildZip([])).size, 0);
});

test('names are stored as UTF-8 and files keep their order', () => {
  const files = readZip(buildZip([{ path: 'images/château.png', data: 'a' }, { path: 'b.txt', data: 'b' }]));
  assert.deepEqual([...files.keys()], ['images/château.png', 'b.txt']);
});
