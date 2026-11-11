import test from 'node:test';
import assert from 'node:assert/strict';
import { MonikaService,currentUserObservation } from '../server/service.mjs';
import { ApiError, decodeCookies, VRChatClient } from '../server/vrchat.mjs';
import { FrameDecoder, clientFrame } from '../server/pipeline.mjs';
import { mergeCredential,MonikaPlugin } from '../src/plugin.mjs';

function memoryStorage() {const files={};const journal=[];return {read:(name,fallback)=>files[name] || fallback,write:(name,v)=>{files[name]=structuredClone(v);},journal:()=>({replay:[],append:e=>journal.push(e)}),files,journalEvents:journal};}
function fakeClient(options={}) {
  const user={id:'usr_alt',displayName:'Alt',location:'wrld_a:1',currentAvatar:'avtr_a'};
  return {user,closed:false,options,exportCookies:()=>Buffer.from('[]').toString('base64'),
    async login(){return user;},async verify(){return user;},async friends(){return [];},
    async request(path){if(path==='auth/user')return user;if(path==='auth')return {token:'fake'};return {name:'World A'};},
    close(){this.closed=true;}};
}
const noPipeline=()=>({close(){}});

test('authenticated presence overrides legacy locations and malformed presence cannot fabricate an instance',()=>{
  const user={id:'usr_alt',location:'wrld_stale:9',presence:{world:'wrld_actual',instance:'2~region(jp)'}};
  assert.equal(currentUserObservation(user).location,'wrld_actual:2~region(jp)');
  assert.equal(currentUserObservation({...user,presence:{world:'traveling',instance:'traveling'}}).location,'traveling');
  assert.equal(Object.hasOwn(currentUserObservation({...user,presence:{world:'wrld_actual'}}),'location'),false);
  assert.equal(Object.hasOwn(currentUserObservation({id:'usr_alt',location:'wrld_stale:9'},{allowLegacyLocation:false}),'location'),false);
});

test('presence and location streams merge concurrent instances while legacy profile ghosts remain excluded',async t=>{
  let at=100000;t.mock.method(Date,'now',()=>at);
  const client=fakeClient();client.user.presence={world:'wrld_a',instance:'1'};
  const service=new MonikaService(memoryStorage(),{clientFactory:()=>client,pipelineFactory:noPipeline});
  t.after(()=>service.stop());
  await service.login({primaryId:'usr_main'});await service.pollPromise;
  const r=service.recorder('usr_alt');
  service.handlePipeline({type:'user-location',content:{userId:'usr_alt',location:'wrld_b:2'}});
  for(let i=0;i<3;i++){
    at+=30000;
    service.handlePipeline({type:'user-update',content:{user:{...client.user,location:'wrld_ghost:9'}}});
    await service.poll();
    assert.equal(r.activeVisits.size,2);
    at+=30000;service.handlePipeline({type:'user-location',content:{userId:'usr_alt',location:'wrld_b:2'}});
  }
  assert.deepEqual([...r.visits.values()].map(v=>v.location),['wrld_a:1','wrld_b:2']);
  service.handlePipeline({type:'user-location',content:{userId:'usr_alt',location:'traveling:traveling'}});
  at+=10000;service.handlePipeline({type:'user-location',content:{userId:'usr_alt',location:'wrld_c:3'}});
  assert.deepEqual([...r.visits.values()].map(v=>v.location),['wrld_a:1','wrld_b:2','wrld_c:3']);
  assert(!r.events.some(e=>e.type==='cloud-user' && e.user.location==='wrld_ghost:9'));
  assert(r.events.some(e=>e.type==='cloud-user' && e.locationSource==='location-stream'));
  assert.equal(service.status().locations.length,3);
  assert.equal(service.status().locationBufferMs,120000);
});

test('location-only stream updates never copy the other client avatar and location-less profiles do not renew visits',async t=>{
  let at=100000;t.mock.method(Date,'now',()=>at);
  const client=fakeClient(),service=new MonikaService(memoryStorage(),{clientFactory:()=>client,pipelineFactory:noPipeline});
  t.after(()=>service.stop());await service.login({primaryId:'usr_main'});await service.pollPromise;
  const r=service.recorder('usr_alt');
  at+=1000;service.handlePipeline({type:'user-location',content:{userId:'usr_alt',location:'wrld_b:2'}});
  assert.equal(r.detail(r.current.id).visit.final[0].avatar,null);
  const lastLocationSeen=r.current.locationSeen;
  at+=50000;service.handlePipeline({type:'user-update',content:{user:{id:'usr_alt',displayName:'Alt'}}});
  assert.equal(r.activeVisits.get('wrld_b:2').locationSeen,lastLocationSeen);
  service.settings({locationBufferMs:300000});assert.equal(r.locationBufferMs,300000);
  service.settings({interval:600000,locationBufferMs:30000});assert.equal(r.locationBufferMs,600000);
});

test('instance actions call the primary VRCX launch dialog with the full tag and leave secondary APIs unused',async t=>{
  const previous=globalThis.window, calls=[];
  globalThis.window={location:{hash:'#/feed'},$pinia:{auth:{loginForm:{loading:false}},user:{currentUser:{id:'usr_primary'}},launch:{showLaunchDialog:async tag=>calls.push(tag)}}};
  t.after(()=>{if(previous===undefined)delete globalThis.window;else globalThis.window=previous;});
  const plugin=new MonikaPlugin();plugin.api=()=>{throw new Error('secondary API must not be called');};
  const location='wrld_a:42794~private(usr_alt)~region(jp)~nonce(test)';
  await plugin.openInstance(location);assert.deepEqual(calls,[location]);
  await assert.rejects(plugin.openInstance('traveling'),/完整实例/);assert.equal(calls.length,1);
  window.$pinia.user.currentUser=null;await assert.rejects(plugin.openInstance(location),/主账号/);
});

test('presence can recover missed moves after the disconnected location stream becomes stale',async t=>{
  let at=100000;t.mock.method(Date,'now',()=>at);
  const client=fakeClient(),service=new MonikaService(memoryStorage(),{clientFactory:()=>client,pipelineFactory:noPipeline});
  t.after(()=>service.stop());await service.login({primaryId:'usr_main'});await service.pollPromise;
  service.handlePipeline({type:'user-location',content:{userId:'usr_alt',location:'wrld_b:2'}});
  client.user.presence={world:'wrld_c',instance:'3'};at+=180000;await service.poll();
  assert.equal(service.recorder('usr_alt').current.location,'wrld_c:3');
});

test('a secondary service login after plugin stop resumes the same location without repeated visit starts',async t=>{
  let at=100000;t.mock.method(Date,'now',()=>at);
  const client=fakeClient(),service=new MonikaService(memoryStorage(),{clientFactory:()=>client,pipelineFactory:noPipeline});
  t.after(()=>service.stop());await service.login({primaryId:'usr_main'});await service.pollPromise;
  const recorder=service.recorder('usr_alt'),id=recorder.current.id;
  service.stop('manual-stop');at+=600000;client.closed=false;
  await service.login({primaryId:'usr_main'});await service.pollPromise;
  assert.equal(recorder.current.id,id);assert.equal(recorder.visits.size,1);assert.equal(recorder.events.filter(e=>e.type==='visit-start').length,1);
  assert.equal(recorder.events.filter(e=>e.type==='visit-resume').length,1);
});

test('world lookup begins at a location event, is reused on return, and failures can retry',async t=>{
  const client=fakeClient(),requested=[];let fail=true;
  const original=client.request;
  client.request=async path=>{requested.push(path);if(path==='worlds/wrld_b'){if(fail)throw new Error('temporary');return {name:'Let me decay'};}return original(path);};
  const service=new MonikaService(memoryStorage(),{clientFactory:()=>client,pipelineFactory:noPipeline});
  t.after(()=>service.stop());await service.login({primaryId:'usr_main'});await service.pollPromise;
  const r=service.recorder('usr_alt');
  service.handlePipeline({type:'user-location',content:{userId:'usr_alt',location:'wrld_b:2'}});
  assert(requested.includes('worlds/wrld_b'));await service.resolveWorldName();
  fail=false;await service.resolveWorldName();assert.equal(r.current.worldName,'Let me decay');
  service.handlePipeline({type:'user-location',content:{userId:'usr_alt',location:'wrld_a:1'}});
  service.handlePipeline({type:'user-location',content:{userId:'usr_alt',location:'wrld_b:2'}});
  assert.equal(r.current.worldName,'Let me decay');
  assert.equal(requested.filter(path=>path==='worlds/wrld_b').length,2);
});

test('plugin connects and ticks without a key, and discards a legacy key from its configuration',async t=>{
  const previous=globalThis.window;let captured;
  globalThis.window={location:{hash:'#/feed'},$pinia:{auth:{loginForm:{loading:false}},user:{currentUser:{id:'usr_main'}}},
    webApiService:{execute:()=>{throw new Error('must not use primary transport');}}};
  t.mock.method(globalThis,'fetch',async(url,options)=>{captured={url,...options};return new Response('{}');});
  t.after(()=>{if(previous===undefined)delete globalThis.window;else globalThis.window=previous;});
  const plugin=new MonikaPlugin();plugin.get=()=>({port:39123,token:'obsolete',autoLogin:false});
  assert.equal(Object.hasOwn(plugin.config(),'token'),false);
  await plugin.api('/status');assert.equal(captured.headers.Authorization,undefined);assert.equal(captured.credentials,'omit');
  assert.equal(captured.redirect,'error');assert.equal(captured.url,'http://127.0.0.1:39123/status');
  let ticks=0;plugin.started=true;plugin.status=async()=>{ticks++;return {recording:false,pending2FA:[]};};plugin.syncDatabase=async()=>{};
  await plugin.tick();assert.equal(ticks,1);
});

test('session is isolated, primary login is rejected, credentials preserve global settings',async()=>{
  const storage=memoryStorage(),clients=[];
  const service=new MonikaService(storage,{clientFactory:o=>{const c=fakeClient(o);clients.push(c);return c;},pipelineFactory:noPipeline});
  await assert.rejects(service.login({expectedId:'usr_main',primaryId:'usr_main'}),/主账号/);
  assert.equal(clients.length,0);
  const result=await service.login({primaryId:'usr_main',expectedId:'usr_alt'});await service.pollPromise;
  assert.equal(result.user.id,'usr_alt');assert.equal(storage.files['sessions.json'].usr_alt.user.id,'usr_alt');
  const existing={user:{id:'usr_alt',other:'keep'},loginParams:{username:'old',password:'encrypted',endpoint:'',websocket:''},extra:'preserved'};
  const merged=mergeCredential(existing,result,'new');assert.equal(merged.loginParams.password,'encrypted');assert.equal(merged.extra,'preserved');assert.equal(merged.user.other,'keep');
  const created=mergeCredential(undefined,result,'new');assert.equal(created.loginParams.password,'');assert.equal(created.loginParams.username,'new');
  service.settings({primaryId:'usr_alt'});assert.equal(service.active,null);assert(clients[0].closed);
});

test('two-factor login retains isolated pending cookies and activates only after identity validation',async()=>{
  const client=fakeClient();client.login=async()=>({requiresTwoFactorAuth:['totp','emailOtp']});
  const service=new MonikaService(memoryStorage(),{clientFactory:()=>client,pipelineFactory:noPipeline});
  const result=await service.login({primaryId:'usr_main',expectedId:'usr_alt'});assert.deepEqual(result.requiresTwoFactorAuth,['totp','emailOtp']);assert.equal(service.active,null);
  const authenticated=await service.verify('totp','123456');assert.equal(authenticated.user.id,'usr_alt');await service.pollPromise;service.stop();
});

test('two-factor code errors can retry while identity rejection and primary logout discard pending sessions',async()=>{
  const client=fakeClient();client.login=async()=>({requiresTwoFactorAuth:['totp']});
  let wrongCode=true;
  client.verify=async()=>{if(wrongCode)throw new Error('验证码错误');return {...client.user,id:'usr_main'};};
  const service=new MonikaService(memoryStorage(),{clientFactory:()=>client,pipelineFactory:noPipeline});
  await service.login({primaryId:'usr_main',expectedId:'usr_alt'});
  await assert.rejects(service.verify('totp','123456'),/验证码错误/);
  assert(service.pending);assert.equal(client.closed,false);
  wrongCode=false;await assert.rejects(service.verify('totp','123456'),/主账号/);
  assert.equal(service.pending,null);assert.equal(service.active,null);assert(client.closed);
  const second=fakeClient();second.login=client.login;
  service.clientFactory=()=>second;
  await service.login({primaryId:'usr_main',expectedId:'usr_alt'});
  service.settings({primaryId:''});
  assert.equal(service.pending,null);assert(second.closed);
  await assert.rejects(service.verify('totp','123456'),/没有待完成/);
});

test('failed roster pagination leaves the existing snapshot intact and never emits false exits',async()=>{
  const client=fakeClient();let fail=false;
  client.friends=async()=>{if(fail)throw new ApiError(429,'limited',90);return [{id:'usr_friend',displayName:'Friend',location:'wrld_a:1'}];};
  const service=new MonikaService(memoryStorage(),{clientFactory:()=>client,pipelineFactory:noPipeline});
  await service.login({primaryId:'usr_main'});await service.pollPromise;const r=service.recorder('usr_alt');assert(r.roster.has('usr_friend'));
  fail=true;await service.poll();assert(r.roster.has('usr_friend'));assert.equal(r.events.filter(e=>e.type==='person-leave').length,0);assert(service.retryAt>Date.now());service.stop();
});

test('upstream unauthorized ends recording and keeps the error visible',async()=>{
  const client=fakeClient();let fail=false;const original=client.request;client.request=async path=>{if(fail&&path==='auth/user')throw new ApiError(401,'expired');return original(path);};
  const service=new MonikaService(memoryStorage(),{clientFactory:()=>client,pipelineFactory:noPipeline});
  await service.login({primaryId:'usr_main'});await service.pollPromise;fail=true;await service.poll();assert.equal(service.active,null);assert.equal(service.lastError,'expired');assert.equal(service.recorder('usr_alt').current,null);
});

test('pipeline validates self identity and records only same-instance friend avatar changes',async()=>{
  const service=new MonikaService(memoryStorage(),{clientFactory:fakeClient,pipelineFactory:noPipeline});
  await service.login({primaryId:'usr_main'});await service.pollPromise;
  service.handlePipeline({type:'user-location',content:JSON.stringify({userId:'usr_main',location:'wrld_wrong:2'})});assert.equal(service.recorder('usr_alt').current.location,'wrld_a:1');
  service.handlePipeline({type:'friend-location',content:JSON.stringify({userId:'usr_friend',location:'wrld_a:1',user:{displayName:'Friend'}})});
  service.handlePipeline({type:'friend-update',content:JSON.stringify({user:{id:'usr_friend',currentAvatar:'avtr_other'}})});
  assert(service.recorder('usr_alt').roster.has('usr_friend'));assert.equal(service.recorder('usr_alt').avatars.get('usr_friend').id,'avtr_other');service.stop();
});

test('cookie compatibility accepts .NET base64 format without copying unrelated cookies',()=>{
  const encoded=Buffer.from(JSON.stringify([{Name:'auth',Value:'auth_123',Domain:'.vrchat.cloud',Path:'/'},{Name:'session-other',Value:'secret',Domain:'.vrchat.cloud'}])).toString('base64');
  const cookies=decodeCookies(encoded);assert.equal(cookies.length,1);assert.equal(cookies[0].Name,'auth');
  const client=new VRChatClient({cookies:encoded});assert.equal(client.cookieHeader(),'auth=auth_123');assert.equal(decodeCookies(client.exportCookies()).length,1);client.close();
  assert.throws(()=>new VRChatClient({endpoint:'https://attacker.test/api/1'}),/官方/);
});

test('websocket fragmentation, ping, split buffers and client masking',()=>{
  const frames=[],decoder=new FrameDecoder((kind,data)=>frames.push([kind,data.toString()]));
  decoder.push(Buffer.from([1,2,104]));decoder.push(Buffer.from([105,0x89,1,120,0x80,1,33]));
  assert.deepEqual(frames,[[9,'x'],[1,'hi!']]);
  const frame=clientFrame(1,'hello');assert(frame[1]&128);const payload=frame.subarray(6);for(let i=0;i<payload.length;i++)payload[i]^=frame[2+i%4];assert.equal(payload.toString(),'hello');
  assert.throws(()=>new FrameDecoder(()=>{}).push(Buffer.from([0x81,0x80])),/格式/);
});
