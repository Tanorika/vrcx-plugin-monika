export function isReliableDisplayName(name) {
  return typeof name==='string' && name.trim().length>0 && !name.includes('\uFFFD') && name.isWellFormed();
}
export function vrcxPrefix(id) {
  if(!/^usr_[a-zA-Z0-9-]+$/.test(id))throw new Error('无效的目标账号 ID');
  return id.replaceAll('-','').replaceAll('_','');
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
  constructor(sqlite,{databaseFactory,data}={}) {
    this.sqlite=adaptSQLite(sqlite);
    this.databaseFactory=databaseFactory || createVrcxAccountDatabase;
    this.data=data;this.contexts=new Map();this.accountInitializations=new Map();
    this.socialSnapshots=new Map();this.socialUsers=new Map();
  }
  async init() {} // VRCX owns its native schema; Monika creates no extension tables here.
  async accounts() {return this.data.accounts();}
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
    const scoped={execute:(callback,sql,args)=>enqueue(()=>this.sqlite.execute(callback,sql,normalize(args))),
      executeNonQuery:(sql,args)=>enqueue(()=>this.sqlite.executeNonQuery(retrySafeInsert(sql),normalize(args)),true),
      executeInsert:(sql,args)=>enqueue(()=>this.sqlite.executeInsert(retrySafeInsert(sql),normalize(args)),true),
      flush:async()=>{await pending;if(writeFailure)throw writeFailure.error;}};
    const database=this.databaseFactory(scoped,id);await database.initUserTables(id);
    await this.migrateFeedBioLinks(id,scoped);await scoped.flush();
    const avatarMetadata=new Map(Object.entries(await this.data.read(id,'avatar-metadata').catch(()=>({})) || {}));
    const context={database,scoped,avatarMetadata,archive:{visits:new Map(),worldNames:new Map()}};
    this.contexts.set(id,context);return context;
  }
  async refreshArchive(id) {
    const context=await this.account(id),snapshot=await this.data.context(id);
    if(snapshot.accountId!==id)throw new Error('扩展活动账号不匹配');
    context.archive={visits:new Map(snapshot.visits.map(visit=>[visit.id,visit])),worldNames:new Map(snapshot.worldNames)};
    return context.archive;
  }
  async ingestNative(id,records) {
    const context=await this.account(id),db=context.database;
    const methods={GPS:'addGPSToDatabase',Status:'addStatusToDatabase',Bio:'addBioToDatabase',Avatar:'addAvatarToDatabase',Presence:'addOnlineOfflineToDatabase','friend-log':'addFriendLogHistory'};
    try{
      for(const {kind,entry} of records){
        if(kind==='profile'){vrcxPrefix(entry.id);db.setUserProfile(entry);}
        else if(methods[kind]){vrcxPrefix(entry.userId);await db[methods[kind]](entry);}
        else throw new Error('无效的原生记录类型');
        await context.scoped.flush();
      }
    }catch(error){this.contexts.delete(id);throw error;}
  }
  async history(id,options){return this.data.history(id,options);}
  avatarInfo(id,avatarId,image){const assets=this.contexts.get(id)?.avatarMetadata;return assets?.get(avatarId) || assets?.get(image) || null;}
  async saveAvatarMetadata(id,assets){
    const context=await this.account(id);
    for(const asset of assets){
      if(!asset || typeof asset.key!=='string' || typeof asset.name!=='string')throw new Error('模型名称响应无效');
      for(const key of new Set([asset.key,asset.id,asset.image].filter(Boolean))){
        await this.data.write(id,'avatar-metadata',key,asset);
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
    // Full API responses mirror VRCX's in-memory user/favorite stores.
    // Persist only VRCX's native friend logs/profiles and Monika's derived data.
    this.socialSnapshots.set(id,merged);
    return merged;
  }
  async social(id){vrcxPrefix(id);return this.socialSnapshots.get(id) || null;}
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
    const stats=new Map((await this.data.stats(id).catch(()=>[])).map(row=>[row.userId,row]));
    const memos=new Map(Object.entries(await this.data.read(id,'memos').catch(()=>({}))));
    const details=this.socialUsers.get(id) || new Map();
    const profiles=new Map((await db.getAllUserProfiles()).map(profile=>[profile.userId,profile]));
    return friends.map(user=>({...details.get(user.id),...user,bio:profiles.get(user.id)?.bio ?? user.bio ?? '',bioLinks:profiles.get(user.id)?.bioLinks || user.bioLinks || [],
      friendNumber:current.get(user.id)?.friendNumber,stats:stats.get(user.id),memo:memos.get(user.id) || ''}));
  }
  async saveSocialUser(id,user){
    vrcxPrefix(user.id);const {database:db,scoped}=await this.account(id);
    if(!this.socialUsers.has(id))this.socialUsers.set(id,new Map());
    const users=this.socialUsers.get(id),existing=users.get(user.id) || {};
    users.set(user.id,{...existing,...user,profileLoaded:true});
    if(typeof user.bio==='string' || Array.isArray(user.bioLinks)){const previous=await db.getUserProfile(user.id);db.setUserProfile({id:user.id,bio:user.bio ?? previous?.bio ?? '',bioLinks:user.bioLinks ?? previous?.bioLinks ?? []});await scoped.flush();}
  }
  async saveUserMemo(id,userId,memo){
    vrcxPrefix(id);vrcxPrefix(userId);
    await this.data.write(id,'memos',userId,String(memo).slice(0,10000));
  }
  async detail(id,visitId){return this.data.detail(id,visitId);}
  async nativeFeed(id,options,{all=false}={}) {
    const context=await this.account(id),db=context.database;
    try{await this.refreshArchive(id);}catch{/* Native history remains available while the service is stopped. */}
    const archive=context.archive;
    const types=Array.isArray(options.nativeTypes)?options.nativeTypes:options.nativeType?[options.nativeType]:[];
    const rows=await db.searchFeedDatabase(options.search || '',types,options.selfOnly?[id]:[],20000,new Date(options.from).toISOString(),new Date(options.to).toISOString());
    const filtered=rows.filter(row=>new Date(row.created_at).getTime()>=options.from && new Date(row.created_at).getTime()<=options.to);
    const page=Math.max(1,Number(options.page) || 1),limit=100;
    return {events:(all?filtered:filtered.slice((page-1)*limit,page*limit)).map(row=>({id:`${row.type}-${row.rowId}`,at:new Date(row.created_at).getTime(),source:'vrcx-database',self:row.userId===id,...row,
      ...(row.location?{worldName:archive.worldNames.get(row.location.split(':')[0]) || row.worldName}:{})})),eventTotal:filtered.length,truncated:rows.length>=20000};
  }
  async export(id,options){
    const query=await this.data.export(id,options);
    const nativeTypes=Array.isArray(options.nativeTypes)?options.nativeTypes:options.nativeType?[options.nativeType]:options.type==='avatar'?['Avatar']:[];
    const native=await this.nativeFeed(id,{...options,nativeTypes,page:1},{all:true});
    if(native.truncated)throw new Error('原生动态导出超过查询上限，请缩小日期范围');
    return {...query,schemaVersion:3,storage:{native:'VRCX SQLite',derived:'Monika data/'},nativeFeed:native.events};
  }
}
