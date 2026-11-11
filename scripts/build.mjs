import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { Script } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { buildNativeUi } from './build-native-ui.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await mkdir(resolve(root,'dist'),{recursive:true});
const nativeUi=await buildNativeUi();
// Browser sources intentionally have no imports. Node tests import their named exports.
await import('./vendor-vrcx.mjs');
const files = ['src/vendor-vrcx.mjs', 'src/archive.mjs', 'src/database.mjs', 'src/native-world.mjs', 'src/native-avatar.mjs', 'src/social.mjs', 'src/view.mjs', 'src/plugin.mjs'];
const parts = await Promise.all(files.map(async file => {
  const text = await readFile(resolve(root, file), 'utf8');
  if (/^import\s/m.test(text)) throw new Error(`Browser source must be self-contained: ${file}`);
  return text.replace(/^export (?=(?:class|function|const|async function)\s)/gm, '');
}));
parts.unshift(nativeUi);
const vrcxLicense=await readFile(resolve(root,'vendor/vrcx/LICENSE'),'utf8');
const output = `/* VRCX-plugin-Monika v0.1.22 | MIT | Requires vrcx-plugin-system-fixed\nIncludes original VRCX code under the following license:\n${vrcxLicense}\n*/\n(() => {\n'use strict';\n${parts.join('\n')}\nwindow.customjs.__LAST_PLUGIN_CLASS__ = MonikaPlugin;\n})();\n`;
new Script(output, { filename: 'monika.js' });
await mkdir(resolve(root, 'dist'), { recursive: true });
await writeFile(resolve(root, 'dist/monika.js'), output, 'utf8');
const nativeNotices=await readFile(resolve(root,'dist/native-ui-LICENSES.txt'),'utf8');
await writeFile(resolve(root,'dist/THIRD-PARTY-NOTICES.txt'),`VRCX: https://github.com/vrcx-team/VRCX\n${vrcxLicense}\nvrcx-plugin-system by Bluscream: https://github.com/vrcx-plugin-system/vrcx-plugin-system\nMIT, see supplied project README and source headers.\n${nativeNotices}`);
console.log(`Built dist/monika.js (${Buffer.byteLength(output)} bytes)`);
