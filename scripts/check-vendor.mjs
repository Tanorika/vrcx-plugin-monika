import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const root = resolve(import.meta.dirname, '..');
const source = JSON.parse(await readFile(resolve(root, 'vendor/vrcx/SOURCE.json'), 'utf8'));
for (const file of source.files) {
  if (!file.path.startsWith('src/') || file.path.includes('..')) throw new Error('Invalid vendor path');
  const bytes = await readFile(resolve(root, 'vendor/vrcx', file.path));
  if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error(`VRCX source snapshot changed: ${file.path}`);
}
const fixture = JSON.parse(await readFile(resolve(root, 'tests/fixtures/framework-fixed.json'), 'utf8'));
if (createHash('sha256').update(await readFile(resolve(root, 'tests/fixtures/framework-fixed.js'))).digest('hex') !== fixture.sha256)
  throw new Error('Fixed framework test fixture changed without provenance update');
console.log(`Verified ${source.files.length} VRCX source hashes and the Fixed framework fixture`);
