import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { VRChatClient } from '../server/vrchat.mjs';

function response(t, chunks) {
  t.mock.method(https, 'request', (url, options, callback) => {
    const req = new EventEmitter();
    req.end = () => queueMicrotask(() => {
      const res = new EventEmitter();
      res.headers = {}; res.statusCode = 200;
      res.destroy = error => { res.destroyed = true; res.emit('error', error); };
      callback(res);
      for (const chunk of chunks) { res.emit('data', chunk); if (res.destroyed) return; }
      res.emit('end');
    });
    return req;
  });
  const client = new VRChatClient(); t.after(() => client.close());
  return client;
}

test('API responses preserve Chinese, Japanese and emoji across every UTF-8 chunk boundary', async t => {
  const users = [{ id: 'usr_friend', displayName: '凉のONE 沐心12 菜榕ccc 是跟风君哒 𠮷 😊', bio: '简介とリンク' }];
  const bytes = Buffer.from(JSON.stringify(users));
  const client = response(t, [...bytes].map(byte => Buffer.from([byte])));
  assert.deepEqual(await client.request('auth/user/friends'), users);
});

test('invalid upstream UTF-8 is rejected before a damaged name can become a friend snapshot', async t => {
  const client = response(t, [Buffer.from('{"displayName":"'), Buffer.from([0xe6, 0xb2]), Buffer.from('"}')]);
  await assert.rejects(client.request('auth/user/friends'), /无效 UTF-8/);
});

test('API response size limits count bytes before decoding', async t => {
  const client = response(t, [Buffer.alloc(8_000_001, 0x61)]);
  await assert.rejects(client.request('auth/user/friends'), /响应过大/);
});
