import test from 'node:test';
import assert from 'node:assert/strict';
import { MonikaView } from '../src/view.mjs';
import { MonikaService } from '../server/service.mjs';
import { createVrcxWorldRef,vrcxFeedDifference,vrcxBioLinksDifference,vrcxParseLocation,vrcxFeedFilterChange } from '../src/vendor-vrcx.mjs';
import { openVrcxWorldPage } from '../src/native-world.mjs';

function viewFixture(nativeHistory) {
  const renders=[],view=Object.create(MonikaView.prototype);
  Object.assign(view,{tab:'native',from:'2026-11-10',to:'2026-11-10',accountId:'usr_alt',page:1,eventType:'',nativeTypes:['Status'],
    history:{events:[{type:'Status'}]},expandedFeed:new Set(),refreshVersion:0,visitNavigationVersion:0,status:{accounts:[]},
    controller:{history:async()=>({stats:{},visits:[]}),nativeHistory},
    render(){renders.push({types:[...this.nativeTypes],loading:this.loadingHistory,events:this.history?.events,error:this.error});}});
  return {view,renders};
}

test('empty native Bio filter is immediate and cannot be overwritten by an earlier slow Status query',async()=>{
  let resolveStatus;
  const {view,renders}=viewFixture(async(id,options)=>options.nativeTypes.includes('Status')
    ?new Promise(resolve=>{resolveStatus=resolve;}):{events:[],eventTotal:0});
  const first=view.refreshSelection();await Promise.resolve();
  assert.equal(renders[0].loading,true);assert.equal(renders[0].events,undefined);
  view.nativeTypes=['Bio'];await view.refreshSelection();
  assert.deepEqual(view.history.events,[]);assert.equal(view.loadingHistory,false);
  resolveStatus({events:[{type:'Status'}],eventTotal:1});await first;
  assert.deepEqual(view.nativeTypes,['Bio']);assert.deepEqual(view.history.events,[]);
});

test('failed native filter clears old rows and reports its error',async()=>{
  const {view}=viewFixture(async()=>{throw new Error('SQLite unavailable');});
  await view.refreshSelection();assert.equal(view.history,null);assert.equal(view.error,'SQLite unavailable');assert.equal(view.loadingHistory,false);
});

test('CEF string errors are shown and a subsequent native query can render without manual refresh',async()=>{
  let fail=true;
  const {view}=viewFixture(async()=>{if(fail){fail=false;throw 'SQLiteException: no such column: bio_links';}return {events:[{type:'Status'}]};});
  await view.refreshSelection();assert.equal(view.history,null);assert.equal(view.error,'SQLiteException: no such column: bio_links');
  await view.refreshSelection();assert.equal(view.error,'');assert.deepEqual(view.history.events,[{type:'Status'}]);
});

test('VRCX filter rules keep All exclusive and support multiple types, all selected and none selected',()=>{
  assert.deepEqual(vrcxFeedFilterChange([],['All','Bio']),['Bio']);
  assert.deepEqual(vrcxFeedFilterChange(['Status'],['Status','Avatar']),['Status','Avatar']);
  assert.deepEqual(vrcxFeedFilterChange(['Status','Avatar'],['Status','Avatar','All']),[]);
  assert.deepEqual(vrcxFeedFilterChange(['Bio'],[]),[]);
  assert.deepEqual(vrcxFeedFilterChange([],[]),[]);
  assert.deepEqual(vrcxFeedFilterChange(['Bio'],['GPS','Online','Offline','Status','Avatar','Bio']),[]);
});

test('native filter clicks query immediately: empty Bio, All, multiple types and deselecting',async t=>{
  const previous=globalThis.vrcxFeedFilterChange;globalThis.vrcxFeedFilterChange=vrcxFeedFilterChange;
  t.after(()=>{if(previous===undefined)delete globalThis.vrcxFeedFilterChange;else globalThis.vrcxFeedFilterChange=previous;});
  const events=[{type:'Status'},{type:'Avatar'},{type:'GPS'}],queries=[];
  const {view}=viewFixture(async(id,options)=>{
    queries.push([...options.nativeTypes]);
    const rows=events.filter(event=>!options.nativeTypes.length || options.nativeTypes.includes(event.type));
    return {events:rows,eventTotal:rows.length};
  });
  view.nativeTypes=[];
  const click=async type=>{
    const target={dataset:{nativeType:type},disabled:false};
    await view.click({target:{closest:()=>target}});
  };
  await click('Bio');assert.deepEqual(view.history.events,[]);assert(view.nativeFeedHtml().includes('暂无数据'));
  await click('All');assert.equal(view.history.events.length,3);assert(!view.loadingHistory);
  await click('Status');await click('Avatar');assert.deepEqual(view.history.events.map(e=>e.type),['Status','Avatar']);
  const html=view.nativeFeedHtml();assert(html.includes('data-native-type="Status" aria-pressed="true"'));assert(html.includes('data-native-type="Avatar" aria-pressed="true"'));assert(html.includes('data-native-type="All" aria-pressed="false"'));
  await click('Status');assert.deepEqual(view.nativeTypes,['Avatar']);
  await click('Avatar');assert.deepEqual(view.nativeTypes,[]);assert.equal(view.history.events.length,3);
  assert.deepEqual(queries,[['Bio'],[],['Status'],['Status','Avatar'],['Avatar'],[]]);
});

test('copied VRCX bio diffs escape HTML and retain added/removed links',()=>{
  const diff=vrcxFeedDifference('old text','new <script>alert(1)</script>');
  assert(diff.includes('x-text-added'));assert(diff.includes('x-text-removed'));assert(!diff.includes('<script>'));
  assert.deepEqual(vrcxBioLinksDifference(['https://old.test'],['https://new.test']).map(x=>x.className),['x-text-added','x-text-removed']);
});

function serviceFixture(t,request) {
  const service=new MonikaService({read:(name,fallback)=>fallback,write(){},journal:()=>({replay:[],append(){}})});
  service.active={user:{id:'usr_alt',displayName:'Alt',status:'ask me',location:'wrld_a:1'},
    client:{request,instance:async()=>({worldId:'wrld_a',instanceId:'1',userCount:12}),exportCookies:()=>'',close(){}}};
  const r=service.recorder('usr_alt');r.observeSelf(service.active.user,1000);
  r.observeRoster([{id:'usr_friend',displayName:'Friend',location:'wrld_a:1'}],service.active.user,1100);
  t.after(()=>service.stop());return service;
}

test('secondary world lookup covers friend worlds, persists names, deduplicates and rejects other identities',async t=>{
  const calls=[],service=serviceFixture(t,async path=>{calls.push(path);return {id:path.slice(7),name:'Friend World'};});
  const names=await service.resolveWorldNames({accountId:'usr_alt',worldIds:['wrld_friend','wrld_friend']});
  assert.equal(names.names.wrld_friend,'Friend World');assert.equal(service.recorder('usr_alt').worldNames.get('wrld_friend'),'Friend World');
  await service.resolveWorldNames({accountId:'usr_alt',worldIds:['wrld_friend']});assert.equal(calls.length,1);
  await assert.rejects(service.worldDetails('usr_main','wrld_a','wrld_a:1'),/目标账号/);
  const detail=await service.worldDetails('usr_alt','wrld_a','wrld_a:1');
  assert.equal(detail.accountId,'usr_alt');assert.equal(detail.instance.userCount,12);assert.deepEqual(new Set(detail.people.map(p=>p.id)),new Set(['usr_alt','usr_friend']));
  await assert.rejects(service.worldDetails('usr_alt','wrld_a','wrld_other:1'),/不匹配/);
});

test('late world responses after account changes cannot persist another account metadata',async t=>{
  let resolve;const service=serviceFixture(t,()=>new Promise(done=>{resolve=done;}));
  const request=service.worldDetails('usr_alt','wrld_a');service.stop('account-switch');resolve({id:'wrld_a',name:'Too late'});
  await assert.rejects(request,/会话已变化/);assert(!service.recorder('usr_alt').worldNames.has('wrld_a'));
});

test('friend-only instances outside self visits display secondary friends and an independently resolved creator in the native dialog',async t=>{
  const calls=[],location='wrld_friends:42~hidden(usr_owner)~region(jp)';
  const service=serviceFixture(t,async path=>{
    calls.push(path);
    if(path==='worlds/wrld_friends')return {id:'wrld_friends',name:'Friends World',instances:[['9~region(jp)',4]]};
    if(path==='users/usr_owner')return {id:'usr_owner',displayName:'Creator',location:'offline',isFriend:true,currentAvatarThumbnailImageUrl:'https://example.com/owner.png',email:'private@example.com'};
    throw new Error('unexpected request');
  });
  service.active.client.instance=async tag=>({worldId:tag.split(':')[0],instanceId:tag.split(':')[1],userCount:12});
  const recorder=service.recorder('usr_alt');
  recorder.observeRoster([{id:'usr_friend',displayName:'Secondary Friend',location,status:'active',currentAvatarThumbnailImageUrl:'https://example.com/friend.png'},
    {id:'usr_other_room',displayName:'Other Room',location:'wrld_friends:9~region(jp)'},
    {id:'usr_same_number',displayName:'Different Access',location:'wrld_friends:42~friends(usr_owner)~region(jp)'},
    {id:'usr_hidden',displayName:'Invisible',location:'private'}],service.active.user,1200);
  assert(!recorder.activeVisits.has(location));
  const detail=await service.worldDetails('usr_alt','wrld_friends',location);
  assert.deepEqual(detail.people.map(p=>p.id),['usr_friend']);assert.equal(detail.people[0].currentAvatarThumbnailImageUrl,'https://example.com/friend.png');
  assert.equal(detail.creators.usr_owner.displayName,'Creator');assert.equal(detail.creators.usr_owner.location,'offline');assert(!('email' in detail.creators.usr_owner));
  assert(!recorder.cloudUsers.has('usr_owner'));assert.deepEqual(calls,['worlds/wrld_friends','users/usr_owner']);
  await service.worldDetails('usr_alt','wrld_friends',location);assert.equal(calls.length,2);
  const oldRef=globalThis.createVrcxWorldRef,oldParser=globalThis.vrcxParseLocation;
  globalThis.createVrcxWorldRef=createVrcxWorldRef;globalThis.vrcxParseLocation=vrcxParseLocation;
  t.after(()=>{if(oldRef===undefined)delete globalThis.createVrcxWorldRef;else globalThis.createVrcxWorldRef=oldRef;if(oldParser===undefined)delete globalThis.vrcxParseLocation;else globalThis.vrcxParseLocation=oldParser;});
  const main={id:'usr_main'},primaryUsers=new Map([['usr_main',main]]),stores={user:{currentUser:main,cachedUsers:primaryUsers},world:{worldDialog:{}},ui:{openDialog(){}}};
  openVrcxWorldPage(stores,undefined,detail,location);
  const rooms=stores.world.worldDialog.rooms;
  assert.equal(rooms[0].tag,location);assert.deepEqual(rooms[0].users.map(p=>p.displayName),['Secondary Friend']);assert.equal(rooms[0].$location.user.displayName,'Creator');
  assert.deepEqual(rooms[1].users.map(p=>p.id),['usr_other_room']);assert.equal(rooms.length,3);
  assert.equal(stores.user.currentUser,main);assert.deepEqual([...primaryUsers.keys()],['usr_main']);
});

test('a cached creator outside the room is displayed without treating them as an occupant or fetching their profile',async t=>{
  const calls=[],service=serviceFixture(t,async path=>{calls.push(path);return {id:'wrld_a',name:'World'};});
  const recorder=service.recorder('usr_alt'),location='wrld_a:5~friends(usr_owner)~region(jp)';
  recorder.observeRoster([{id:'usr_owner',displayName:'Known Creator',location:'wrld_elsewhere:1',status:'active'},
    {id:'usr_friend',displayName:'Friend',location}],service.active.user,1200);
  const detail=await service.worldDetails('usr_alt','wrld_a',location);
  assert.deepEqual(detail.people.map(p=>p.id),['usr_friend']);assert.equal(detail.creators.usr_owner.displayName,'Known Creator');
  assert.deepEqual(calls,['worlds/wrld_a']);
});

test('a denied creator lookup retains visible secondary friends and backs off repeated requests',async t=>{
  let lookups=0;const service=serviceFixture(t,async path=>{
    if(path.startsWith('users/')){lookups++;throw Object.assign(new Error('denied'),{status:403});}
    return {id:'wrld_a',name:'World'};
  });
  const location='wrld_a:5~hidden(usr_owner)';
  service.recorder('usr_alt').observeRoster([{id:'usr_friend',displayName:'Friend',location}],service.active.user,1200);
  for(let i=0;i<2;i++){
    const detail=await service.worldDetails('usr_alt','wrld_a',location);
    assert.deepEqual(detail.people.map(p=>p.id),['usr_friend']);assert.deepEqual(detail.creators,{});
  }
  assert.equal(lookups,1);
});

test('creator requests finishing after an account switch cannot populate another account cache',async t=>{
  let resolveCreator,started;const creatorStarted=new Promise(resolve=>{started=resolve;});
  const service=serviceFixture(t,async path=>{
    if(path.startsWith('users/'))return new Promise(resolve=>{resolveCreator=resolve;started();});
    return {id:'wrld_a',name:'World'};
  });
  const pending=service.worldDetails('usr_alt','wrld_a','wrld_a:5~friends(usr_owner)');
  await creatorStarted;service.stop('account-switch');resolveCreator({id:'usr_owner',displayName:'Too late'});
  await assert.rejects(pending,/会话已变化/);assert.equal(service.worldUserCache.size,0);
});

test('public instance creator IDs use the secondary lookup and mismatched user responses are rejected',async t=>{
  const service=serviceFixture(t,async path=>path.startsWith('users/')?{id:'usr_wrong',displayName:'Wrong'}:{id:'wrld_a',name:'World'});
  service.active.client.instance=async()=>({worldId:'wrld_a',instanceId:'5',userCount:12,ownerId:'usr_owner'});
  await assert.rejects(service.worldDetails('usr_alt','wrld_a','wrld_a:5'),/建立者资料与请求身份不匹配/);
  assert.equal(service.worldUserCache.size,0);
});

test('native world page selects the requested instance and excludes primary local data during remounts',t=>{
  const previous=globalThis.createVrcxWorldRef;globalThis.createVrcxWorldRef=createVrcxWorldRef;
  t.after(()=>{if(previous===undefined)delete globalThis.createVrcxWorldRef;else globalThis.createVrcxWorldRef=previous;});
  let callback,closed=false,opened;
  const primary={id:'usr_main'},worldDialog={rooms:[{users:[primary]}]},stores={user:{currentUser:primary},
    world:{worldDialog,$subscribe(fn){callback=fn;return()=>{closed=true;};}},ui:{openDialog(args){opened=args;}}};
  const parseLocation=tag=>({tag,worldId:tag.split(':')[0],instanceId:tag.split(':')[1] || ''});
  const data={accountId:'usr_alt',world:{id:'wrld_a',name:'World',slimInstances:[{instanceId:'2',n_users:6}]},
    instance:{userCount:12},people:[{id:'usr_alt'}]};
  const stop=openVrcxWorldPage(stores,{parseLocation},data,'wrld_a:1');
  assert.equal(opened.type,'world');assert.equal(opened.tag,'wrld_a:1');assert.equal(worldDialog.rooms[0].tag,'wrld_a:1');
  assert.deepEqual(worldDialog.rooms[0].users,[{id:'usr_alt'}]);assert.equal(stores.user.currentUser,primary);
  worldDialog.rooms=[{tag:'wrld_a:1',users:[primary]}];callback();
  assert.deepEqual(worldDialog.rooms[0].users,[{id:'usr_alt'}]);assert.equal(worldDialog.ref.name,'World');
  stop();assert(closed);
});

test('native world page uses the original parser when the host exposes no global location utilities',t=>{
  const previousRef=globalThis.createVrcxWorldRef,previousParser=globalThis.vrcxParseLocation;
  globalThis.createVrcxWorldRef=createVrcxWorldRef;globalThis.vrcxParseLocation=vrcxParseLocation;
  t.after(()=>{
    if(previousRef===undefined)delete globalThis.createVrcxWorldRef;else globalThis.createVrcxWorldRef=previousRef;
    if(previousParser===undefined)delete globalThis.vrcxParseLocation;else globalThis.vrcxParseLocation=previousParser;
  });
  const opened=[],worldDialog={},stores={world:{worldDialog},ui:{openDialog:args=>opened.push(args)}};
  const instanceId='42~private(usr_alt)~canRequestInvite~region(jp)~strict~ageGate';
  const tag=`wrld_a:${instanceId}`;
  openVrcxWorldPage(stores,{}, {world:{id:'wrld_a',name:'World',instances:[['2~region(eu)',6]]},instance:{userCount:12,shortName:'secret'},people:[{id:'usr_alt'}]},tag);
  assert.equal(opened[0].tag,tag);assert.equal(worldDialog.rooms[0].tag,tag);assert.equal(worldDialog.activeTab,'Instances');
  const L=worldDialog.rooms[0].$location;
  assert.equal(L.accessType,'invite+');assert.equal(L.region,'jp');assert.equal(L.instanceName,'42');assert.equal(L.userId,'usr_alt');
  assert.equal(L.ageGate,true);assert.equal(L.strict,true);assert.equal(L.shortName,'secret');assert.deepEqual(L.user,{id:'usr_alt'});
  assert.equal(worldDialog.rooms[1].$location.region,'eu');
  openVrcxWorldPage(stores,undefined,{world:{id:'wrld_a',name:'World'}},'wrld_a');assert.equal(worldDialog.id,'wrld_a');
  assert.throws(()=>openVrcxWorldPage({ui:stores.ui},undefined,{},tag),/world\.worldDialog/);
  assert.throws(()=>openVrcxWorldPage({world:stores.world},undefined,{},tag),/ui\.openDialog/);
});
