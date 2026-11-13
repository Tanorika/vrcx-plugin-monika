const CustomModule = globalThis.window?.customjs?.classes?.CustomModule || class {};

export function mergeCredential(existing, result, username = '') {
  const user = { ...existing?.user, ...result.user };
  user.username = result.user?.username || existing?.user?.username || username;
  return { ...existing, user, cookies: result.cookies,
    loginParams: { password: '', endpoint: '', websocket: '', ...existing?.loginParams,
      username: existing?.loginParams?.username || username || user.username } };
}

export class MonikaPlugin extends CustomModule {
  constructor() {
    super({ id: 'monika', name: 'Monika', description: '目标账号独立云端会话与活动记录',
      authors: [{name:'Monika'}], build:'0.1.22', tags:['Accounts','Activity','Charts'] });
    this.syncPromise = null; this.lastSyncedCookies = ''; this.autoAttemptAt = 0; this.loginBusy = false;
    this.visible = false; this.tickBusy = false;this.connectionPollBusy=false;
    this.databaseSync = null;this.lastState = null;this.statusVersion=0;this.statusPublishedVersion=0;
    this.primarySession = '';this.sessionGeneration = 0;this.settingsPromise = null;
    this.serviceConnected = false;
    this.nativeProgress=new Map();
    this.worldNameAttempts=new Map();this.worldNamePromise=null;this.worldDialogGeneration=0;this.nativeWorldCleanup=null;
    this.avatarNameAttempts=new Map();this.avatarNamePromise=null;this.avatarDialogGeneration=0;this.nativeAvatarCleanup=null;
  }
  async load() {
    this.actionButtons = [{title:'打开 Monika',color:'primary',icon:'ri-user-follow-line',callback:()=>this.show()}];
    this.loaded = true;
  }
  config() {
    const {token:obsoleteToken,...config}=this.get('connection',{port:39123,interval:60000,locationBufferMs:0,proxy:'',autoLogin:false,accountId:''});
    return config;
  }
  primaryId() { return window.$pinia?.user?.currentUser?.id || ''; }
  primarySessionId() {
    // VRCX retains currentUser after logout. A protected route is reached only after loginComplete.
    const auth = window.$pinia?.auth, hash = window.location?.hash || '';
    if (!auth || !/^#\/(?!login(?:[/?]|$)).+/.test(hash) || auth.loginForm?.loading ||
        auth.attemptingAutoLogin || auth.twoFactorAuthDialogVisible || auth.credentialsToSave) return '';
    return this.primaryId();
  }
  session() {
    const id = this.primarySessionId();
    if (id !== this.primarySession) {
      this.primarySession = id;this.sessionGeneration++;this.lastSyncedCookies = '';
    }
    return {id,generation:this.sessionGeneration};
  }
  requireSession(expected) {
    const current = this.session();
    if (!current.id || (expected && (expected.id !== current.id || expected.generation !== current.generation)))
      throw new Error('请先完成 VRCX 主账号登录；主账号会话变化时目标账号操作已取消');
    return current;
  }
  async updateServiceSettings(config = {}) {
    // Serialize settings so a delayed pre-logout request cannot restore an old primary identity.
    const operation = (this.settingsPromise || Promise.resolve()).catch(()=>{}).then(()=>this.api('/settings',{
      ...config,primaryId:this.session().id,interval:this.config().interval,locationBufferMs:this.config().locationBufferMs || 0
    }));
    this.settingsPromise = operation;
    try {await operation;} finally {if (this.settingsPromise === operation) this.settingsPromise = null;}
  }
  primaryName() { return window.$pinia?.user?.currentUser?.displayName || ''; }
  async openInstance(location) {
    this.requireSession();
    if (typeof location !== 'string' || !/^wrld_[a-zA-Z0-9-]+:[^\s]+$/.test(location)) throw new Error('此记录没有可加入的完整实例位置');
    const launch = window.$pinia?.launch;
    if (typeof launch?.showLaunchDialog !== 'function') throw new Error('当前 VRCX 未提供实例启动弹窗接口');
    await launch.showLaunchDialog(location);
  }
  worldName(accountId,location) {
    return this.database?.contexts.get(accountId)?.archive.worldNames.get(String(location).split(':')[0]) || '';
  }
  async openWorld(location,accountId) {
    const session=this.requireSession(),generation=++this.worldDialogGeneration;
    if(!/^wrld_[a-zA-Z0-9-]+(?::[^\s]+)?$/.test(location))throw new Error('无效的世界位置');
    const worldId=location.split(':')[0];
    const data=await this.api(`/worlds/${encodeURIComponent(worldId)}`,undefined,{accountId,...(location.includes(':')?{location}:{})});
    this.requireSession(session);
    if(generation!==this.worldDialogGeneration)return;
    if(data.accountId!==accountId || data.world?.id!==worldId)throw new Error('世界详情账号或身份不匹配');
    const archive=await this.database.refreshArchive(accountId);
    const visits=[...archive.visits.values()].filter(v=>v.location.split(':')[0]===worldId);
    const stats={visitCount:visits.length,lastVisit:visits.length?new Date(Math.max(...visits.map(v=>v.start))).toISOString():'',
      timeSpent:visits.reduce((sum,v)=>sum+Math.max(0,(v.end ?? v.lastSeen)-v.start),0)};
    this.requireSession(session);
    if(generation!==this.worldDialogGeneration)return;
    this.nativeWorldCleanup?.();
    this.nativeWorldCleanup=openVrcxWorldPage(window.$pinia,window.utils,data,location,stats);
    await this.syncDatabase(await this.api('/status'));
  }
  async api(path, data, params) {
    const statusRequest=['/status','/settings','/stop','/refresh'].includes(path)?++this.statusVersion:0;
    const config = this.config();
    const port = Number(config.port);
    if (!Number.isInteger(port) || port<1024 || port>65535) throw new Error('请设置有效的本地服务端口');
    const query = params ? `?${new URLSearchParams(Object.entries(params).map(([k,v])=>[k,String(v)]))}` : '';
    const options = { url:`http://127.0.0.1:${port}${path}${query}`,method:data===undefined?'GET':'POST',
      headers:{'Content-Type':'application/json'}, ...(data===undefined?{}:{body:JSON.stringify(data)}) };
    let response;
    try {
      // Local IPC must never use the main account's native HTTP client or cookie container.
      const result = await fetch(options.url,{method:options.method,headers:options.headers,body:options.body,
        credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(30000)});
      response={status:result.status,data:await result.text()};
    } catch { this.serviceConnected=false;this.view?.updateConnection();throw new Error(`无法连接 Monika 本地服务（端口 ${port}），请先运行 npm start`); }
    let result;
    try { result=typeof response.data==='string'?JSON.parse(response.data):response.data; } catch { this.serviceConnected=false;this.view?.updateConnection();throw new Error('本地服务返回了无效响应'); }
    this.serviceConnected=true;
    this.view?.renderConnection();
    if (response.status<200 || response.status>=300) { const error=new Error(result.error || `本地服务错误 ${response.status}`); error.status=response.status; throw error; }
    if(statusRequest>=this.statusPublishedVersion && statusRequest && Array.isArray(result.accounts) && typeof result.recording==='boolean'){
      this.statusPublishedVersion=statusRequest;this.lastState=result;this.view?.updateConnection(result);
    }
    return result;
  }
  async start() {
    if (this.started) return;
    const navigation = window.customjs.api?.navigation;
    if (!window.customjs.importLocalPlugin || !navigation ||
        !['addItem','removeItem','updateContentVisibility'].every(key=>typeof navigation[key]==='function'))
      throw new Error('请先安装 vrcx-plugin-system-fixed 框架，再从插件管理导入 monika.js');
    if(!window.sqliteService && !window.SQLite)throw new Error('需要 VRCX 原生 SQLite 接口');
    this.set('connection',this.config());
    this.database = new MonikaDatabase(window.sqliteService || window.SQLite,{data:new MonikaRemoteData((...args)=>this.api(...args))});
    await this.database.init();
    this.view = new MonikaView(this);
    navigation.addItem('monika',{label:'Monika',icon:'ri-user-follow-line',content:this.view.root,
      onShow:()=>{this.visible=true; void this.view.refresh();},onHide:()=>{this.visible=false;this.view?.socialView?.native?.close();}});
    this.started=true;
    const sessionChanged = () => {
      const generation = this.sessionGeneration;this.session();
      if (generation !== this.sessionGeneration) void this.updateServiceSettings().catch(()=>{});
      void this.tick();
    };
    for (const store of [window.$pinia?.user,window.$pinia?.auth])
      if (store?.$subscribe) this.registerSubscription(store.$subscribe(sessionChanged,{detached:true,flush:'sync'}));
    window.addEventListener('hashchange',sessionChanged);
    this.registerSubscription(()=>window.removeEventListener('hashchange',sessionChanged));
    const hideChartTooltip=()=>this.view?.hideTooltip();
    window.addEventListener('scroll',hideChartTooltip,true);
    this.registerSubscription(()=>window.removeEventListener('scroll',hideChartTooltip,true));
    this.registerTimer(setInterval(()=>void this.tick(),15000));
    this.registerTimer(setInterval(()=>void this.pollConnection(),3000));
    await this.tick();
  }
  show() {
    window.customjs.api.navigation.updateContentVisibility('monika');
  }
  async savedAccounts() {
    if (!window.configRepository) throw new Error('当前 VRCX 未提供 credentials 配置接口');
    const text=await window.configRepository.getString('savedCredentials','{}');
    const credentials=JSON.parse(text);
    if (!credentials || typeof credentials!=='object' || Array.isArray(credentials)) throw new Error('VRCX credentials 配置格式无效');
    return credentials;
  }
  async status() {
    await this.updateServiceSettings();
    const state=await this.api('/status');return this.lastState || state;
  }
  async syncDatabase(state=this.lastState) {
    if(this.databaseSync)return this.databaseSync;
    if(!state || !this.database)return;
    const session=this.session();if(!session.id)return;
    this.databaseSync=(async()=>{
      for(const user of state.accounts || []){
        this.requireSession(session);if(user.id===session.id)continue;
        let progress=this.nativeProgress.get(user.id) || {after:0,streamId:''};
        for(let round=0;round<10;round++){
          const batch=await this.api('/native-sync',undefined,{accountId:user.id,...progress});
          this.requireSession(session);
          if(batch.accountId!==user.id || typeof batch.streamId!=='string' || !Array.isArray(batch.records) ||
            !Number.isInteger(batch.after) || batch.after<0 || !Number.isInteger(batch.total) ||
            batch.after+batch.records.length>batch.total || batch.records.some((record,index)=>record.seq!==batch.after+index+1))throw new Error('原生记录响应账号或格式不匹配');
          await this.database.ingestNative(user.id,batch.records);
          this.requireSession(session);
          progress={streamId:batch.streamId,after:batch.after+batch.records.length};
          if(batch.records.length)await this.api('/native-ack',{accountId:user.id,...progress});
          this.nativeProgress.set(user.id,progress);
          if(!batch.hasMore)break;
        }
      }
    })();
    try{await this.databaseSync;}finally{this.databaseSync=null;}
  }
  async history(accountId,options) {const result=await this.database.history(accountId,options);this.queueAvatarNames(accountId,result.events,result.visits);return result;}
  async nativeHistory(accountId,options){
    const result=await this.database.nativeFeed(accountId,options);
    this.queueWorldNames(accountId,result.events);this.queueAvatarNames(accountId,result.events);return result;
  }
  queueWorldNames(accountId,events) {
    if(this.worldNamePromise || !this.lastState?.recording || this.lastState.user?.id!==accountId)return;
    const ids=[...new Set(events.flatMap(e=>[e.location,e.previousLocation]).filter(v=>/^wrld_[a-zA-Z0-9-]+:/.test(v || '')).map(v=>v.split(':')[0]))]
      .filter(id=>!this.worldName(accountId,id) && Date.now()>(this.worldNameAttempts.get(`${accountId}:${id}`) || 0)).slice(0,5);
    if(!ids.length)return;
    for(const id of ids)this.worldNameAttempts.set(`${accountId}:${id}`,Date.now()+300000);
    const session=this.session();
    this.worldNamePromise=(async()=>{
      const result=await this.api('/worlds/resolve',{accountId,worldIds:ids});this.requireSession(session);
      if(result.accountId!==accountId || !Object.keys(result.names || {}).length)return;
      await this.syncDatabase(await this.api('/status'));
      await this.database.refreshArchive(accountId);
      if(this.visible && this.view?.tab==='native' && this.view.accountId===accountId)await this.view.refresh({localOnly:true});
    })().catch(()=>{}).finally(()=>{
      this.worldNamePromise=null;
      if(this.visible && this.view?.tab==='native' && this.view.accountId===accountId)this.queueWorldNames(accountId,events);
    });
  }
  async detail(accountId,id) {const result=await this.database.detail(accountId,id);this.queueAvatarNames(accountId,result.events,[result.visit]);return result;}
  avatarInfo(accountId,id,image){return this.database?.avatarInfo(accountId,id,image);}
  queueAvatarNames(accountId,events=[],visits=[]){
    if(this.avatarNamePromise || !this.lastState?.recording || this.lastState.user?.id!==accountId)return;
    const refs=events.flatMap(event=>event.type==='Avatar'?[{id:/^avtr_/.test(event.avatarName)?event.avatarName:'',image:event.currentAvatarImageUrl || event.currentAvatarThumbnailImageUrl},{image:event.previousCurrentAvatarImageUrl || event.previousCurrentAvatarThumbnailImageUrl}]:[event.avatar,event.previous])
      .concat(visits.flatMap(visit=>[...(visit.initial || []),...(visit.final || [])].map(person=>person.avatar))).filter(Boolean);
    const avatars=[...new Map(refs.filter(ref=>ref.id || /^https:\/\//.test(ref.image || '')).map(ref=>[ref.id || ref.image,ref])).values()]
      .filter(ref=>{const info=this.avatarInfo(accountId,ref.id,ref.image);return (!info || (ref.id && !info.id)) && Date.now()>(this.avatarNameAttempts.get(`${accountId}:${ref.id || ref.image}`) || 0);}).slice(0,8);
    if(!avatars.length)return;
    for(const ref of avatars)this.avatarNameAttempts.set(`${accountId}:${ref.id || ref.image}`,Date.now()+300000);
    const session=this.session();
    this.avatarNamePromise=(async()=>{
      const result=await this.api('/avatars/resolve',{accountId,avatars});this.requireSession(session);
      if(result.accountId!==accountId)throw new Error('模型名称账号不匹配');
      await this.database.saveAvatarMetadata(accountId,result.assets || []);
      if(this.visible && this.view?.accountId===accountId && this.view.tab!=='settings')this.view.render();
    })().catch(()=>{}).finally(()=>{this.avatarNamePromise=null;if(this.visible && this.view?.accountId===accountId)this.queueAvatarNames(accountId,events,visits);});
  }
  async openAvatar(id,accountId){
    const session=this.requireSession(),generation=++this.avatarDialogGeneration;
    const data=await this.api(`/avatars/${encodeURIComponent(id)}`,undefined,{accountId});this.requireSession(session);
    if(generation!==this.avatarDialogGeneration)return;
    if(data.accountId!==accountId || data.avatar?.id!==id)throw new Error('模型详情账号或身份不匹配');
    this.nativeAvatarCleanup?.();this.nativeAvatarCleanup=openVrcxAvatarPage(window.$pinia,data);
  }
  async social(accountId,{force=false}={}){
    const session=this.requireSession();
    try{const snapshot=await this.api('/social',undefined,{accountId,force});this.requireSession(session);await this.database.saveSocial(accountId,snapshot);}
    catch(error){this.requireSession(session);if(!await this.database.social(accountId))throw error;}
    this.requireSession(session);
    return {...await this.database.social(accountId),friends:await this.database.socialFriends(accountId),history:await this.database.socialHistory(accountId)};
  }
  async socialAction(accountId,action,data){
    throw new Error('Monika 社交为只读模式，不能修改好友、收藏或屏蔽记录');
  }
  async socialUser(accountId,id,options={}){
    const session=this.requireSession();const result=await this.api(`/social/users/${encodeURIComponent(id)}`,undefined,{accountId,...options});this.requireSession(session);
    if(result.accountId!==accountId || result.user?.id!==id)throw new Error('用户详情账号不匹配');await this.database.saveSocialUser(accountId,result.user);return result.user;
  }
  async nativeQuery(accountId,kind,params){
    if(!['profile','currentUser','mutualFriends','mutuals','userGroups','favoriteGroups','favoriteWorlds','worldsByUser','avatarsByUser','world','group','instance','worldContext'].includes(kind))throw new Error('Monika 社交为只读模式');
    const session=this.requireSession();const result=await this.api('/social/native',{accountId,kind,params});this.requireSession(session);
    if(result.accountId!==accountId)throw new Error('社交请求账号不匹配');return result.data;
  }
  async nativeActivity(accountId,userId){
    const session=this.requireSession(),archive=await this.database.refreshArchive(accountId),now=Date.now();
    const data=await this.database.nativeFeed(accountId,{from:0,to:now,nativeTypes:['Online','Offline'],search:'',page:1},{all:true});this.requireSession(session);
    const events=data.events.filter(e=>e.userId===userId).sort((a,b)=>a.at-b.at);
    const friendSessions=[];let start=null;for(const e of events){if(e.type==='Online'){if(start===null)start=e.at;}else if(e.type==='Offline' && start!==null){friendSessions.push({start,end:e.at});start=null;}}if(start!==null)friendSessions.push({start,end:now});
    const worldVisits=[...archive.visits.values()];return {friendSessions,selfSessions:worldVisits.map(v=>({start:v.start,end:v.end ?? v.lastSeen})),worldVisits};
  }
  async confirm(options){const modal=window.$pinia?.modal;if(!modal?.confirm)throw new Error('当前 VRCX 未提供确认窗口');return (await modal.confirm(options)).ok;}
  async prompt(options){const modal=window.$pinia?.modal;if(!modal?.prompt)throw new Error('当前 VRCX 未提供输入窗口');const result=await modal.prompt(options);return result.ok?result.value:null;}
  async storedAccounts(){return Object.values(await this.savedAccounts()).map(saved=>saved.user).filter(user=>user?.id && user.id!==this.primaryId());}
  async saveConfig(config) {
    if (!this.set('connection',{...this.config(),...config})) throw new Error('无法保存 Monika 设置');
    await this.updateServiceSettings({proxy:config.proxy});
    this.autoAttemptAt=0;
  }
  async loginSaved(id) {
    if (this.loginBusy) throw new Error('目标账号正在登录');
    const session = this.requireSession();
    if (!id || id===session.id) throw new Error('请选择与主账号不同的目标账号');
    this.loginBusy=true;
    try {
      const saved=(await this.savedAccounts())[id];
      if (!saved?.user) throw new Error('VRCX 中未找到该账号');
      this.requireSession(session);
      const options={expectedId:id,cookies:saved.cookies,endpoint:saved.loginParams?.endpoint || '',primaryId:session.id,
        interval:this.config().interval,proxy:this.config().proxy,locationBufferMs:this.config().locationBufferMs || 0};
      let result;
      try { result=await this.api('/login',options); }
      catch (e) {
        if (e.status!==401 || !saved.loginParams?.password) throw e;
        let password=saved.loginParams.password;
        if (window.$pinia?.advancedSettings?.enablePrimaryPassword) {
          if (!window.$pinia.auth?.checkPrimaryPassword) throw new Error('请在“添加账号 / 重新登录”中手动输入密码');
          password=await window.$pinia.auth.checkPrimaryPassword(saved.loginParams);
        }
        this.requireSession(session);
        result=await this.api('/login',{...options,username:saved.loginParams.username,password});
      }
      this.requireSession(session);this.pendingSession = session;
      this.set('connection',{...this.config(),accountId:id});
      if (result.user) {await this.status();await this.syncCredentials(result,'',session);}
      return result;
    } finally {this.loginBusy=false;}
  }
  async loginNew(username,password) {
    if (this.loginBusy) throw new Error('目标账号正在登录');
    const session = this.requireSession();this.loginBusy = true;
    try {
      const result=await this.api('/login',{username,password,primaryId:session.id,interval:this.config().interval,proxy:this.config().proxy,locationBufferMs:this.config().locationBufferMs || 0});
      this.requireSession(session);
      if (result.user) {await this.status();await this.syncCredentials(result,username,session);this.set('connection',{...this.config(),accountId:result.user.id});}
      this.pendingUsername=username;this.pendingSession=session;
      return result;
    } finally {this.loginBusy=false;}
  }
  async verify(type,code) {
    if (this.loginBusy) throw new Error('目标账号正在登录');
    const session = this.requireSession(this.pendingSession);this.loginBusy=true;
    try {
      const result=await this.api('/verify',{type,code});this.requireSession(session);
      if (result.user) {await this.status();await this.syncCredentials(result,this.pendingUsername || '',session);this.set('connection',{...this.config(),accountId:result.user.id});this.pendingUsername='';this.pendingSession=null;}
      return result;
    } finally {this.loginBusy=false;}
  }
  async syncCredentials(result,username='',session=this.requireSession()) {
    const operation=(this.syncPromise || Promise.resolve()).catch(()=>{}).then(async()=>{
      if (!result.user?.id || result.user.id===session.id) throw new Error('拒绝将主账号会话写入目标账号记录');
      if (typeof result.cookies !== 'string' || !result.cookies) throw new Error('目标账号没有有效的会话凭据');
      // Compare-and-swap one config row: preserve a native credentials write that happened during our read.
      for (let attempt=0;attempt<5;attempt++) {
        this.requireSession(session);
        const previous=await window.configRepository.getString('savedCredentials',null);
        const saved=JSON.parse(previous ?? '{}');
        if (!saved || typeof saved!=='object' || Array.isArray(saved)) throw new Error('VRCX credentials 配置格式无效');
        saved[result.user.id]=mergeCredential(saved[result.user.id],result,username || result.user.username);
        this.requireSession(session);
        let written=false;
        const sql=previous===null
          ? 'INSERT OR IGNORE INTO configs (key,value) VALUES (@key,@value) RETURNING key'
          : 'UPDATE configs SET value=@value WHERE key=@key AND value=@previous RETURNING key';
        await this.database.sqlite.execute(()=>{written=true;},sql,{
          '@key':'config:savedcredentials','@value':JSON.stringify(saved),...(previous===null?{}:{'@previous':previous})
        });
        if (written) {this.lastSyncedCookies=result.cookies;return;}
      }
      throw new Error('VRCX 正在更新账号凭据，请稍后重试');
    });
    this.syncPromise=operation;
    try {await operation;} finally {if(this.syncPromise===operation)this.syncPromise=null;}
  }
  async tick() {
    if (!this.started || this.tickBusy || this.loginBusy) return;
    this.tickBusy=true;
    try {
      const session=this.session();
      if (!session.id) {await this.updateServiceSettings();return;}
      const state=await this.status();
      this.requireSession(session);
      await this.syncDatabase(state);
      this.requireSession(session);
      if (state.recording) {
        const credentials=await this.api('/credentials');
        if (credentials.cookies!==this.lastSyncedCookies) await this.syncCredentials(credentials,'',session);
      } else if (this.config().autoLogin && this.config().accountId && !state.pending2FA.length && this.primaryId() && Date.now()-this.autoAttemptAt>60000) {
        this.autoAttemptAt=Date.now();await this.loginSaved(this.config().accountId);
      }
      if (this.visible) await this.view.refresh();
    } catch (e) {if (this.visible) {this.view.error=errorText(e);this.view.render();}}
    finally {this.tickBusy=false;}
  }
  async pollConnection() {
    if(!this.started || this.connectionPollBusy || this.loginBusy)return;
    this.connectionPollBusy=true;
    try{const previous=this.view?.accountId;await this.api('/status');if(this.visible && previous!==this.view?.accountId)await this.view.refresh();}catch{/* The API publishes a disconnected badge; history stays available. */}
    finally{this.connectionPollBusy=false;}
  }
  refreshCloud() {return this.api('/refresh',{});}
  async stopRecording() {this.set('connection',{...this.config(),autoLogin:false});await this.api('/stop',{});}
  async export(accountId,options) {
    const data=await this.database.export(accountId,options);
    const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob), link=document.createElement('a');link.href=url;link.download=`Monika-${accountId}-${localDate()}.json`;
    document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async stop() {
    this.started=false;
    this.worldDialogGeneration++;this.nativeWorldCleanup?.();this.nativeWorldCleanup=null;
    this.avatarDialogGeneration++;this.nativeAvatarCleanup?.();this.nativeAvatarCleanup=null;
    this.sessionGeneration++;
    try {await this.api('/stop',{});await this.syncDatabase(await this.api('/status'));} catch {/* Stopping still removes all UI and listeners while the service is unavailable. */}
    const navigation=window.customjs.api?.navigation;
    navigation?.removeItem('monika');
    this.view?.socialView?.dispose();this.view?.root.remove();this.view=null;this.visible=false;
    await super.stop();
  }
}
