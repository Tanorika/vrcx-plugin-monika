import { compile } from '@tailwindcss/node';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

// The real host supplies these styles. Only the synthetic browser preview needs
// its own copy; they are never injected into VRCX or included in monika.js.
export async function buildPreviewStyles() {
  const original = await readFile(resolve(root, 'vendor/vrcx/src/styles/globals.css'), 'utf8');
  const input = original.replace(/^@import[^;]+;\s*/gm, '');
  const compiler = await compile(`@import "tailwindcss" source(none);\n${input}`, {
    base: root, onDependency() {}
  });
  const candidates = new Set();
  async function scan(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await scan(path);
      else if (/\.(vue|jsx?|mjs)$/.test(entry.name)) {
        const source = await readFile(path, 'utf8');
        for (const match of source.matchAll(/[^<>"'`\s;=(){}]+/g)) candidates.add(match[0]);
      }
    }
  }
  await scan(resolve(root, 'vendor/vrcx/src'));
  await scan(resolve(root, 'src/native-ui'));
  const output = resolve(root, 'dist/preview-host.css');
  await mkdir(resolve(root, 'dist'), { recursive: true });
  await writeFile(output, compiler.build([...candidates]));
  return output;
}
