import { version } from './version.mjs';
import { Recorder, realLocation } from './recorder.mjs';
import { VRChatClient, ApiError } from './vrchat.mjs';
import { connectPipeline } from './pipeline.mjs';
import { accountKey } from './storage.mjs';
import { vrcxParseLocation } from '../src/vendor-vrcx.mjs';
import { resolveAvatarMetadata,avatarDetails,socialSnapshot,socialUserDetails,socialAction,nativeSocialQuery } from './entities.mjs';

function profile(user) {
  return { id: user.id, displayName: user.displayName || user.id, username: user.username || '',
    currentAvatar: user.currentAvatar || '', currentAvatarImageUrl: user.currentAvatarImageUrl || '',
    status: user.status || '', statusDescription: user.statusDescription || '', state:user.state || '', location: user.location || '' };
}

function worldUserProfile(user,extra={}) {
  // Only public display fields enter the native dialog, including for authenticated self profiles.
  const keys=['id','displayName','status','statusDescription','state','location','currentAvatarImageUrl','currentAvatarThumbnailImageUrl','iconUrl','userIcon','profilePicOverride','thumbnailUrl','iconFrame','isFriend'];
  const ref=Object.fromEntries(keys.filter(key=>Object.hasOwn(user,key)).map(key=>[key,user[key]]));
  ref.iconUrl ||= ref.userIcon || ref.profilePicOverride || '';
  return {...ref,...extra};
}

// Authenticated-user responses contain a legacy location field; VRCX uses presence instead.
export function currentUserObservation(user, { allowLegacyLocation = true } = {}) {
  const observation = { ...user };
  delete observation.presence;
  delete observation.location;
  const presence = user.presence;
  if (presence && typeof presence.world === 'string') {
    if (presence.world.startsWith('wrld_')) {
      const location = `${presence.world}:${presence.instance || ''}`;
      if (realLocation(location)) observation.location = location;
    } else observation.location = presence.world;
  } else if (allowLegacyLocation && typeof user.location === 'string') observation.location = user.location;
  return observation;
}

export function instancePopulation(data,location) {
  if (!data || typeof data!=='object' || !realLocation(location)) throw new Error('无效的实例人数响应');
  const separator=location.indexOf(':'),worldId=location.slice(0,separator),instanceId=location.slice(separator+1);
  if ((data.worldId && data.worldId!==worldId) || (data.instanceId && data.instanceId!==instanceId) ||
      (typeof data.id==='string' && data.id.startsWith('wrld_') && data.id!==location)) throw new Error('实例人数响应与请求位置不匹配');
  const total=[data.userCount,data.n_users].find(value=>Number.isInteger(value) && value>=0);
  if (total===undefined) throw new Error('实例 API 未提供总人数');
  return {total,capacity:Number.isInteger(data.capacity) && data.capacity>=0?data.capacity:null};
}

export class MonikaService {
  constructor(storage, { clientFactory = options => new VRChatClient(options), pipelineFactory = connectPipeline } = {}) {
    this.storage = storage;
    this.clientFactory = clientFactory;
    this.pipelineFactory = pipelineFactory;
    this.profiles = storage.read('sessions.json', {});
    this.recorders = new Map();
    this.active = null; this.pending = null; this.generation = 0; this.authBusy = false;
    this.primaryId = ''; this.proxy = ''; this.interval = 60000; this.locationBufferMs = 0; this.timer = null; this.pollPromise = null;
    this.lastError = ''; this.lastRosterAt = null; this.connected = false; this.retryAt = 0;
    this.pipelineVersion = 0; this.selfVersion = 0; this.backoff = 0;
    this.worldRequests = new Map(); this.rosterReady = false; this.lastLocationSignalAt = 0;
    this.worldCache=new Map();this.worldNameRetryAt=new Map();
    this.worldUserCache=new Map();this.worldUserRequests=new Map();this.worldUserRetryAt=new Map();
    this.countAttempts=new Map();
  }
  effectiveLocationBuffer() { return Math.max(this.interval, this.locationBufferMs || this.interval * 2); }
  recorder(id) {
    id = accountKey(id);
    if (!this.recorders.has(id)) {
      const { replay, append } = this.storage.journal(id);
      this.recorders.set(id, new Recorder(id, append, replay, {locationBufferMs:this.effectiveLocationBuffer()}));
    }
    return this.recorders.get(id);
  }
  status() {
    const r = this.active ? this.recorder(this.active.user.id) : null;
    return { user: this.active ? profile(this.active.user) : null, pending2FA: this.pending?.methods || [],
      connected: this.connected, recording: Boolean(this.active), lastSeen: r?.lastSeen || null,
      lastRosterAt: this.lastRosterAt, lastError: this.lastError, retryAt: this.retryAt, interval: this.interval,
      location: r?.current?.location || '', gap: r?.gap || false, locationBufferMs:this.effectiveLocationBuffer(),
      locations: [...(r?.activeVisits.values() || [])].map(v=>({location:v.location,worldName:v.worldName,lastSeen:v.locationSeen,visitId:v.id,
        population:v.population.at(-1) || null})),
      accounts: Object.values(this.profiles).map(p => profile(p.user)), scope: 'visible-friends', version };
  }
  settings({ primaryId = this.primaryId, interval = this.interval, proxy = this.proxy, locationBufferMs = this.locationBufferMs } = {}) {
    if (primaryId) accountKey(primaryId);
    const previousPrimaryId = this.primaryId;
    this.primaryId = primaryId;
    this.interval = Math.max(30000, Math.min(600000, Number(interval) || 60000));
    this.proxy = proxy;
    this.locationBufferMs = Math.max(0, Math.min(1800000, Number(locationBufferMs) || 0));
    for (const recorder of this.recorders.values()) recorder.locationBufferMs = this.effectiveLocationBuffer();
    if((!primaryId || primaryId!==previousPrimaryId) && (this.active || this.pending || this.authBusy)){
      this.stop(primaryId ? 'primary-session-change' : 'primary-logout');return;
    }
    if (this.active?.user.id === primaryId) { this.stop('became-primary'); this.lastError = '目标账号已成为 VRCX 主账号，记录已停止'; }
  }
  async login(options) {
    if (this.authBusy) throw new ApiError(409, '登录正在进行');
    this.settings(options);
    this.authBusy = true;
    this.stop('account-switch');
    const generation = this.generation;
    let client;
    try {
      if (!this.primaryId) throw new Error('请先登录 VRCX 主账号');
      if (options.expectedId === this.primaryId) throw new Error('请选择与主账号不同的目标账号');
      const stored = options.expectedId ? this.profiles[options.expectedId] : null;
      client = this.clientFactory({ cookies: options.cookies || stored?.cookies, endpoint: options.endpoint, proxy: this.proxy });
      const user = await client.login(options);
      if (generation !== this.generation) throw new Error('登录已取消');
      if (user.requiresTwoFactorAuth) {
        this.pending = { client, expectedId: options.expectedId, methods: user.requiresTwoFactorAuth, generation };
        return { requiresTwoFactorAuth: user.requiresTwoFactorAuth };
      }
      return this.activate(client, user, options.expectedId);
    } catch (error) { client?.close(); this.lastError = error.message; throw error; }
    finally { this.authBusy = false; }
  }
  async verify(type, code) {
    if (!this.pending) throw new Error('没有待完成的二步验证');
    if(!this.primaryId)throw new Error('请先登录 VRCX 主账号');
    if (this.authBusy) throw new ApiError(409, '验证正在进行');
    this.authBusy = true;
    const pending = this.pending;
    try {
      if (!pending.methods.includes(type) && type !== 'otp') throw new Error('不支持的二步验证方式');
      const user = await pending.client.verify(type, code);
      if (pending.generation !== this.generation) throw new Error('验证已取消');
      const result = this.activate(pending.client, user, pending.expectedId);
      this.pending = null;
      return result;
    } finally { this.authBusy = false; }
  }
  activate(client, user, expectedId) {
    try {
      accountKey(user.id);
      if (user.id === this.primaryId || (expectedId && expectedId !== user.id))
        throw new Error('登录账号与所选目标账号不一致，或与主账号相同');
    } catch (error) {
      client.close();
      if (this.pending?.client === client) this.pending = null;
      throw error;
    }
    this.pending = null;
    const initialLocationSource = user.presence ? 'auth-presence' : 'legacy-api';
    user = currentUserObservation(user);
    this.active = { client, user };
    this.lastLocationSignalAt = 0;
    this.lastError = ''; this.backoff = 0; this.retryAt = 0; this.rosterReady = false;
    this.persistSession();
    this.recorder(user.id).observeSelf(user, Date.now(), 'cloud-poll', initialLocationSource);
    void this.poll();
    return this.credentials();
  }
  persistSession() {
    if (!this.active) return;
    this.profiles[this.active.user.id] = { user: profile(this.active.user), cookies: this.active.client.exportCookies() };
    this.storage.write('sessions.json', this.profiles);
  }
  credentials() {
    if (!this.active) throw new Error('目标账号未登录');
    return { user: profile(this.active.user), cookies: this.active.client.exportCookies() };
  }
  async poll() {
    if (!this.active) return;
    if (this.pollPromise) return this.pollPromise;
    const active = this.active, generation = this.generation;
    this.pollPromise = this.runPoll(active, generation).finally(() => {
      this.pollPromise = null;
      if (this.active && generation === this.generation) this.schedule();
      else if (this.active) this.schedule(100);
    });
    return this.pollPromise;
  }
  async runPoll(active, generation) {
    if (Date.now()<this.retryAt) return;
    const isCurrent = () => this.active === active && generation === this.generation;
    const recorder = this.recorder(active.user.id);
    try {
      const version = this.selfVersion;
      const user = await active.client.request('auth/user');
      if (!isCurrent()) return;
      if (user.requiresTwoFactorAuth) throw new ApiError(401, '目标账号需要重新完成二步验证');
      if (user.id !== active.user.id) throw new ApiError(401, '目标账号会话身份发生变化');
      if (version === this.selfVersion) this.observeCurrentUser(user, 'cloud-poll');
      this.persistSession();
      this.lastError = ''; this.backoff = 0; this.retryAt = 0;
      // Fetch names before the paginated roster, and also immediately after location events.
      const worldRequest = this.resolveWorldName(active, generation);
      // A following roster observation bounds these samples without extending the account's activity.
      await this.pollInstanceCounts(active,generation);
      if (!isCurrent()) return;
      if (Date.now()<this.retryAt) { await worldRequest; return; }
      const rosterVersion = this.pipelineVersion;
      try {
        const friends = await active.client.friends();
        if (!isCurrent()) return;
        if (rosterVersion === this.pipelineVersion) {
          recorder.observeRoster(friends, active.user);
          this.lastRosterAt = Date.now(); this.rosterReady = true;
        }
      } catch (e) {
        if (!isCurrent()) return;
        this.lastError = `人员快照更新失败：${e.message}。保留上次快照。`;
        if (e.status === 429) this.retryAt = Date.now() + Math.max(60000, (e.retryAfter || 60)*1000);
      }
      if (!isCurrent()) return;
      await worldRequest;
      if (isCurrent() && Date.now()>=this.retryAt && !this.pipeline && Date.now() >= this.pipelineRetryAt) await this.openPipeline(active, generation);
    } catch (e) {
      if (!isCurrent()) return;
      this.lastError = e.message;
      recorder.markGap(Date.now(), e.status === 429 ? 'rate-limit' : 'api-unavailable');
      this.backoff = Math.min(600000, Math.max(60000, this.backoff*2));
      this.retryAt = Date.now() + Math.max(this.backoff, (e.retryAfter || 0)*1000);
      if (e.status === 401) this.stop('session-expired', true);
    }
  }
  async pollInstanceCounts(active=this.active,generation=this.generation) {
    if (!active || this.active!==active || generation!==this.generation || Date.now()<this.retryAt) return;
    const recorder=this.recorder(active.user.id),visits=[...recorder.activeVisits.values()];
    const liveIds=new Set(visits.map(v=>v.id));
    for(const id of this.countAttempts.keys())if(!liveIds.has(id))this.countAttempts.delete(id);
    // Sequential requests give a 429 a chance to defer the remaining concurrent instances.
    for(const visit of visits) {
      if(this.active!==active || generation!==this.generation)return;
      if(recorder.activeVisits.get(visit.location)?.id!==visit.id)continue;
      const now=Date.now();
      const due=this.countAttempts.get(visit.id) || 0;
      if(now<due)continue;
      this.countAttempts.set(visit.id,now+this.interval);
      try {
        const separator=visit.location.indexOf(':'),path=`instances/${encodeURIComponent(visit.location.slice(0,separator))}:${encodeURIComponent(visit.location.slice(separator+1))}`;
        const response=typeof active.client.instance==='function'?await active.client.instance(visit.location):await active.client.request(path);
        const sample=instancePopulation(response,visit.location);
        if(this.active!==active || generation!==this.generation || recorder.activeVisits.get(visit.location)?.id!==visit.id)continue;
        recorder.observeInstanceCount(visit.location,{...sample,intervalMs:this.interval},Date.now());
      } catch(error) {
        if(this.active!==active || generation!==this.generation || recorder.activeVisits.get(visit.location)?.id!==visit.id)continue;
        recorder.observeInstanceCount(visit.location,{total:null,intervalMs:this.interval,
          reason:error.status===429?'rate-limit':[403,404].includes(error.status)?'inaccessible':'unavailable',httpStatus:error.status || 0},Date.now());
        if(error.status===429) {
          const retryAt=Date.now()+Math.max(this.interval,(error.retryAfter || 60)*1000);
          this.retryAt=Math.max(this.retryAt,retryAt);
          for(const pending of visits)this.countAttempts.set(pending.id,retryAt);
          break;
        }
      }
    }
  }
  observeCurrentUser(user, source, { directLocation = false } = {}) {
    const active = this.active;
    if (!active || user.id !== active.user.id) return;
    const at = Date.now();
    const observation = directLocation ? { ...user } : currentUserObservation(user, { allowLegacyLocation: source === 'cloud-poll' && !this.lastLocationSignalAt });
    if (directLocation) this.lastLocationSignalAt = at;
    active.user = { ...active.user, ...observation };
    const locationSource = Object.hasOwn(observation, 'location') ? directLocation ? 'location-stream' : user.presence ? 'user-presence' : 'legacy-api' : '';
    this.recorder(user.id).observeSelf({displayName:active.user.displayName,...observation}, at, source, locationSource);
  }
  async resolveWorldName(active = this.active, generation = this.generation) {
    if (!active) return;
    const recorder = this.recorder(active.user.id);
    const worlds = new Set([...recorder.activeVisits.values()].map(v=>v.location.split(':')[0]));
    await Promise.all([...worlds].map(worldId=>this.resolveInstanceWorldName(active,generation,recorder,worldId)));
  }
  async resolveInstanceWorldName(active,generation,recorder,worldId) {
    if (recorder.worldNames.has(worldId)) return;
    try {await this.loadWorld(active,generation,worldId);}catch { /* Retry on a later cloud observation. */ }
  }
  async loadWorld(active,generation,worldId) {
    if(!/^wrld_[a-zA-Z0-9-]+$/.test(worldId))throw new Error('无效的世界 ID');
    const key = `${active.user.id}:${worldId}`;
    const cached=this.worldCache.get(key);if(cached && Date.now()-cached.at<300000)return cached.world;
    if (this.worldRequests.has(key)) return this.worldRequests.get(key);
    const request = (async () => {
        const world = await active.client.request(`worlds/${encodeURIComponent(worldId)}`);
        if(this.active!==active || generation!==this.generation)throw new ApiError(409,'账号会话已变化');
        if(!world || (world.id && world.id!==worldId) || typeof world.name!=='string' || !world.name.trim())throw new Error('世界响应无效');
        const recorder=this.recorder(active.user.id);
        if(recorder.worldNames.get(worldId)!==world.name)recorder.emit('world',{worldId,name:world.name},Date.now());
        this.worldCache.set(key,{world,at:Date.now()});return world;
    })();
    this.worldRequests.set(key, request);
    try { await request; } finally { if (this.worldRequests.get(key) === request) this.worldRequests.delete(key); }
    return request;
  }
  requireAccount(id) {
    accountKey(id);
    if(!this.active || this.active.user.id!==id)throw new ApiError(409,'请先连接目标账号');
    return this.active;
  }
  resolveAvatarMetadata(data){return resolveAvatarMetadata(this,data);}
  avatarDetails(accountId,id){return avatarDetails(this,accountId,id);}
  socialSnapshot(accountId,options){return socialSnapshot(this,accountId,options);}
  socialUserDetails(accountId,id,options){return socialUserDetails(this,accountId,id,options);}
  nativeSocialQuery(data){return nativeSocialQuery(this,data);}
  socialAction(data){return socialAction(this,data);}
  async resolveWorldNames({accountId,worldIds}) {
    const active=this.requireAccount(accountId),generation=this.generation,recorder=this.recorder(accountId),names={};
    if(!Array.isArray(worldIds) || worldIds.length>5 || worldIds.some(id=>typeof id!=='string' || !/^wrld_[a-zA-Z0-9-]+$/.test(id)))throw new Error('每次最多查询 5 个有效世界 ID');
    for(const worldId of new Set(worldIds)){
      if(recorder.worldNames.has(worldId)){names[worldId]=recorder.worldNames.get(worldId);continue;}
      const key=`${accountId}:${worldId}`;
      if(Date.now()<this.retryAt || Date.now()<(this.worldNameRetryAt.get(key) || 0))continue;
      try{names[worldId]=(await this.loadWorld(active,generation,worldId)).name;}
      catch(error){
        if(this.active!==active || generation!==this.generation)throw error;
        this.worldNameRetryAt.set(key,Date.now()+300000);
        if(error.status===429){this.retryAt=Date.now()+Math.max(this.interval,(error.retryAfter || 60)*1000);break;}
      }
    }
    return {accountId,names};
  }
  async worldDetails(accountId,worldId,location='') {
    const active=this.requireAccount(accountId),generation=this.generation;
    if(location && (!realLocation(location) || location.split(':')[0]!==worldId))throw new Error('世界与实例位置不匹配');
    const world=await this.loadWorld(active,generation,worldId);
    let instance=null;
    if(location){try{instance=await active.client.instance(location);instancePopulation(instance,location);}catch(error){if(error.status===429)throw error;instance=null;}}
    if(this.active!==active || generation!==this.generation)throw new ApiError(409,'账号会话已变化');
    const recorder=this.recorder(accountId),rooms=new Map();
    const add=(tag,user,extra={})=>{
      const L=vrcxParseLocation(tag);
      if(L.worldId!==worldId || !L.instanceId)return;
      const canonical=`${worldId}:${L.instanceId}`;
      if(!rooms.has(canonical))rooms.set(canonical,new Map());
      rooms.get(canonical).set(user.id,worldUserProfile(user,{isFriend:true,location:canonical,...extra}));
    };
    // VRCX instance store groups all visible friends by full instance ID, even outside self's instance.
    for(const user of recorder.cloudUsers.values())if(user.id!==accountId)add(user.location,user);
    for(const visit of recorder.activeVisits.values())for(const person of recorder.rosters.get(visit.id)?.values() || []) {
      const user={...recorder.cloudUsers.get(person.id),...(person.id===accountId?active.user:{}),...person};
      if(person.avatar?.image)user.currentAvatarThumbnailImageUrl=person.avatar.image;
      add(visit.location,user,{state:'online',$location_at:visit.start});
    }
    const L=vrcxParseLocation(location),creatorId=L.userId || instance?.ownerId,creators={};
    if(typeof creatorId==='string' && /^usr_[a-zA-Z0-9-]+$/.test(creatorId)) {
      const known=creatorId===accountId?active.user:recorder.cloudUsers.get(creatorId);
      let creator=known?.displayName?worldUserProfile(known,{isFriend:true}):await this.loadWorldUser(active,generation,creatorId);
      if(creator)creators[creatorId]=creator;
    }
    if(this.active!==active || generation!==this.generation)throw new ApiError(409,'账号会话已变化');
    const people=[...(rooms.get(`${worldId}:${L.instanceId}`)?.values() || [])];
    return {accountId,world:{...world,id:worldId},instance,people,creators,
      rooms:[...rooms].map(([location,users])=>({location,people:[...users.values()]}))};
  }
  async loadWorldUser(active,generation,userId) {
    const key=`${active.user.id}:${userId}`,cached=this.worldUserCache.get(key);
    if(cached && Date.now()-cached.at<300000)return cached.user;
    if(Date.now()<this.retryAt || Date.now()<(this.worldUserRetryAt.get(key) || 0))return null;
    if(this.worldUserRequests.has(key))return this.worldUserRequests.get(key);
    // VRCX's missing instance creator lookup, using this secondary account's HTTP client.
    const request=(async()=>{
      try {
        const user=await active.client.request(`users/${encodeURIComponent(userId)}`);
        if(this.active!==active || generation!==this.generation)throw new ApiError(409,'账号会话已变化');
        if(user?.id!==userId || !user.displayName)throw new ApiError(409,'实例建立者资料与请求身份不匹配');
        const ref=worldUserProfile(user);this.worldUserCache.set(key,{user:ref,at:Date.now()});return ref;
      }catch(error){
        if(this.active!==active || generation!==this.generation || [401,409].includes(error.status))throw error;
        this.worldUserRetryAt.set(key,Date.now()+60000);
        if(error.status===429)this.retryAt=Math.max(this.retryAt,Date.now()+Math.max(this.interval,(error.retryAfter || 60)*1000));
        return null;
      }
    })();
    this.worldUserRequests.set(key,request);
    try{return await request;}finally{if(this.worldUserRequests.get(key)===request)this.worldUserRequests.delete(key);}
  }
  schedule(delay) {
    clearTimeout(this.timer);
    const next = delay ?? Math.max(this.interval, this.retryAt-Date.now());
    this.timer = setTimeout(() => void this.poll(), next); this.timer.unref();
  }
  pipelineRetryAt = 0;
  async openPipeline(active, generation) {
    this.pipelineRetryAt = Date.now() + 60000;
    try {
      const { token } = await active.client.request('auth');
      if (!token || this.active !== active || generation !== this.generation) return;
      this.pipeline = this.pipelineFactory(active.client, token, {
        onOpen: () => { if (this.active === active) this.connected = true; },
        onClose: () => { if (this.active === active) { this.connected = false; this.pipeline = null; this.pipelineRetryAt = Date.now()+60000; } },
        onMessage: message => { if (this.active === active && generation === this.generation) this.handlePipeline(message); }
      });
    } catch { this.connected = false; }
  }
  handlePipeline(message) {
    if (!this.active) return;
    let content;
    try { content = typeof message.content === 'string' ? JSON.parse(message.content) : message.content; } catch { return; }
    if (!content || typeof content !== 'object') return;
    const recorder = this.recorder(this.active.user.id), at = Date.now();
    this.pipelineVersion++;
    if (message.type === 'user-location' && content.userId === this.active.user.id && typeof content.location === 'string') {
      this.selfVersion++;
      this.observeCurrentUser({ id: this.active.user.id, location: content.location }, 'cloud-pipeline', { directLocation: true });
      this.rosterReady = false;
      void this.resolveWorldName();
      this.schedule(1000);
    } else if (message.type === 'user-update' && content.user?.id === this.active.user.id) {
      this.selfVersion++;
      this.observeCurrentUser(content.user, 'cloud-pipeline');
      void this.resolveWorldName();
    } else if (message.type.startsWith('friend-')) {
      const id = content.userId || content.user?.id;
      if (!id) return;
      const user = { ...content.user, id };
      if (typeof content.location === 'string') user.location = content.location;
      if (['friend-offline','friend-active','friend-delete'].includes(message.type)) user.location = 'offline';
      recorder.observeFriend(user, at);
    }
  }
  stop(reason = 'manual-stop', keepError = false) {
    this.generation++;
    clearTimeout(this.timer); this.timer = null;
    this.pipeline?.close(); this.pipeline = null; this.connected = false; this.pipelineRetryAt = 0;
    if (this.active) {
      const recorder = this.recorder(this.active.user.id);
      this.persistSession();
      recorder.close(recorder.lastSeen || Date.now(), reason, 'last-observed');
      this.active.client.close();
    }
    this.pending?.client.close(); this.pending = null; this.active = null;
    this.lastRosterAt = null; this.retryAt = 0;
    this.countAttempts.clear();
    this.worldCache.clear();this.worldNameRetryAt.clear();
    this.worldUserCache.clear();this.worldUserRetryAt.clear();
    this.avatarMetadataCache?.clear();this.avatarMetadataRetry?.clear();this.socialCache?.clear();
    if (!keepError) this.lastError = '';
  }
}
