import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {MonikaService} from '../server/service.mjs';
import {publicSocialUser} from '../server/entities.mjs';
import {MonikaDatabase} from '../src/database.mjs';
import {MonikaPlugin} from '../src/plugin.mjs';
import {MonikaView,activityRange,dateBounds,escapeHtml,dateText,durationText,safeImage,accountPresence} from '../src/view.mjs';
import {MonikaSocialView,socialLogRows,socialModerationRows,socialFriendRows} from '../src/social.mjs';
import {openVrcxAvatarPage} from '../src/native-avatar.mjs';
import {createVrcxAccountDatabase,createVrcxCloudContext,createVrcxAvatarRef,vrcxAvatarPlatforms,vrcxComputeTrustLevel,vrcxReplaceBioSymbols} from '../src/vendor-vrcx.mjs';
import {Recorder} from '../server/recorder.mjs';
import {localData} from './helpers/local-data.mjs';

Object.assign(globalThis,{vrcxComputeTrustLevel,vrcxReplaceBioSymbols,escapeHtml,dateText,durationText,safeImage,accountPresence,createVrcxAvatarRef,vrcxAvatarPlatforms});
function service(t,request=async()=>[]){
  const storage={read:()=>({}),write(){},journal:()=>({replay:[],append(){}})};
  const s=new MonikaService(storage);s.primaryId='usr_main';
  s.active={user:{id:'usr_alt'},client:{request,friends:async({offline=false}={})=>[{id:offline?'usr_offline':'usr_friend',displayName:offline?'Offline':'Friend',status:offline?'offline':'active',location:offline?'offline':'wrld_a:1'}],exportCookies:()=>'',close(){}}};
  t.after(()=>s.stop());return s;
}
function database(t){
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  const bridge={execute:async(fn,sql,args)=>{for(const row of db.prepare(sql).all(args || {}))fn(Object.values(row));},
    executeNonQuery:async(sql,args)=>db.prepare(sql).run(args || {}).changes,executeInsert:async(sql,args)=>Number(db.prepare(sql).run(args || {}).lastInsertRowid)};
  return new MonikaDatabase(bridge,{databaseFactory:createVrcxAccountDatabase,data:localData(t).data});
}
const snapshot=(updatedAt,friends,extra={})=>({accountId:'usr_alt',updatedAt,friends,friendsComplete:true,favorites:[],groups:[],moderations:[],errors:{},...extra});

test('avatar names use target avatar endpoints or native file naming, and image-only observations never invent an avatar ID',async t=>{
  const calls=[],s=service(t,async path=>{
    calls.push(path);
    if(path==='avatars/avtr_known')return {id:'avtr_known',name:'Known Avatar',authorId:'usr_author'};
    if(path==='avatars/avtr_private'){const error=new Error('private');error.status=403;throw error;}
    if(path.startsWith('file/'))return {id:path.slice(5),name:'Avatar - File Avatar - Image - revision',ownerId:'usr_author',versions:[{created_at:'2026-11-11'}]};
    return [];
  });
  const result=await s.resolveAvatarMetadata({accountId:'usr_alt',avatars:[{id:'avtr_known'},{image:'https://api.vrchat.cloud/api/1/file/file_image/1/file'},{id:'avtr_private',image:'https://api.vrchat.cloud/api/1/file/file_private/1/file'}]});
  assert.equal(result.assets[0].name,'Known Avatar');assert.equal(result.assets[1].name,'File Avatar');assert.equal(result.assets[1].id,'');assert.equal(result.assets[2].id,'avtr_private');
  assert(calls.includes('avatars/avtr_known'));assert(calls.includes('file/file_image'));
  const before=calls.length;await s.resolveAvatarMetadata({accountId:'usr_alt',avatars:[{image:'https://api.vrchat.cloud/api/1/file/file_image/2/file'}]});assert.equal(calls.length,before);
  await assert.rejects(s.resolveAvatarMetadata({accountId:'usr_main',avatars:[{id:'avtr_known'}]}),/目标账号/);
});

test('late avatar metadata cannot enter a cache after an account switch and 429 backs off',async t=>{
  let complete;const s=service(t,()=>new Promise(resolve=>{complete=resolve;}));
  const pending=s.resolveAvatarMetadata({accountId:'usr_alt',avatars:[{id:'avtr_a'}]});s.stop('account-switch');complete({id:'avtr_a',name:'Late'});
  await assert.rejects(pending,/会话已变化/);assert.equal(s.avatarMetadataCache.size,0);
  const limited=service(t,async()=>{const error=new Error('limited');error.status=429;error.retryAfter=90;throw error;});
  const names=await limited.resolveAvatarMetadata({accountId:'usr_alt',avatars:[{id:'avtr_b'},{id:'avtr_c'}]});assert.equal(names.assets.length,0);assert(limited.retryAt>Date.now()+80000);
});

test('native avatar dialog uses target ref and gallery, preserves primary caches, and detaches on navigation',()=>{
  const callbacks=new Set(),primaryCache=new Map([['avtr_a',{name:'Primary cached'}]]),D={},opened=[];
  const stores={avatar:{avatarDialog:D,cachedAvatars:primaryCache,$subscribe:fn=>{callbacks.add(fn);return()=>callbacks.delete(fn);}},ui:{openDialog:args=>opened.push(args)}};
  const cleanup=openVrcxAvatarPage(stores,{accountId:'usr_alt',avatar:{id:'avtr_a',name:'Target private',unityPackages:[{platform:'standalonewindows',variant:'standard',performanceRating:'Good'}]},gallery:[{id:'file_gallery',versions:[{file:{url:'https://example.com/gallery.png'}}]}]});
  assert.equal(opened[0].type,'avatar');assert.equal(D.ref.name,'Target private');assert.equal(D.galleryImages[0].id,'file_gallery');assert(D.isPC);assert.equal(primaryCache.get('avtr_a').name,'Primary cached');
  D.ref={name:'Primary late response'};D.galleryImages=[];D.timeSpent=10000;for(const fn of callbacks)fn();
  assert.equal(D.ref.name,'Target private');assert.equal(D.galleryImages.length,1);assert.equal(D.timeSpent,0);
  const gallery=D.galleryImages;for(const fn of callbacks)fn();assert.equal(D.galleryImages,gallery);
  D.id='avtr_other';for(const fn of callbacks)fn();assert.equal(callbacks.size,0);cleanup();
});

test('complete online and offline friend snapshots deduplicate, redact self secrets, and retain prior data on failure',async t=>{
  const s=service(t,async path=>path.startsWith('favorite/groups')?[{name:'group_0',type:'friend',displayName:'Friends'}]:[]);
  const first=await s.socialSnapshot('usr_alt');assert(first.friendsComplete);assert.equal(first.friends.length,2);assert.equal(first.groups[0].displayName,'Friends');
  s.active.client.friends=async()=>{throw 'page failed';};
  const second=await s.socialSnapshot('usr_alt',{force:true});assert(!second.friendsComplete);assert.deepEqual(second.friends,first.friends);assert.equal(second.errors.friends,'page failed');
  const ref=publicSocialUser({id:'usr_alt',displayName:'Alt',email:'private',password:'private',authToken:'private',friends:['usr_secret'],currentAvatar:'avtr_a'});
  assert.deepEqual(ref,{id:'usr_alt',displayName:'Alt',currentAvatar:'avtr_a'});
});

test('new target session never reuses an old in-flight social request',async t=>{
  const pendingResolvers=[],s=service(t);s.active.client.friends=()=>new Promise(resolve=>pendingResolvers.push(resolve));
  const old=s.socialSnapshot('usr_alt');s.generation++;s.active={...s.active,client:{...s.active.client,friends:async()=>[]}};
  const newer=await s.socialSnapshot('usr_alt');assert(newer.friendsComplete);assert.equal(newer.friends.length,0);
  for(const resolve of pendingResolvers)resolve([]);await assert.rejects(old,/会话已变化/);
  assert.equal(s.socialCache.get('usr_alt'),newer);
});

test('favorite and moderation mutations use target endpoints and refuse rows owned by another account',async t=>{
  const calls=[],s=service(t,async(path,options)=>{calls.push({path,options});return [];});
  await s.socialSnapshot('usr_alt');
  s.socialCache.set('usr_alt',snapshot(Date.now(),[{id:'usr_friend',displayName:'Friend'}],{groups:[{type:'friend',name:'group_0'}],favorites:[{id:'fvrt_a',favoriteId:'usr_friend',type:'friend',tags:['group_0']}],moderations:[{type:'block',sourceUserId:'usr_other',targetUserId:'usr_friend'}]}));
  await assert.rejects(s.socialAction({accountId:'usr_alt',action:'moderationDelete',type:'block',userId:'usr_friend'}),/其他账号/);
  await assert.rejects(s.socialAction({accountId:'usr_main',action:'unfriend',userIds:['usr_friend']}),/目标账号/);
  await s.socialAction({accountId:'usr_alt',action:'groupEdit',group:'group_0',displayName:'New Name',visibility:'friends'});
  const mutation=calls.find(call=>call.options?.method==='PUT');assert.equal(mutation.path,'favorite/group/friend/group_0/usr_alt');assert.equal(mutation.options.body.visibility,'friends');
  assert(!calls.some(call=>call.path.includes('usr_main')));
});

test('social baselines, name/trust changes and unfriend logs persist in the target SQLite tables only',async t=>{
  const db=database(t),friend={id:'usr_friend',displayName:'Old',tags:['system_trust_basic']};
  await db.saveSocial('usr_alt',snapshot(1000,[friend]));assert.equal((await db.socialHistory('usr_alt')).length,0);
  await db.saveSocial('usr_alt',snapshot(2000,[{...friend,displayName:'New',tags:['system_trust_veteran']}]));
  assert.deepEqual(new Set((await db.socialHistory('usr_alt')).map(row=>row.type)),new Set(['DisplayName','TrustLevel']));
  await db.saveSocial('usr_alt',snapshot(3000,[],{friendsComplete:false,errors:{friends:'incomplete'}}));
  assert.equal((await db.socialFriends('usr_alt')).length,1);assert.equal((await db.socialHistory('usr_alt')).length,2);
  await db.saveSocial('usr_alt',snapshot(4000,[]));const rows=await db.socialHistory('usr_alt');assert(rows.some(row=>row.type==='Unfriend'));
  await db.deleteSocialHistory('usr_alt',rows[0].rowId);assert.equal((await db.socialHistory('usr_alt')).length,2);
  await db.saveSocial('usr_other',{...snapshot(5000,[friend]),accountId:'usr_other'});assert.equal((await db.socialHistory('usr_other')).length,0);
  await db.saveUserMemo('usr_other','usr_friend','Other memo');assert.equal((await db.socialFriends('usr_other'))[0].memo,'Other memo');
  assert.equal((await db.socialFriends('usr_alt')).length,0);
});

test('damaged nickname observations keep the last valid baseline and genuine Unicode renames still log',async t=>{
  const db=database(t),friend={id:'usr_friend',displayName:'沐心12 𠮷 😊',tags:['system_trust_basic']};
  await db.saveSocial('usr_alt',snapshot(1000,[friend]));
  await db.saveSocial('usr_alt',snapshot(2000,[{...friend,displayName:'沐\uFFFD\uFFFD12'}]));
  await db.saveSocial('usr_alt',snapshot(3000,[friend]));
  assert.equal((await db.socialHistory('usr_alt')).length,0);
  await db.saveSocial('usr_alt',snapshot(4000,[{...friend,displayName:'凉のONE'}]));
  const [rename]=await db.socialHistory('usr_alt');
  assert.equal(rename.type,'DisplayName');assert.equal(rename.previousDisplayName,friend.displayName);assert.equal(rename.displayName,'凉のONE');
});

test('legacy damaged nickname logs stay archived but disappear from the log view, and recovery is silent',async t=>{
  const db=database(t),friend={id:'usr_friend',displayName:'沐心12',tags:['system_trust_basic']};
  await db.saveSocial('usr_alt',snapshot(1000,[friend]));
  const {database:native,scoped}=await db.account('usr_alt');
  const current=(await native.getFriendLogCurrent())[0],damaged='沐\uFFFD\uFFFD12';
  native.setFriendLogCurrent({...current,displayName:damaged});
  for(const [index,displayName,previousDisplayName] of [[1,damaged,friend.displayName],[2,friend.displayName,damaged],[3,'凉のONE','凉のTWO']])
    native.addFriendLogHistory({...current,created_at:new Date(index).toISOString(),type:'DisplayName',displayName,previousDisplayName});
  native.addFriendLogHistory({...current,created_at:new Date(4).toISOString(),type:'Friend'});
  await scoped.flush();
  await db.saveSocial('usr_alt',snapshot(2000,[friend]));
  assert.equal((await native.getFriendLogHistory()).length,4,'original archive is preserved');
  const visible=await db.socialHistory('usr_alt');assert.equal(visible.length,2);assert(visible.some(row=>row.type==='Friend'));
  assert.equal(visible.find(row=>row.type==='DisplayName').displayName,'凉のONE');
  assert.equal((await native.getFriendLogCurrent())[0].displayName,friend.displayName);
  assert.equal((await db.socialHistory('usr_other')).length,0);
});

test('avatar metadata aliases survive database reopen and remain scoped to their account',async t=>{
  const db=database(t);await db.saveAvatarMetadata('usr_alt',[{key:'https://example.com/image',id:'avtr_a',name:'Target Avatar',image:'https://example.com/image'}]);
  assert.equal(db.avatarInfo('usr_alt','avtr_a').name,'Target Avatar');assert.equal(db.avatarInfo('usr_main','avtr_a'),null);
  db.contexts.delete('usr_alt');await db.account('usr_alt');assert.equal(db.avatarInfo('usr_alt','', 'https://example.com/image').id,'avtr_a');
});

test('loaded target profiles persist bio links and mutual counts without overriding current presence',async t=>{
  const db=database(t);await db.saveSocial('usr_alt',snapshot(1000,[{id:'usr_friend',displayName:'Friend',location:'wrld_current:1',status:'active'}]));
  await db.saveSocialUser('usr_alt',{id:'usr_friend',displayName:'Friend',bio:'Profile bio',bioLinks:['https://example.com'],date_joined:'2020-01-01',mutualCount:3,location:'wrld_previous:1'});
  await db.saveSocialUser('usr_alt',{id:'usr_friend',displayName:'Friend',bio:'New bio'});
  const friend=(await db.socialFriends('usr_alt'))[0];assert.equal(friend.bio,'New bio');assert.deepEqual(friend.bioLinks,['https://example.com']);assert.equal(friend.mutualCount,3);
  assert.equal(friend.location,'wrld_current:1');assert(friend.profileLoaded);assert.equal(friend.date_joined,'2020-01-01');
  assert.equal((await db.socialFriends('usr_other')).length,0);
});

test('target user details read native profile and mutual-count endpoints through the isolated client',async t=>{
  const calls=[],s=service(t,async path=>{
    calls.push(path);if(path==='users/usr_friend')return {id:'usr_friend',displayName:'Friend',email:'secret'};
    if(path==='profile/usr_friend')return {bio:'Profile',bioLinks:['https://example.com']};
    if(path==='users/usr_friend/mutuals')return {friends:3,groups:2};throw new Error('unexpected');
  });
  const result=await s.socialUserDetails('usr_alt','usr_friend',{mutuals:true});assert.equal(result.user.bio,'Profile');assert.equal(result.user.mutualCount,3);assert(!Object.hasOwn(result.user,'email'));
  assert.deepEqual(calls,['users/usr_friend','profile/usr_friend','users/usr_friend/mutuals']);
});
test('native social reads use a fixed target-authenticated endpoint and sanitize profiles',async t=>{
 const calls=[],s=service(t,async(path,options)=>{calls.push({path,options});if(path==='profile/usr_friend')return {bio:'Visible',email:'secret',authToken:'secret'};if(path==='users/usr_friend/groups')return [];return [];});
 const profile=await s.nativeSocialQuery({accountId:'usr_alt',kind:'profile',params:{userId:'usr_friend',url:'auth/user'}});assert.deepEqual(profile,{accountId:'usr_alt',data:{bio:'Visible'}});
 await s.nativeSocialQuery({accountId:'usr_alt',kind:'userGroups',params:{userId:'usr_friend'}});assert.equal(calls[1].path,'users/usr_friend/groups');
 await assert.rejects(s.nativeSocialQuery({accountId:'usr_main',kind:'profile',params:{userId:'usr_friend'}}));await assert.rejects(s.nativeSocialQuery({accountId:'usr_alt',kind:'auth',params:{url:'auth/user'}}));assert.equal(calls.length,2);
});

test('a social snapshot completing after a target switch is discarded',async()=>{
 let complete;const view={accountId:'usr_alt',controller:{social:()=>new Promise(resolve=>{complete=resolve;})}};
 const social=new MonikaSocialView(view),pending=social.load();view.accountId='usr_other';social.reset('usr_other');complete(snapshot(1000,[]));await pending;
 assert.equal(social.snapshot,null);assert.equal(social.accountId,'usr_other');
});

test('social type selections are multiple, log search matches native names, moderation search matches either party',()=>{
  const rows=[{type:'Friend',displayName:'Alpha',created_at:'2026-11-10',rowId:1},{type:'Unfriend',displayName:'Alpha',created_at:'2026-11-11',rowId:2},{type:'DisplayName',displayName:'Beta',previousDisplayName:'Alpha',created_at:'2026-11-09',rowId:3}];
  assert.deepEqual(socialLogRows(rows,{types:['Friend','Unfriend'],search:'alpha'}).map(row=>row.rowId),[2,1]);
  assert.deepEqual(socialLogRows(rows,{search:'alpha',hideUnfriends:true}).map(row=>row.rowId),[1]);assert.equal(rows[0].rowId,1);
  assert.equal(socialModerationRows([{type:'block',sourceDisplayName:'Alpha',targetDisplayName:'Beta',created:'2026-11-10'}],{search:'beta',types:['block','mute']}).length,1);
});

test('friend searches respect chosen fields and VRChat favorite groups, preserving native friend-number sorting',()=>{
  const data=snapshot(1000,[{id:'usr_a',displayName:'Alpha',bio:'Text',memo:'Private memo',tags:['system_trust_veteran'],friendNumber:1},{id:'usr_b',displayName:'Beta',tags:[],friendNumber:2}],{favorites:[{favoriteId:'usr_a',tags:['group_0']}]});
  assert.deepEqual(socialFriendRows(data).map(user=>user.id),['usr_b','usr_a']);
  assert.deepEqual(socialFriendRows(data,{group:'group_0'}).map(user=>user.id),['usr_a']);
  assert.equal(socialFriendRows(data,{fields:['Display Name'],search:'memo'}).length,0);assert.equal(socialFriendRows(data,{search:'memo'}).length,1);
  assert.equal(socialFriendRows(data,{fields:['Rank'],search:'trusted'}).length,1);
});

test('social UI disposes the native scope when the target changes',async()=>{
 const view={accountId:'usr_alt',controller:{social:async()=>snapshot(1000,[{id:'usr_friend',displayName:'<unsafe>',tags:[]}])}};
 const social=new MonikaSocialView(view);await social.load();assert.equal(social.html(),'<div data-monika-native></div>');
 let disposed=0;social.native={dispose(){disposed++;}};view.accountId='usr_other';view.controller.social=async()=>({...snapshot(2000,[]),accountId:'usr_other'});await social.load();
 assert.equal(disposed,1);assert.equal(social.native,null);assert.equal(social.accountId,'usr_other');
});

test('activity defaults to a rolling 24-hour interval and target selection follows service identity',()=>{
  const now=new Date('2026-11-11T01:23:45+08:00').getTime();
  assert.deepEqual(activityRange('rolling24','2026-11-10','2026-11-11',now),{from:now-86400000,to:now});
  assert.deepEqual(activityRange('dates','2026-11-10','2026-11-10',now),dateBounds('2026-11-10','2026-11-10'));
  const view=Object.create(MonikaView.prototype);Object.assign(view,{accountId:'usr_old',history:{},visitNavigationVersion:0,status:{user:{id:'usr_new'},accounts:[]},controller:{config:()=>({accountId:'usr_old'})}});
  assert(view.followTargetAccount());assert.equal(view.accountId,'usr_new');assert.equal(view.history,null);
  view.status.user=null;assert(view.followTargetAccount());assert.equal(view.accountId,'usr_old');
});

test('a model link uses verified IDs and escaped names; file-only names remain readable',()=>{
  const view=Object.create(MonikaView.prototype);view.accountId='usr_alt';view.controller={avatarInfo:()=>({name:'<Avatar>',id:'avtr_a'})};
  assert(view.modelLink({image:'https://example.com/image'}).includes('data-avatar="avtr_a"'));assert(view.modelLink({}).includes('&lt;Avatar&gt;'));
  view.controller.avatarInfo=()=>({name:'File Avatar',id:''});assert.equal(view.modelLink({image:'https://example.com/file'}),'<span>File Avatar</span>');
});

test('a primary session change cannot be hidden by the social cached-data fallback',async()=>{
  const p=new MonikaPlugin();let current={id:'usr_main',generation:1};p.session=()=>current;
  p.api=async()=>{current={id:'usr_main',generation:2};return snapshot(1000,[]);};p.database={social:async()=>snapshot(500,[]),saveSocial:async()=>{throw new Error('must not write');}};
  await assert.rejects(p.social('usr_alt'),/会话变化/);
});

test('social account mutations are rejected by the frontend without sending requests',async()=>{
 const p=new MonikaPlugin(),calls=[];p.api=async(...args)=>{calls.push(args);throw new Error('unexpected request');};
 for(const action of ['unfriend','favoriteAdd','favoriteRemove','groupEdit','groupClear','moderationDelete','moderationClear'])await assert.rejects(p.socialAction('usr_alt',action,{}),/只读/);
 for(const kind of ['saveNote','sendInvite','selfInvite','moderationCreate','auth'])await assert.rejects(p.nativeQuery('usr_alt',kind,{}),/只读/);
 assert.deepEqual(calls,[]);
});
