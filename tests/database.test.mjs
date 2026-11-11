import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { MonikaDatabase,scopeSql,adaptSQLite } from '../src/database.mjs';
import { createVrcxAccountDatabase,createVrcxCloudContext } from '../src/vendor-vrcx.mjs';
import { Recorder } from '../server/recorder.mjs';

function sqlite(t) {
  const native=new DatabaseSync(':memory:');t.after(()=>native.close());const statements=[];
  return {native,statements,execute:async(callback,sql,args)=>{statements.push(sql);for(const row of native.prepare(sql).all(args || {}))callback(Object.values(row));},
    executeNonQuery:async(sql,args)=>{statements.push(sql);return native.prepare(sql).run(args || {}).changes;},
    executeInsert:async(sql,args)=>{statements.push(sql);const result=native.prepare(sql).run(args || {});return result.changes?Number(result.lastInsertRowid):0;}};
}
function sink(sql) {return new MonikaDatabase(sql,{databaseFactory:createVrcxAccountDatabase,cloudFactory:createVrcxCloudContext,
  archiveFactory:(id,events)=>new Recorder(id,()=>{},events,{closeUnfinished:false})});}
function records() {
  const recorder=new Recorder('usr_alt');
  const user=(location='wrld_a:1',avatar='avtr_1',status='active')=>({id:'usr_alt',displayName:'Alt',location,currentAvatar:avatar,status});
  recorder.observeSelf(user(),1000);recorder.observeRoster([{id:'usr_friend',displayName:'Friend',location:'wrld_a:1',currentAvatar:'avtr_f1',status:'active'}],user(),1200);
  recorder.observeSelf(user('wrld_b:2','avtr_2','busy'),3000);
  recorder.observeRoster([],user('wrld_b:2','avtr_2','busy'),3100);recorder.observeSelf(user('wrld_b:2','avtr_2','busy'),5000);recorder.close(5000);
  return recorder.events.map((event,i)=>({seq:i+1,event}));
}

test('original VRCX feed filters return empty Bio rows and enrich old friend GPS names from persisted metadata',async t=>{
  const sql=sqlite(t),database=sink(sql),context=await database.account('usr_alt');
  await context.database.addStatusToDatabase({created_at:new Date(1000).toISOString(),userId:'usr_friend',displayName:'Friend',status:'ask me'});
  await context.database.addGPSToDatabase({created_at:new Date(1000).toISOString(),userId:'usr_friend',displayName:'Friend',location:'wrld_friend:1',worldName:'wrld_friend'});
  context.archive.reduce({type:'world',worldId:'wrld_friend',name:'Resolved World',accountId:'usr_alt',at:2000});
  const options={from:0,to:5000};
  assert.equal((await database.nativeFeed('usr_alt',{...options,nativeType:'Status'})).events[0].type,'Status');
  assert.equal((await database.nativeFeed('usr_alt',{...options,nativeType:'Bio'})).events.length,0);
  assert.equal((await database.nativeFeed('usr_alt',{...options,nativeType:'GPS'})).events[0].worldName,'Resolved World');
});

test('legacy Bio migration preserves history, only upgrades the selected account and is idempotent under concurrent initialization',async t=>{
  const sql=sqlite(t);
  const legacy=prefix=>`CREATE TABLE ${prefix}_feed_bio(id INTEGER PRIMARY KEY,created_at TEXT,user_id TEXT,display_name TEXT,bio TEXT,previous_bio TEXT)`;
  sql.native.exec(`${legacy('usralt')};${legacy('usrmain')};`);
  sql.native.prepare('INSERT INTO usralt_feed_bio VALUES(?,?,?,?,?,?)').run(7,new Date(1000).toISOString(),'usr_alt','Alt','new bio','old bio');
  const mainSchema=sql.native.prepare("SELECT sql FROM sqlite_schema WHERE name='usrmain_feed_bio'").get().sql;
  const database=sink(sql),options={from:0,to:5000,nativeTypes:['Bio']};
  const [history,feed,context]=await Promise.all([database.history('usr_alt',options),database.nativeFeed('usr_alt',options),database.account('usr_alt')]);
  assert.equal(history.visitTotal,0);assert.equal(await database.account('usr_alt'),context);
  assert.equal(feed.events[0].bio,'new bio');assert.equal(feed.events[0].previousBio,'old bio');
  assert.deepEqual(feed.events[0].bioLinks,[]);assert.deepEqual(feed.events[0].previousBioLinks,[]);
  assert.equal(sql.native.prepare('SELECT id FROM usralt_feed_bio').get().id,7);
  assert.equal(sql.native.prepare("SELECT sql FROM sqlite_schema WHERE name='usrmain_feed_bio'").get().sql,mainSchema);
  assert.deepEqual(sql.statements.filter(s=>s.startsWith('ALTER TABLE')),['ALTER TABLE usralt_feed_bio ADD bio_links TEXT DEFAULT \'[]\'','ALTER TABLE usralt_feed_bio ADD previous_bio_links TEXT DEFAULT \'[]\'']);
  await sink(sql).account('usr_alt');assert.equal(sql.statements.filter(s=>s.startsWith('ALTER TABLE')).length,2);
  await context.database.addBioToDatabase({created_at:new Date(2000).toISOString(),userId:'usr_alt',displayName:'Alt',bio:'with link',previousBio:'new bio',bioLinks:['https://example.com'],previousBioLinks:[]});
  assert.equal((await database.nativeFeed('usr_alt',options)).events.length,2);
});

test('empty Bio then All and multiple original feed types query and export without refreshing cloud data',async t=>{
  const sql=sqlite(t),database=sink(sql),context=await database.account('usr_alt'),at=new Date(1000).toISOString();
  await context.database.addStatusToDatabase({created_at:at,userId:'usr_alt',displayName:'Alt',status:'active'});
  await context.database.addAvatarToDatabase({created_at:at,userId:'usr_alt',displayName:'Alt',avatarName:'Avatar'});
  await context.database.addGPSToDatabase({created_at:at,userId:'usr_alt',displayName:'Alt',location:'wrld_a:1'});
  const options={from:0,to:5000};
  assert.equal((await database.nativeFeed('usr_alt',{...options,nativeTypes:['Bio']})).events.length,0);
  assert.equal((await database.nativeFeed('usr_alt',{...options,nativeTypes:[]})).events.length,3);
  assert.deepEqual(new Set((await database.nativeFeed('usr_alt',{...options,nativeTypes:['Status','Avatar']})).events.map(e=>e.type)),new Set(['Status','Avatar']));
  const exported=await database.export('usr_alt',{...options,nativeTypes:['Status','Avatar']});
  assert.deepEqual(new Set(exported.nativeFeed.map(e=>e.type)),new Set(['Status','Avatar']));
});

test('a rejected SQLite read releases the account queue for subsequent feeds and writes',async t=>{
  const sql=sqlite(t),database=sink(sql),context=await database.account('usr_alt');
  await context.database.addStatusToDatabase({created_at:new Date(1000).toISOString(),userId:'usr_alt',status:'active'});
  const execute=sql.execute;let fail=true;
  sql.execute=async(...args)=>{if(fail && args[1].includes('FROM usralt_feed_status')){fail=false;throw 'CEF SQLite read failure';}return execute(...args);};
  await assert.rejects(database.nativeFeed('usr_alt',{from:0,to:5000,nativeTypes:['Status']}),e=>e==='CEF SQLite read failure');
  await context.scoped.flush();
  assert.equal((await database.nativeFeed('usr_alt',{from:0,to:5000})).events.length,1);
  await context.database.addStatusToDatabase({created_at:new Date(2000).toISOString(),userId:'usr_alt',status:'busy'});
  assert.equal((await database.nativeFeed('usr_alt',{from:0,to:5000})).events.length,2);
});

test('fire-and-forget write errors still fail flush and ingest, then retry in a fresh account context',async t=>{
  const sql=sqlite(t),database=sink(sql),context=await database.account('usr_alt');
  const execute=sql.executeNonQuery;let fail=true;
  sql.executeNonQuery=async(...args)=>{if(fail && args[0].includes('INSERT OR REPLACE INTO usralt_user_profile')){fail=false;throw 'CEF SQLite write failure';}return execute(...args);};
  context.database.setUserProfile({id:'usr_alt',bio:'unsaved',bioLinks:[]});
  await assert.rejects(context.scoped.flush(),e=>e==='CEF SQLite write failure');
  await assert.rejects(context.scoped.execute(()=>{},'SELECT 1'),e=>e==='CEF SQLite write failure');
  await assert.rejects(context.scoped.flush(),e=>e==='CEF SQLite write failure');
  const batch=records();await assert.rejects(database.ingest('usr_alt',batch),e=>e==='CEF SQLite write failure');
  assert.equal(database.contexts.has('usr_alt'),false);assert.equal(await database.cursor('usr_alt'),0);
  await database.ingest('usr_alt',batch);assert.equal(await database.cursor('usr_alt'),batch.length);
});

test('API population samples survive SQLite sync retries and offline archive reconstruction without native feed noise',async t=>{
  const sql=sqlite(t),database=sink(sql),r=new Recorder('usr_alt');
  const user={id:'usr_alt',displayName:'Alt',location:'wrld_a:1'};
  r.observeSelf(user,1000);r.observeRoster([],user,1100);
  r.observeInstanceCount(user.location,{total:15,capacity:16,intervalMs:60000},1200);
  r.observeInstanceCount(user.location,{total:null,reason:'inaccessible',httpStatus:403},1300);
  r.observeSelf(user,1500);r.close(1500);
  const batch=r.events.map((event,i)=>({seq:i+1,event}));
  let fail=true;const run=sql.executeNonQuery;
  sql.executeNonQuery=async(statement,args)=>{if(fail && statement.startsWith('INSERT OR REPLACE INTO monika_sync') && args['@seq']===batch.find(v=>v.event.type==='instance-count').seq){fail=false;throw new Error('population retry');}return run(statement,args);};
  await assert.rejects(database.ingest('usr_alt',batch,user),/population retry/);
  await database.ingest('usr_alt',batch.slice(await database.cursor('usr_alt')),user);
  const restored=sink(sql),detail=await restored.detail('usr_alt',[...r.visits.keys()][0]);
  assert.deepEqual(detail.visit.population.map(s=>[s.total,s.capacity,s.reason]),[[15,16,''],[null,null,'inaccessible']]);
  assert.equal(detail.visit.end,1500);assert(!detail.events.some(e=>e.type==='instance-count'));
  assert.equal(sql.native.prepare("SELECT COUNT(*) n FROM monika_events WHERE type='instance-count'").get().n,2);
  const feed=await restored.nativeFeed('usr_alt',{from:0,to:10000});assert(!feed.events.some(e=>e.type==='instance-count'));
  const history=await restored.history('usr_alt',{from:0,to:10000});assert(!history.events.some(e=>e.type==='instance-count'));
});

test('buffered visits project one native GPS entry per segment and isolated overlapping game histories, including retries',async t=>{
  const sql=sqlite(t),database=sink(sql),r=new Recorder('usr_alt',()=>{},[],{locationBufferMs:10000});
  const user=location=>({id:'usr_alt',displayName:'Alt',location});
  r.observeSelf(user('wrld_a:1'),1000);r.emit('world',{worldId:'wrld_a',name:'Let me decay'},1100);
  r.observeSelf(user('wrld_b:2'),2000);r.emit('world',{worldId:'wrld_b',name:'Steal an egg!'},2100);
  r.observeRoster([{id:'usr_friend_a',displayName:'Friend A',location:'wrld_a:1'},{id:'usr_friend_b',displayName:'Friend B',location:'wrld_b:2'}],user('wrld_b:2'),2200);
  r.observeSelf(user('wrld_a:1'),3000);r.observeSelf(user('traveling'),3500);r.observeSelf(user('wrld_b:2'),4000);
  r.observeSelf(user('wrld_a:1'),5000);r.observeSelf(user('wrld_b:2'),6000);r.close(20000,'manual-stop','last-observed');
  const batch=r.events.map((event,i)=>({seq:i+1,event}));
  const startSeq=batch.find(item=>item.event.type==='visit-start').seq;
  let fail=true;const run=sql.executeNonQuery;
  sql.executeNonQuery=async(statement,args)=>{if(fail && statement.startsWith('INSERT OR REPLACE INTO monika_sync') && args['@seq']===startSeq){fail=false;throw new Error('retry buffered GPS');}return run(statement,args);};
  await assert.rejects(database.ingest('usr_alt',batch,user('wrld_b:2')),/retry/);
  await database.ingest('usr_alt',batch.slice(await database.cursor('usr_alt')),user('wrld_b:2'));
  const gps=sql.native.prepare('SELECT location,world_name FROM usralt_feed_gps WHERE user_id=\'usr_alt\' ORDER BY created_at').all();
  assert.deepEqual(gps.map(row=>({...row})),[{location:'wrld_a:1',world_name:'Let me decay'},{location:'wrld_b:2',world_name:'Steal an egg!'}]);
  const logs=sql.native.prepare('SELECT location,time FROM usralt_monika_gamelog_location ORDER BY created_at').all();
  assert.deepEqual(logs.map(row=>({...row})),[{location:'wrld_a:1',time:4000},{location:'wrld_b:2',time:4000}]);
  const restored=sink(sql),history=await restored.history('usr_alt',{from:0,to:10000});
  assert.equal(history.visitTotal,2);assert.equal(history.stats.elapsedDuration,5000);assert.equal(history.stats.parallelDuration,3000);
  for(const visit of history.visits)assert.deepEqual(visit.final.map(p=>p.id),visit.location==='wrld_a:1'?['usr_alt','usr_friend_a']:['usr_alt','usr_friend_b']);
});

test('resuming across a service restart retains one activity and GPS, retracts only its temporary end, and retries safely',async t=>{
  const sql=sqlite(t),database=sink(sql),r=new Recorder('usr_alt',()=>{},[],{locationBufferMs:3000});
  const user={id:'usr_alt',displayName:'Alt',location:'wrld_a:1'},friend={id:'usr_friend',displayName:'Friend',location:user.location};
  r.observeSelf(user,1000);r.observeRoster([friend],user,1500);r.observeInstanceCount(user.location,{total:12},2000);r.observeSelf(user,3000);
  const id=r.current.id;r.close(4000,'manual-stop','last-observed');
  const initial=r.events.map((event,i)=>({seq:i+1,event}));await database.ingest('usr_alt',initial,user);
  assert.equal(sql.native.prepare('SELECT COUNT(*) n FROM usralt_monika_gamelog_location').get().n,1);
  assert.equal(sql.native.prepare("SELECT COUNT(*) n FROM usralt_monika_gamelog_join_leave WHERE type='OnPlayerLeft'").get().n,2);
  // Keep an unrelated secondary row at the same timestamp and location intact.
  sql.native.prepare('INSERT INTO usralt_monika_gamelog_join_leave(created_at,type,user_id,display_name,location,time) VALUES(?,?,?,?,?,?)')
    .run(new Date(3000).toISOString(),'OnPlayerLeft','usr_unrelated','Unrelated',user.location,99);
  const resumed=new Recorder('usr_alt',()=>{},r.events,{locationBufferMs:3000});resumed.observeSelf(user,100000);resumed.observeRoster([friend],user,101000);
  const resumeSeq=resumed.events.findIndex(e=>e.type==='visit-resume')+1;let fail=true;const write=sql.executeNonQuery;
  sql.executeNonQuery=async(statement,args)=>{if(fail && statement.startsWith('INSERT OR REPLACE INTO monika_sync') && args['@seq']===resumeSeq){fail=false;throw new Error('resume retry');}return write(statement,args);};
  const batch=resumed.events.map((event,i)=>({seq:i+1,event}));
  await assert.rejects(database.ingest('usr_alt',batch.slice(initial.length),user),/resume retry/);
  await database.ingest('usr_alt',batch.slice(await database.cursor('usr_alt')),user);
  assert.equal(sql.native.prepare('SELECT COUNT(*) n FROM usralt_monika_gamelog_location').get().n,0);
  assert.deepEqual(sql.native.prepare("SELECT user_id FROM usralt_monika_gamelog_join_leave WHERE type='OnPlayerLeft'").all().map(row=>row.user_id),['usr_unrelated']);
  assert.equal(sql.native.prepare('SELECT COUNT(*) n FROM usralt_feed_gps').get().n,1);
  let restored=sink(sql),detail=await restored.detail('usr_alt',id);
  assert.equal(detail.visit.start,1000);assert.equal(detail.visit.end,null);assert.equal(detail.visit.population[0].total,12);
  assert.equal((await restored.history('usr_alt',{from:0,to:200000})).visitTotal,1);
  const after=resumed.events.length;resumed.close(110000,'manual-stop','last-observed');
  await database.ingest('usr_alt',resumed.events.slice(after).map((event,i)=>({seq:after+i+1,event})),user);
  assert.equal(sql.native.prepare('SELECT COUNT(*) n FROM usralt_monika_gamelog_location').get().n,1);
  assert.equal(sql.native.prepare('SELECT time FROM usralt_monika_gamelog_location').get().time,100000);
  restored=sink(sql);assert.equal((await restored.detail('usr_alt',id)).visit.end,101000);
});

test('loading transitions do not pollute native GPS and repeated visits keep persisted world names',async t=>{
  const sql=sqlite(t),database=sink(sql),r=new Recorder('usr_alt');
  const user=location=>({id:'usr_alt',displayName:'Alt',location});
  r.observeSelf(user('wrld_a:1'),1000);r.emit('world',{worldId:'wrld_a',name:'Let me decay'},1100);
  r.observeSelf(user('traveling:traveling'),2000);r.observeSelf(user('wrld_a:1'),3000);
  r.observeSelf(user('traveling'),4000);r.observeSelf(user('wrld_b:2'),5000);
  r.observeSelf(user('wrld_a:1'),6000);r.close(7000);
  await database.ingest('usr_alt',r.events.map((event,i)=>({seq:i+1,event})),user('wrld_a:1'));
  const gps=sql.native.prepare('SELECT location,world_name FROM usralt_feed_gps ORDER BY created_at').all();
  assert.deepEqual(gps.map(row=>row.location),['wrld_b:2','wrld_a:1']);assert.equal(gps[1].world_name,'Let me decay');
  const history=await database.history('usr_alt',{from:0,to:10000});assert.equal(history.visitTotal,3);
  assert(history.visits.filter(v=>v.location==='wrld_a:1').every(v=>v.worldName==='Let me decay'));
  const restored=sink(sql);assert((await restored.history('usr_alt',{from:0,to:10000})).visits.filter(v=>v.location==='wrld_a:1').every(v=>v.worldName==='Let me decay'));
});

test('reused VRCX methods write native account feeds and isolated game tables in the shared SQLite',async t=>{
  const sql=sqlite(t);sql.native.exec('CREATE TABLE gamelog_location(id INTEGER PRIMARY KEY,created_at TEXT,location TEXT,world_id TEXT,world_name TEXT,time INTEGER,group_name TEXT); INSERT INTO gamelog_location(location,world_id,time) VALUES(\'wrld_main:1\',\'wrld_main\',999999);');
  const database=sink(sql),batch=records();await database.ingest('usr_alt',batch,{id:'usr_alt',displayName:'Alt'});
  assert.equal(sql.native.prepare('SELECT COUNT(*) n FROM gamelog_location').get().n,1);
  assert.equal(sql.native.prepare('SELECT COUNT(*) n FROM usralt_monika_gamelog_location').get().n,2);
  assert.equal(sql.native.prepare('SELECT COUNT(*) n FROM usralt_feed_gps').get().n,1);
  assert.equal(sql.native.prepare('SELECT COUNT(*) n FROM usralt_feed_avatar').get().n,1);
  assert.equal(sql.native.prepare('SELECT COUNT(*) n FROM usralt_feed_status').get().n,3);
  assert.equal(sql.native.prepare('SELECT COUNT(*) n FROM usralt_feed_online_offline').get().n,2);
  assert.equal(sql.native.prepare('SELECT location FROM usralt_feed_online_offline WHERE user_id=\'usr_alt\'').get().location,'wrld_a:1');
  assert(sql.statements.every(s=>!/^\s*(BEGIN|COMMIT|ROLLBACK)/.test(s)));
  const history=await database.history('usr_alt',{from:0,to:10000});assert.equal(history.visitTotal,2);assert.equal(history.stats.duration,4000);
  const native=await database.nativeFeed('usr_alt',{from:0,to:10000,page:1,selfOnly:true});assert(native.events.every(e=>e.userId==='usr_alt'));assert(native.events.some(e=>e.type==='GPS'));
  const context=await database.account('usr_alt');const locations=await context.database.getCurrentUserLocationSliceV2(new Date(0).toISOString(),new Date(10000).toISOString());assert.equal(locations.length,2);assert(!locations.some(r=>r.time===999999));
  assert.equal((await database.accounts())[0].id,'usr_alt');
});

test('interrupted native projection retries without duplicate feed rows or lost extension events',async t=>{
  const sql=sqlite(t),database=sink(sql),batch=records();let rejectOnce=true;
  const run=sql.executeNonQuery;sql.executeNonQuery=async(sqlText,args)=>{if(rejectOnce&&sqlText.startsWith('INSERT OR REPLACE INTO monika_sync')&&args['@seq']===1){rejectOnce=false;throw new Error('simulated disk failure');}return run(sqlText,args);};
  await assert.rejects(database.ingest('usr_alt',batch,{id:'usr_alt'}),/simulated/);
  assert.equal(await database.cursor('usr_alt'),0);await database.ingest('usr_alt',batch,{id:'usr_alt'});
  assert.equal(sql.native.prepare('SELECT COUNT(*) n FROM usralt_feed_online_offline WHERE user_id=\'usr_alt\'').get().n,1);
  assert.equal(sql.native.prepare('SELECT COUNT(*) n FROM monika_events').get().n,batch.length);
  assert.equal(await database.cursor('usr_alt'),batch.length);
  const restored=sink(sql);assert.equal((await restored.history('usr_alt',{from:0,to:10000})).visitTotal,2);
});

test('account contexts preserve main tables and reject event identity mismatches',async t=>{
  const sql=sqlite(t),database=sink(sql),batch=records();
  await assert.rejects(database.ingest('usr_alt',[{seq:1,event:{...batch[0].event,accountId:'usr_main'}}]),/不匹配/);
  assert.throws(()=>scopeSql('SELECT * FROM gamelog_location','../main'),/无效/);
  const first=await database.account('usr_alt'),other=await database.account('usr_other');
  await first.database.addGPSToDatabase({created_at:'2026-11-10T00:00:00.000Z',userId:'usr_alt',location:'wrld_alt:1'});
  await other.database.addGPSToDatabase({created_at:'2026-11-10T00:00:00.000Z',userId:'usr_other',location:'wrld_other:1'});
  assert.equal(sql.native.prepare('SELECT location FROM usralt_feed_gps').get().location,'wrld_alt:1');
  assert.equal(sql.native.prepare('SELECT location FROM usrother_feed_gps').get().location,'wrld_other:1');
});

test('missing executeInsert still projects complete account histories through atomic RETURNING',async t=>{
  const sql=sqlite(t);delete sql.executeInsert;
  const database=sink(sql),batch=records();await database.ingest('usr_alt',batch,{id:'usr_alt'});
  assert.equal(await database.cursor('usr_alt'),batch.length);
  assert.equal(sql.native.prepare('SELECT COUNT(*) n FROM usralt_feed_avatar').get().n,1);
  assert.equal(sql.native.prepare('SELECT COUNT(*) n FROM usralt_monika_gamelog_location').get().n,2);
  assert.equal((await database.history('usr_alt',{from:0,to:10000})).visitTotal,2);
  assert(sql.statements.some(statement=>statement.includes('RETURNING rowid')));
  assert(!sql.statements.some(statement=>statement.includes('last_insert_rowid')));
});

test('raw uppercase SQLite bridge returns the correct ID despite another writer and preserves ignored-insert zero',async t=>{
  const sql=sqlite(t);sql.native.exec('CREATE TABLE alt(id INTEGER PRIMARY KEY,value TEXT UNIQUE); CREATE TABLE main(id INTEGER PRIMARY KEY);');
  const bridge={ExecuteNonQuery:sql.executeNonQuery,Execute:async(statement,args)=>{
    const rows=sql.native.prepare(statement).all(args || {}).map(row=>Object.values(row));
    if(statement.includes('RETURNING'))sql.native.exec('INSERT INTO main DEFAULT VALUES; INSERT INTO main DEFAULT VALUES;');
    return rows;
  }};
  const adapter=adaptSQLite(bridge),statement='INSERT OR IGNORE INTO alt(value) VALUES(@value);';
  assert.equal(await adapter.executeInsert(statement,{'@value':'observed'}),1);
  assert.equal(await adapter.executeInsert(statement,{'@value':'observed'}),0);
  assert.equal(sql.native.prepare('SELECT COUNT(*) n FROM alt').get().n,1);
  await assert.rejects(adapter.executeInsert('SELECT 1'),/INSERT/);
});

test('JSON SQLite bridge converts parameter maps for reads and writes',async t=>{
  const sql=sqlite(t),values=args=>args?Object.fromEntries(args):{};
  const adapter=adaptSQLite({ExecuteJson:async(statement,args)=>JSON.stringify(sql.native.prepare(statement).all(values(args)).map(row=>Object.values(row))),
    ExecuteNonQuery:async(statement,args)=>sql.native.prepare(statement).run(values(args)).changes});
  await adapter.executeNonQuery('CREATE TABLE alt(id INTEGER PRIMARY KEY,value TEXT)');
  assert.equal(await adapter.executeInsert('INSERT INTO alt(value) VALUES(@value)',{'@value':'saved'}),1);
  const rows=[];await adapter.execute(row=>rows.push(row),'SELECT value FROM alt WHERE id=@id',{'@id':1});
  assert.deepEqual(rows,[['saved']]);
});
