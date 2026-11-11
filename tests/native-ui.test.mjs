import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { Script } from 'node:vm';
const code=await readFile(new URL('../dist/native-ui.js',import.meta.url),'utf8');
const pluginCode=await readFile(new URL('../dist/monika.js',import.meta.url),'utf8');
const manifest=JSON.parse(await readFile(new URL('../dist/native-ui-manifest.json',import.meta.url),'utf8'));
const workerCode=await readFile(new URL('../dist/native-graph-worker.js',import.meta.url),'utf8');
function setup({embedded=false}={}){
 const dom=new JSDOM('<div id="app"></div>',{url:'http://localhost/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
 const errors=[],calls=[];
 w.addEventListener('error',e=>errors.push(e.error?.stack || e.message));
 w.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
 w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});w.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};
 w.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};w.Element.prototype.scrollIntoView=function(){};w.Element.prototype.hasPointerCapture=()=>false;
 w.$pinia={appearanceSettings:{tablePageSize:20,tablePageSizes:[20,50]}};
 if(embedded){
  w.customjs={classes:{CustomModule:class{}}};
  // Expose the actual view for this test only, without changing the compiled plugin's behavior.
  w.eval(pluginCode.replace('window.customjs.__LAST_PLUGIN_CLASS__ = MonikaPlugin;','window.customjs.__LAST_PLUGIN_CLASS__ = MonikaPlugin;window.__MonikaView=MonikaView;'));
 }else w.eval(code);
 const controller={view:{accountId:'usr_target',status:{user:{id:'usr_target',displayName:'Target'}}},nativeError:e=>errors.push(String(e)),nativeMessage(){},
  nativeQuery:async(account,kind,params)=>{calls.push({account,kind,params});if(kind==='profile')return {bio:'Target-visible bio',bioLinks:[],pronouns:'she/her',iconUrl:''};return [];},nativeActivity:async()=>({selfSessions:[],friendSessions:[],worldVisits:[]}),
  socialUser:async(account,id)=>{calls.push({account,kind:'user',id});return {id,displayName:'Target Friend',tags:[],bio:'Target-visible bio',profileLoaded:true};},api:async()=>({assets:[]}),database:{},confirm:async()=>true,prompt:async()=>null
 };
 const snapshot={accountId:'usr_target',friends:[{id:'usr_friend',displayName:'Target Friend',tags:[],friendNumber:1,bio:'<unsafe>',profileLoaded:true}],history:[{rowId:1,created_at:'2026-11-11T10:00:00Z',type:'Friend',userId:'usr_friend',displayName:'Target Friend'}],groups:[{type:'friend',name:'group_0',displayName:'Target Favorites',visibility:'private'}],favorites:[{type:'friend',id:'fvrt_1',favoriteId:'usr_friend',tags:['group_0']}],moderations:[
  {id:'pmod_block',created:'2026-11-11T10:00:00Z',type:'block',sourceUserId:'usr_target',sourceDisplayName:'Target',targetUserId:'usr_friend',targetDisplayName:'Target Friend'},
  {id:'pmod_unknown',created:'2026-11-11T09:00:00Z',type:'future_moderation_type',sourceUserId:'usr_target',sourceDisplayName:'Target',targetUserId:'usr_other',targetDisplayName:'Other Player'}
 ]};
 let ui,view;
 if(embedded){
  const status=controller.view.status;controller.metadata={build:'test'};controller.serviceConnected=true;controller.worldName=()=>'';
  view=new w.__MonikaView(controller);controller.view=view;view.status={accounts:[],...status};view.accountId=snapshot.accountId;view.tab='social';
  view.socialView.accountId=snapshot.accountId;view.socialView.snapshot=snapshot;
  w.document.getElementById('app').append(view.root);view.render();
  ui={dispose:()=>view.socialView.dispose()};
 }else ui=w.MonikaNativeUi.mount(w.document.getElementById('app'),controller,snapshot);
 return {dom,w,errors,calls,controller,snapshot,ui,view};
}
const tick=()=>new Promise(resolve=>setTimeout(resolve,40));
const searchTick=()=>new Promise(resolve=>setTimeout(resolve,240));
function cleanup(s){s.ui.dispose();s.dom.window.close();assert.deepEqual(s.errors,[],'no asynchronous UI errors');}
function activateTab(w,tab){assert(tab,'native tab exists');tab.dispatchEvent(new w.MouseEvent('mousedown',{bubbles:true,button:0}));tab.click();}
test('native social and graph sources are tracked with explicit target-account adaptations',async()=>{
 for(const name of ['views/FriendLog/FriendLog.vue','views/FriendList/FriendList.vue','views/Moderation/Moderation.vue','views/Favorites/FavoritesFriend.vue','components/dialogs/UserDialog/UserDialog.vue','components/dialogs/UserDialog/UserSummaryHeader.vue','components/dialogs/UserDialog/UserDialogInfoTab.vue']){
  const source=await readFile(new URL(`../vendor/vrcx/src/${name}`,import.meta.url),'utf8');assert.equal(manifest.find(x=>x.file===name)?.source,createHash('sha256').update(source).digest('hex'),name);
 }
 for(const name of ['views/FriendList/FriendList.vue','views/Moderation/Moderation.vue','views/Charts/components/MutualFriends.vue','stores/charts.js'])assert(manifest.find(x=>x.file===name)?.adaptedSource,name);
 assert(manifest.find(x=>x.file==='views/Charts/graphLayoutWorker.js')?.worker);
});
test('real native social pages mount, retain inputs on refresh, and use target-scoped column persistence',async t=>{
 const s=setup();t.after(()=>cleanup(s));await tick();
 assert.deepEqual(s.errors,[]);assert.match(s.w.document.body.textContent,/Target Friend/);
 const tabs=()=>[...s.w.document.querySelectorAll('[role=tab]')];
 activateTab(s.w,tabs().find(x=>x.textContent==='好友列表'));await tick();assert.deepEqual(s.errors,[]);
 const panel=s.w.document.querySelector('[role=tabpanel][data-state=active]');
 assert.match(panel.textContent,/Target Friend/);const input=panel.querySelector('input');input.value='tárget';input.dispatchEvent(new s.w.Event('input',{bubbles:true}));await searchTick();
 assert.match(panel.querySelector('tbody').textContent,/Target Friend/,'native locale search ignores case and accents');assert.deepEqual(s.errors,[]);
 input.value='absent';input.dispatchEvent(new s.w.Event('input',{bubbles:true}));await searchTick();assert(!panel.querySelector('tbody').textContent.includes('Target Friend'));
 input.value='Target';input.dispatchEvent(new s.w.Event('input',{bubbles:true}));await searchTick();
 s.ui.update(s.snapshot);await tick();assert.equal(panel.querySelector('input'),input);
 for(const label of ['玩家管理','好友分组']){activateTab(s.w,tabs().find(x=>x.textContent===label));await tick();assert.deepEqual(s.errors,[],label);}
 assert.match(s.w.document.body.textContent,/Target Favorites/);
 for(let i=0;i<s.w.localStorage.length;i++)assert(s.w.localStorage.key(i).startsWith('monika:usr_target:'),s.w.localStorage.key(i));
});
test('native moderation rows render localized and unknown types on entry and refresh',async t=>{
 const s=setup();t.after(()=>cleanup(s));await tick();
 assert.deepEqual(s.errors,[],'nonempty moderation data must not break social entry');
 const open=async label=>{activateTab(s.w,[...s.w.document.querySelectorAll('[role=tab]')].find(x=>x.textContent===label));await tick();assert.deepEqual(s.errors,[],label);};
 const labels=JSON.parse(await readFile(new URL('../vendor/vrcx/src/localization/zh-CN.json',import.meta.url),'utf8'));
 const assertTypes=()=>{const rows=[...s.w.document.querySelectorAll('tbody tr')].map(row=>row.textContent);assert(rows.some(row=>row.includes(labels.view.moderation.filters.block)),'known type uses the original translation');assert(rows.some(row=>row.includes('future_moderation_type')),'unknown type retains the API value');};
 await open('玩家管理');assertTypes();
 s.ui.update({...s.snapshot,moderations:[]});await tick();assert.deepEqual(s.errors,[]);
 s.ui.update(s.snapshot);await tick();assert.deepEqual(s.errors,[]);assertTypes();
 for(const label of ['好友日志','好友列表','好友分组','玩家管理'])await open(label);
 assertTypes();
});
test('the final plugin shell reserves space for social content and retains native views on refresh',async t=>{
 const s=setup({embedded:true});t.after(()=>cleanup(s));await tick();
 const header=s.view.root.querySelector(':scope > .monika'),host=s.view.socialView.host;
 assert.equal(s.w.getComputedStyle(header).minHeight,'0px','social header must not inherit the full-page minimum height');
 assert.equal(s.view.error,'');assert(host.querySelector('tbody tr'));
 activateTab(s.w,[...host.querySelectorAll('[role=tab]')].find(x=>x.textContent==='好友列表'));await tick();
 assert.equal(host.querySelector('[role=tab][aria-selected=true]').textContent,'好友列表');
 const input=host.querySelector('[role=tabpanel][data-state=active] input');input.focus();input.value='Target';input.dispatchEvent(new s.w.Event('input',{bubbles:true}));await searchTick();
 s.view.render();await tick();assert.equal(s.view.socialView.host,host);assert.equal(s.w.document.activeElement,input);
 assert.equal(host.querySelector('[role=tab][aria-selected=true]').textContent,'好友列表');assert.equal(s.view.error,'');
 s.view.tab='activity';s.view.render();assert.equal(s.w.getComputedStyle(s.view.root).minHeight,'100%','full pages retain their original minimum height');
 s.view.tab='social';s.view.render();await tick();assert.equal(s.view.socialView.host,host);assert.equal(s.view.error,'');
 assert.equal(s.w.getComputedStyle(s.view.root.querySelector(':scope > .monika')).minHeight,'0px');
});
test('friend clicks open the complete native dialog using target identity',async t=>{
 const s=setup();t.after(()=>cleanup(s));await tick();
 const user=[...s.w.document.querySelectorAll('span')].find(x=>x.textContent==='Target Friend'&&x.className.includes('pr-2.5'));assert(user,'native friend click target');user.dispatchEvent(new s.w.MouseEvent('click',{bubbles:true}));await tick();await tick();
 assert.deepEqual(s.errors,[]);assert(s.w.document.querySelector('[role=dialog]'));
 assert.match(s.w.document.querySelector('[role=dialog]').textContent,/Target-visible bio/);
 assert(s.calls.some(x=>x.kind==='profile' && x.account==='usr_target'));assert(s.calls.every(x=>x.account==='usr_target'));
 const labels=JSON.parse(await readFile(new URL('../vendor/vrcx/src/localization/zh-CN.json',import.meta.url),'utf8')).dialog.user;
 assert(![...s.w.document.querySelectorAll('[role=dialog] [role=tab]')].some(x=>x.textContent===labels.avatars.header),'other users have no API avatar list');
 for(const key of ['mutual_friends','groups','worlds','favorite_worlds','json']){const tab=[...s.w.document.querySelectorAll('[role=dialog] [role=tab]')].find(x=>x.textContent===labels[key].header);assert(tab,key);activateTab(s.w,tab);await tick();assert.deepEqual(s.errors,[],key);}
});
test('native favorite cards open the user ID rather than the favorite record ID',async t=>{
 const s=setup();t.after(()=>cleanup(s));await tick();
 activateTab(s.w,[...s.w.document.querySelectorAll('[role=tab]')].find(x=>x.textContent==='好友分组'));await tick();
 s.w.document.querySelector('.group-item')?.click();await tick();
 const card=s.w.document.querySelector('.favorites-card-list .favorites-item');assert(card,s.w.document.querySelector('.favorites-card-list')?.outerHTML || s.w.document.body.textContent);card.click();await tick();await tick();assert(s.calls.some(x=>x.kind==='user' && x.id==='usr_friend'));assert.deepEqual(s.errors,[]);
});

test('native social tables retain API columns and remove account mutation controls',async t=>{
 const s=setup();t.after(()=>cleanup(s));await tick();
 const labels=JSON.parse(await readFile(new URL('../vendor/vrcx/src/localization/zh-CN.json',import.meta.url),'utf8'));
 const open=async label=>{activateTab(s.w,[...s.w.document.querySelectorAll('[role=tab]')].find(x=>x.textContent===label));await tick();return s.w.document.querySelector('[role=tabpanel][data-state=active]');};
 const friends=await open('好友列表'),headers=[...friends.querySelectorAll('th')].map(x=>x.textContent.trim());
 for(const key of ['joinCount','timeTogether','lastSeen','friendNumber','unfriend'])assert(!headers.includes(labels.table.friendList[key]),key);
 for(const key of ['displayName','status','mutualFriends'])assert(headers.includes(labels.table.friendList[key]),key);
 for(const label of [labels.view.friend_list.bulk_unfriend,labels.view.friend_list.load])assert(![...friends.querySelectorAll('button,span')].some(x=>x.textContent.trim()===label),label);
 assert(!friends.querySelector('[role=switch]'));
 const moderation=await open('玩家管理');assert(!moderation.querySelector('tbody button'),'moderation actions removed');
 const groups=await open('好友分组');assert(!groups.querySelector('[role=switch]'),'favorites have no edit mode');
 assert(!groups.textContent.includes(labels.view.favorite.worlds.local_favorites),'local favorites removed');
 s.w.document.querySelector('.favorites-card-list .favorites-item')?.click();await tick();await tick();
 const dialog=s.w.document.querySelector('.monika-user-dialog');assert(dialog);
 assert(!dialog.textContent.includes(labels.dialog.user.info.vrcx_info));assert(!dialog.textContent.includes(labels.dialog.user.info.memo));
 const menu=dialog.querySelector('button[aria-label="'+labels.nav_tooltip.manage+'"]');assert(menu);menu.dispatchEvent(new s.w.MouseEvent('pointerdown',{bubbles:true,button:0}));menu.click();await tick();
 const items=[...s.w.document.querySelectorAll('[role=menuitem]')].map(x=>x.textContent.trim());
 assert(items.some(x=>x.includes(labels.dialog.user.actions.refresh)),'read commands remain');
 for(const key of ['unfriend','edit_note_memo','request_invite','send_friend_request','edit_profile'])assert(!items.some(x=>x===labels.dialog.user.actions[key]),key);
});

test('the original graph worker produces finite layouts and reports malformed graph requests',()=>{
 let handle,result;new Script(workerCode).runInNewContext({self:{addEventListener:(type,fn)=>{if(type==='message')handle=fn;},postMessage:data=>{result=data;}}});
 handle({data:{requestId:7,nodes:[{id:'a',attributes:{x:0,y:0,size:5}},{id:'b',attributes:{x:1,y:1,size:5}}],edges:[{key:'a-b',source:'a',target:'b',attributes:{size:1}}],settings:{layoutIterations:300,layoutSpacing:60,reinitialize:true}}});
 assert.equal(result.requestId,7);assert(!result.error,result.error);for(const id of ['a','b'])for(const coordinate of ['x','y'])assert(Number.isFinite(result.positions[id][coordinate]));
 handle({data:{requestId:8,nodes:[{id:'a',attributes:{}}],edges:[{key:'invalid',source:'a',target:'missing'}],settings:{}}});assert.equal(result.requestId,8);assert(result.error);
});

function mockGraphPlatform(s){
 const {w}=s,workers=[];
 // jsdom has no GPU: load the real component and layout worker but leave canvas dimensions zero.
 const enums=new Map();w.WebGL2RenderingContext=new Proxy(function(){},{get:(_,key)=>{if(!enums.has(key))enums.set(key,enums.size+1);return enums.get(key);}});
 w.URL.createObjectURL=()=> 'blob:synthetic-worker';w.URL.revokeObjectURL=()=>{};
 w.Worker=class{
  listeners={};terminated=false;
  constructor(){workers.push(this);new Script(workerCode).runInNewContext({self:{addEventListener:(type,fn)=>{if(type==='message')this.handle=fn;},postMessage:data=>w.queueMicrotask(()=>{if(!this.terminated)this.listeners.message?.({data});})}});}
  addEventListener(type,fn){this.listeners[type]=fn;}
  postMessage(data){this.handle({data});}
  terminate(){this.terminated=true;}
 };
 return workers;
}

test('native relationship tab fetches target API pages, exposes settings, caches the graph, and closes its worker',async t=>{
 const s=setup();t.after(()=>cleanup(s));const workers=mockGraphPlatform(s);await tick();
 s.controller.nativeQuery=async(account,kind,params)=>{s.calls.push({account,kind,params});assert.equal(kind,'mutualFriends');assert.equal(account,'usr_target');return params.offset===0?Array.from({length:100},(_,i)=>({id:`usr_mutual_${i}`,displayName:`Mutual ${i}`})):[];};
 activateTab(s.w,[...s.w.document.querySelectorAll('[role=tab]')].find(x=>x.textContent==='好友列表'));await tick();
 assert(![...s.w.document.querySelectorAll('button')].some(x=>x.textContent.trim()==='查看关系网'),'redundant relationship button is removed');
 activateTab(s.w,[...s.w.document.querySelectorAll('[role=tab]')].find(x=>x.textContent==='关系网'));
 for(let i=0;i<25 && !s.w.localStorage.getItem('monika:usr_target:mutual-graph');i++)await tick();
 const cache=JSON.parse(s.w.localStorage.getItem('monika:usr_target:mutual-graph') || '{}');assert.equal(cache.snapshot?.[0]?.[1]?.length,100,JSON.stringify({calls:s.calls,errors:s.errors,panel:s.w.document.querySelector('#monika-mutual-graph')?.textContent,cache}));
 assert.deepEqual(s.calls.filter(x=>x.kind==='mutualFriends').map(x=>x.params.offset),[0,100]);assert(s.calls.every(x=>x.account==='usr_target'));
 for(let i=0;i<25 && !workers.length;i++)await tick();assert(workers.length,'original graph runs its layout in a worker');
 const graph=s.w.document.querySelector('#monika-mutual-graph');assert(graph);assert(graph.closest('[role=tabpanel][data-state=active]'));
 assert.equal(s.w.document.querySelector('[role=tab][data-state=active]').textContent,'关系网');
 assert(!s.w.document.querySelector('.monika-mutual-dialog'));assert.deepEqual(s.errors,[]);
 const settings=graph.querySelector('button[aria-label]');assert(settings,'graph settings has an accessible label');settings.click();await tick();
 const sheet=s.w.document.querySelector('[data-slot=sheet-content]');assert(sheet,'settings sidebar opens');assert(sheet.querySelector('[role=slider]'),'native layout settings remain usable');
 s.w.document.dispatchEvent(new s.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await tick();
 assert(!s.w.document.querySelector('[data-slot=sheet-content]'));
 activateTab(s.w,[...s.w.document.querySelectorAll('[role=tab]')].find(x=>x.textContent==='好友列表'));await tick();
 assert(workers.every(w=>w.terminated),'leaving graph releases the worker');assert(!s.w.document.querySelector('#monika-mutual-graph'));
 const requests=s.calls.length;activateTab(s.w,[...s.w.document.querySelectorAll('[role=tab]')].find(x=>x.textContent==='关系网'));await tick();await tick();
 assert(s.w.document.querySelector('#monika-mutual-graph'));assert.equal(s.calls.length,requests,'returning uses the cached graph');
 s.ui.close();await tick();assert(workers.every(w=>w.terminated));assert(!s.w.document.querySelector('#monika-mutual-graph'));
});

test('closing or switching target during a graph request cannot persist partial or foreign data',async t=>{
 const s=setup();t.after(()=>cleanup(s));mockGraphPlatform(s);await tick();
 let pending;s.controller.nativeQuery=async(account,kind,params)=>{s.calls.push({account,kind,params});return new Promise(resolve=>{pending=resolve;});};
 const open=async()=>{activateTab(s.w,[...s.w.document.querySelectorAll('[role=tab]')].find(x=>x.textContent==='关系网'));for(let i=0;i<25 && !pending;i++)await tick();assert(pending,'graph request started');};
 await open();activateTab(s.w,[...s.w.document.querySelectorAll('[role=tab]')].find(x=>x.textContent==='好友分组'));await tick();pending([{id:'usr_mutual'}]);pending=null;await tick();await tick();assert.equal(s.w.localStorage.getItem('monika:usr_target:mutual-graph'),null,'cancelled results are not persisted');
 await open();s.controller.view.accountId='usr_other';s.ui.update({...s.snapshot,accountId:'usr_other',friends:[{id:'usr_other_friend',displayName:'Other target friend',tags:[]}]});
 const diagnostics=[];s.w.console.error=(...args)=>diagnostics.push(args.map(String).join(' '));
 pending([{id:'usr_mutual'}]);await tick();await tick();
 assert.equal(s.w.localStorage.getItem('monika:usr_target:mutual-graph'),null);assert.equal(s.w.localStorage.getItem('monika:usr_other:mutual-graph'),null);
 assert(s.calls.every(x=>x.account==='usr_target'),'a prior fetch never requests with the new target credentials');assert(diagnostics.every(x=>x.includes('会话已变化')));
 assert(!s.w.document.querySelector('#monika-mutual-graph'));
});

test('an initial graph confirmation cannot begin a fetch after leaving the tab',async t=>{
 const s=setup();t.after(()=>cleanup(s));mockGraphPlatform(s);await tick();
 let confirm;s.controller.confirm=()=>new Promise(resolve=>{confirm=resolve;});
 activateTab(s.w,[...s.w.document.querySelectorAll('[role=tab]')].find(x=>x.textContent==='关系网'));
 for(let i=0;i<25 && !confirm;i++)await tick();assert(confirm,'initial confirmation was requested');
 activateTab(s.w,[...s.w.document.querySelectorAll('[role=tab]')].find(x=>x.textContent==='好友日志'));await tick();
 confirm(true);await tick();await tick();assert.equal(s.calls.length,0);assert(!s.w.document.querySelector('#monika-mutual-graph'));
});
