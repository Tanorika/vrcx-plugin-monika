import test from 'node:test';
import assert from 'node:assert/strict';
import { MonikaView,entryPopulation,visitActivityEvents,connectionState,timelineChartHtml,chartTooltipHtml,chartTooltipPosition,preciseDurationText } from '../src/view.mjs';
import { vrcxFeedFilterChange } from '../src/vendor-vrcx.mjs';
import { MonikaPlugin } from '../src/plugin.mjs';
import { MonikaSocialView,socialCss } from '../src/social.mjs';
globalThis.MonikaSocialView=MonikaSocialView;globalThis.socialCss=socialCss;

function detail(id='visit_a',accountId='usr_alt') {
  const event=(type,at,extra={})=>({type,at,visitId:id,...extra});
  const initial=[{id:accountId,displayName:'Alt'},{id:'usr_friend',displayName:'Friend'}];
  return {visit:{id,accountId,start:1000,end:10000,lastSeen:10000,initialAt:1001,finalAt:10000,rosterInitialized:true,location:'wrld_test:1',worldName:'Test',initial,final:initial,population:[{at:1000,total:4}]},events:[
    event('visit-start',1000),event('snapshot',1001,{people:initial}),event('avatar',1002,{baseline:true}),
    event('person-join',2000,{person:{id:'usr_friend',displayName:'Friend'}}),
    event('person-leave',3000,{person:{id:'usr_friend',displayName:'Friend'}}),
    event('avatar',4000,{self:true,userId:accountId,displayName:'Alt',avatar:{id:'avtr_new'},previous:{id:'avtr_old'}}),
    event('visit-end',5000),event('visit-resume',6000),event('observation-gap',7000),event('observation-resumed',8000),
    event('person-join',9000,{visitId:'other_visit',person:{id:'usr_other',displayName:'Other'}})
  ]};
}
function viewFixture() {
  const view=Object.create(MonikaView.prototype);
  Object.assign(view,{accountId:'usr_alt',search:'',seenCharts:new Set(),visitDetails:new Map(),visitFilters:new Map(),visitModes:new Map(),visitErrors:new Map(),visitRequests:new Map(),expandedVisits:new Set(),root:{clientWidth:1000},controller:{detail:async(account,id)=>detail(id,account)}});
  const renders=[];view.renderVisit=id=>renders.push(view.visitContentHtml(id));return {view,renders};
}

test('instance activity shows only joins, leaves and changed avatars for its own visit',()=>{
  const data=detail();
  assert.deepEqual(visitActivityEvents(data).map(event=>event.type),['avatar','person-leave','person-join']);
  assert.deepEqual(visitActivityEvents(data,{selfOnly:true}).map(event=>event.type),['avatar']);
  assert.deepEqual(visitActivityEvents(data,{types:['person-join'],search:'Friend'}).map(event=>event.type),['person-join']);
});

test('each expanded visit keeps independent VRCX-style multiple selection and All restores its data',async t=>{
  const previous=globalThis.vrcxFeedFilterChange;globalThis.vrcxFeedFilterChange=vrcxFeedFilterChange;
  t.after(()=>{if(previous===undefined)delete globalThis.vrcxFeedFilterChange;else globalThis.vrcxFeedFilterChange=previous;});
  const {view}=viewFixture();await view.loadVisit('visit_a');await view.loadVisit('visit_b');
  const click=type=>view.click({target:{closest:()=>({dataset:{visitFilter:'visit_a',activityType:type}})}});
  await click('person-join');await click('avatar');
  assert.deepEqual(view.visitFilters.get(view.visitKey('visit_a')),['person-join','avatar']);
  assert(!view.visitFilters.has(view.visitKey('visit_b')));
  let html=view.visitContentHtml('visit_a');assert(html.includes('data-activity-type="person-leave" aria-pressed="false"'));
  assert(html.includes('Friend'));assert(!html.includes('活动结束'));assert(!html.includes('初始人员快照'));assert(html.includes('进入时人员'));
  await click('All');assert.deepEqual(view.visitFilters.get(view.visitKey('visit_a')),[]);
  await click('person-join');await click('person-leave');await click('avatar');assert.deepEqual(view.visitFilters.get(view.visitKey('visit_a')),[]);
  view.visitFilters.set(view.visitKey('visit_a'),['person-join']);view.search='no matching user';
  html=view.visitContentHtml('visit_a');assert(html.includes('暂无数据'));view.search='';assert(!view.visitContentHtml('visit_a').includes('暂无数据'));
});

test('entry population never substitutes a later count or skips a failed first sample',()=>{
  const visit={start:1000,population:[{at:1001,total:4},{at:61000,total:20}]};
  assert.equal(entryPopulation(visit).total,4);
  visit.population[0].total=null;assert.equal(entryPopulation(visit).total,null);
  visit.population=[{at:181000,total:20}];assert.equal(entryPopulation(visit),null);
});

test('visit details deduplicate reads, refresh new events, and discard rendering after an account switch',async()=>{
  const {view,renders}=viewFixture();let resolve,calls=0;
  view.controller.detail=()=>{calls++;return new Promise(done=>{resolve=done;});};
  const first=view.loadVisit('visit_a'),second=view.loadVisit('visit_a');await Promise.resolve();assert.equal(calls,1);
  view.accountId='usr_other';resolve(detail());await Promise.all([first,second]);assert.equal(renders.length,0);
  view.accountId='usr_alt';view.controller.detail=async()=>{const result=detail();result.events.push({type:'person-join',visitId:'visit_a',at:10000,person:{displayName:'New friend'}});return result;};
  await view.loadVisit('visit_a',{force:true});assert(renders.at(-1).includes('New friend'));
  view.controller.detail=()=>{throw 'SQLite unavailable';};await view.loadVisit('visit_b');
  assert.equal(view.visitRequests.size,0);assert(view.visitContentHtml('visit_b').includes('SQLite unavailable'));
  view.controller.detail=async()=>detail('visit_b');await view.loadVisit('visit_b');assert(!view.visitContentHtml('visit_b').includes('SQLite unavailable'));
});

test('connection status publishes before slow history sync and while a settings input is focused',async t=>{
  const previousFetch=globalThis.fetch,previousDocument=globalThis.document;
  t.after(()=>{globalThis.fetch=previousFetch;if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;});
  const badge={},presence={},plugin=new MonikaPlugin(),view=Object.create(MonikaView.prototype);plugin.config=()=>({port:39123});
  plugin.view=view;view.controller=plugin;
  Object.assign(view,{status:{accounts:[]},statusInitialized:false,saved:{},tab:'settings',accountId:'',refreshVersion:0,from:'2026-11-10',to:'2026-11-10',page:1,search:'',selfOnly:false,
    root:{querySelector:selector=>selector==='.connection-badge'?badge:presence,contains:()=>true},render(){throw new Error('focused form must remain intact');}});
  globalThis.document={activeElement:{matches:()=>true}};
  assert.equal(connectionState(view.status,false,false).healthy,null);
  let state={accounts:[],user:{id:'usr_alt',displayName:'Alt',status:'ask me',location:'wrld_a:1'},recording:true,connected:true};
  globalThis.fetch=async()=>({status:200,text:async()=>JSON.stringify(state)});
  plugin.savedAccounts=async()=>({});plugin.status=()=>plugin.api('/status');plugin.history=async()=>({visits:[]});
  let resolveSync;plugin.syncDatabase=()=>new Promise(done=>{resolveSync=done;});
  const pending=view.refresh();await new Promise(setImmediate);
  assert(badge.innerHTML.includes('healthy'));assert(badge.innerHTML.includes('账号已连接'));assert(presence.innerHTML.includes('askme'));
  resolveSync();await pending;
  state={accounts:[],user:null,recording:false,connected:false};await plugin.api('/stop',{});
  assert(badge.innerHTML.includes('账号未连接'));assert.equal(presence.innerHTML,'');
  const publicState=view.status;state={user:{id:'usr_alt'},cookies:'synthetic-secret'};await plugin.api('/credentials');assert.equal(view.status,publicState);
  globalThis.fetch=async()=>{throw new Error('service offline');};await assert.rejects(plugin.api('/status'));
  assert(badge.innerHTML.includes('服务未连接'));
});

test('a delayed connection poll cannot overwrite a newer stop and polls do not wait for history',async t=>{
  const previousFetch=globalThis.fetch;t.after(()=>{globalThis.fetch=previousFetch;});
  const plugin=new MonikaPlugin();plugin.config=()=>({port:39123});plugin.started=true;
  let complete,calls=0;
  const online={accounts:[],recording:true,user:{id:'usr_alt'}},stopped={accounts:[],recording:false,user:null};
  globalThis.fetch=async(url)=>{calls++;return url.endsWith('/stop')?{status:200,text:async()=>JSON.stringify(stopped)}:
    new Promise(resolve=>{complete=()=>resolve({status:200,text:async()=>JSON.stringify(online)});});};
  const first=plugin.pollConnection();await plugin.pollConnection();assert.equal(calls,1);
  await plugin.api('/stop',{});complete();await first;
  assert.equal(plugin.lastState.recording,false);assert.equal(plugin.connectionPollBusy,false);assert.equal(calls,2);
});

test('history uses horizontal page tabs and places unrestricted instance entries after the chart',t=>{
  const previousDocument=globalThis.document;t.after(()=>{if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;});
  const root={setAttribute(){},addEventListener(){},querySelectorAll:()=>[],clientWidth:1000};
  globalThis.document={createElement:()=>root};
  const view=new MonikaView({serviceConnected:false,metadata:{build:'0.1.12'}});
  view.accountId='usr_alt';view.from='2026-11-10';view.to='2026-11-10';
  const start=new Date('2026-11-10T10:00:00+08:00').getTime();
  view.history={stats:{},visits:[{id:'a',location:'wrld_a:1',worldName:'First',start,end:start+10000,duration:10000,population:[{at:start,total:4},{at:start+5000,total:7}]},
    {id:'b',location:'wrld_b:2',worldName:'Second',start:start+20000,end:null,duration:10000,population:[]}],worlds:[]};
  view.render();
  assert(root.innerHTML.includes('row tabs vrcx-topbar'));assert(!root.innerHTML.includes('name="selfOnly"'));
  assert.equal((root.innerHTML.match(/role="tab"/g) || []).length,4);
  assert(!root.innerHTML.includes('name="account"'));
  assert.equal((root.innerHTML.match(/class="log-group"/g) || []).length,2);
  assert(root.innerHTML.includes('进入时 4 人'));assert(!root.innerHTML.includes('进入时 7 人'));assert(root.innerHTML.includes('进入时 人数未知'));
  assert(root.innerHTML.indexOf('class="panel summary-worlds"')<root.innerHTML.indexOf('class="panel activity-record"'));
  assert(root.innerHTML.indexOf('class="panel activity-record"')<root.innerHTML.indexOf('class="panel activity-history"'));
  assert(!root.innerHTML.includes('data-detail'));assert(!root.innerHTML.includes('data-scroll="instance-history"'));
  assert(!root.innerHTML.includes('class="panel summary-worlds" open'));
});

test('graph mode stays within its visit and event selections return directly to the event list',async t=>{
  const previous=globalThis.vrcxFeedFilterChange;globalThis.vrcxFeedFilterChange=vrcxFeedFilterChange;
  t.after(()=>{if(previous===undefined)delete globalThis.vrcxFeedFilterChange;else globalThis.vrcxFeedFilterChange=previous;});
  const {view}=viewFixture();await view.loadVisit('visit_a');await view.loadVisit('visit_b');
  await view.click({target:{closest:()=>({dataset:{visitChart:'visit_a'}})}});
  const html=view.visitContentHtml('visit_a');assert(html.includes('visit-charts'));assert(html.includes('房间人数时间轴'));assert(html.includes('可见好友活动'));
  assert(!html.includes('data-launch'));assert(!html.includes('完整实例位置'));
  assert(!html.includes('data-detail'));assert(!view.visitContentHtml('visit_b').includes('visit-charts'));
  assert(html.includes('data-activity-type="All" aria-pressed="false"'));
  await view.click({target:{closest:()=>({dataset:{visitFilter:'visit_a',activityType:'person-join'}})}});
  assert(!view.visitContentHtml('visit_a').includes('visit-charts'));assert.deepEqual(view.visitFilters.get(view.visitKey('visit_a')),['person-join']);
  await view.click({target:{closest:()=>({dataset:{visitChart:'visit_a'}})}});
  await view.click({target:{closest:()=>({dataset:{visitFilter:'visit_a',activityType:'All'}})}});
  assert.deepEqual(view.visitFilters.get(view.visitKey('visit_a')),[]);assert(!view.visitContentHtml('visit_a').includes('visit-charts'));
});

test('the time axis remains outside the row scroller, shares its scale, and charts use independent clip paths',()=>{
  const rows=Array.from({length:80},(_,i)=>({id:`visit_${i}`,worldName:`World ${i}`,location:`wrld_${i}:1`,start:1000,end:4000}));
  const html=timelineChartHtml(rows,{from:0,to:8000,width:1000,labelVisits:true},'activity-chart');
  const [body,axis]=html.split('<div class="timeline-axis">');
  assert(body.endsWith('</svg></div>'));assert(body.includes('data-scroll="activity-chart"'));assert(axis.includes('aria-label="时间刻度"'));
  const bodyTicks=[...body.matchAll(/<line x1="([^"]+)" x2=/g)].map(match=>match[1]);
  const axisTicks=[...axis.matchAll(/<text x="([^"]+)"/g)].map(match=>match[1]);assert.deepEqual(bodyTicks,axisTicks);
  assert(body.includes('data-visit="visit_0"'));assert(!body.includes('data-instance='));
  const other=timelineChartHtml(rows,{from:0,to:8000,width:1000},'people:visit_a');
  const firstClip=/clipPath id="([^"]+)"/.exec(html)[1],secondClip=/clipPath id="([^"]+)"/.exec(other)[1];
  assert.notEqual(firstClip,secondClip);assert(other.includes(`url(#${secondClip})`));
});

function navigationFixture(rows) {
  const {view}=viewFixture(),queries=[],scrolled=[];let nodes=[];
  Object.assign(view,{tab:'activity',from:'2026-11-10',to:'2026-11-10',page:1,nativeTypes:[],refreshVersion:0,visitNavigationVersion:0,status:{accounts:[]},
    root:{clientWidth:1000,querySelectorAll:()=>nodes},render(){nodes=(this.history?.visits || []).map(visit=>({dataset:{group:visit.id},open:this.expandedVisits.has(this.visitKey(visit.id)),scrollIntoView:()=>scrolled.push(visit.id)}));}});
  view.controller.detail=async(account,id)=>{const result=detail(id,account);Object.assign(result.visit,rows.find(row=>row.id===id));return result;};
  view.controller.history=async(account,options)=>{
    queries.push({account,...options});
    const filtered=rows.filter(row=>row.start>=options.from && row.start<=options.to && (!options.search || row.worldName.includes(options.search)));
    return {visits:filtered.slice((options.page-1)*options.limit,options.page*options.limit),visitTotal:filtered.length,stats:{},worlds:[]};
  };
  return {view,queries,scrolled,nodes:()=>nodes};
}

test('chart links locate the corresponding history page and expand charts in that exact entry',async()=>{
  const start=new Date('2026-11-10T10:00:00+08:00').getTime();
  const rows=Array.from({length:210},(_,i)=>({id:`visit_${i}`,accountId:'usr_alt',worldName:`World ${i}`,location:`wrld_${i}:1`,start:start-i*1000,end:start+10000,lastSeen:start+10000,duration:10000}));
  const {view,queries,scrolled,nodes}=navigationFixture(rows);view.history={visits:rows.slice(0,100)};
  await view.click({target:{closest:()=>({dataset:{visit:'visit_205'}})}});
  assert.equal(view.page,3);assert.deepEqual(scrolled,['visit_205']);assert(nodes().find(node=>node.dataset.group==='visit_205').open);
  assert.equal(view.visitModes.get(view.visitKey('visit_205')),'charts');assert.deepEqual(view.visitFilters.get(view.visitKey('visit_205')),[]);assert(queries.every(query=>query.account==='usr_alt'));
  assert(queries.some(query=>query.page===3 && query.limit===100));
  view.visitModes.set(view.visitKey('visit_205'),'events');await view.refresh({localOnly:true});assert.equal(view.visitModes.get(view.visitKey('visit_205')),'events');
});

test('current-instance links switch from settings, resolve the selected account and reveal a filtered-out visit',async()=>{
  const start=new Date('2026-11-09T10:00:00+08:00').getTime(),rows=[{id:'visit_old',accountId:'usr_alt',worldName:'Old World',location:'wrld_old:1',start,end:start+10000,lastSeen:start+10000,duration:10000}];
  const {view,queries,scrolled}=navigationFixture(rows);view.accountId='usr_other';view.tab='settings';view.search='no match';view.history={visits:[]};
  await view.click({target:{closest:()=>({dataset:{visit:'visit_old',visitAccount:'usr_alt'}})}});
  assert.equal(view.tab,'activity');assert.equal(view.accountId,'usr_alt');assert.equal(view.from,'2026-11-09');assert.equal(view.to,'2026-11-09');assert.equal(view.search,'');
  assert.deepEqual(scrolled,['visit_old']);assert(queries.every(query=>query.account==='usr_alt'));
});

test('a delayed entry lookup does not switch pages or scroll after the user changes the page tab',async()=>{
  const {view,scrolled}=navigationFixture([]);let resolve;
  view.controller.detail=()=>new Promise(done=>{resolve=done;});
  const pending=view.openVisit('visit_a');await Promise.resolve();view.tab='native';view.visitNavigationVersion++;
  resolve(detail());await pending;
  assert.equal(view.tab,'native');assert.deepEqual(scrolled,[]);assert.equal(view.history,undefined);
});

test('an already visible entry is positioned again after its content finishes expanding',async()=>{
  const {view,scrolled}=navigationFixture([]);view.history={visits:[{id:'visit_a'}]};let resolve;
  view.controller.detail=()=>new Promise(done=>{resolve=done;});
  const pending=view.openVisit('visit_a');await Promise.resolve();assert.deepEqual(scrolled,['visit_a']);
  resolve(detail());await pending;assert.deepEqual(scrolled,['visit_a','visit_a']);
});

test('linking back to a visit opens charts and resets its previous event selection',async()=>{
  const {view}=navigationFixture([]);view.history={visits:[{id:'visit_a'}]};
  view.visitModes.set(view.visitKey('visit_a'),'events');view.visitFilters.set(view.visitKey('visit_a'),['avatar']);
  view.seenCharts.add(view.animationKey(`people:${view.visitKey('visit_a')}`));
  await view.openVisit('visit_a');assert.equal(view.visitModes.get(view.visitKey('visit_a')),'charts');assert.deepEqual(view.visitFilters.get(view.visitKey('visit_a')),[]);
  assert(!view.seenCharts.has(view.animationKey(`people:${view.visitKey('visit_a')}`)));
});

test('chart tooltips retain VRCX layout, precise duration and explicit population without exposing HTML',()=>{
  const data={name:'<img src=x onerror=alert(1)>',location:'wrld_test:42~hidden(usr_owner)',start:1000,end:23336000,color:'red;position:fixed'};
  const html=chartTooltipHtml(data);assert(html.includes('chart-tooltip-color'));assert(html.includes('#42 · 好友+'));assert(!html.includes('<img'));
  assert(html.includes('6 小时 28 分 55 秒'));assert(!html.includes('position:fixed'));
  const population=chartTooltipHtml({...data,kind:'population',total:15,known:2,unknown:13});assert(population.includes('总人数 15 · 可见 2 · 未识别 13'));
  assert.equal(preciseDurationText(Infinity),'0 秒');assert.equal(preciseDurationText(-1000),'0 秒');
  const atEdge=chartTooltipPosition(310,190,120,70,320,200);assert.deepEqual(atEdge,{left:192,top:122});
});

test('hover details are positioned in the viewport and removed on leaving or malformed data',t=>{
  const previous=globalThis.window;t.after(()=>{if(previous===undefined)delete globalThis.window;else globalThis.window=previous;});
  globalThis.window={innerWidth:320,innerHeight:200};const attributes=new Map();
  const tooltip={id:'monika-chart-tooltip',hidden:true,offsetWidth:120,offsetHeight:70,style:{}},target={dataset:{chartTooltip:JSON.stringify({name:'Friend',start:1000,end:4000,color:'#5470c6'})},
    setAttribute:(name,value)=>attributes.set(name,value),removeAttribute:name=>attributes.delete(name),getBoundingClientRect:()=>({right:300,top:180})};
  const view=Object.create(MonikaView.prototype);view.root={querySelector:()=>tooltip};view.tooltipTarget=null;
  view.showTooltip({target:{closest:()=>target},clientX:310,clientY:190});assert.equal(tooltip.hidden,false);assert(tooltip.innerHTML.includes('Friend'));assert.equal(tooltip.style.left,'192px');
  assert(attributes.has('aria-describedby'));view.hideTooltip();assert.equal(tooltip.hidden,true);assert(!attributes.has('aria-describedby'));
  target.dataset.chartTooltip='null';view.showTooltip({target:{closest:()=>target}});assert.equal(tooltip.hidden,true);
});

test('chart animation runs on display or selection and does not restart on periodic rendering',t=>{
  const previous=globalThis.matchMedia;t.after(()=>{if(previous===undefined)delete globalThis.matchMedia;else globalThis.matchMedia=previous;});
  globalThis.matchMedia=()=>({matches:false});const {view}=viewFixture(),animations=[];
  const bars=[0,1].map(()=>({animate:(frames,options)=>animations.push({frames,options})}));
  let visible=false;
  const chart={dataset:{chartAnimation:'activity-chart'},getClientRects:()=>visible?[{}]:[],querySelectorAll:()=>bars},root={querySelectorAll:()=>[chart]};
  view.animateCharts(root);assert.equal(animations.length,0);assert.equal(view.seenCharts.size,0);visible=true;
  view.animateCharts(root);assert.equal(animations.length,2);assert.equal(animations[0].options.duration,300);
  view.animateCharts(root);assert.equal(animations.length,2);view.seenCharts.clear();view.animateCharts(root);assert.equal(animations.length,4);
  const emptyChart={dataset:{chartAnimation:'population:visit_a'},getClientRects:()=>[{}],querySelectorAll:()=>[],querySelector:()=>null};
  view.animateCharts({querySelectorAll:()=>[emptyChart]});assert(!view.seenCharts.has(view.animationKey(emptyChart.dataset.chartAnimation)));
  emptyChart.querySelector=()=>({animate:(frames,options)=>animations.push({frames,options})});
  view.animateCharts({querySelectorAll:()=>[emptyChart]});assert.equal(animations.length,5);
  globalThis.matchMedia=()=>({matches:true});view.seenCharts.clear();view.animateCharts(root);assert.equal(animations.length,5);
});
