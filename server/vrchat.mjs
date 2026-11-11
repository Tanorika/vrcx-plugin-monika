import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';

export class ApiError extends Error {
  constructor(status, message, retryAfter = 0) { super(message); this.status = status; this.retryAfter = retryAfter; }
}

// One agent and cookie jar per secondary account. Never uses VRCX's HTTP client.
class ProxyAgent extends https.Agent {
  constructor(proxy) { super({ keepAlive: true }); this.proxy = new URL(proxy); }
  createConnection(options, callback) {
    const proxy = this.proxy;
    const transport = proxy.protocol === 'https:' ? https : http;
    const headers = { Host: `${options.host}:${options.port || 443}` };
    if (proxy.username) headers['Proxy-Authorization'] = `Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString('base64')}`;
    const req = transport.request({ hostname: proxy.hostname, port: proxy.port || (proxy.protocol === 'https:' ? 443 : 80),
      method: 'CONNECT', path: `${options.host}:${options.port || 443}`, headers, timeout: 20000 });
    req.once('connect', (res, socket, head) => {
      if (res.statusCode !== 200) { socket.destroy(); callback(new Error('代理 CONNECT 失败')); return; }
      if (head.length) socket.unshift(head);
      const secure = tls.connect({ socket, servername: options.host });
      secure.once('secureConnect', () => callback(null, secure));
      secure.once('error', callback);
    });
    req.once('timeout', () => req.destroy(new Error('代理连接超时')));
    req.once('error', callback);
    req.end();
  }
}

export function decodeCookies(value) {
  if (!value) return [];
  const list = typeof value === 'string' ? JSON.parse(Buffer.from(value, 'base64').toString('utf8')) : value;
  if (!Array.isArray(list)) throw new Error('不支持的 VRCX Cookie 格式');
  return list.filter(c => ['auth','twoFactorAuth'].includes(c.Name || c.name)).map(c => ({
    Name: c.Name || c.name, Value: c.Value || c.value, Domain: c.Domain || c.domain || 'api.vrchat.cloud', Path: c.Path || c.path || '/',
    Secure: true, HttpOnly: true, Expires: c.Expires || '9999-12-31T23:59:59'
  })).filter(c => typeof c.Value === 'string' && /^[a-zA-Z0-9_.-]+$/.test(c.Value) && /(^|\.)vrchat\.(cloud|com)$/.test(c.Domain));
}

export class VRChatClient {
  constructor({ cookies, endpoint = '', proxy = '' } = {}) {
    this.base = endpoint || 'https://api.vrchat.cloud/api/1';
    if (!/^https:\/\/api\.vrchat\.(cloud|com)\/api\/1\/?$/.test(this.base)) throw new Error('Monika 当前仅支持 VRChat 官方 API 地址');
    this.base = this.base.replace(/\/$/, '');
    if (proxy && !/^https?:\/\//.test(proxy)) throw new Error('代理必须使用 http:// 或 https:// 地址');
    this.agent = proxy ? new ProxyAgent(proxy) : new https.Agent({ keepAlive: true });
    this.cookies = decodeCookies(cookies);
    this.closed = false;
  }
  cookieHeader() {
    const host = new URL(this.base).hostname;
    return this.cookies.filter(c => host === c.Domain.replace(/^\./,'') || host.endsWith(`.${c.Domain.replace(/^\./,'')}`))
      .map(c => `${c.Name}=${c.Value}`).join('; ');
  }
  exportCookies() { return Buffer.from(JSON.stringify(this.cookies)).toString('base64'); }
  instance(location) {
    if (typeof location!=='string' || !/^wrld_[a-zA-Z0-9-]+:[^\s]+$/.test(location)) throw new Error('无效的实例位置');
    const separator=location.indexOf(':');
    return this.request(`instances/${encodeURIComponent(location.slice(0,separator))}:${encodeURIComponent(location.slice(separator+1))}`);
  }
  request(path, { method = 'GET', body, authorization } = {}) {
    if (this.closed) return Promise.reject(new Error('会话已关闭'));
    if (!/^[a-zA-Z0-9_/?=&%:~().+-]+$/.test(path) || path.includes('..')) return Promise.reject(new Error('无效的 API 路径'));
    const headers = { 'User-Agent': 'VRCX-plugin-Monika/0.1.19 (independent secondary account)', Accept: 'application/json', Cookie: this.cookieHeader() };
    if (authorization) headers.Authorization = authorization;
    const payload = body === undefined ? null : JSON.stringify(body);
    if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(payload); }
    return new Promise((resolve, reject) => {
      const req = https.request(`${this.base}/${path}`, { method, headers, agent: this.agent, timeout: 25000 }, res => {
        for (const line of res.headers['set-cookie'] || []) {
          const match = /^(auth|twoFactorAuth)=([^;]*)/.exec(line);
          if (!match) continue;
          this.cookies = this.cookies.filter(c => c.Name !== match[1]);
          if (match[2] && !/Max-Age=0/i.test(line)) this.cookies.push({ Name: match[1], Value: match[2],
            Domain: new URL(this.base).hostname, Path: '/', Secure: true, HttpOnly: true, Expires: '9999-12-31T23:59:59' });
        }
        const chunks = []; let size = 0;
        // Network chunks can split a UTF-8 character. Decode once, and reject invalid bytes.
        res.on('data', chunk => { size += chunk.length; if (size > 8_000_000) res.destroy(new Error('API 响应过大')); else chunks.push(chunk); });
        res.on('error', reject);
        res.on('end', () => {
          let json; try { const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)); json = text ? JSON.parse(text) : {}; } catch { reject(new ApiError(res.statusCode, `VRChat API 返回无效 UTF-8 或 JSON 响应 (${res.statusCode})`)); return; }
          if (res.statusCode < 200 || res.statusCode >= 300 || json.error) {
            // Do not forward raw upstream content, which can contain session information.
            reject(new ApiError(res.statusCode, `VRChat API 请求失败 (${res.statusCode})`, Number(res.headers['retry-after']) || 0));
          } else resolve(json);
        });
      });
      req.on('timeout', () => req.destroy(new Error('VRChat API 请求超时')));
      req.on('error', () => reject(new ApiError(0, '无法连接 VRChat API，请检查网络或代理设置')));
      req.end(payload);
    });
  }
  async login({ username = '', password = '' } = {}) {
    try {
      if (this.cookies.length) return await this.request('auth/user');
    } catch (e) { if (e.status !== 401) throw e; this.cookies = []; }
    if (!username || !password) throw new ApiError(401, '已保存会话过期，请输入账号密码重新登录');
    const basic = Buffer.from(`${encodeURIComponent(username)}:${encodeURIComponent(password)}`).toString('base64');
    return this.request('auth/user', { authorization: `Basic ${basic}` });
  }
  async verify(type, code) {
    const method = { totp: 'totp', otp: 'otp', emailOtp: 'emailotp' }[type];
    if (!method || !/^\d{6,12}$/.test(code)) throw new Error('请输入有效的二步验证码');
    const result = await this.request(`auth/twofactorauth/${method}/verify`, { method: 'POST', body: { code } });
    if (!result.verified) throw new Error('二步验证未通过');
    return this.request('auth/user');
  }
  async friends({offline=false}={}) {
    const all = new Map();
    for (let offset = 0; offset < 20000; offset += 100) {
      const page = await this.request(`auth/user/friends?offline=${Boolean(offline)}&n=100&offset=${offset}`);
      if (!Array.isArray(page) || page.some(u => !u.id || !u.displayName)) throw new Error('好友列表不完整，本轮不更新人员快照');
      for (const user of page) all.set(user.id, user);
      if (page.length < 100) return [...all.values()];
    }
    throw new Error('好友列表超出安全分页上限，本轮不更新人员快照');
  }
  close() { this.closed = true; this.agent.destroy(); this.cookies = []; }
}
