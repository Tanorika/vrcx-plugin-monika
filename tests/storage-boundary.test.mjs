import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {MonikaDatabase} from '../src/database.mjs';
import {MonikaPlugin} from '../src/plugin.mjs';
import {createVrcxAccountDatabase} from '../src/vendor-vrcx.mjs';
import {NativeRecords} from '../server/native-records.mjs';
import {localData} from './helpers/local-data.mjs';

function pluginFixture(t,local) {
  const previous=globalThis.window;
  globalThis.window={$pinia:{auth:{loginForm:{}},user:{currentUser:{id:'usr_main'}}},location:{hash:'#/feed'}};
  t.after(()=>{if(previous===undefined)delete globalThis.window;else globalThis.window=previous;});
  const sql=new DatabaseSync(':memory:'),statements=[];t.after(()=>sql.close());
  const bridge={execute:async(fn,text,args)=>{statements.push(text);for(const row of sql.prepare(text).all(args || {}))fn(Object.values(row));},
    executeNonQuery:async(text,args)=>{statements.push(text);return sql.prepare(text).run(args || {}).changes;},
    executeInsert:async(text,args)=>{statements.push(text);const value=sql.prepare(text).run(args || {});return value.changes?Number(value.lastInsertRowid):0;}};
  const plugin=new MonikaPlugin();plugin.api=local.api;
  plugin.database=new MonikaDatabase(bridge,{databaseFactory:createVrcxAccountDatabase,data:local.data});
  return {plugin,sql,statements};
}

test('switching to empty data resets only derived history and native delivery ignores an old SQLite cursor',async t=>{
  const first=localData(t),{plugin,sql,statements}=pluginFixture(t,first);
  sql.exec("CREATE TABLE monika_sync(account_id TEXT,seq INTEGER); INSERT INTO monika_sync VALUES('usr_alt',31501); CREATE TABLE monika_events(payload TEXT);");
  const r=first.service.recorder('usr_alt'),self={id:'usr_alt',displayName:'Alt',status:'active',location:'wrld_a:1'};
  r.observeSelf(self,1000);r.observeRoster([{id:'usr_friend',displayName:'Friend',location:self.location}],self,1200);
  r.observeInstanceCount(self.location,{total:15,capacity:16},1300);r.observeSelf({...self,status:'busy'},2000);r.close(2100);
  await plugin.syncDatabase(first.service.status());
  assert.equal((await plugin.history('usr_alt',{from:0,to:10000})).visitTotal,1);
  assert.equal(first.service.nativeRecords.get('usr_alt').records.length,0);
  const oldProgress=plugin.nativeProgress.get('usr_alt'),count=sql.prepare('SELECT COUNT(*) n FROM usralt_feed_status').get().n;
  assert(count>0);

  const empty=localData(t);plugin.api=empty.api;plugin.database.data=empty.data;
  const reset=await empty.api('/native-sync',undefined,{accountId:'usr_alt',...oldProgress});
  assert(reset.reset);assert.equal(reset.after,0);assert.equal(reset.records.length,0);
  await plugin.syncDatabase(empty.service.status());
  assert.equal((await plugin.history('usr_alt',{from:0,to:10000})).visitTotal,0);
  assert.equal((await plugin.database.refreshArchive('usr_alt')).visits.size,0);
  assert.equal((await plugin.nativeHistory('usr_alt',{from:0,to:10000,nativeTypes:['Status']})).events.length,count);
  assert.equal(sql.prepare('SELECT seq FROM monika_sync').get().seq,31501);
  assert(!statements.some(statement=>statement.includes('monika_')));
  empty.service.recorder('usr_alt').observeSelf({...self,status:'ask me'},3000);
  await plugin.syncDatabase(empty.service.status());
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM usralt_feed_status').get().n,count+1);
});

test('service restart replays derived visits and population without recreating native observations',async t=>{
  const first=localData(t,{remove:false}),{plugin,sql}=pluginFixture(t,first);
  const r=first.service.recorder('usr_alt'),self={id:'usr_alt',displayName:'Alt',location:'wrld_a:1',status:'active'};
  r.observeSelf(self,1000);r.observeRoster([],self,1200);r.observeInstanceCount(self.location,{total:0},1300);r.close(1400);
  await plugin.syncDatabase(first.service.status());
  const history=await plugin.history('usr_alt',{from:0,to:10000}),count=sql.prepare('SELECT COUNT(*) n FROM usralt_feed_status').get().n;
  await first.close();
  const restarted=localData(t,{path:first.path});plugin.api=restarted.api;plugin.database.data=restarted.data;
  await plugin.syncDatabase(restarted.service.status());
  const detail=await plugin.detail('usr_alt',history.visits[0].id);
  assert.equal(detail.visit.population[0].total,0);assert.equal(detail.visit.end,1400);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM usralt_feed_status').get().n,count);
  assert.equal(restarted.service.nativeRecords.get('usr_alt').sequence,0);
});

test('legacy mixed journals remain readable but native records never appear in the derived feed',async t=>{
  const local=localData(t);
  local.storage.journal('usr_alt').append({id:'old-native',accountId:'usr_alt',type:'cloud-user',at:1000,user:{id:'usr_alt',bio:'Old',status:'active'}});
  local.storage.journal('usr_alt').append({id:'old-friend',accountId:'usr_alt',type:'friend-log',kind:'Friend',at:1100,userId:'usr_friend',displayName:'Friend'});
  const stream=await local.api('/native-sync',undefined,{accountId:'usr_alt'});
  assert(stream.records.some(row=>row.kind==='friend-log'));assert(stream.records.some(row=>row.kind==='profile'));
  assert.equal((await local.data.history('usr_alt',{from:0,to:10000})).eventTotal,0);
  const r=local.service.recorder('usr_alt');r.observeSelf({id:'usr_alt',location:'wrld_a:1',bio:'New'},2000);
  assert.equal(local.storage.journal('usr_alt').replay.filter(event=>event.type==='cloud-user').length,1);
  await assert.rejects(local.api('/sync',undefined,{accountId:'usr_alt',after:31501}),/接口不存在/);
});

test('native batches paginate, release acknowledged memory, and reset stale offsets without rejecting',async()=>{
  const stream=new NativeRecords('usr_alt',{worldName:location=>location});
  for(let index=0;index<1001;index++)stream.push('Status',{userId:'usr_alt',status:String(index)});
  const first=await stream.read();assert.equal(first.records.length,500);assert(first.hasMore);
  stream.acknowledge({streamId:first.streamId,after:500});assert.equal(stream.records.length,501);
  const reloaded=await stream.read();assert(reloaded.reset);assert.equal(reloaded.after,500);assert.equal(reloaded.records[0].seq,501);
  const second=await stream.read({streamId:first.streamId,after:500});assert.equal(second.records.length,500);
  stream.acknowledge({streamId:first.streamId,after:1000});
  const last=await stream.read({streamId:first.streamId,after:1000});assert.equal(last.records.length,1);assert(!last.hasMore);
  stream.acknowledge({streamId:first.streamId,after:1001});assert.equal(stream.records.length,0);
  assert.equal((await stream.read({streamId:first.streamId,after:31501})).after,1001);
  await assert.rejects(stream.read({after:-1}),/无效/);
});

test('native avatar coordination uses resolved metadata while derived avatar changes stay in data/',async t=>{
  const local=localData(t),image='https://example.com/avatar.png';
  await local.data.write('usr_alt','avatar-metadata',image,{key:image,name:'Native avatar',ownerId:'usr_owner'});
  const r=local.service.recorder('usr_alt'),self={id:'usr_alt',displayName:'Alt',location:'wrld_a:1',bannerType:'avatarBanner',bannerUrl:image,currentAvatar:'avtr_first'};
  r.observeSelf(self,1000);r.observeSelf({...self,currentAvatar:'avtr_second'},2000);
  const native=await local.service.readNativeRecords('usr_alt');
  assert.equal(native.records.filter(record=>record.kind==='Avatar').length,1);
  assert.equal(native.records.find(record=>record.kind==='Avatar').entry.avatarName,'Native avatar');
  const journal=local.storage.journal('usr_alt').replay;
  assert(journal.some(event=>event.type==='avatar' && event.avatar.id==='avtr_second'));
  assert(!journal.some(event=>event.type==='cloud-user'));
});

test('native delivery rejects invalid sequences before writing or acknowledging them',async t=>{
  const local=localData(t),{plugin,sql}=pluginFixture(t,local),calls=[];
  plugin.api=async(path)=>{
    calls.push(path);return {accountId:'usr_alt',streamId:'new-stream',after:0,total:1,records:[{seq:3,kind:'profile',entry:{id:'usr_alt',bio:'bad'}}]};
  };
  await assert.rejects(plugin.syncDatabase({accounts:[{id:'usr_alt'}]}),/不匹配/);
  assert.deepEqual(calls,['/native-sync']);assert.equal(plugin.nativeProgress.size,0);
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM sqlite_schema WHERE type='table'").get().n,0);
});

test('derived API data and people statistics stay account-scoped and exclude native profile copies',async t=>{
  const local=localData(t),r=local.service.recorder('usr_alt'),self={id:'usr_alt',location:'wrld_a:1'},friend={id:'usr_friend',displayName:'Friend',location:self.location};
  r.observeSelf(self,1000);r.observeRoster([friend],self,1200);r.observeRoster([],self,2000);r.observeRoster([friend],self,2500);r.close(3000);
  const stats=await local.data.stats('usr_alt');assert.equal(stats.length,1);assert.equal(stats[0].joinCount,2);assert.equal(stats[0].timeSpent,1300);
  assert.equal(stats[0].lastSeen,new Date(3000).toISOString());
  await local.data.write('usr_alt','memos','usr_friend','Alt memo');
  assert.equal((await local.data.read('usr_alt','memos')).usr_friend,'Alt memo');
  assert.deepEqual(await local.data.read('usr_other','memos'),{});
  await assert.rejects(local.data.read('usr_main','memos'),/主账号/);
  await assert.rejects(local.data.history('usr_main',{}),/未找到/);
  await assert.rejects(local.data.write('usr_alt','social-users','usr_friend',friend),/无效/);
  await assert.rejects(local.data.write('usr_alt','memos','../outside','bad'),/ID/);
});
