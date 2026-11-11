import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
const metadata = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(metadata.version)) throw new Error('Invalid release version');
const releaseName = `Monika-v${metadata.version}`;
const outputRoot = resolve(root, 'releases');
const stage = resolve(outputRoot, releaseName);
if (!stage.startsWith(outputRoot + '\\') && !stage.startsWith(outputRoot + '/')) throw new Error('Invalid release path');
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });

const entries = [];
async function include(source, destination = source) {
  const bytes = await readFile(resolve(root, source));
  const target = resolve(stage, destination);
  if (!target.startsWith(stage + '\\') && !target.startsWith(stage + '/')) throw new Error('Invalid package entry');
  await mkdir(resolve(target, '..'), { recursive: true });
  await writeFile(target, bytes);
  entries.push({ name: `${releaseName}/${destination.replaceAll('\\', '/')}`, bytes });
}
async function includeDirectory(directory) {
  for (const entry of (await readdir(resolve(root, directory), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await includeDirectory(name);
    else if (entry.isFile()) await include(name);
  }
}

// Runtime allowlist: no account data, reference checkouts, development dependencies or framework bundle.
for (const file of ['README.md', 'LICENSE', 'CHANGELOG.md', 'dist/monika.js', 'dist/THIRD-PARTY-NOTICES.txt',
  'src/vendor-vrcx.mjs', 'scripts/start-monika.ps1', 'docs/architecture.md']) await include(file);
await includeDirectory('server');
await includeDirectory('docs/screenshots');
const runtime = { name: metadata.name, version: metadata.version, private: true, type: 'module',
  description: metadata.description, license: metadata.license, engines: metadata.engines,
  scripts: { start: 'node server/main.mjs' } };
const runtimeBytes = Buffer.from(JSON.stringify(runtime, null, 2) + '\n');
await writeFile(resolve(stage, 'package.json'), runtimeBytes);
entries.push({ name: `${releaseName}/package.json`, bytes: runtimeBytes });
const checksums = entries.map(entry => `${createHash('sha256').update(entry.bytes).digest('hex')}  ${entry.name.slice(releaseName.length + 1)}`).sort().join('\n') + '\n';
await writeFile(resolve(stage, 'SHA256SUMS.txt'), checksums);
entries.push({ name: `${releaseName}/SHA256SUMS.txt`, bytes: Buffer.from(checksums) });

// ZIP writer using Node's standard library, so release packaging needs no extra tooling.
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
const local = [], central = [];
let offset = 0;
for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
  const name = Buffer.from(entry.name), compressed = deflateRawSync(entry.bytes), crc = crc32(entry.bytes);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6);
  header.writeUInt16LE(8, 8); header.writeUInt16LE(33, 12); // 1980-01-01, reproducible timestamp.
  header.writeUInt32LE(crc, 14); header.writeUInt32LE(compressed.length, 18);
  header.writeUInt32LE(entry.bytes.length, 22); header.writeUInt16LE(name.length, 26);
  local.push(header, name, compressed);
  const index = Buffer.alloc(46);
  index.writeUInt32LE(0x02014b50); index.writeUInt16LE(20, 4); index.writeUInt16LE(20, 6);
  index.writeUInt16LE(0x800, 8); index.writeUInt16LE(8, 10); index.writeUInt16LE(33, 14);
  index.writeUInt32LE(crc, 16); index.writeUInt32LE(compressed.length, 20);
  index.writeUInt32LE(entry.bytes.length, 24); index.writeUInt16LE(name.length, 28);
  index.writeUInt32LE(offset, 42); central.push(index, name);
  offset += header.length + name.length + compressed.length;
}
const directory = Buffer.concat(central), end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
const zipPath = resolve(outputRoot, `${releaseName}.zip`);
await writeFile(zipPath, Buffer.concat([...local, directory, end]));
await writeFile(zipPath + '.sha256', `${createHash('sha256').update(await readFile(zipPath)).digest('hex')}  ${releaseName}.zip\n`);
console.log(`Packaged ${relative(root, zipPath)} (${entries.length} files)`);
