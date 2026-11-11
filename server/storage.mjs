import { mkdirSync, readFileSync, existsSync, appendFileSync, writeFileSync, renameSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

export function accountKey(value) {
  if (typeof value !== 'string' || !/^usr_[a-zA-Z0-9-]+$/.test(value)) throw new Error('无效的账号 ID');
  return value;
}

export class Storage {
  constructor(root) {
    this.root = root;
    mkdirSync(root, { recursive: true });
    this.lockPath = join(root, 'service.lock');
    try { this.lock = openSync(this.lockPath, 'wx'); }
    catch { throw new Error('数据目录已锁定。请关闭其他 Monika 服务；异常退出后确认进程已停止再删除 service.lock。'); }
  }
  read(name, fallback) { const path = join(this.root, name); return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback; }
  write(name, value) {
    const path = join(this.root, name);
    writeFileSync(`${path}.tmp`, JSON.stringify(value, null, 2), { mode: 0o600 });
    renameSync(`${path}.tmp`, path);
  }
  journal(id) {
    const path = join(this.root, `${accountKey(id)}.ndjson`);
    let replay = [];
    if (existsSync(path)) {
      const text = readFileSync(path, 'utf8');
      const lines = text.split('\n');
      // An interrupted append may leave an incomplete last line. Preserve it for diagnosis.
      if (lines.at(-1)) {
        writeFileSync(`${path}.recovered-tail`, lines.pop(), { mode: 0o600 });
        writeFileSync(path, `${lines.join('\n')}\n`, { mode: 0o600 });
      }
      replay = lines.filter(Boolean).map(line => JSON.parse(line));
      if (replay.some(e => e.accountId !== id)) throw new Error('记录文件包含不匹配的账号');
    }
    return { replay, append: e => appendFileSync(path, `${JSON.stringify(e)}\n`, { mode: 0o600 }) };
  }
  close() { if (this.lock !== undefined) { closeSync(this.lock); unlinkSync(this.lockPath); this.lock = undefined; } }
}
