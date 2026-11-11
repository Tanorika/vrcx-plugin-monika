import test from 'node:test';
import assert from 'node:assert/strict';
import { Recorder, avatarOf, realLocation, isTraveling } from '../server/recorder.mjs';
import { attendance, timelineSvg, escapeHtml, dateBounds } from '../src/view.mjs';

const self = (location='wrld_a:1', avatar='avtr_a') => ({id:'usr_alt',displayName:'Monika',location,currentAvatar:avatar});
const friend = (id='usr_friend',location='wrld_a:1',avatar='avtr_f') => ({id,displayName:id,location,currentAvatar:avatar});

test('buffer merges alternating instances, preserves overlapping ranges and computes union duration',()=>{
  const r=new Recorder('usr_alt',()=>{},[],{locationBufferMs:3000});
  for(const [at,location] of [[1000,'wrld_a:1'],[2000,'wrld_b:2'],[3000,'wrld_a:1'],[4000,'wrld_b:2'],[5000,'wrld_a:1'],[6000,'wrld_b:2']])r.observeSelf(self(location),at);
  assert.equal(r.visits.size,2);assert.equal(r.activeVisits.size,2);
  r.close(10000,'manual-stop','last-observed');
  assert.deepEqual([...r.visits.values()].map(v=>[v.start,v.end]),[[1000,5000],[2000,6000]]);
  assert.equal(r.activeVisits.size,0);
  const stats=r.query({from:0,to:10000}).stats;
  assert.equal(stats.duration,8000);assert.equal(stats.elapsedDuration,5000);assert.equal(stats.parallelDuration,3000);
  const clipped=r.query({from:2500,to:4500}).stats;
  assert.equal(clipped.duration,4000);assert.equal(clipped.elapsedDuration,2000);assert.equal(clipped.parallelDuration,2000);
  assert.equal(r.query({from:0,to:10000,search:'wrld_a'}).stats.parallelDuration,0);
});

test('buffer includes the exact boundary and expires absent siblings only after another positive location report',()=>{
  const r=new Recorder('usr_alt',()=>{},[],{locationBufferMs:3000});
  r.observeSelf(self(),1000);r.observeSelf(self('wrld_b:2'),2000);
  r.observeSelf(self(),4000);assert.equal(r.visits.size,2);
  r.observeSelf(self('traveling'),5000);r.observeSelf({id:'usr_alt'},6000);
  assert.equal(r.activeVisits.size,2);
  r.observeSelf(self('wrld_b:2'),6500);r.observeSelf(self('wrld_b:2'),7001);
  assert.equal(r.activeVisits.has('wrld_a:1'),false);assert.equal([...r.visits.values()][0].end,4000);
  assert.equal(r.visits.size,2);assert(!r.events.some(e=>e.type==='visit-start' && /travel/i.test(e.location)));
  r.observeSelf(self('wrld_b:2'),11000);r.observeSelf(self(),11001);assert.equal(r.visits.size,3);
});

test('a delayed identical report and a slow friend poll keep the same activity ID and snapshots',()=>{
  const r=new Recorder('usr_alt',()=>{},[],{locationBufferMs:3000});
  r.observeSelf(self(),1000);r.observeRoster([friend()],self(),1500);const id=r.current.id;
  r.observeRoster([friend()],self(),20000);r.observeFriend(friend(),25000);
  r.observeSelf(self(),30000);r.observeSelf(self(),50000);
  assert.equal(r.visits.size,1);assert.equal(r.current.id,id);assert.equal(r.current.start,1000);assert.equal(r.current.lastSeen,50000);
  assert.equal(r.detail(id).visit.initialAt,1500);assert.equal(r.events.filter(e=>e.type==='visit-start').length,1);
});

test('a new recorder after stop or crash resumes an unchanged instance with its original ID and population',()=>{
  for(const stop of ['manual-stop','service-shutdown',null]) {
    const journal=[],r=new Recorder('usr_alt',e=>journal.push(e),[],{locationBufferMs:3000});
    r.observeSelf(self(),1000);r.observeRoster([friend()],self(),1500);r.observeInstanceCount('wrld_a:1',{total:12},2000);r.observeSelf(self(),4000);
    const id=r.current.id;if(stop)r.close(4000,stop,'last-observed');
    const resumed=new Recorder('usr_alt',e=>journal.push(e),[...journal],{locationBufferMs:3000});
    assert.equal(resumed.activeVisits.size,0);resumed.observeSelf(self(),100000);
    assert.equal(resumed.visits.size,1);assert.equal(resumed.current.id,id);assert.equal(resumed.current.start,1000);assert.equal(resumed.current.end,null);
    assert.equal(resumed.current.population[0].total,12);assert.deepEqual(resumed.detail(id).visit.initial.map(p=>p.id),['usr_alt','usr_friend']);
    resumed.observeRoster([friend()],self(),101000);assert.equal(resumed.events.filter(e=>e.type==='visit-start').length,1);
    const replay=new Recorder('usr_alt',()=>{},journal,{locationBufferMs:3000,closeUnfinished:false});
    assert.deepEqual(replay.detail(id),resumed.detail(id));
  }
});

test('a buffered API gap resumes the same location and explicit different-location evidence eventually starts a new segment',()=>{
  const r=new Recorder('usr_alt',()=>{},[],{locationBufferMs:3000});r.observeSelf(self(),1000);const id=r.current.id;
  r.markGap(10000,'api-unavailable');r.observeSelf(self(),20000);assert.equal(r.current.id,id);assert.equal(r.visits.size,1);
  r.close(21000,'manual-stop','last-observed');r.observeSelf(self('wrld_b:2'),30000);r.observeSelf(self('wrld_b:2'),34000);r.observeSelf(self(),35000);
  assert.notEqual(r.current.id,id);assert.equal(r.visits.size,3);
  assert.equal(r.query({from:0,to:40000,selfOnly:true,type:'visit-resume'}).eventTotal,1);
});

test('late A/B reports in either order and resumed concurrent instances preserve both activity IDs',()=>{
  for(const order of [['wrld_a:1','wrld_b:2'],['wrld_b:2','wrld_a:1']]) {
    const r=new Recorder('usr_alt',()=>{},[],{locationBufferMs:3000});r.observeSelf(self(),1000);r.observeSelf(self('wrld_b:2'),1500);
    const ids=new Map([...r.activeVisits].map(([location,v])=>[location,v.id]));
    r.observeSelf(self(order[0]),30000);r.observeSelf(self(order[1]),30001);
    assert.equal(r.visits.size,2);for(const [location,id]of ids)assert.equal(r.activeVisits.get(location).id,id);
    r.close(31000,'manual-stop','last-observed');
    const restored=new Recorder('usr_alt',()=>{},r.events,{locationBufferMs:3000});
    restored.observeSelf(self(order[1]),100000);restored.observeSelf(self(order[0]),100001);
    assert.equal(restored.visits.size,2);for(const [location,id]of ids)assert.equal(restored.activeVisits.get(location).id,id);
    restored.observeSelf(self('wrld_a:1'),105000);restored.observeSelf(self('wrld_c:3'),105001);
    assert.equal(restored.activeVisits.has('wrld_b:2'),false);assert.equal(restored.activeVisits.get('wrld_a:1').id,ids.get('wrld_a:1'));
  }
});

test('concurrent rosters and self avatars remain independent through polls, friend moves and replay',()=>{
  const r=new Recorder('usr_alt',()=>{},[],{locationBufferMs:10000});
  r.observeSelf(self(),1000);r.observeSelf(self('wrld_b:2','avtr_b'),2000);
  r.observeRoster([friend(),friend('usr_second','wrld_b:2','avtr_s')],self('wrld_b:2','avtr_b'),2500);
  r.observeSelf({id:'usr_alt',location:'wrld_a:1'},3000);
  const a=r.activeVisits.get('wrld_a:1'),b=r.activeVisits.get('wrld_b:2');
  assert.deepEqual(r.detail(a.id).visit.initial.map(p=>p.id),['usr_alt','usr_friend']);
  assert.deepEqual(r.detail(b.id).visit.initial.map(p=>p.id),['usr_alt','usr_second']);
  assert.equal(r.detail(a.id).visit.final[0].avatar.id,'avtr_a');assert.equal(r.detail(b.id).visit.final[0].avatar.id,'avtr_b');
  r.observeFriend(friend('usr_friend','wrld_b:2','avtr_changed'),3500);
  assert(!r.rosters.get(a.id).has('usr_friend'));assert(r.rosters.get(b.id).has('usr_friend'));
  assert.equal(r.events.filter(e=>e.type==='person-leave').length,1);
  const replay=new Recorder('usr_alt',()=>{},r.events,{closeUnfinished:false});
  assert.equal(replay.activeVisits.size,2);assert.deepEqual(replay.detail(a.id),r.detail(a.id));assert.deepEqual(replay.detail(b.id),r.detail(b.id));
  const restored=new Recorder('usr_alt',()=>{},r.events);
  assert.equal(restored.activeVisits.size,0);assert([...restored.visits.values()].every(v=>v.end===3500));
  r.markGap(20000,'api-unavailable');assert.equal(r.activeVisits.size,0);
  assert.equal(r.query({from:0,to:20000,selfOnly:true,type:'avatar'}).events.filter(e=>!e.self).length,0);
});

test('buffered raw location observations persist self snapshots without a completed friend poll',()=>{
  const r=new Recorder('usr_alt',()=>{},[],{locationBufferMs:3000});
  r.observeSelf(self(),1000);r.observeSelf({id:'usr_alt',displayName:'Alt B',location:'wrld_b:2'},2000);
  const replay=new Recorder('usr_alt',()=>{},r.events,{closeUnfinished:false});
  for(const v of r.visits.values())assert.deepEqual(replay.detail(v.id).visit.final,r.detail(v.id).visit.final);
});

test('traveling never creates a visit or a native location change and ends the old visit at departure',()=>{
  const r=new Recorder('usr_alt');r.observeSelf(self('traveling:traveling'),500);
  assert.equal(r.visits.size,0);
  r.observeSelf(self(),1000);r.observeRoster([friend()],self(),1500);
  r.observeSelf(self('traveling:traveling'),2000);r.observeSelf(self('travelling'),3000);
  r.observeRoster([],self('traveling'),3500);
  assert.equal(r.visits.size,1);assert(r.roster.has('usr_friend'));assert.equal(r.current.lastSeen,1500);
  assert(!r.events.some(e=>e.type==='cloud-user' && isTraveling(e.user.location)));
  r.observeSelf(self('wrld_b:2'),5000);
  assert.equal(r.visits.size,2);assert.equal([...r.visits.values()][0].end,2000);
  assert(r.events.filter(e=>e.type==='visit-end').every(e=>e.reason==='location-change'));
  assert.equal(r.current.start,5000);
});

test('traveling back to the same instance does not split a visit or fabricate friend exits',()=>{
  const r=new Recorder('usr_alt');r.observeSelf(self(),1000);r.observeRoster([friend()],self(),1500);
  r.observeFriend(friend('usr_friend','traveling:traveling'),2000);
  r.observeRoster([friend('usr_friend','traveling')],self(),2500);
  r.observeSelf(self('traveling'),3000);r.observeSelf(self(),4000);
  assert.equal(r.visits.size,1);assert(r.roster.has('usr_friend'));
  assert.equal(r.events.filter(e=>['visit-end','person-leave'].includes(e.type)).length,0);
  r.observeSelf(self('traveling'),5000);r.close(8000,'manual-stop','last-observed');
  assert.equal([...r.visits.values()][0].end,4000);
});

test('world names remain available for repeated visits and journal replay',()=>{
  const r=new Recorder('usr_alt');r.observeSelf(self(),1000);r.emit('world',{worldId:'wrld_a',name:'Let me decay'},1100);
  r.observeSelf(self('wrld_b:2'),2000);r.observeSelf(self(),3000);
  assert.equal(r.current.worldName,'Let me decay');
  const replayed=new Recorder('usr_alt',()=>{},r.events,{closeUnfinished:false});
  assert.equal(replayed.current.worldName,'Let me decay');
  replayed.close(4000);replayed.observeSelf(self(),5000);
  assert.equal(replayed.current.worldName,'Let me decay');
});

test('location transitions retain initial/final roster, repeated visits, and independent avatars',()=>{
  const r=new Recorder('usr_alt');
  r.observeSelf(self(),1000);
  r.observeRoster([friend()],self(),1500);
  r.observeFriend(friend('usr_second'),2000);
  r.observeFriend(friend('usr_friend','wrld_b:2'),3000);
  r.observeFriend(friend('usr_second','wrld_a:1','avtr_new'),3500);
  r.observeSelf(self('wrld_b:2','avtr_b'),4000);
  r.observeSelf(self('wrld_a:1'),5000);
  assert.equal(r.visits.size,3);
  const first=[...r.visits.values()][0];
  assert.deepEqual(first.initial.map(p=>p.id),['usr_alt','usr_friend']);
  assert.deepEqual(first.final.map(p=>p.id),['usr_alt','usr_second']);
  assert.equal(first.end,4000);
  assert.equal(first.finalAt,3500);
  assert.equal(first.final.find(p=>p.id==='usr_second').avatar.id,'avtr_new');
  assert.equal(r.events.filter(e=>e.type==='person-join').length,1);
  assert.equal(r.events.filter(e=>e.type==='person-leave').length,1);
  const segments=attendance(r.detail(first.id));
  assert.equal(segments.find(s=>s.person.id==='usr_friend').end,3000);
  assert.equal(segments.find(s=>s.person.id==='usr_second').start,2000);
});

test('later pipeline roster events keep open charts and gap/restart snapshots consistent',()=>{
  const journal=[], r=new Recorder('usr_alt',e=>journal.push(e));
  r.observeSelf(self(),1000);r.observeRoster([friend()],self(),1500);
  r.observeFriend(friend('usr_second'),3000);
  r.observeFriend(friend('usr_friend','offline'),4000);
  const open=r.detail(r.current.id);
  assert.equal(open.visit.finalAt,4000);assert.equal(open.visit.lastSeen,4000);
  assert.equal(r.query({from:0,to:10000}).stats.duration,3000);
  assert(attendance(open).every(segment=>segment.end>=segment.start));
  const restored=new Recorder('usr_alt',()=>{},journal);
  assert.equal([...restored.visits.values()][0].end,4000);
  assert.equal([...restored.visits.values()][0].finalAt,4000);
  r.markGap(10000,'api-unavailable');
  const closed=[...r.visits.values()][0];
  assert.equal(closed.end,4000);assert.equal(closed.finalAt,4000);
  assert.deepEqual(closed.final.map(p=>p.id),['usr_alt','usr_second']);
});

test('unchanged roster polls advance the persisted final observation without false activity events',()=>{
  const journal=[],r=new Recorder('usr_alt',e=>journal.push(e));
  r.observeSelf(self(),1000);r.observeRoster([friend()],self(),1500);
  r.observeSelf(self(),5000);r.observeRoster([friend()],self(),5500);
  assert.equal(r.detail(r.current.id).visit.finalAt,5500);
  assert.equal(r.current.initialAt,1500);
  assert.equal(r.query({from:0,to:10000}).events.some(e=>e.type==='roster-observed'),false);
  assert.equal(r.events.filter(e=>['person-join','person-leave'].includes(e.type)).length,0);
  const restored=new Recorder('usr_alt',()=>{},journal);
  assert.equal([...restored.visits.values()][0].finalAt,5500);
  assert.equal([...restored.visits.values()][0].end,5500);
});

test('API observation gap excludes unobserved time and recovery starts a new segment',()=>{
  const r=new Recorder('usr_alt');r.observeSelf(self(),1000);r.observeRoster([friend()],self(),1100);r.observeSelf(self(),5000);
  r.markGap(10000,'api-unavailable');r.markGap(15000,'api-unavailable');r.observeSelf(self(),20000);
  assert.equal(r.events.filter(e=>e.type==='observation-gap').length,1);
  const first=[...r.visits.values()][0];assert.equal(first.end,5000);assert.equal(first.endQuality,'last-observed');
  assert.equal(r.query({from:0,to:30000}).stats.duration,4000);
  assert.equal(r.visits.size,2);assert.equal(r.gap,false);
});

test('journal replay closes an unfinished visit at last observation and survives a second replay',()=>{
  const journal=[],r=new Recorder('usr_alt',e=>journal.push(e));
  r.observeSelf(self(),1000);r.observeRoster([friend()],self(),2000);r.observeSelf(self(),4000);
  const restored=new Recorder('usr_alt',e=>journal.push(e),[...journal]);
  assert.equal([...restored.visits.values()][0].end,4000);assert.equal(restored.current,null);
  const again=new Recorder('usr_alt',()=>{},journal);assert.equal(again.visits.size,1);assert.equal(again.current,null);
});

test('identity guard, private locations, and image-only model observations',()=>{
  const r=new Recorder('usr_alt');assert.throws(()=>r.observeSelf({id:'usr_main',location:'wrld_a:1'},100),/身份/);
  r.observeSelf(self(),1000);r.observeSelf(self('private'),2000);assert.equal(r.current,null);
  assert.equal(realLocation('offline'),null);assert.equal(realLocation('traveling'),null);
  const imageUser={id:'usr_alt',currentAvatarImageUrl:'https://example.test/image'};
  assert.equal(avatarOf(imageUser).certainty,'image-only');assert.equal(avatarOf(imageUser).id,'');
  r.observeSelf(imageUser,3000);r.observeSelf(imageUser,4000);
  assert.equal(r.events.filter(e=>e.type==='avatar' && e.avatar.certainty==='image-only').length,1);
  r.observeAvatar(friend('usr_stranger'),5000,'cloud-pipeline');assert.equal(r.avatars.has('usr_stranger'),false);
});

test('date overlap uses clipped duration, self-only filters others, and pagination retains totals',()=>{
  const r=new Recorder('usr_alt');r.observeSelf(self(),1000);r.observeRoster([friend()],self(),2000);
  r.observeFriend(friend('usr_friend','wrld_a:1','avtr_changed'),3000);r.observeSelf(self('wrld_a:1','avtr_changed'),4000);r.close(10000);
  const q=r.query({from:2500,to:5000,selfOnly:true,type:'avatar',limit:1});
  assert.equal(q.stats.duration,2500);assert.equal(q.eventTotal,1);assert(q.events.every(e=>e.self));
  const all=r.query({from:0,to:12000,limit:1});assert.equal(all.events.length,1);assert(all.eventTotal>1);
  assert.equal(r.query({from:0,to:12000,search:'wrld_missing'}).visitTotal,0);
  assert.throws(()=>r.query({from:NaN}),/日期/);
});

test('SVG chart and table output escape untrusted labels and clamp zero duration',()=>{
  const chart=timelineSvg([{id:'abc',worldName:'<script>danger</script>',start:1000,end:1000}],{from:0,to:5000});
  assert(!chart.includes('<script>'));assert(chart.includes('&lt;script&gt;'));assert(!chart.includes('NaN'));
  assert.equal(escapeHtml('"<>&'), '&quot;&lt;&gt;&amp;');
  assert.throws(()=>dateBounds('bad','2026-11-10'),/日期/);
});
