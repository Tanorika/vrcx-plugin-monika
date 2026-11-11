import https from 'node:https';
import { randomBytes, createHash } from 'node:crypto';

// Small RFC6455 client using the same HTTPS/proxy agent as the isolated API client.
export function clientFrame(opcode, payload = Buffer.alloc(0)) {
  payload = Buffer.from(payload);
  const mask = randomBytes(4);
  const extra = payload.length < 126 ? 0 : payload.length < 65536 ? 2 : 8;
  const header = Buffer.alloc(2 + extra + 4);
  header[0] = 0x80 | opcode;
  header[1] = 0x80 | (extra === 0 ? payload.length : extra === 2 ? 126 : 127);
  if (extra === 2) header.writeUInt16BE(payload.length, 2);
  if (extra === 8) header.writeBigUInt64BE(BigInt(payload.length), 2);
  mask.copy(header, 2 + extra);
  const data = Buffer.from(payload);
  for (let i = 0; i < data.length; i++) data[i] ^= mask[i % 4];
  return Buffer.concat([header, data]);
}

export class FrameDecoder {
  constructor(onFrame) { this.onFrame = onFrame; this.buffer = Buffer.alloc(0); this.parts = []; this.size = 0; this.fragmentOpcode = 0; }
  push(data) {
    this.buffer = Buffer.concat([this.buffer, data]);
    if (this.buffer.length > 8_000_000) throw new Error('Pipeline 帧过大');
    while (this.buffer.length >= 2) {
      const first = this.buffer[0], second = this.buffer[1];
      const opcode = first & 15, fin = Boolean(first & 128);
      if (first & 112 || second & 128) throw new Error('Pipeline 帧格式无效');
      let size = second & 127, offset = 2;
      if (size === 126) { if (this.buffer.length < 4) return; size = this.buffer.readUInt16BE(2); offset = 4; }
      if (size === 127) { if (this.buffer.length < 10) return; const big = this.buffer.readBigUInt64BE(2); if (big > 8_000_000n) throw new Error('Pipeline 帧过大'); size = Number(big); offset = 10; }
      if (opcode >= 8 && (!fin || size > 125)) throw new Error('Pipeline 控制帧无效');
      if (this.buffer.length < offset + size) return;
      const payload = this.buffer.subarray(offset, offset+size);
      this.buffer = this.buffer.subarray(offset+size);
      if (opcode >= 8) { this.onFrame(opcode, payload); continue; }
      if (opcode !== 0) { if (this.fragmentOpcode) throw new Error('Pipeline 分片无效'); this.fragmentOpcode = opcode; }
      else if (!this.fragmentOpcode) throw new Error('Pipeline 分片缺少起始帧');
      this.parts.push(payload); this.size += payload.length;
      if (this.size > 8_000_000) throw new Error('Pipeline 消息过大');
      if (fin) { const complete = Buffer.concat(this.parts); const kind = this.fragmentOpcode; this.parts = []; this.size = 0; this.fragmentOpcode = 0; this.onFrame(kind, complete); }
    }
  }
}

export function connectPipeline(client, token, { onMessage, onOpen, onClose }) {
  const key = randomBytes(16).toString('base64');
  const expected = createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
  let socket, timer, closed = false, notified = false;
  const finish = () => { if (notified) return; notified = true; clearInterval(timer); if (!closed) onClose(); };
  const req = https.request(`https://pipeline.vrchat.cloud/?auth=${encodeURIComponent(token)}`, { agent: client.agent, timeout: 25000,
    headers: { Upgrade: 'websocket', Connection: 'Upgrade', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': key,
      'User-Agent': 'VRCX-plugin-Monika/0.1.0' } });
  req.on('upgrade', (res, connection, head) => {
    socket = connection;
    if (closed || res.headers['sec-websocket-accept'] !== expected || res.statusCode !== 101) { socket.destroy(); finish(); return; }
    socket.setTimeout(0);
    let lastFrame = Date.now();
    const decoder = new FrameDecoder((opcode, payload) => {
      lastFrame = Date.now();
      if (opcode === 9) socket.write(clientFrame(10, payload));
      else if (opcode === 8) { socket.end(clientFrame(8)); finish(); }
      else if (opcode === 1) { try { onMessage(JSON.parse(payload.toString('utf8'))); } catch { /* Ignore invalid upstream events. */ } }
    });
    const receive = chunk => { try { decoder.push(chunk); } catch { socket.destroy(); } };
    socket.on('data', receive); socket.on('error', finish); socket.on('close', finish);
    timer = setInterval(() => { if (Date.now()-lastFrame > 90000) socket.destroy(); else socket.write(clientFrame(9)); }, 30000);
    timer.unref();
    onOpen(); if (head.length) receive(head);
  });
  req.on('response', res => { res.resume(); finish(); });
  req.on('error', finish);
  req.on('timeout', () => req.destroy());
  req.end();
  return { close() { closed = true; clearInterval(timer); req.destroy(); socket?.destroy(); } };
}
