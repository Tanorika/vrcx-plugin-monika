import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
await import('./check-vendor.mjs');
async function checkDirectory(dir) {
  for (const file of await readdir(dir,{withFileTypes:true})) {
    if(file.isDirectory()){await checkDirectory(`${dir}/${file.name}`);continue;}
    if(!file.name.endsWith('.mjs'))continue;
    const result = spawnSync(process.execPath, ['--check', `${dir}/${file.name}`], { encoding: 'utf8' });
    if (result.error) throw result.error;
    if (result.status !== 0) { process.stderr.write(result.stderr); process.exit(result.status || 1); }
  }
}
for (const dir of ['server','src','scripts','tests'])await checkDirectory(dir);
console.log('JavaScript syntax checks passed');
