export function isReliableDisplayName(name) {
  return typeof name==='string' && name.trim().length>0 && !name.includes('\uFFFD') && name.isWellFormed();
}
export function vrcxPrefix(id) {
  if(!/^usr_[a-zA-Z0-9-]+$/.test(id))throw new Error('无效的目标账号 ID');
  return id.replaceAll('-','').replaceAll('_','');
}
export function scopeSql(sql,id) {
  const prefix=vrcxPrefix(id);
  // VRCX's game-log schema is global. Give its unchanged methods an account-scoped SQL view.
  return sql.replace(/\b(?:idx_)?gamelog_[a-zA-Z0-9_]+\b/g,table=>`${prefix}_monika_${table}`);
}
export function retrySafeInsert(sql) {
  const match=/^\s*INSERT OR IGNORE INTO (\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)\s*$/i.exec(sql);
  if(!match)return sql;
  const columns=match[2].split(',').map(s=>s.trim()),values=match[3].split(',').map(s=>s.trim());
  if(columns.length!==values.length || values.some(v=>!/^@\w+$/.test(v)))return sql;
  return `INSERT OR IGNORE INTO ${match[1]} (${match[2]}) SELECT ${match[3]} WHERE NOT EXISTS (SELECT 1 FROM ${match[1]} WHERE ${columns.map((c,i)=>`${c} IS ${values[i]}`).join(' AND ')})`;
}

export function adaptSQLite(bridge) {
  if (!bridge) throw new Error('VRCX SQLite 接口不可用');
  const execute = typeof bridge.execute === 'function' ? (...args) => bridge.execute(...args) : async (callback,sql,args=null) => {
    let rows;
    if (typeof bridge.Execute === 'function') rows = await bridge.Execute(sql,args);
    else if (typeof bridge.ExecuteJson === 'function') rows = JSON.parse(await bridge.ExecuteJson(sql,args ? new Map(Object.entries(args)) : null));
    else throw new Error('VRCX SQLite 接口缺少 execute / Execute 查询方法');
    for (const row of rows) callback(row);
  };
  const nativeArgs = args => typeof bridge.Execute !== 'function' && typeof bridge.ExecuteJson === 'function' && args ? new Map(Object.entries(args)) : args;
  const executeNonQuery = typeof bridge.executeNonQuery === 'function' ? (...args) => bridge.executeNonQuery(...args) :
    typeof bridge.ExecuteNonQuery === 'function' ? (sql,args=null) => bridge.ExecuteNonQuery(sql,nativeArgs(args)) : null;
  if (!executeNonQuery) throw new Error('VRCX SQLite 接口缺少 executeNonQuery / ExecuteNonQuery 写入方法');
  const nativeInsert = typeof bridge.executeInsert === 'function' ? (...args) => bridge.executeInsert(...args) :
    typeof bridge.ExecuteInsert === 'function' ? (sql,args=null) => bridge.ExecuteInsert(sql,nativeArgs(args)) : null;
  return { execute, executeNonQuery, executeInsert: nativeInsert || (async (sql,args=null) => {
    // Return the ID from this statement, never from a later connection-global last_insert_rowid().
    if (!/^\s*INSERT\b/i.test(sql)) throw new Error('SQLite 插入适配仅接受 INSERT 语句');
    let rowId = 0;
    await execute(row => {rowId=Number(row[0]);}, `${sql.trim().replace(/;$/,'')} RETURNING rowid`, args);
    return rowId; // INSERT OR IGNORE with no inserted row must still return zero.
  }) };
}

export class MonikaDatabase {
  constructor(sqlite,{databaseFactory,cloudFactory,archiveFactory}={}) {
    this.sqlite=adaptSQLite(sqlite);
    this.databaseFactory=databaseFactory || createVrcxAccountDatabase;
    this.cloudFactory=cloudFactory || createVrcxCloudContext;
    this.archiveFactory=archiveFactory || ((id,events)=>new MonikaArchive(id,()=>{},events,{closeUnfinished:false}));
    this.contexts=new Map();this.accountInitializations=new Map();this.initialized=null;
  }
  init() {
    if(!this.initialized)this.initialized=(async()=>{
      await this.sqlite.executeNonQuery('CREATE TABLE IF NOT EXISTS monika_accounts (account_id TEXT PRIMARY KEY, user_json TEXT NOT NULL)');
      await this.sqlite.executeNonQuery('CREATE TABLE IF NOT EXISTS monika_events (account_id TEXT NOT NULL, seq INTEGER NOT NULL, event_id TEXT NOT NULL, visit_id TEXT, at INTEGER NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL, projected INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(account_id,seq), UNIQUE(account_id,event_id))');
      await this.sqlite.executeNonQuery('CREATE INDEX IF NOT EXISTS monika_events_visit_idx ON monika_events(account_id,visit_id,at)');
      await this.sqlite.executeNonQuery('CREATE TABLE IF NOT EXISTS monika_sync (account_id TEXT PRIMARY KEY, seq INTEGER NOT NULL DEFAULT 0, cloud_state TEXT NOT NULL DEFAULT \'[]\')');
      await this.sqlite.executeNonQuery('CREATE TABLE IF NOT EXISTS monika_avatar_metadata (account_id TEXT NOT NULL, asset_key TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(account_id,asset_key))');
      await this.sqlite.executeNonQuery('CREATE TABLE IF NOT EXISTS monika_social (account_id TEXT PRIMARY KEY, payload TEXT NOT NULL)');
      await this.sqlite.executeNonQuery('CREATE TABLE IF NOT EXISTS monika_user_memos (account_id TEXT NOT NULL, user_id TEXT NOT NULL, memo TEXT NOT NULL, PRIMARY KEY(account_id,user_id))');
      await this.sqlite.executeNonQuery('CREATE TABLE IF NOT EXISTS monika_social_users (account_id TEXT NOT NULL, user_id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(account_id,user_id))');
    })().catch(e=>{this.initialized=null;throw e;});
    return this.initialized;
  }
  async accounts() {
    await this.init();const accounts=[];
    await this.sqlite.execute(row=>accounts.push(JSON.parse(row[0])),'SELECT user_json FROM monika_accounts');return accounts;
  }
  async account(id) {
    vrcxPrefix(id);await this.init();if(this.contexts.has(id))return this.contexts.get(id);
    let initialization=this.accountInitializations.get(id);
    if(!initialization){initialization=this.createAccount(id);this.accountInitializations.set(id,initialization);}
    try{return await initialization;}
    finally{if(this.accountInitializations.get(id)===initialization)this.accountInitializations.delete(id);}
  }
  async migrateFeedBioLinks(id,scoped) {
    // VRCX tableAlter.addFeedBioLinks, scoped to this account and safe to repeat.
    const table=`${vrcxPrefix(id)}_feed_bio`,columns=new Set();
    await scoped.execute(row=>columns.add(row[1]),`PRAGMA table_info(${table})`);
    for(const column of ['bio_links','previous_bio_links'])if(!columns.has(column))
      await scoped.executeNonQuery(`ALTER TABLE ${table} ADD ${column} TEXT DEFAULT '[]'`);
  }
  async createAccount(id) {
    // Track even fire-and-forget writes in upstream VRCX methods. No global BEGIN/COMMIT on the shared connection.
    let pending=Promise.resolve(),writeFailure=null;
    const enqueue=(operation,write=false)=>{
      const result=pending.then(()=>{if(writeFailure)throw writeFailure.error;return operation();});
      // Reads report their own error and release the queue; failed writes still abort projection.
      pending=result.then(()=>{},error=>{if(write && !writeFailure)writeFailure={error};});
      return result;
    };
    const normalize=args=>args?Object.fromEntries(Object.entries(args).map(([k,v])=>[k,v===undefined?null:v])):null;
    const scoped={execute:(callback,sql,args)=>enqueue(()=>this.sqlite.execute(callback,scopeSql(sql,id),normalize(args))),
      executeNonQuery:(sql,args)=>enqueue(()=>this.sqlite.executeNonQuery(retrySafeInsert(scopeSql(sql,id)),normalize(args)),true),
      executeInsert:(sql,args)=>enqueue(()=>this.sqlite.executeInsert(retrySafeInsert(scopeSql(sql,id)),normalize(args)),true),
      flush:async()=>{await pending;if(writeFailure)throw writeFailure.error;}};
    const database=this.databaseFactory(scoped,id);await database.initUserTables(id);await database.initScopedGameTables();
    await this.migrateFeedBioLinks(id,scoped);await scoped.flush();
    let seq=0,state=[];
    await this.sqlite.execute(row=>{seq=Number(row[0]);state=JSON.parse(row[1]);},'SELECT seq,cloud_state FROM monika_sync WHERE account_id=@id',{'@id':id});
    const events=[];
    await this.sqlite.execute(row=>events.push(JSON.parse(row[0])),'SELECT payload FROM monika_events WHERE account_id=@id AND seq<=@seq ORDER BY seq',{'@id':id,'@seq':seq});
    const archive=this.archiveFactory(id,events);
    const avatarMetadata=new Map();
    await this.sqlite.execute(row=>avatarMetadata.set(row[0],JSON.parse(row[1])),'SELECT asset_key,payload FROM monika_avatar_metadata WHERE account_id=@id',{'@id':id});
    const cloud=this.cloudFactory(database,{accountId:id,worldName:location=>[...archive.visits.values()].find(v=>v.location.split(':')[0]===String(location).split(':')[0])?.worldName || String(location).split(':')[0],
      avatarName:image=>{const info=avatarMetadata.get(image);return info?{ownerId:info.ownerId || '',avatarName:info.name,fileCreatedAt:info.fileCreatedAt}:null;}});
    cloud.seed(state);
    const context={database,cloud,archive,seq,scoped,avatarMetadata};this.contexts.set(id,context);return context;
  }
  async cursor(id) {return (await this.account(id)).seq;}
  async ingest(id,batch,user) {
    const context=await this.account(id);
    if(user?.id && user.id!==id)throw new Error('数据库同步账号不匹配');
    if(user)await this.sqlite.executeNonQuery('INSERT OR REPLACE INTO monika_accounts(account_id,user_json) VALUES(@id,@user)',{'@id':id,'@user':JSON.stringify(user)});
    try {
      for(const item of batch){
        const {seq,event}=item;
        if(event.accountId!==id || !Number.isInteger(seq) || seq!==context.seq+1)throw new Error('数据库同步事件或游标不匹配');
        let existing;
        await this.sqlite.execute(row=>{existing=row[0];},'SELECT event_id FROM monika_events WHERE account_id=@id AND seq=@seq',{'@id':id,'@seq':seq});
        if(existing && existing!==event.id)throw new Error('检测到目标账号记录被替换，停止同步');
        await this.sqlite.executeNonQuery('INSERT OR IGNORE INTO monika_events(account_id,seq,event_id,visit_id,at,type,payload) VALUES(@id,@seq,@event,@visit,@at,@type,@payload)',
          {'@id':id,'@seq':seq,'@event':event.id,'@visit':event.visitId || null,'@at':event.at,'@type':event.type,'@payload':JSON.stringify(event)});
        await this.project(context,event);
        await context.scoped.flush();
        await this.sqlite.executeNonQuery('UPDATE monika_events SET projected=1 WHERE account_id=@id AND seq=@seq',{'@id':id,'@seq':seq});
        await this.sqlite.executeNonQuery('INSERT OR REPLACE INTO monika_sync(account_id,seq,cloud_state) VALUES(@id,@seq,@state)',{'@id':id,'@seq':seq,'@state':JSON.stringify(context.cloud.snapshot())});
        context.archive.reduce(event);context.seq=seq;
      }
    }catch(error){this.contexts.delete(id);throw error;}
  }
  async project(context,e) {
    const {database:db,archive}=context,created_at=new Date(e.at).toISOString();
    if(e.type==='cloud-user') {await context.cloud.observe(e.user,e.at,{skipLocationFeed:Boolean(e.buffered && e.user.id===e.accountId)});return;}
    if(e.type==='friend-log'){db.addFriendLogHistory({created_at,type:e.kind,userId:e.userId,displayName:e.displayName});return;}
    if(e.type==='avatar' && !e.baseline) {
      await db.addAvatarToDatabase({created_at,userId:e.userId,displayName:e.displayName,ownerId:'',avatarName:e.avatar.id || '模型图片变化（ID 未知）',
        currentAvatarImageUrl:e.avatar.image,currentAvatarThumbnailImageUrl:e.avatar.image,previousCurrentAvatarImageUrl:e.previous?.image || '',previousCurrentAvatarThumbnailImageUrl:e.previous?.image || ''});return;
    }
    if(e.type==='world') {
      const prefix=vrcxPrefix(e.accountId);
      await this.sqlite.executeNonQuery(`UPDATE ${prefix}_monika_gamelog_location SET world_name=@name WHERE world_id=@id`,{'@name':e.name,'@id':e.worldId});
      await this.sqlite.executeNonQuery(`UPDATE ${prefix}_feed_gps SET world_name=@name WHERE location LIKE @location`,{'@name':e.name,'@location':`${e.worldId}:%`});return;
    }
    if(e.type==='visit-start') {
      if(e.buffered)await db.addGPSToDatabase({created_at,userId:e.accountId,
        displayName:context.cloud.snapshot().find(x=>x.ref.id===e.accountId)?.ref.displayName || e.accountId,
        location:e.location,previousLocation:'',worldName:archive.worldNames.get(e.location.split(':')[0]) || e.worldName,time:0,groupName:''});
      await db.addGamelogJoinLeaveToDatabase({created_at,type:'OnPlayerJoined',displayName:context.cloud.snapshot().find(x=>x.ref.id===e.accountId)?.ref.displayName || e.accountId,
        location:e.location,userId:e.accountId,time:0});return;
    }
    const visit=archive.visits.get(e.visitId);
    if(!visit)return;
    if(e.type==='visit-resume') {
      if(visit.location!==e.location || visit.end!==e.previousEnd)throw new Error('续记活动与已保存记录不匹配');
      const previousEnd=new Date(e.previousEnd).toISOString();
      // Retract only this temporary end's projection; the original join/GPS and raw journal remain.
      await context.scoped.executeNonQuery('DELETE FROM gamelog_location WHERE created_at=@at AND location=@location AND time=@time',
        {'@at':previousEnd,'@location':visit.location,'@time':Math.max(0,e.previousEnd-visit.start)});
      for(const p of visit.final)await context.scoped.executeNonQuery('DELETE FROM gamelog_join_leave WHERE created_at=@at AND location=@location AND user_id=@user AND type=@type',
        {'@at':previousEnd,'@location':visit.location,'@user':p.id,'@type':'OnPlayerLeft'});
      return;
    }
    const join=async p=>db.addGamelogJoinLeaveToDatabase({created_at,type:'OnPlayerJoined',displayName:p.displayName,location:visit.location,userId:p.id,time:0});
    const leave=async p=>{
      const events=archive.detail(visit.id).events;
      const lastJoin=[...events].reverse().find(event=>event.type==='person-join' && event.person.id===p.id);
      const start=p.id===e.accountId?visit.start:lastJoin?.at || visit.initialAt || visit.start;
      await db.addGamelogJoinLeaveToDatabase({created_at,type:'OnPlayerLeft',displayName:p.displayName,location:visit.location,userId:p.id,time:Math.max(0,e.at-start)});
    };
    if(e.type==='snapshot'){for(const p of e.people)if(p.id!==e.accountId)await join(p);}
    if(e.type==='person-join')await join(e.person);
    if(e.type==='person-leave')await leave(e.person);
    if(e.type==='visit-end'){
      await db.addGamelogLocationToDatabase({created_at,location:visit.location,worldId:visit.location.split(':')[0],worldName:visit.worldName,time:Math.max(0,e.at-visit.start),groupName:''});
      for(const p of e.people)await leave(p);
    }
  }
  async history(id,options){return (await this.account(id)).archive.query(options);}
  avatarInfo(id,avatarId,image){const assets=this.contexts.get(id)?.avatarMetadata;return assets?.get(avatarId) || assets?.get(image) || null;}
  async saveAvatarMetadata(id,assets){
    const context=await this.account(id);
    for(const asset of assets){
      if(!asset || typeof asset.key!=='string' || typeof asset.name!=='string')throw new Error('模型名称响应无效');
      for(const key of new Set([asset.key,asset.id,asset.image].filter(Boolean))){
        await this.sqlite.executeNonQuery('INSERT OR REPLACE INTO monika_avatar_metadata(account_id,asset_key,payload) VALUES(@id,@key,@payload)',{'@id':id,'@key':key,'@payload':JSON.stringify(asset)});
        context.avatarMetadata.set(key,asset);
      }
    }
  }
  async saveSocial(id,snapshot){
    if(snapshot.accountId!==id)throw new Error('社交数据账号不匹配');
    const context=await this.account(id),db=context.database,previous=await this.social(id),merged={...snapshot};
    for(const key of ['friends','favorites','groups','moderations'])if(snapshot.errors?.[key] && previous?.[key])merged[key]=previous[key];
    if(snapshot.friendsComplete && previous?.updatedAt!==snapshot.updatedAt){
      const old=new Map((await db.getFriendLogCurrent()).map(user=>[user.userId,user]));
      const initialized=previous?.friendsInitialized || old.size>0,seen=new Set(),created_at=new Date(snapshot.updatedAt).toISOString();
      let number=Math.max(0,...[...old.values()].map(user=>Number(user.friendNumber) || 0));
      for(const user of snapshot.friends){
        const trustLevel=vrcxComputeTrustLevel(user.tags || [],user.developerType).trustLevel,prior=old.get(user.id);
        const displayName=isReliableDisplayName(user.displayName)?user.displayName:prior?.displayName ?? user.displayName;
        const entry={userId:user.id,displayName,trustLevel,friendNumber:prior?.friendNumber ?? ++number};seen.add(user.id);
        if(initialized && !prior)db.addFriendLogHistory({...entry,created_at,type:'Friend'});
        // A clean response repairs a damaged baseline without recording a fictional rename.
        if(prior && isReliableDisplayName(prior.displayName) && isReliableDisplayName(entry.displayName) && prior.displayName!==entry.displayName)db.addFriendLogHistory({...entry,created_at,type:'DisplayName',previousDisplayName:prior.displayName});
        if(prior && prior.trustLevel!==trustLevel)db.addFriendLogHistory({...entry,created_at,type:'TrustLevel',previousTrustLevel:prior.trustLevel});
        db.setFriendLogCurrent(entry);
      }
      if(initialized)for(const prior of old.values())if(!seen.has(prior.userId)){db.addFriendLogHistory({...prior,created_at,type:'Unfriend'});db.deleteFriendLogCurrent(prior.userId);}
      merged.friendsInitialized=true;await context.scoped.flush();
    }else merged.friendsInitialized=previous?.friendsInitialized || false;
    await this.sqlite.executeNonQuery('INSERT OR REPLACE INTO monika_social(account_id,payload) VALUES(@id,@payload)',{'@id':id,'@payload':JSON.stringify(merged)});
    return merged;
  }
  async social(id){
    await this.init();vrcxPrefix(id);let snapshot=null;
    await this.sqlite.execute(row=>{snapshot=JSON.parse(row[0]);},'SELECT payload FROM monika_social WHERE account_id=@id',{'@id':id});return snapshot;
  }
  async socialHistory(id){
    const {database:db,scoped}=await this.account(id);await scoped.flush();
    return (await db.getFriendLogHistory()).filter(row=>row.type!=='DisplayName' || isReliableDisplayName(row.displayName) && isReliableDisplayName(row.previousDisplayName));
  }
  async deleteSocialHistory(id,rowId){
    if(!Number.isInteger(rowId) || rowId<=0)throw new Error('无效的好友日志记录');
    await this.sqlite.executeNonQuery(`DELETE FROM ${vrcxPrefix(id)}_friend_log_history WHERE id=@row`,{'@row':rowId});
  }
  async socialFriends(id){
    const {database:db}=await this.account(id),snapshot=await this.social(id),friends=snapshot?.friends || [],current=new Map((await db.getFriendLogCurrent()).map(user=>[user.userId,user]));
    const stats=new Map((await db.getAllUserStats(friends.map(user=>user.id),friends.map(user=>user.displayName))).map(row=>[row.userId,row]));
    const memos=new Map();await this.sqlite.execute(row=>memos.set(row[0],row[1]),'SELECT user_id,memo FROM monika_user_memos WHERE account_id=@id',{'@id':id});
    const details=new Map();await this.sqlite.execute(row=>details.set(row[0],JSON.parse(row[1])),'SELECT user_id,payload FROM monika_social_users WHERE account_id=@id',{'@id':id});
    const profiles=new Map((await db.getAllUserProfiles()).map(profile=>[profile.userId,profile]));
    return friends.map(user=>({...details.get(user.id),...user,bio:profiles.get(user.id)?.bio ?? user.bio ?? '',bioLinks:profiles.get(user.id)?.bioLinks || user.bioLinks || [],
      friendNumber:current.get(user.id)?.friendNumber,stats:stats.get(user.id),memo:memos.get(user.id) || ''}));
  }
  async saveSocialUser(id,user){
    vrcxPrefix(user.id);const {database:db,scoped}=await this.account(id);
    let existing={};await this.sqlite.execute(row=>{existing=JSON.parse(row[0]);},'SELECT payload FROM monika_social_users WHERE account_id=@id AND user_id=@user',{'@id':id,'@user':user.id});
    await this.sqlite.executeNonQuery('INSERT OR REPLACE INTO monika_social_users(account_id,user_id,payload) VALUES(@id,@user,@payload)',{'@id':id,'@user':user.id,'@payload':JSON.stringify({...existing,...user,profileLoaded:true})});
    if(typeof user.bio==='string' || Array.isArray(user.bioLinks)){const previous=await db.getUserProfile(user.id);db.setUserProfile({id:user.id,bio:user.bio ?? previous?.bio ?? '',bioLinks:user.bioLinks ?? previous?.bioLinks ?? []});await scoped.flush();}
  }
  async saveUserMemo(id,userId,memo){
    vrcxPrefix(id);vrcxPrefix(userId);
    await this.sqlite.executeNonQuery('INSERT OR REPLACE INTO monika_user_memos(account_id,user_id,memo) VALUES(@id,@user,@memo)',{'@id':id,'@user':userId,'@memo':String(memo).slice(0,10000)});
  }
  async detail(id,visitId){const detail=(await this.account(id)).archive.detail(visitId);if(!detail)throw new Error('活动不存在');return detail;}
  async nativeFeed(id,options,{all=false}={}) {
    const {database:db,archive}=await this.account(id);
    const types=Array.isArray(options.nativeTypes)?options.nativeTypes:options.nativeType?[options.nativeType]:[];
    const rows=await db.searchFeedDatabase(options.search || '',types,options.selfOnly?[id]:[],20000,new Date(options.from).toISOString(),new Date(options.to).toISOString());
    const filtered=rows.filter(row=>new Date(row.created_at).getTime()>=options.from && new Date(row.created_at).getTime()<=options.to);
    const page=Math.max(1,Number(options.page) || 1),limit=100;
    return {events:(all?filtered:filtered.slice((page-1)*limit,page*limit)).map(row=>({id:`${row.type}-${row.rowId}`,at:new Date(row.created_at).getTime(),source:'vrcx-database',self:row.userId===id,...row,
      ...(row.location?{worldName:archive.worldNames.get(row.location.split(':')[0]) || row.worldName}:{})})),eventTotal:filtered.length,truncated:rows.length>=20000};
  }
  async export(id,options){const context=await this.account(id),query=context.archive.query(options),events=[],visits=[];
    for(let page=1;page<=Math.ceil(Math.max(query.eventTotal,query.visitTotal)/500);page++){const chunk=context.archive.query({...options,page,limit:500});events.push(...chunk.events);visits.push(...chunk.visits);}
    const nativeTypes=Array.isArray(options.nativeTypes)?options.nativeTypes:options.nativeType?[options.nativeType]:options.type==='avatar'?['Avatar']:[];
    const native=await this.nativeFeed(id,{...options,nativeTypes,page:1},{all:true});
    if(native.truncated)throw new Error('原生动态导出超过查询上限，请缩小日期范围');
    return {schemaVersion:2,accountId:id,exportedAt:new Date().toISOString(),storage:'VRCX SQLite',scope:'visible-friends',filters:options,stats:query.stats,visits,events,nativeFeed:native.events};
  }
}
