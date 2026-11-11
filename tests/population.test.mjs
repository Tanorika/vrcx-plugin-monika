import test from 'node:test';
import assert from 'node:assert/strict';
import { MonikaService, instancePopulation } from '../server/service.mjs';
import { Recorder } from '../server/recorder.mjs';
import { VRChatClient, ApiError } from '../server/vrchat.mjs';
import { attendance, populationTimeline, populationSvg, populationLabel, visitPopulation, timelineSvg, MonikaView } from '../src/view.mjs';

const self=location=>({id:'usr_alt',displayName:'Alt',location});
function serviceFixture(t,client) {
  const storage={read:(key,fallback)=>fallback,write(){},journal:()=>({replay:[],append(){}})};
  const service=new MonikaService(storage,{pipelineFactory:()=>({close(){}})});
  service.active={user:self('wrld_a:1'),client:{exportCookies:()=>'',close(){},...client}};
  const recorder=service.recorder('usr_alt');recorder.observeSelf(service.active.user,100000);
  t.after(()=>service.stop());return {service,recorder};
}

test('instance population uses only explicit API totals, validates identity, and preserves zero',()=>{
  assert.deepEqual(instancePopulation({userCount:15,n_users:14,capacity:16},'wrld_a:1'),{total:15,capacity:16});
  assert.equal(instancePopulation({userCount:0,n_users:14},'wrld_a:1').total,0);
  assert.equal(instancePopulation({n_users:7},'wrld_a:1').total,7);
  assert.equal(instancePopulation({userCount:-1,n_users:7,capacity:'16'},'wrld_a:1').capacity,null);
  for(const data of [null,{users:[{}]},{userCount:'15'},{userCount:1.5},{userCount:-1}])assert.throws(()=>instancePopulation(data,'wrld_a:1'));
  for(const data of [{userCount:15,worldId:'wrld_b'},{userCount:15,instanceId:'2'},{userCount:15,id:'wrld_b:1'}])
    assert.throws(()=>instancePopulation(data,'wrld_a:1'),/不匹配/);
});

test('instance requests preserve the full tag and use the independent VRChat client',async()=>{
  const client=new VRChatClient();let path;
  client.request=async value=>{path=value;return {userCount:15};};
  try {
    const location='wrld_a:14~group(grp_a)~groupAccessType(public)~region(jp)';
    assert.equal((await client.instance(location)).userCount,15);
    assert.equal(path,`instances/wrld_a:${encodeURIComponent(location.split(':')[1])}`);
    assert.throws(()=>client.instance('traveling'));assert.throws(()=>client.instance('wrld_a:1 invalid'));
  } finally {client.close();}
});

test('concurrent instances sample independently once per interval without renewing account presence',async t=>{
  let at=101000;t.mock.method(Date,'now',()=>at);const calls=[];
  const {service,recorder}=serviceFixture(t,{instance:async location=>{calls.push(location);at+=100;return {userCount:location==='wrld_a:1'?15:3,capacity:16};}});
  recorder.observeSelf(self('wrld_b:2'),100500);
  const timestamps=[...recorder.activeVisits.values()].map(v=>[v.lastSeen,v.locationSeen,v.rosterLastSeen]);
  await service.pollInstanceCounts();assert.deepEqual(calls,['wrld_a:1','wrld_b:2']);
  assert.deepEqual([...recorder.activeVisits.values()].map(v=>v.population[0].total),[15,3]);
  assert.equal(recorder.activeVisits.get('wrld_a:1').population[0].at,101100);
  assert.deepEqual([...recorder.activeVisits.values()].map(v=>[v.lastSeen,v.locationSeen,v.rosterLastSeen]),timestamps);
  await service.pollInstanceCounts();assert.equal(calls.length,2);
  at=161500;await service.pollInstanceCounts();assert.equal(calls.length,4);
  assert.equal(service.status().locations[0].population.total,15);
});

test('population is collected before the roster so the first response is visible within the observed activity',async t=>{
  let at=101000;t.mock.method(Date,'now',()=>at);const order=[];
  const {service,recorder}=serviceFixture(t,{request:async path=>path==='auth/user'?self('wrld_a:1'):path==='auth'?{}:{name:'World'},
    instance:async()=>{order.push('count');at+=1000;return {userCount:15};},friends:async()=>{order.push('friends');at+=1000;return [];}});
  await service.runPoll(service.active,service.generation);
  const detail=recorder.detail(recorder.current.id);
  assert.deepEqual(order,['count','friends']);assert.equal(detail.visit.lastSeen,103000);
  assert.equal(populationTimeline(detail).latest.total,15);
});

test('inaccessible instance counts create unknown samples without clearing known people or closing visits',async t=>{
  let at=101000;t.mock.method(Date,'now',()=>at);
  const {service,recorder}=serviceFixture(t,{instance:async()=>{throw new ApiError(403,'not accessible');}});
  recorder.observeRoster([{id:'usr_friend',displayName:'Friend',location:'wrld_a:1'}],self('wrld_a:1'),100500);
  const before=recorder.current.lastSeen;await service.pollInstanceCounts();
  assert.equal(recorder.current.population[0].total,null);assert.equal(recorder.current.population[0].reason,'inaccessible');
  assert.equal(recorder.current.lastSeen,before);assert.equal(recorder.roster.size,2);assert.equal(recorder.current.end,null);
  at+=60000;await service.pollInstanceCounts();assert.equal(recorder.current.population.length,2);
});

test('instance rate limits defer other instances and early location-triggered polls',async t=>{
  let at=101000;t.mock.method(Date,'now',()=>at);let calls=0,requests=0;
  const {service,recorder}=serviceFixture(t,{instance:async()=>{calls++;throw new ApiError(429,'limited',120);},request:async()=>{requests++;return self('wrld_a:1');}});
  recorder.observeSelf(self('wrld_b:2'),100500);await service.pollInstanceCounts();
  assert.equal(calls,1);assert.equal(service.retryAt,221000);
  assert.equal(recorder.activeVisits.get('wrld_b:2').population.length,0);
  at=102000;await service.pollInstanceCounts();await service.runPoll(service.active,service.generation);
  assert.equal(calls,1);assert.equal(requests,0);assert.equal(recorder.activeVisits.size,2);
});

test('late population responses are discarded after an account session or visit changes',async t=>{
  let at=101000;t.mock.method(Date,'now',()=>at);let resolve;
  const {service,recorder}=serviceFixture(t,{instance:()=>new Promise(done=>{resolve=done;})});
  const first=recorder.current,request=service.pollInstanceCounts();
  recorder.closeVisit(first,100500,'location-change');recorder.observeSelf(self('wrld_a:1'),100600);
  resolve({userCount:15});await request;
  assert.equal(first.population.length,0);assert.equal(recorder.current.population.length,0);
  at=161000;const next=service.pollInstanceCounts(),second=recorder.current;
  service.stop('account-switch');resolve({userCount:15});await next;assert.equal(second.population.length,0);
});

function detailFixture() {
  return {visit:{id:'visit_1',accountId:'usr_alt',location:'wrld_a:1',worldName:'World',start:1000,end:181000,lastSeen:181000,
    initial:[{id:'usr_alt',displayName:'Alt'},{id:'usr_friend',displayName:'Friend'}],final:[],initialAt:1000,population:[
      {at:1000,total:15,capacity:16,intervalMs:60000},{at:61000,total:14,intervalMs:60000},{at:121000,total:16,intervalMs:60000}]},
    events:[{type:'snapshot',at:1000,people:[{id:'usr_alt',displayName:'Alt'},{id:'usr_friend',displayName:'Friend'}]},
      {type:'person-leave',at:31000,person:{id:'usr_friend',displayName:'Friend'}},
      {type:'person-join',at:91000,person:{id:'usr_friend',displayName:'Friend'}}]};
}

test('population decomposition follows known attendance and self-only filtering leaves API totals intact',()=>{
  const detail=detailFixture(),timeline=populationTimeline(detail);
  assert(timeline.intervals.every(v=>v.total===v.known+v.unknown));assert.equal(timeline.peak,16);
  assert.equal(timeline.average,15);assert.equal(timeline.coverage,180000);
  assert.equal(timeline.intervals.find(v=>v.start===31000).known,1);
  assert.equal(timeline.intervals.find(v=>v.start===91000).known,2);
  const render=selfOnly=>MonikaView.prototype.visitChartsHtml.call({selfOnly,root:{clientWidth:1000},visitKey:id=>`usr_alt:${id}`},detail);
  const full=render(false),only=render(true);
  assert.equal(full.split('<svg class="monika-timeline population-timeline"')[1].split('</svg>')[0],
    only.split('<svg class="monika-timeline population-timeline"')[1].split('</svg>')[0]);
  assert(!only.includes('observation-note'));assert(full.indexOf('房间人数时间轴')<full.indexOf('可见好友活动'));
});

test('repeated friend attendance occupies one row and preserves joins before the initial snapshot',()=>{
  const detail=detailFixture(),segments=attendance(detail),chart=timelineSvg(segments,{from:1000,to:181000,
    rowKey:s=>s.person.id,label:s=>s.person.displayName,start:s=>s.start,end:s=>s.end});
  assert.equal(segments.filter(s=>s.person.id==='usr_friend').length,2);
  assert.equal([...chart.matchAll(/<text[^>]*>.*?>Friend<\/text>/g)].length,1);
  detail.events.unshift({type:'person-join',at:1000,person:{id:'usr_early',displayName:'Early'}});
  detail.events[1].at=5000;detail.events[1].people.push({id:'usr_early',displayName:'Early'});
  assert.equal(attendance(detail).find(s=>s.person.id==='usr_early').start,1000);
});

test('failed, expired and out-of-activity samples stay unknown; zero and mismatch preserve actual API totals',()=>{
  const detail=detailFixture();detail.visit.population=[{at:1000,total:15,intervalMs:30000},{at:91000,total:null,intervalMs:30000},
    {at:121000,total:0,intervalMs:30000},{at:181001,total:99,intervalMs:60000}];
  const timeline=populationTimeline(detail);
  assert.equal(timeline.intervals.find(v=>v.start===61000).total,null);
  assert.equal(timeline.intervals.find(v=>v.start===91000).total,null);
  assert.equal(timeline.intervals.find(v=>v.start===121000).total,0);
  assert(timeline.intervals.find(v=>v.start===121000).mismatch);assert.equal(timeline.peak,15);
  assert.equal(visitPopulation(detail.visit).total,0);
  assert.equal(populationLabel({at:1000,total:0,intervalMs:30000},1000),'0 人');
  assert.equal(populationLabel({at:1000,total:0,intervalMs:30000},61000),'人数未知');
  assert.equal(populationLabel({at:1000,total:5},999),'人数未知');
  const chart=populationSvg(detail);assert(chart.includes('population-gap'));assert(chart.includes('population-mismatch'));
  assert(!chart.includes('NaN'));assert(!chart.includes('总人数 99'));
  detail.visit.population=[];assert(populationSvg(detail).includes('尚未采集'));
});

test('population persists through journal replay and stays out of activity-event feeds',()=>{
  const r=new Recorder('usr_alt');r.observeSelf(self('wrld_a:1'),1000);
  r.observeInstanceCount('wrld_a:1',{total:15,capacity:16,intervalMs:60000},2000);
  r.observeInstanceCount('wrld_a:1',{total:null,reason:'inaccessible'},3000);
  r.observeSelf(self('wrld_a:1'),4000);r.close(4000);
  const restored=new Recorder('usr_alt',()=>{},r.events),detail=restored.detail([...r.visits.keys()][0]);
  assert.deepEqual(detail.visit.population.map(s=>s.total),[15,null]);
  assert(!detail.events.some(e=>e.type==='instance-count'));
  assert(!restored.query({from:0,to:10000}).events.some(e=>e.type==='instance-count'));
  assert.equal(r.observeInstanceCount('wrld_a:1',{total:2},5000),false);
});
