import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { request } from 'node:http';
import { Storage } from '../server/storage.mjs';
import { MonikaService } from '../server/service.mjs';
import { createHttpServer } from '../server/http.mjs';

function temporary() {
  const path=mkdtempSync(join(tmpdir(),'monika-test-'));
  return path;
}
function removeTemporary(path) {const target=resolve(path);assert(target.startsWith(resolve(tmpdir())+'\\monika-test-') || target.startsWith(resolve(tmpdir())+'/monika-test-'));rmSync(target,{recursive:true,force:true});}
test('storage journals replay, exclusive lock and incomplete tail recovery',t=>{
  const path=temporary(),storage=new Storage(path);t.after(()=>{storage.close();removeTemporary(path);});assert.throws(()=>new Storage(path),/锁定/);
  storage.write('test.json',{a:1});assert.deepEqual(storage.read('test.json',{}),{a:1});
  const journal=storage.journal('usr_alt');journal.append({id:'e',accountId:'usr_alt',type:'test'});
  assert.equal(storage.journal('usr_alt').replay.length,1);writeFileSync(join(path,'usr_alt.ndjson'),'{"accountId":"usr_alt"}\n{"incomplete":');
  assert.equal(storage.journal('usr_alt').replay.length,1);assert.equal(readFileSync(join(path,'usr_alt.ndjson.recovered-tail'),'utf8'),'{"incomplete":');
  assert.throws(()=>storage.journal('../secret'),/ID/);storage.close();
});

test('local JSON requests preserve split Unicode and reject invalid UTF-8 before updating settings',async t=>{
  const calls=[],service={settings:data=>calls.push(data),status:()=>({ok:true})};
  const server=createHttpServer(service,{projectRoot:resolve('.')});server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const send=chunks=>new Promise((resolve,reject)=>{
    const req=request({hostname:'127.0.0.1',port:server.address().port,path:'/settings',method:'POST',headers:{'Content-Type':'application/json'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});
    req.on('error',reject);for(const chunk of chunks)req.write(chunk);req.end();
  });
  const data={label:'凉のONE 𠮷 😊'};
  assert.equal(await send([...Buffer.from(JSON.stringify(data))].map(byte=>Buffer.from([byte]))),200);
  assert.deepEqual(calls,[data]);
  assert.equal(await send([Buffer.from('{"label":"'),Buffer.from([0xe6,0xb2]),Buffer.from('"}')]),400);
  assert.equal(calls.length,1);
});

test('HTTP needs no connection key, rejects external origins and hosts, and exports scoped histories',async t=>{
  const path=temporary(),storage=new Storage(path),service=new MonikaService(storage);
  service.profiles.usr_alt={user:{id:'usr_alt',displayName:'Alt'}};
  const recorder=service.recorder('usr_alt');recorder.observeSelf({id:'usr_alt',location:'wrld_a:1'},1000);
  for(let i=0;i<110;i++)recorder.observeSelf({id:'usr_alt',currentAvatar:`avtr_${i}`},2000+i);
  recorder.close(5000);
  const server=createHttpServer(service,{projectRoot:resolve('.')});server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));storage.close();removeTemporary(path);});
  const base=`http://127.0.0.1:${server.address().port}`,headers={};
  assert.equal((await fetch(`${base}/status`)).status,200);assert.equal((await fetch(`${base}/status`,{headers:{Origin:'https://evil.test'}})).status,403);
  const externalHostStatus=await new Promise((resolve,reject)=>{
    const req=request({hostname:'127.0.0.1',port:server.address().port,path:'/status',headers:{Host:'evil.test'}},res=>{res.resume();resolve(res.statusCode);});
    req.on('error',reject);req.end();
  });
  assert.equal(externalHostStatus,403);
  assert.equal((await fetch(`${base}/status`,{headers:{Origin:'null'}})).status,200);
  assert.equal((await fetch(`${base}/settings`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({primaryId:'usr_main'})})).status,200);
  const history=await(await fetch(`${base}/history?accountId=usr_alt&from=0&to=10000&type=avatar&selfOnly=true&limit=10`,{headers})).json();assert.equal(history.events.length,10);assert.equal(history.eventTotal,110);
  const exported=await(await fetch(`${base}/export?accountId=usr_alt&from=0&to=10000&type=avatar&selfOnly=true`,{headers})).json();assert.equal(exported.events.length,110);assert(exported.events.every(e=>e.self));
  assert.equal((await fetch(`${base}/history?accountId=usr_unknown`,{headers})).status,404);assert.equal((await fetch(`${base}/health`)).status,200);
});
