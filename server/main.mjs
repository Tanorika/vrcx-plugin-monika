import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Storage } from './storage.mjs';
import { MonikaService } from './service.mjs';
import { createHttpServer } from './http.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const value = (name, fallback) => args.includes(name) ? args[args.indexOf(name)+1] : fallback;
const port = Number(value('--port', '39123'));
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('端口必须为 1024–65535');
const storage = new Storage(resolve(value('--data-dir', resolve(projectRoot, 'data'))));
const service = new MonikaService(storage);
const server = createHttpServer(service, { projectRoot, port });
let ending = false;
function stop() {
  if (ending) return; ending = true;
  try { service.stop('service-shutdown'); } finally { server.close(() => { storage.close(); process.exit(0); }); }
}
server.on('error', error => { console.error(`Monika 启动失败：${error.code || error.message}`); storage.close(); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => {
  console.log(`Monika 本地服务：http://127.0.0.1:${port}`);
  console.log('在 vrcx-plugin-system-fixed 的插件管理中导入 dist/monika.js。');
  console.log('插件自动连接本机服务，无需连接密钥。');
  console.log('仅连接 VRChat 云端，不读取本地 VRChat 缓存、日志或 OSC。按 Ctrl+C 停止。');
});
process.on('SIGINT', stop); process.on('SIGTERM', stop);
