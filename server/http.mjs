import { version } from './version.mjs';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

function body(request) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    request.on('data', chunk => { size += chunk.length; if (size > 1_000_000) { reject(new Error('请求过大')); request.destroy(); } else chunks.push(chunk); });
    request.on('end', () => { try { const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)); resolve(text ? JSON.parse(text) : {}); } catch { reject(new Error('无效的 UTF-8 或 JSON 请求')); } });
    request.on('error', reject);
  });
}
export function historyOptions(params) {
  return { from: params.get('from') ?? 0, to: params.get('to') ?? Date.now(), search: params.get('search') || '',
    selfOnly: params.get('selfOnly') === 'true', type: params.get('type') || '', page: params.get('page') || 1,
    limit: params.get('limit') || 100, visitId: params.get('visitId') || '' };
}
export function createHttpServer(service, { projectRoot, port = 39123 }) {
  return http.createServer(async (req, res) => {
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(data)); };
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (!/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(req.headers.host || '')) {
      json(403,{error:'仅允许本机 Host'});return;
    }
    const origin = req.headers.origin;
    // VRCX's file://vrcx page sends Origin: null. Local IPC uses credential-free browser fetch.
    if (origin && origin !== 'null' && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) { json(403, { error: 'Origin 不受信任' }); return; }
    if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Headers': 'Authorization,Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' }); res.end(); return;
    }
    try {
      if (req.method === 'GET' && url.pathname === '/health') { json(200, { name: 'VRCX-plugin-Monika', version }); return; }
      if (req.method === 'GET' && url.pathname === '/plugin/monika.js') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        const code = await readFile(join(projectRoot, 'dist', 'monika.js'), 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'X-Content-Type-Options': 'nosniff' }); res.end(code); return;
      }
      if (req.method === 'GET' && url.pathname === '/repository.json') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        json(200, { name: 'Monika 本地插件仓库', authors: [{ name: 'Monika' }], modules: [{ id: 'monika', name: 'Monika',
          description: '目标账号独立云端活动记录', url: `http://127.0.0.1:${port}/plugin/monika.js`, enabled: true, tags: ['Accounts','Activity'] }] }); return;
      }
      if (req.method === 'GET' && url.pathname === '/status') { json(200, service.status()); return; }
      if (req.method === 'POST') {
        const data = await body(req);
        if (url.pathname === '/settings') { service.settings(data); json(200, service.status()); return; }
        if (url.pathname === '/login') { json(200, await service.login(data)); return; }
        if (url.pathname === '/verify') { json(200, await service.verify(data.type, String(data.code || ''))); return; }
        if (url.pathname === '/stop') { service.stop(); json(200, service.status()); return; }
        if (url.pathname === '/refresh') { if (Date.now() >= service.retryAt) void service.poll(); json(200, service.status()); return; }
        if (url.pathname === '/worlds/resolve') { json(200,await service.resolveWorldNames(data));return; }
        if (url.pathname === '/avatars/resolve') { json(200,await service.resolveAvatarMetadata(data));return; }
        if (url.pathname === '/social/action') { json(200,await service.socialAction(data));return; }
        if (url.pathname === '/social/native') { json(200,await service.nativeSocialQuery(data));return; }
      }
      if(req.method==='GET' && url.pathname==='/social') {json(200,await service.socialSnapshot(url.searchParams.get('accountId'),{force:url.searchParams.get('force')==='true'}));return;}
      if(req.method==='GET' && url.pathname.startsWith('/social/users/')) {json(200,await service.socialUserDetails(url.searchParams.get('accountId'),decodeURIComponent(url.pathname.slice(14)),{mutuals:url.searchParams.get('mutuals')==='true'}));return;}
      if(req.method==='GET' && url.pathname.startsWith('/avatars/')) {json(200,await service.avatarDetails(url.searchParams.get('accountId'),decodeURIComponent(url.pathname.slice(9))));return;}
      if(req.method==='GET' && url.pathname.startsWith('/worlds/')) {
        json(200,await service.worldDetails(url.searchParams.get('accountId'),decodeURIComponent(url.pathname.slice(8)),url.searchParams.get('location') || ''));return;
      }
      if (req.method === 'GET' && url.pathname === '/credentials') { json(200, service.credentials()); return; }
      if (req.method === 'GET' && url.pathname === '/sync') {
        const id=url.searchParams.get('accountId');
        if(!service.profiles[id]){json(404,{error:'目标账号不存在'});return;}
        const events=service.recorder(id).events,after=Number(url.searchParams.get('after') || 0);
        if(!Number.isInteger(after) || after<0 || after>events.length){json(409,{error:'同步游标与记录不匹配，请检查本地记录是否被截断'});return;}
        const batch=events.slice(after,after+500).map((event,i)=>({seq:after+i+1,event}));
        json(200,{accountId:id,events:batch,total:events.length,hasMore:after+batch.length<events.length});return;
      }
      if (req.method === 'GET' && ['/history','/export'].includes(url.pathname)) {
        const id = url.searchParams.get('accountId');
        if (!service.profiles[id]) { json(404, { error: '未找到该目标账号的记录' }); return; }
        const recorder = service.recorder(id), options = historyOptions(url.searchParams);
        const query = recorder.query(options);
        if (url.pathname === '/history') { json(200, query); return; }
        if (query.eventTotal > 100000 || query.visitTotal > 100000) { json(400, { error: '导出范围过大，请缩小日期范围' }); return; }
        const events = [], visits = [];
        for (let page = 1; page <= Math.ceil(Math.max(query.eventTotal, query.visitTotal)/500); page++) {
          const chunk = recorder.query({ ...options, page, limit: 500 }); events.push(...chunk.events); visits.push(...chunk.visits);
        }
        json(200, { schemaVersion: 1, accountId: id, exportedAt: new Date().toISOString(), scope: 'visible-friends',
          filters: options, stats: query.stats, visits, events }); return;
      }
      if (req.method === 'GET' && url.pathname.startsWith('/visits/')) {
        const id = url.searchParams.get('accountId');
        if (!service.profiles[id]) { json(404, { error: '未找到该目标账号的记录' }); return; }
        const detail = service.recorder(id).detail(decodeURIComponent(url.pathname.slice(8)));
        json(detail ? 200 : 404, detail || { error: '活动不存在' }); return;
      }
      json(404, { error: '接口不存在' });
    } catch (error) { json(error.status || 400, { error: error.message || '本地服务操作失败' }); }
  });
}
