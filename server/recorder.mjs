import { randomUUID } from 'node:crypto';

export function realLocation(value) {
  return typeof value === 'string' && /^wrld_[a-zA-Z0-9-]+:[^\s]+$/.test(value) ? value : null;
}

export function isTraveling(value) {
  return typeof value === 'string' && /^travell?ing(?::.*)?$/i.test(value);
}

export function avatarOf(user) {
  const id = typeof user.currentAvatar === 'string' && user.currentAvatar.startsWith('avtr_') ? user.currentAvatar : '';
  const image = user.currentAvatarImageUrl || user.currentAvatarThumbnailImageUrl || '';
  return id || image ? { key: id || image, id, image, certainty: id ? 'avatar-id' : 'image-only' } : null;
}

function person(user) {
  return { id: user.id, displayName: user.displayName || user.id, avatar: avatarOf(user) };
}
const resumableReasons=new Set(['manual-stop','service-restart','service-shutdown','observation-gap','session-expired','account-switch','primary-session-change','primary-logout','became-primary']);

// A reducer over a durable journal. Only isolated cloud observations enter here.
export class Recorder {
  constructor(accountId, append = () => {}, replay = [], { closeUnfinished = true, locationBufferMs = 0 } = {}) {
    this.accountId = accountId;
    this.append = append;
    this.events = [];
    this.visits = new Map();
    this.activeVisits = new Map();
    this.resumeCandidates=new Map();this.lastReportedLocation='';
    this.rosters = new Map();
    this.locationAvatars = new Map();
    this.locationBufferMs = locationBufferMs;
    this.current = null;
    this.roster = new Map();
    this.avatars = new Map();
    this.worldNames = new Map();
    this.travelStartedAt = null;
    this.lastSeen = null;
    this.gap = false;
    for (const event of replay) this.reduce(event);
    if (closeUnfinished && this.activeVisits.size) this.close(this.lastSeen || 0, 'service-restart', 'last-observed');
  }

  selectVisit(visit) {
    this.current = visit || null;
    this.roster = visit ? this.rosters.get(visit.id) : new Map();
  }

  withVisit(visit, callback) {
    const previous = this.current;
    this.selectVisit(visit);
    try { return callback(); }
    finally { this.selectVisit(previous?.end === null ? previous : [...this.activeVisits.values()].at(-1)); }
  }

  emit(type, data, at, source = 'cloud-poll') {
    const event = { id: randomUUID(), accountId: this.accountId, type, at, source, ...data };
    this.append(event); // Persist before applying; never acknowledge an unrecorded observation.
    this.reduce(event);
    return event;
  }

  reduce(e) {
    this.events.push(e);
    if (e.type === 'visit-start') {
      const worldId = e.location.split(':')[0];
      const visit = { id: e.visitId, accountId: this.accountId, location: e.location, worldName: this.worldNames.get(worldId) || e.worldName || worldId,
        start: e.at, end: null, lastSeen: e.at, initial: [], final: [], rosterInitialized: false,
        initialAt: null, finalAt: null, rosterLastSeen:e.at, locationSeen:e.at, buffered:Boolean(e.buffered), closeReason: '', endQuality: '', maxObserved: 1, population:[] };
      this.visits.set(e.visitId, visit);
      this.activeVisits.set(e.location, visit);
      this.rosters.set(e.visitId, new Map());
      this.selectVisit(visit);
      this.noteLocation(e.location,e.at);
    } else if (e.type === 'visit-end') {
      const visit = this.visits.get(e.visitId);
      if (visit) Object.assign(visit, { end: e.at, final: e.people, finalAt: e.observedAt, closeReason: e.reason, endQuality: e.quality });
      if(visit && (resumableReasons.has(e.reason) || e.reason==='buffer-expired'))
        this.resumeCandidates.set(visit.location,{visitId:visit.id,replacementAt:e.reason==='buffer-expired' && this.lastReportedLocation!==visit.location?(e.decisionAt ?? e.at):null});
      if (visit && this.activeVisits.get(visit.location)?.id === visit.id) this.activeVisits.delete(visit.location);
      this.rosters.delete(e.visitId);
      if (this.current?.id === e.visitId) this.selectVisit([...this.activeVisits.values()].at(-1));
      this.travelStartedAt = null;
    } else if(e.type==='visit-resume') {
      const visit=this.visits.get(e.visitId);
      if(!visit || visit.location!==e.location)return;
      Object.assign(visit,{end:null,closeReason:'',endQuality:'',lastSeen:e.at,locationSeen:e.at,resumeCount:(visit.resumeCount || 0)+1});
      this.activeVisits.set(visit.location,visit);
      this.rosters.set(visit.id,new Map(visit.final.map(p=>[p.id,p])));
      this.resumeCandidates.delete(visit.location);this.selectVisit(visit);
      this.noteLocation(visit.location,e.at);
    } else if (e.type === 'snapshot') {
      const visit = this.visits.get(e.visitId);
      if (visit) {
        visit.initial = e.people;
        visit.initialAt = e.at;
        visit.rosterInitialized = true;
      }
      const roster = new Map(e.people.map(p => [p.id, p]));
      this.rosters.set(e.visitId, roster);
      if (this.current?.id === e.visitId) this.roster = roster;
    } else if (e.type === 'person-join') {
      this.rosters.get(e.visitId)?.set(e.person.id, e.person);
    } else if (e.type === 'person-leave') {
      this.rosters.get(e.visitId)?.delete(e.person.id);
    } else if (e.type === 'avatar') {
      this.avatars.set(e.userId, e.avatar);
      if (e.location) this.locationAvatars.set(`${e.userId}@${e.location}`, e.avatar);
      const roster = this.rosters.get(e.visitId);
      if (roster?.has(e.userId)) roster.set(e.userId, { ...roster.get(e.userId), avatar: e.avatar });
    } else if (e.type === 'heartbeat') {
      this.lastSeen = e.at;
      const visit = this.visits.get(e.visitId);
      if (visit && visit.end === null && !e.traveling) {
        if(e.selfPerson)this.rosters.get(e.visitId)?.set(e.selfPerson.id,e.selfPerson);
        visit.lastSeen = Math.max(visit.lastSeen, e.at);
        if (e.locationObserved) {visit.locationSeen = e.at;this.noteLocation(visit.location,e.at);}
        this.selectVisit(visit);
      }
    } else if (e.type === 'world') {
      this.worldNames.set(e.worldId, e.name);
      for (const visit of this.visits.values()) if (visit.location.split(':')[0] === e.worldId) visit.worldName = e.name;
    } else if (e.type === 'instance-count') {
      const visit=this.visits.get(e.visitId);
      if (visit && visit.location===e.location) visit.population.push({at:e.at,total:e.total,capacity:e.capacity ?? null,
        intervalMs:e.intervalMs,reason:e.reason || '',httpStatus:e.httpStatus || 0});
    } else if (e.type === 'cloud-user') {
      this.cloudUsers.set(e.user.id,{...this.cloudUsers.get(e.user.id),...e.user});
    } else if (e.type === 'observation-gap') {
      this.gap = true;
    } else if (e.type === 'observation-resumed') {
      this.gap = false;
    }
    const visit = this.visits.get(e.visitId);
    if (visit && visit.end === null) visit.maxObserved = Math.max(visit.maxObserved, this.rosters.get(visit.id)?.size || 0);
    if (visit && visit.end === null && ['snapshot','roster-observed','person-join','person-leave','avatar'].includes(e.type)) {
      visit.rosterLastSeen = Math.max(visit.rosterLastSeen, e.at);
      visit.lastSeen = Math.max(visit.lastSeen, e.at);
    }
  }

  noteLocation(location,at) {
    this.lastReportedLocation=location;
    for(const [other,candidate]of this.resumeCandidates)if(other!==location && candidate.replacementAt===null)candidate.replacementAt=at;
  }

  close(at, reason = 'location-change', quality = 'observed', source = 'service') {
    for (const visit of [...this.activeVisits.values()]) this.closeVisit(visit, at, reason, quality, source);
  }

  closeVisit(visit, at, reason, quality = 'observed', source = 'service', decisionAt = null) {
    if(quality==='last-observed')at=Math.max(visit.lastSeen,visit.rosterLastSeen);
    this.emit('visit-end', { visitId: visit.id, people: [...(this.rosters.get(visit.id)?.values() || [])],
      observedAt: visit.rosterLastSeen, reason, quality,...(decisionAt===null?{}:{decisionAt}) }, Math.max(at, visit.start), source);
  }

  expireLocations(at) {
    if (!this.locationBufferMs) return;
    for (const visit of [...this.activeVisits.values()]) {
      if (at - visit.locationSeen > this.locationBufferMs) this.closeVisit(visit, visit.lastSeen, 'buffer-expired', 'last-observed','service',at);
    }
  }

  markGap(at, reason) {
    if (this.gap) return;
    this.emit('observation-gap', { visitId: this.current?.id || null, reason }, at, 'service');
    this.close(this.lastSeen || at, 'observation-gap', 'last-observed');
  }

  observeSelf(user, at = Date.now(), source = 'cloud-poll', locationSource = '') {
    if (user.id !== this.accountId) throw new Error('目标账号数据身份不匹配');
    if (this.gap) this.emit('observation-resumed', {}, at, source);
    this.observeCloudUser(user, at, source, locationSource);
    if (this.locationBufferMs) { this.observeBufferedSelf(user, at, source); return; }
    if (isTraveling(user.location)) {
      // Loading is not a visited instance. Keep the previous roster until a real destination arrives.
      this.travelStartedAt ??= at;
      this.observeAvatar(user, at, source);
      this.emit('heartbeat', { visitId: this.current?.id || null, traveling: true }, at, source);
      return;
    }
    if (Object.hasOwn(user, 'location')) {
      const location = realLocation(user.location);
      if (location !== (this.current?.location || null)) {
        this.close(this.travelStartedAt ?? at, location ? 'location-change' : (user.location || 'location-unavailable'), 'observed', source);
        if (location) this.emit('visit-start', { visitId: randomUUID(), location, worldName: this.worldNames.get(location.split(':')[0]) || location.split(':')[0] }, at, source);
      }
      this.travelStartedAt = null;
      if (this.current && !this.roster.has(user.id)) this.roster.set(user.id, person(user));
    }
    this.observeAvatar(user, at, source);
    this.emit('heartbeat', { visitId: this.current?.id || null }, at, source);
  }

  observeBufferedSelf(user, at, source) {
    const location = realLocation(user.location);
    if (location) {
      let visit = this.activeVisits.get(location);
      const candidate=this.resumeCandidates.get(location);
      if(!visit && candidate && (candidate.replacementAt===null || at-candidate.replacementAt<=this.locationBufferMs)) {
        visit=this.visits.get(candidate.visitId);
        this.emit('visit-resume',{visitId:visit.id,location,previousEnd:visit.end,previousReason:visit.closeReason},at,source);
      }
      if (!visit) {
        this.resumeCandidates.delete(location);
        this.emit('visit-start', { visitId: randomUUID(), location, buffered:true,
          worldName:this.worldNames.get(location.split(':')[0]) || location.split(':')[0] }, at, source);
        visit = this.current;
      }
      this.selectVisit(visit);
      const previous = this.roster.get(user.id);
      this.roster.set(user.id, {...person(user), avatar:avatarOf(user) || previous?.avatar || null});
      this.observeAvatar(user, at, source);
      this.emit('heartbeat', { visitId:visit.id, locationObserved:true, selfPerson:this.roster.get(user.id) }, at, source);
      // Renew the reported instance before expiring siblings; delayed identical reports never split it.
      this.expireLocations(at);
    } else {
      // A location-less profile or one client's loading/offline signal cannot close sibling instances.
      this.withVisit(null, () => this.observeAvatar(user, at, source));
      this.emit('heartbeat', { visitId:null, traveling:isTraveling(user.location) }, at, source);
      if(typeof user.location==='string')this.expireLocations(at);
    }
  }

  observeAvatar(user, at, source) {
    const avatar = avatarOf(user);
    if (!avatar || !user.id) return;
    if (user.id !== this.accountId && !this.roster.has(user.id)) return;
    const location = this.locationBufferMs ? this.current?.location : '';
    const previous = location ? this.locationAvatars.get(`${user.id}@${location}`) : this.avatars.get(user.id);
    if (previous?.key === avatar.key) return;
    this.emit('avatar', { visitId: this.travelStartedAt === null ? this.current?.id || null : null, userId: user.id,
      displayName: user.displayName || user.id, self: user.id === this.accountId,
      avatar, previous: previous || null, baseline: !previous,...(location ? {location} : {}) }, at, source);
  }

  observeRoster(users, self, at = Date.now(), source = 'cloud-poll') {
    for (const user of users) this.observeCloudUser(user,at,source);
    if (this.locationBufferMs) {
      for (const visit of [...this.activeVisits.values()]) this.withVisit(visit, () => this.observeVisitRoster(users,{...self,location:visit.location},at,source));
    } else this.observeVisitRoster(users,self,at,source);
  }

  observeVisitRoster(users, self, at, source) {
    if (!this.current || realLocation(self.location) !== this.current.location) return;
    const people = [this.roster.get(self.id) || person(self), ...users.filter(u => u.id !== this.accountId && (u.location === this.current.location || (isTraveling(u.location) && this.roster.has(u.id)))).map(person)];
    const next = new Map(people.map(p => [p.id, p]));
    if (!this.current.rosterInitialized) {
      this.emit('snapshot', { visitId: this.current.id, people: [...next.values()], scope: 'visible-friends' }, at, source);
    } else {
      for (const [id, p] of next) if (!this.roster.has(id)) this.emit('person-join', { visitId: this.current.id, person: p, reason: 'observed-in-instance' }, at, source);
      for (const [id, p] of [...this.roster]) if (!next.has(id)) this.emit('person-leave', { visitId: this.current.id, person: p, reason: 'left-or-not-visible' }, at, source);
    }
    for (const user of users) this.observeAvatar(user, at, source);
    // Persist successful unchanged polls too, so the final snapshot has its actual observation time.
    this.emit('roster-observed', { visitId: this.current.id }, at, source);
  }

  observeFriend(user, at = Date.now(), source = 'cloud-pipeline') {
    this.observeCloudUser(user,at,source);
    if (this.locationBufferMs) {
      for (const visit of [...this.activeVisits.values()]) this.withVisit(visit, () => this.observeVisitFriend(user,at,source));
    } else this.observeVisitFriend(user,at,source);
  }

  observeVisitFriend(user, at, source) {
    if (!this.current || this.travelStartedAt !== null || !user.id || user.id === this.accountId) return;
    if (Object.hasOwn(user, 'location') && !isTraveling(user.location)) {
      const isHere = user.location === this.current.location;
      if (isHere && !this.roster.has(user.id)) this.emit('person-join', { visitId: this.current.id, person: person({...this.cloudUsers.get(user.id),...user}), reason: 'observed-in-instance' }, at, source);
      else if (!isHere && this.roster.has(user.id)) this.emit('person-leave', { visitId: this.current.id, person: this.roster.get(user.id), reason: 'left-or-not-visible' }, at, source);
    }
    this.observeAvatar(user, at, source);
  }

  observeInstanceCount(location, sample, at=Date.now(), source='cloud-poll') {
    const visit=this.activeVisits.get(location);
    if (!visit) return false;
    if (sample.total!==null && (!Number.isInteger(sample.total) || sample.total<0)) throw new Error('无效的实例人数');
    if (!Number.isFinite(at) || at<visit.start) throw new Error('无效的人数采样时间');
    this.emit('instance-count',{visitId:visit.id,location,total:sample.total,capacity:sample.capacity ?? null,
      intervalMs:Math.max(30000,Math.min(600000,Number(sample.intervalMs) || 60000)),
      ...(sample.reason?{reason:sample.reason,httpStatus:sample.httpStatus || 0}:{})},at,source);
    // Population observation must not renew the secondary account's location or extend an activity.
    return true;
  }

  query({ from = 0, to = Date.now(), search = '', selfOnly = false, type = '', page = 1, limit = 100, visitId = '' } = {}) {
    from = Number(from); to = Number(to);
    page = Math.max(1, Number(page) || 1); limit = Math.min(500, Math.max(1, Number(limit) || 100));
    if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) throw new Error('日期范围无效');
    const needle = String(search).toLowerCase();
    const match = value => !needle || JSON.stringify(value).toLowerCase().includes(needle);
    const matchingVisits=new Set(needle?this.events.filter(e=>!['heartbeat','roster-observed','cloud-user','friend-log'].includes(e.type) && e.visitId && match(e)).map(e=>e.visitId):[]);
    const visits = [...this.visits.values()].filter(v => v.start <= to && (v.end ?? v.lastSeen) >= from && (match(v) || matchingVisits.has(v.id))).map(v => ({ ...v,
      final: v.end !== null ? v.final : [...(this.rosters.get(v.id)?.values() || [])], finalAt: v.end !== null ? v.finalAt : v.rosterLastSeen,
      duration: Math.max(0, Math.min(v.end ?? v.lastSeen, to) - Math.max(v.start, from)) })).sort((a,b) => b.start - a.start);
    const visitIds = new Set([...this.visits.values()].filter(v => v.start <= to && (v.end ?? v.lastSeen) >= from).map(v => v.id));
    const filtered = this.events.filter(e => !['heartbeat','roster-observed','world','cloud-user','friend-log','instance-count'].includes(e.type) && e.at >= from && e.at <= to &&
      (!visitId || e.visitId === visitId) && (!type || e.type === type) &&
      (!selfOnly || e.userId === this.accountId || (e.person?.id === this.accountId) || ['visit-start','visit-end','visit-resume','observation-gap','observation-resumed'].includes(e.type)) && match(e)).reverse();
    const worlds = new Map();
    for (const v of visits) { const key = v.location.split(':')[0]; const w = worlds.get(key) || { id: key, name: v.worldName, duration: 0, visits: 0 }; w.duration += v.duration; w.visits++; worlds.set(key, w); }
    const avatars = this.events.filter(e => e.type === 'avatar' && !e.baseline && e.at >= from && e.at <= to && (!selfOnly || e.self) && match(e) && (!visitId || e.visitId === visitId));
    const boundaries = visits.flatMap(v=>[[Math.max(v.start,from),1],[Math.min(v.end ?? v.lastSeen,to),-1]]).sort((a,b)=>a[0]-b[0]);
    let count=0,previous=from,elapsedDuration=0,parallelDuration=0;
    for(const [at,delta] of boundaries){const span=Math.max(0,at-previous);if(count>0)elapsedDuration+=span;if(count>1)parallelDuration+=span;count+=delta;previous=at;}
    return { visits: visits.slice((page-1)*limit, page*limit), visitTotal: visits.length, events: filtered.slice((page-1)*limit, page*limit), eventTotal: filtered.length, page, limit,
      stats: { duration: visits.reduce((sum,v) => sum + v.duration, 0), elapsedDuration, parallelDuration, visits: visits.length,
        people: new Set(this.events.filter(e => visitIds.has(e.visitId) && ['snapshot','person-join'].includes(e.type)).flatMap(e => e.people || [e.person]).map(p => p.id).filter(id => id !== this.accountId)).size,
        avatarChanges: avatars.length }, worlds: [...worlds.values()].sort((a,b) => b.duration-a.duration).slice(0,20) };
  }

  detail(id) {
    const visit = this.visits.get(id);
    if (!visit) return null;
    return { visit: { ...visit, final: visit.end !== null ? visit.final : [...(this.rosters.get(visit.id)?.values() || [])], finalAt: visit.end !== null ? visit.finalAt : visit.rosterLastSeen },
      events: this.events.filter(e => e.visitId === id && !['heartbeat','roster-observed','world','cloud-user','friend-log','instance-count'].includes(e.type)) };
  }

  cloudUsers = new Map();
  observeCloudUser(user,at,source,locationSource = '') {
    if(!user.id)return;
    const allowed=['id','displayName','location','state','status','statusDescription','bio','bioLinks','currentAvatar','currentAvatarImageUrl','currentAvatarThumbnailImageUrl','bannerType','bannerUrl','iconUrl'];
    const patch=Object.fromEntries(allowed.filter(key=>Object.hasOwn(user,key)).map(key=>[key,user[key]]));
    if (isTraveling(patch.location)) delete patch.location;
    const next={...this.cloudUsers.get(user.id),...patch};
    if(JSON.stringify(next)===JSON.stringify(this.cloudUsers.get(user.id)))return;
    this.cloudUsers.set(user.id,next);
    this.emit('cloud-user',{user:patch,...(locationSource ? {locationSource} : {}),...(this.locationBufferMs && user.id===this.accountId ? {buffered:true} : {})},at,source);
  }
}
