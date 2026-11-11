import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { MonikaPlugin, mergeCredential } from '../src/plugin.mjs';
import { MonikaService } from '../server/service.mjs';

const alt = {user:{id:'usr_alt',username:'alt'},cookies:'new-alt-cookie'};
function fixture(t, saved = {usr_main:{user:{id:'usr_main'},cookies:'main-cookie',loginParams:{username:'main',password:'main-password'}}}) {
  const previousWindow = globalThis.window;
  const sql = new DatabaseSync(':memory:');
  sql.exec('CREATE TABLE configs (key TEXT PRIMARY KEY, value TEXT)');
  const write = data => sql.prepare('INSERT OR REPLACE INTO configs VALUES (?,?)').run('config:savedcredentials',JSON.stringify(data));
  if (saved !== null) write(saved);
  const read = () => JSON.parse(sql.prepare('SELECT value FROM configs WHERE key=?').get('config:savedcredentials')?.value || '{}');
  const requests=[],auth={loginForm:{loading:false},attemptingAutoLogin:false,twoFactorAuthDialogVisible:false};
  globalThis.window={location:{hash:'#/feed'},$pinia:{auth,user:{currentUser:{id:'usr_main'}}},
    webApiService:{execute(){throw new Error('primary transport called');},setCookies(){throw new Error('primary cookies changed');},clearCookies(){throw new Error('primary cookies cleared');}},
    configRepository:{getString:async()=>sql.prepare('SELECT value FROM configs WHERE key=?').get('config:savedcredentials')?.value ?? null,
      setString(){throw new Error('unconditional credentials overwrite');}}};
  const plugin=new MonikaPlugin();plugin.config=()=>({port:39123,interval:60000,autoLogin:true,accountId:'usr_alt'});
  plugin.set=()=>true;plugin.started=true;
  plugin.database={sqlite:{execute:async(callback,text,params)=>{for(const row of sql.prepare(text).all(params))callback(Object.values(row));}}};
  plugin.api=async(path,data)=>{requests.push({path,data});return {};};
  t.after(()=>{sql.close();if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow;});
  return {plugin,auth,requests,read,write,sql};
}

test('a retained currentUser does not authenticate the login page or start secondary login/sync',async t=>{
  const {plugin,requests,read}=fixture(t);const before=read();
  window.location.hash='#/login?redirect=/feed';
  await plugin.tick();
  assert.deepEqual(requests.map(r=>r.path),['/settings']);assert.equal(requests[0].data.primaryId,'');
  await assert.rejects(plugin.loginSaved('usr_alt'),/主账号/);
  await assert.rejects(plugin.loginNew('alt','password'),/主账号/);
  await assert.rejects(plugin.syncCredentials(alt),/主账号/);
  assert.deepEqual(read(),before);
});

test('primary manual login, auto login and 2FA suspend secondary operations on a stale protected route',async t=>{
  const {plugin,auth,requests}=fixture(t);
  for(const field of ['loading','attemptingAutoLogin','twoFactorAuthDialogVisible','credentialsToSave']) {
    const target=field==='loading'?auth.loginForm:auth;target[field]=field==='credentialsToSave'?{}:true;
    await plugin.tick();assert.equal(requests.at(-1).data.primaryId,'');
    await assert.rejects(plugin.loginNew('alt','password'),/主账号/);
    target[field]=field==='credentialsToSave'?null:false;
  }
  assert(requests.every(r=>r.path==='/settings'));
  assert.equal(plugin.requireSession().id,'usr_main');
});

test('late secondary auth responses cannot save cookies after logout and return to the same primary',async t=>{
  const {plugin,read}=fixture(t);const before=read();let resolveLogin;
  plugin.api=()=>new Promise(resolve=>{resolveLogin=resolve;});
  const pending=plugin.loginNew('alt','password');
  window.location.hash='#/login';plugin.session();window.location.hash='#/feed';plugin.session();
  resolveLogin(alt);await assert.rejects(pending,/会话变化/);
  assert.deepEqual(read(),before);assert.equal(plugin.loginBusy,false);
});

test('credentials compare-and-swap preserves a native account update during the async read',async t=>{
  const {plugin,read,write}=fixture(t);const original=plugin.database.sqlite.execute;let raced=false;
  plugin.database.sqlite.execute=async(...args)=>{
    if (!raced) {raced=true;const native=read();native.usr_main.cookies='refreshed-main-cookie';
      native.usr_other={user:{id:'usr_other'},loginParams:{username:'other',password:'saved'}};write(native);}
    return original(...args);
  };
  await plugin.syncCredentials(alt);
  assert.equal(read().usr_main.cookies,'refreshed-main-cookie');assert.equal(read().usr_main.loginParams.password,'main-password');
  assert.equal(read().usr_other.loginParams.password,'saved');assert.equal(read().usr_alt.cookies,alt.cookies);
});

test('queued credential syncs retain both secondary updates and never replace a primary session',async t=>{
  const {plugin,read}=fixture(t);
  await Promise.all([plugin.syncCredentials(alt),plugin.syncCredentials({user:{id:'usr_other',username:'other'},cookies:'other-cookie'})]);
  assert.equal(read().usr_alt.cookies,alt.cookies);assert.equal(read().usr_other.cookies,'other-cookie');
  const before=read();await assert.rejects(plugin.syncCredentials({user:{id:'usr_main'},cookies:'bad'}),/主账号会话/);
  assert.deepEqual(read(),before);
});

test('credentials create a missing config and cancel before writing when the primary changes during the read',async t=>{
  const {plugin,read}=fixture(t,null);await plugin.syncCredentials(alt);assert.equal(read().usr_alt.cookies,alt.cookies);
  const before=read(),original=window.configRepository.getString;
  window.configRepository.getString=async()=>{const text=await original();window.$pinia.user.currentUser.id='usr_other';return text;};
  await assert.rejects(plugin.syncCredentials({...alt,cookies:'late-cookie'}),/会话变化/);assert.deepEqual(read(),before);
});

test('empty cloud usernames retain usable saved login parameters',()=>{
  const existing={user:{id:'usr_alt',username:'known'},loginParams:{username:'known-login',password:'encrypted',endpoint:'',websocket:''}};
  const merged=mergeCredential(existing,{...alt,user:{id:'usr_alt',username:''}},'');
  assert.equal(merged.user.username,'known');assert.equal(merged.loginParams.username,'known-login');assert.equal(merged.loginParams.password,'encrypted');
  assert.equal(mergeCredential(undefined,alt).loginParams.username,'alt');
});

test('primary logout or switch cancels a service login already waiting for VRChat',async()=>{
  for(const primaryId of ['', 'usr_other']) {
    let resolveLogin;
    const client={closed:false,login:()=>new Promise(resolve=>{resolveLogin=resolve;}),close(){this.closed=true;}};
    const service=new MonikaService({read:(_,fallback)=>fallback},{clientFactory:()=>client});
    const pending=service.login({primaryId:'usr_main',expectedId:'usr_alt'});
    service.settings({primaryId});resolveLogin({id:'usr_alt'});
    await assert.rejects(pending,/登录已取消/);assert.equal(client.closed,true);assert.equal(service.active,null);assert.equal(service.pending,null);
  }
});
