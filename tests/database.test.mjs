import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { MonikaDatabase,adaptSQLite } from '../src/database.mjs';
import { createVrcxAccountDatabase,createVrcxCloudContext } from '../src/vendor-vrcx.mjs';
import { Recorder } from '../server/recorder.mjs';
import {localData} from './helpers/local-data.mjs';

function sqlite(t) {
  const native=new DatabaseSync(':memory:');t.after(()=>native.close());const statements=[];
  return {native,statements,local:localData(t),execute:async(callback,sql,args)=>{statements.push(sql);for(const row of native.prepare(sql).all(args || {}))callback(Object.values(row));},
    executeNonQuery:async(sql,args)=>{statements.push(sql);return native.prepare(sql).run(args || {}).changes;},
    executeInsert:async(sql,args)=>{statements.push(sql);const result=native.prepare(sql).run(args || {});return result.changes?Number(result.lastInsertRowid):0;}};
}
function sink(sql) {return new MonikaDatabase(sql,{databaseFactory:createVrcxAccountDatabase,data:sql.local.data});}
async function records(sql) {
  const recorder=sql.local.service.recorder('usr_alt');
  const user=(location='wrld_a:1',status='active')=>({id:'usr_alt',displayName:'Alt',location,status});
  recorder.observeSelf(user(),1000);recorder.observeRoster([{id:'usr_friend',displayName:'Friend',location:'wrld_a:1',status:'active'}],user(),1200);
  recorder.observeSelf(user('wrld_b:2','busy'),3000);recorder.observeRoster([],user('wrld_b:2','busy'),3100);
  recorder.observeSelf(user('wrld_b:2','busy'),5000);recorder.close(5000);
  return (await sql.local.service.readNativeRecords('usr_alt')).records;
}

test('original VRCX feed filters return empty Bio rows and enrich old friend GPS names from persisted metadata',async t=>{
  const sql=sqlite(t),database=sink(sql),context=await database.account('usr_alt');
  await context.database.addStatusToDatabase({created_at:new Date(1000).toISOString(),userId:'usr_friend',displayName:'Friend',status:'ask me'});
  await context.database.addGPSToDatabase({created_at:new Date(1000).toISOString(),userId:'usr_friend',displayName:'Friend',location:'wrld_friend:1',worldName:'wrld_friend'});
  sql.local.service.recorder('usr_alt').emit('world',{worldId:'wrld_friend',name:'Resolved World'},2000);
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
  const batch=await records(sql);await assert.rejects(database.ingestNative('usr_alt',batch),e=>e==='CEF SQLite write failure');
  assert.equal(database.contexts.has('usr_alt'),false);
  await database.ingestNative('usr_alt',batch);assert((await database.nativeFeed('usr_alt',{from:0,to:10000})).events.length>0);
});

test('native records use VRCX account tables while activities and population stay in data/',async t=>{
  const sql=sqlite(t),database=sink(sql),batch=await records(sql);
  sql.native.exec("CREATE TABLE gamelog_location(id INTEGER PRIMARY KEY,location TEXT); INSERT INTO gamelog_location(location) VALUES('wrld_main:1');");
  await database.ingestNative('usr_alt',batch);
  const r=sql.local.service.recorder('usr_alt');
  // Record a third activity with API population, then reconstruct it through the service.
  r.observeSelf({id:'usr_alt',location:'wrld_c:3'},6000);
  r.observeInstanceCount('wrld_c:3',{total:15,capacity:16},6200);r.close(6500);
  const history=await database.history('usr_alt',{from:0,to:10000});assert.equal(history.visitTotal,3);
  const detail=await database.detail('usr_alt',history.visits[0].id);assert.equal(detail.visit.population[0].total,15);
  const names=sql.native.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map(row=>row.name);
  assert(!names.some(name=>name.includes('monika')));
  assert.equal(sql.native.prepare('SELECT location FROM gamelog_location').get().location,'wrld_main:1');
  assert.equal(sql.native.prepare('SELECT COUNT(*) n FROM usralt_feed_gps').get().n,1);
  assert.equal(sql.native.prepare('SELECT COUNT(*) n FROM usralt_feed_status').get().n,3);
  assert.equal(sql.native.prepare('SELECT COUNT(*) n FROM usralt_feed_online_offline').get().n,2);
  assert(sql.statements.every(s=>!/^\s*(BEGIN|COMMIT|ROLLBACK)/.test(s)));
  const journal=sql.local.storage.journal('usr_alt').replay;
  assert(journal.some(event=>event.type==='instance-count'));assert(!journal.some(event=>['cloud-user','friend-log'].includes(event.type)));
  assert((await sink(sql).history('usr_alt',{from:0,to:10000})).visitTotal===3);
});

test('a partial native batch retries without duplicate feed or friend-log rows',async t=>{
  const sql=sqlite(t),database=sink(sql),batch=await records(sql);let fail=true;const insert=sql.executeInsert;
  sql.executeInsert=async(statement,args)=>{
    if(fail && statement.includes('usralt_feed_gps')){fail=false;throw new Error('simulated disk failure');}
    return insert(statement,args);
  };
  await assert.rejects(database.ingestNative('usr_alt',batch),/simulated/);
  await database.ingestNative('usr_alt',batch);await database.ingestNative('usr_alt',batch);
  assert.equal(sql.native.prepare('SELECT COUNT(*) n FROM usralt_feed_status').get().n,3);
  assert.equal(sql.native.prepare('SELECT COUNT(*) n FROM usralt_feed_gps').get().n,1);
  const friend={kind:'friend-log',entry:{created_at:new Date(7000).toISOString(),type:'Friend',userId:'usr_friend',displayName:'Friend'}};
  await database.ingestNative('usr_alt',[friend]);await database.ingestNative('usr_alt',[friend]);
  assert.equal((await database.socialHistory('usr_alt')).length,1);
});

test('native account contexts remain isolated and reject derived record types or invalid users',async t=>{
  const sql=sqlite(t),database=sink(sql);
  await assert.rejects(database.ingestNative('usr_alt',[{kind:'visit-start',entry:{userId:'usr_alt'}}]),/无效/);
  await assert.rejects(database.ingestNative('usr_alt',[{kind:'profile',entry:{id:'../main'}}]),/无效/);
  await database.ingestNative('usr_alt',[{kind:'GPS',entry:{created_at:new Date(1000).toISOString(),userId:'usr_alt',location:'wrld_alt:1'}}]);
  await database.ingestNative('usr_other',[{kind:'GPS',entry:{created_at:new Date(1000).toISOString(),userId:'usr_other',location:'wrld_other:1'}}]);
  assert.equal(sql.native.prepare('SELECT location FROM usralt_feed_gps').get().location,'wrld_alt:1');
  assert.equal(sql.native.prepare('SELECT location FROM usrother_feed_gps').get().location,'wrld_other:1');
});

test('missing executeInsert still writes native feeds through atomic RETURNING',async t=>{
  const sql=sqlite(t);delete sql.executeInsert;
  const database=sink(sql);await database.ingestNative('usr_alt',await records(sql));
  assert.equal(sql.native.prepare('SELECT COUNT(*) n FROM usralt_feed_gps').get().n,1);
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
