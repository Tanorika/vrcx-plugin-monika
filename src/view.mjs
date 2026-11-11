export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
}
export function durationText(ms) {
  if(ms < 60000)return `${Math.floor(Math.max(0,ms)/1000)} 秒`;
  const minutes = Math.floor(Math.max(0, ms)/60000);
  return minutes >= 60 ? `${Math.floor(minutes/60)} 小时 ${minutes%60} 分` : `${minutes} 分`;
}
export function dateText(at, full = true) {
  return at ? new Date(at).toLocaleString('zh-CN', full ? { hour12: false } : { hour: '2-digit', minute:'2-digit', hour12:false }) : '—';
}
export function localDate(at = Date.now()) {
  const date = new Date(at); return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
export function dateBounds(from, to) {
  const start = new Date(`${from}T00:00:00`).getTime();
  const end = new Date(`${to}T00:00:00`); end.setDate(end.getDate()+1);
  if (!Number.isFinite(start) || !Number.isFinite(end.getTime()) || start >= end.getTime()) throw new Error('请选择有效的日期范围');
  return { from: start, to: end.getTime()-1 };
}
export function activityRange(mode,from,to,now=Date.now()) {
  return mode==='rolling24'?{from:now-86400000,to:now}:dateBounds(from,to);
}
export function safeImage(url) { return typeof url === 'string' && /^https:\/\//.test(url) ? url : ''; }
export function errorText(error) { return error?.message || String(error); }

export function accountPresence(user) {
  if (!user) return {kind:'offline',label:'离线'};
  // Authenticated self profiles can report state=offline while cloud presence is in-game.
  const inGame=/^wrld_[a-zA-Z0-9-]+:[^\s]+$/.test(user.location || '') ||
    ['private','traveling','traveling:traveling'].includes(user.location);
  if (['offline','offline:offline'].includes(user.location) || user.status==='offline' ||
      (user.state==='offline' && !inGame)) return {kind:'offline',label:'离线'};
  return ({active:{kind:'online',label:'在线'},'join me':{kind:'joinme',label:'欢迎加入'},
    'ask me':{kind:'askme',label:'忙碌'},busy:{kind:'busy',label:'请勿打扰'}})[user.status] || {kind:'offline',label:'未知'};
}

export function connectionState(status, serviceConnected, initialized=true) {
  if(!initialized)return {label:'连接中',healthy:null,title:'正在连接 Monika 服务'};
  if (!serviceConnected) return {label:'服务未连接',healthy:false,title:'Monika 服务未连接'};
  if (!status.recording || !status.user) return {label:'账号未连接',healthy:false,title:'Monika 服务已连接 · 账号未连接'};
  return {label:'账号已连接',healthy:Boolean(status.connected && !status.lastError),
    title:`Monika 服务已连接 · ${status.connected?'实时事件已连接':'实时事件重连中 · 云端轮询中'}${status.lastError?` · ${status.lastError}`:''}`};
}

const eventNames = { 'visit-start':'进入实例', 'person-join':'加入实例', 'person-leave':'离开实例', avatar:'模型变化',
  GPS:'位置变化',Status:'状态变化',Bio:'简介变化',Avatar:'模型变化',Online:'上线',Offline:'离线' };
const reasonNames = { 'buffer-expired':'超出合并间隔', 'manual-stop':'手动停止', 'location-change':'位置变化', 'service-restart':'服务重启', 'service-shutdown':'服务关闭',
  'observation-gap':'观察中断', 'session-expired':'会话过期', 'account-switch':'账号切换', 'became-primary':'成为主账号','primary-logout':'主账号已注销',
  'observed-in-instance':'云端观察到位于同一实例','left-or-not-visible':'离开、离线或位置不再可见','api-unavailable':'云端数据暂不可用','rate-limit':'云端限流',offline:'离线', private:'位置不可见' };

export function instanceInfo(location) {
  const value=String(location || ''),instance=value.split(':').slice(1).join(':'),region=/~region\(([^)]+)\)/.exec(instance)?.[1] || '';
  const access=/~group\(/.test(instance)?(/~groupAccessType\(public\)/.test(instance)?'群组公开':'群组'): /~private\(/.test(instance)?(/~canRequestInvite/.test(instance)?'邀请+':'仅限邀请'):/~hidden\(/.test(instance)?'好友+':/~friends\(/.test(instance)?'仅限好友':'公开';
  return {number:instance.split('~')[0],access,region,flag:({jp:'🇯🇵',us:'🇺🇸',use:'🇺🇸',usw:'🇺🇸',eu:'🇪🇺'})[region] || ''};
}
const chartColors=['#5470c6','#91cc75','#fac858','#ee6666','#73c0de','#3ba272','#fc8452','#9a60b4','#ea7ccc'];
function regionFlag(region) {
  let shapes='';
  if(region==='jp')shapes='<rect width="24" height="16" fill="white"/><circle cx="12" cy="8" r="4.5" fill="#e51c39"/>';
  else if(['us','use','usw'].includes(region))shapes='<rect width="24" height="16" fill="white"/>'+Array.from({length:7},(_,i)=>`<rect y="${i*16/13*2}" width="24" height="${16/13}" fill="#b22234"/>`).join('')+'<rect width="10" height="9" fill="#3c3b6e"/>'+Array.from({length:9},(_,i)=>`<circle cx="${2+i%3*3}" cy="${2+Math.floor(i/3)*2.5}" r=".6" fill="white"/>`).join('');
  else if(region==='eu')shapes='<rect width="24" height="16" fill="#003399"/>'+Array.from({length:12},(_,i)=>`<circle cx="${12+4.5*Math.cos(i*Math.PI/6)}" cy="${8+4.5*Math.sin(i*Math.PI/6)}" r=".6" fill="#ffcc00"/>`).join('');
  return shapes?`<svg class="region-flag" viewBox="0 0 24 16" role="img" aria-label="${escapeHtml(region.toUpperCase())}">${shapes}</svg>`:escapeHtml(region);
}
function chartColor(key) { let hash=0;for(const c of String(key))hash=(hash*31+c.charCodeAt(0))>>>0;return chartColors[hash%chartColors.length]; }
export function preciseDurationText(ms) {
  const value=Number(ms),seconds=Number.isFinite(value)?Math.floor(Math.max(0,value)/1000):0;
  return `${seconds>=3600?`${Math.floor(seconds/3600)} 小时 `:''}${seconds>=60?`${Math.floor(seconds/60)%60} 分 `:''}${seconds%60} 秒`;
}
export function chartTooltipHtml(data) {
  const e=escapeHtml,color=typeof data.color==='string' && /^#[\da-f]{6}$/i.test(data.color)?data.color:'#589bd2';
  const sameDay=new Date(data.start).toDateString()===new Date(data.end).toDateString();
  const time=at=>Number.isFinite(at)?sameDay?new Date(at).toLocaleTimeString('zh-CN',{hour12:false}):dateText(at):'—';
  const info=data.location?instanceInfo(data.location):null;
  const name=`${typeof data.name==='string'?data.name:'未知'}${info?` #${info.number} · ${info.access}`:''}`;
  const details=data.kind==='population'
    ?data.total===null?'人数未知':`总人数 ${data.total} · 可见 ${data.known} · 未识别 ${data.unknown}`
    :preciseDurationText(data.end-data.start);
  // Same layout as VRCX Charts/components/InstanceActivityTooltip.jsx (MIT).
  return `<div class="chart-tooltip-content"><span class="chart-tooltip-color" style="background:${color}"></span><div><div>${e(name)}</div><div>${e(time(data.start))} - ${e(time(data.end))}</div><div>${e(details)}</div></div></div>`;
}
export function chartTooltipAttributes(data) {return `data-chart-tooltip="${escapeHtml(JSON.stringify(data))}"`;}
export function chartTooltipPosition(x,y,width,height,viewportWidth,viewportHeight) {
  return {left:Math.max(8,Math.min(x+16,viewportWidth-width-8)),top:Math.max(8,Math.min(y+16,viewportHeight-height-8))};
}
function axisTime(at,span) {
  return new Date(at).toLocaleString('zh-CN',span>90000000?{month:'numeric',day:'numeric'}:
    {hour:'2-digit',minute:'2-digit',...(span<600000?{second:'2-digit'}:{}),hour12:false});
}
export function timelineSvg(rows, { from, to, width = 1000, selected = '', label = v => v.worldName, start = v => v.start, end = v => v.end ?? v.lastSeen, rowKey = null,
  showAxis = true, labelVisits = false, interactive = true, clipId = 'monika-clip' } = {}) {
  if (!rows.length) return '<div class="monika-empty">此范围内没有活动记录</div>';
  const left = 170, right = 20, top = 16, rowHeight = 40;
  const indices=new Map(),rowIndices=rows.map((row,i)=>{const key=rowKey?rowKey(row):i;if(!indices.has(key))indices.set(key,indices.size);return indices.get(key);});
  const height = top+indices.size*rowHeight+(showAxis?38:10), bottom=showAxis?height-30:height;
  const span = Math.max(60000, to-from), minimum = from, maximum = minimum+span;
  const x = at => left+(at-minimum)/span*(width-left-right);
  let html = `<svg class="monika-timeline" viewBox="0 0 ${width} ${height}" role="img" aria-label="活动时间轴"><defs><clipPath id="${escapeHtml(clipId)}"><rect x="${left}" y="${top}" width="${width-left-right}" height="${height-top}"/></clipPath></defs>`;
  for (let i=0; i<=8; i++) { const tick = minimum+span*i/8, pos = x(tick);
    html += `<line x1="${pos}" x2="${pos}" y1="${top}" y2="${bottom}" class="monika-grid"/>${showAxis?`<text x="${pos}" y="${height-10}" text-anchor="middle" class="monika-axis">${escapeHtml(axisTime(tick,span))}</text>`:''}`; }
  html+=`<path d="M${left} ${top}V${bottom}${showAxis?`H${width-right}`:''}" class="monika-chart-axis"/>`;
  const labeled=new Set();
  rows.forEach((v,i) => {
    const row=rowIndices[i],y = top+row*rowHeight, a = Math.max(start(v), minimum), b = Math.min(end(v), maximum);
    const name = String(label(v) || '未知'),color=chartColor(v.location?.split(':')[0] || v.person?.id || name);
    if(!labeled.has(row)){labeled.add(row);const action=interactive && (labelVisits || v.location);
      html += `<text x="${left-9}" y="${y+23}" text-anchor="end" class="monika-axis" ${action?`role="button" tabindex="0" ${labelVisits?`data-visit="${escapeHtml(v.visitId || v.id)}"`:`data-instance="${escapeHtml(v.location)}"`}`:''}><title>${escapeHtml(name)}${action?labelVisits?' · 查看活动历史':' · 打开 VRCX 世界页面':''}</title>${escapeHtml(name.length>21 ? `${name.slice(0,21)}…` : name)}</text>`;}
    if (b>=a) html += `<rect ${interactive?`tabindex="0" role="button" aria-label="${escapeHtml(name)} · 活动历史" data-visit="${escapeHtml(v.visitId || v.id)}"`:''} ${chartTooltipAttributes({name,color,start:start(v),end:end(v),location:v.location || ''})} x="${x(a)}" y="${y+7}" width="${Math.max(3,x(b)-x(a))}" height="26" rx="2" style="fill:${color}" clip-path="url(#${escapeHtml(clipId)})" class="monika-bar ${selected===(v.visitId || v.id) ? 'selected' : ''}"></rect>`;
  });
  return `${html}</svg>`;
}

export function timelineAxisSvg({from,to,width=1000}) {
  const left=170,right=20,span=Math.max(60000,to-from);
  return `<svg class="monika-timeline" viewBox="0 0 ${width} 34" role="img" aria-label="时间刻度"><path d="M${left} 0H${width-right}" class="monika-chart-axis"/>${Array.from({length:9},(_,i)=>{
    const position=left+i/8*(width-left-right);
    return `<path d="M${position} 0V5" class="monika-chart-axis"/><text x="${position}" y="24" text-anchor="middle" class="monika-axis">${escapeHtml(axisTime(from+span*i/8,span))}</text>`;
  }).join('')}</svg>`;
}
export function timelineChartHtml(rows,options,scrollKey) {
  if(!rows.length)return '<div class="monika-empty">此范围内没有活动记录</div>';
  const clipId=`monika-clip-${String(scrollKey).replace(/[^a-zA-Z0-9_-]/g,'_')}`;
  // Only rows scroll vertically. The axis shares their horizontal container and gutter.
  return `<div class="timeline-frame" data-chart-animation="${escapeHtml(scrollKey)}" data-scroll-x="${escapeHtml(scrollKey)}"><div class="timeline-inner"><div class="timeline-body" data-scroll="${escapeHtml(scrollKey)}">${timelineSvg(rows,{...options,showAxis:false,clipId})}</div><div class="timeline-axis">${timelineAxisSvg(options)}</div></div></div>`;
}

export function attendance(detail, selfOnly = false) {
  const { visit, events } = detail;
  const open = new Map(), segments = [];
  const self=[...visit.initial,...visit.final].find(p=>p.id===visit.accountId) || {id:visit.accountId,displayName:events.find(e=>e.self)?.displayName || '目标账号'};
  open.set(self.id,{person:self,start:visit.start});
  if(!events.some(e=>e.type==='snapshot'))for (const p of visit.initial)if(p.id!==visit.accountId)open.set(p.id,{person:p,start:visit.initialAt ?? visit.start});
  const close=(id,at)=>{const item=open.get(id);if(item){segments.push({...item,end:at});open.delete(id);}};
  for (const e of [...events].sort((a,b)=>a.at-b.at)) {
    if(e.type==='snapshot'){
      const present=new Set(e.people.map(p=>p.id));
      for(const id of open.keys())if(id!==visit.accountId && !present.has(id))close(id,e.at);
      for(const p of e.people)open.set(p.id,{person:p,start:open.get(p.id)?.start ?? e.at});
    }
    if (e.type === 'person-join') open.set(e.person.id, { person: e.person, start:open.get(e.person.id)?.start ?? e.at });
    if (e.type === 'person-leave') close(e.person.id,e.at);
  }
  for (const p of open.values()) segments.push({ ...p, end: visit.end ?? visit.lastSeen });
  return segments.map(s=>({...s,start:Math.max(visit.start,s.start),end:Math.min(visit.end ?? visit.lastSeen,s.end)}))
    .filter(s => s.end>=s.start && (!selfOnly || s.person.id===visit.accountId)).map((s,i) => ({ ...s, id: `${visit.id}-${i}`, visitId: visit.id, self:s.person.id===visit.accountId }));
}

export function populationTimeline(detail) {
  const visit=detail.visit,knownSegments=attendance(detail),from=visit.start,to=visit.end ?? visit.lastSeen;
  const samples=(visit.population || []).filter(s=>Number.isFinite(s.at) && s.at>=from && s.at<=to &&
    (s.total===null || (Number.isInteger(s.total) && s.total>=0))).sort((a,b)=>a.at-b.at);
  const boundaries=new Set([from,to]);
  for(const sample of samples){boundaries.add(sample.at);boundaries.add(Math.min(to,sample.at+Math.max(30000,sample.intervalMs || 60000)*2));}
  for(const segment of knownSegments){boundaries.add(segment.start);boundaries.add(segment.end);}
  const times=[...boundaries].sort((a,b)=>a-b),intervals=[];
  let index=-1,weightedTotal=0,coverage=0;
  for(let i=0;i<times.length-1;i++){
    const start=times[i],end=times[i+1];if(end<=start)continue;
    while(index+1<samples.length && samples[index+1].at<=start)index++;
    const sample=samples[index];
    const total=sample && start<sample.at+Math.max(30000,sample.intervalMs || 60000)*2?sample.total:null;
    const known=knownSegments.filter(s=>s.start<=start && s.end>start).length;
    const interval={start,end,total,known,unknown:total===null?null:Math.max(0,total-known),mismatch:total!==null && known>total,sample:sample || null};
    intervals.push(interval);
    if(total!==null){weightedTotal+=total*(end-start);coverage+=end-start;}
  }
  const valid=samples.filter(s=>s.total!==null),latest=samples.at(-1);
  return {from,to,samples,intervals,knownSegments,coverage,average:coverage?weightedTotal/coverage:null,
    peak:valid.length?Math.max(...valid.map(s=>s.total)):null,latest:latest || null};
}

export function populationSvg(detail,{width=1000,from=detail.visit.start,to=Math.max(detail.visit.start+60000,detail.visit.end ?? detail.visit.lastSeen)}={}) {
  const timeline=populationTimeline(detail),e=escapeHtml;
  if(!timeline.samples.length)return '<div class="monika-empty">此活动尚未采集实例人数，更新后开始记录。</div>';
  const left=170,right=20,top=18,height=210,bottom=height-35,span=Math.max(60000,to-from);
  const maximum=Math.max(1,timeline.peak || 0,...timeline.intervals.map(s=>s.known)),step=Math.max(1,Math.ceil(maximum/4)),scale=step*4;
  const x=at=>left+(at-from)/span*(width-left-right),y=count=>bottom-count/scale*(bottom-top);
  let html=`<svg class="monika-timeline population-timeline" viewBox="0 0 ${width} ${height}" role="img" aria-label="房间人数时间轴"><text x="${left-9}" y="${top-3}" text-anchor="end" class="monika-axis">人数</text>`;
  for(let i=0;i<=4;i++){const count=step*i;html+=`<line x1="${left}" x2="${width-right}" y1="${y(count)}" y2="${y(count)}" class="monika-grid"/><text x="${left-9}" y="${y(count)+4}" text-anchor="end" class="monika-axis">${count}</text>`;}
  let previous=null;
  for(const interval of timeline.intervals){
    const a=Math.max(interval.start,from),b=Math.min(interval.end,to);if(b<=a)continue;
    const start=x(a),length=x(b)-start;
    const tooltip=chartTooltipAttributes({kind:'population',name:detail.visit.worldName,color:'#73c0de',start:a,end:b,total:interval.total,known:interval.known,unknown:interval.unknown});
    if(interval.total===null){html+=`<rect ${tooltip} x="${start}" y="${top}" width="${length}" height="${bottom-top}" class="population-gap"></rect>`;previous=null;continue;}
    const known=Math.min(interval.total,interval.known),base=y(known),peak=y(interval.total);
    if(previous?.end===a)html+=`<path d="M${start} ${y(previous.total)}V${peak}" class="population-total"/>`;
    html+=`<g ${tooltip}><rect x="${start}" y="${base}" width="${length}" height="${bottom-base}" class="population-known"/><rect x="${start}" y="${peak}" width="${length}" height="${base-peak}" class="population-unknown"/><path d="M${start} ${peak}H${start+length}" class="population-total ${interval.mismatch?'population-mismatch':''}"/></g>`;
    previous=interval;
  }
  for(const sample of timeline.samples)if(sample.total!==null){const known=timeline.knownSegments.filter(s=>s.start<=sample.at && s.end>sample.at).length;
    html+=`<circle ${chartTooltipAttributes({kind:'population',name:detail.visit.worldName,color:'#73c0de',start:sample.at,end:sample.at,total:sample.total,known,unknown:Math.max(0,sample.total-known)})} cx="${x(sample.at)}" cy="${y(sample.total)}" r="2.5" class="population-point"></circle>`;}
  for(let i=0;i<=8;i++){const tick=from+span*i/8,pos=x(tick);html+=`<line x1="${pos}" x2="${pos}" y1="${top}" y2="${bottom}" class="monika-grid"/><text x="${pos}" y="${height-10}" text-anchor="middle" class="monika-axis">${e(axisTime(tick,span))}</text>`;}
  html+=`<path d="M${left} ${top}V${bottom}H${width-right}" class="monika-chart-axis"/></svg>`;
  return html;
}

export function populationLabel(sample,at=Date.now()) {
  return sample && Number.isInteger(sample.total) && sample.total>=0 && at>=sample.at && at-sample.at<Math.max(30000,sample.intervalMs || 60000)*2
    ? `${sample.total}${sample.capacity?`/${sample.capacity}`:''} 人` : '人数未知';
}
export function visitPopulation(visit,at=visit.end ?? visit.lastSeen) {
  return (visit.population || []).filter(s=>s.at>=visit.start && s.at<=at).sort((a,b)=>a.at-b.at).at(-1) || null;
}
export function entryPopulation(visit) {
  const first=(visit.population || []).filter(sample=>sample.at>=visit.start).sort((a,b)=>a.at-b.at)[0];
  return first && first.at-visit.start<=Math.max(30000,first.intervalMs || 60000) ? first : null;
}
export function visitActivityEvents(detail,{types=[],selfOnly=false,search=''}={}) {
  const needle=search.toLowerCase();
  return detail.events.filter(event=>event.visitId===detail.visit.id && ['person-join','person-leave','avatar'].includes(event.type) &&
    !event.baseline && (!types.length || types.includes(event.type)) &&
    (!selfOnly || event.self || event.person?.id===detail.visit.accountId || event.userId===detail.visit.accountId) &&
    (!needle || JSON.stringify(event).toLowerCase().includes(needle))).sort((a,b)=>b.at-a.at);
}

function statusIndicator(status) {
  const presence=accountPresence({status});
  return `<span class="dot ${presence.kind}" role="img" aria-label="${escapeHtml(presence.label)}" title="${escapeHtml(presence.label)}"></span>`;
}

const css = `
.monika{--m-bg:var(--background,#fff);--m-fg:var(--foreground,#18212d);--m-muted:var(--muted-foreground,#737d8c);--m-border:var(--border,#e2e5ea);--m-card:var(--card,#fff);--m-soft:var(--muted,#f5f6f8);--m-accent:#4a91d3;color:var(--m-fg);font:14px/1.5 Inter,"Microsoft YaHei",sans-serif;background:var(--m-bg);padding:24px;min-height:100%;box-sizing:border-box}
.monika *{box-sizing:border-box}.monika button,.monika input,.monika select{font:inherit;color:inherit}.monika button{cursor:pointer;background:var(--m-card);border:1px solid var(--m-border);padding:7px 12px;border-radius:6px;white-space:nowrap}.monika button:hover{background:var(--m-soft)}.monika button:disabled{opacity:.45;cursor:wait}.monika button.primary{background:var(--m-accent);border-color:var(--m-accent);color:#fff}.monika button.active{background:var(--m-soft);color:var(--m-accent)}.monika input:not([type=checkbox]):not([type=range]),.monika select{background:var(--m-bg);border:1px solid var(--m-border);border-radius:5px;padding:7px 9px;min-width:0}.monika input[type=checkbox]{accent-color:var(--m-accent)}.monika input[type=range]{accent-color:var(--m-accent);width:120px}.monika button:focus-visible,.monika input:focus-visible,.monika select:focus-visible,.monika-bar:focus{outline:2px solid var(--m-accent);outline-offset:2px}.monika h1{font-size:23px;font-weight:600;margin:0}.monika h2{font-size:15px;font-weight:600;margin:0 0 12px}.monika h3{font-size:13px;margin:0 0 8px}.monika p{margin:5px 0}.monika small,.monika .muted{color:var(--m-muted);font-size:12px}.monika .row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.monika .between{justify-content:space-between}.monika .header{margin-bottom:18px}.monika .dot{width:8px;height:8px;display:inline-block;border-radius:50%;background:#a4acb6;margin-right:6px}.monika .dot.on{background:#50ad7c}.monika .tabs{border-bottom:1px solid var(--m-border);gap:5px;margin-bottom:18px}.monika .tabs button{border:0;border-radius:0;padding:10px 17px;border-bottom:2px solid transparent;background:transparent}.monika .tabs button.active{border-bottom-color:var(--m-accent)}.monika .notice{background:var(--m-soft);border:1px solid var(--m-border);padding:10px 14px;border-radius:6px;margin:12px 0;color:var(--m-muted);font-size:12px}.monika .error{color:#d06464;border-color:#d0646444}.monika .cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin:18px 0}.monika .card{border:1px solid var(--m-border);border-radius:8px;padding:15px 17px;background:var(--m-card)}.monika .stat{font-size:24px;font-weight:550;letter-spacing:-.5px;margin:4px 0}.monika .panel{border:1px solid var(--m-border);border-radius:8px;padding:17px;margin-bottom:16px;background:var(--m-card)}.monika .filters{gap:10px}.monika .filters input[type=search]{flex:1;min-width:150px}.monika .table-wrap{overflow-x:auto}.monika table{width:100%;border-collapse:collapse;font-size:12px;text-align:left}.monika th{font-weight:500;color:var(--m-muted);padding:10px;border-bottom:1px solid var(--m-border);white-space:nowrap}.monika td{padding:10px;border-bottom:1px solid var(--m-border);vertical-align:middle;max-width:350px;overflow-wrap:anywhere}.monika tbody tr:last-child td{border-bottom:0}.monika .clickrow{cursor:pointer}.monika .clickrow:hover{background:var(--m-soft)}.monika .tag{display:inline-block;font-size:11px;border-radius:4px;padding:2px 6px;background:var(--m-soft);color:var(--m-muted)}.monika .tag.blue{color:var(--m-accent);background:#4a91d318}.monika .empty,.monika-empty{color:var(--m-muted);padding:50px 16px;text-align:center}.monika-timeline{display:block;width:100%;min-width:500px}.monika-axis{font:12px Inter,"Microsoft YaHei",sans-serif;fill:var(--m-muted)}.monika-grid{stroke:var(--m-border);stroke-dasharray:3 4}.monika-bar{fill:#589bd2;cursor:pointer;opacity:.85}.monika-bar:hover,.monika-bar.selected{opacity:1;stroke:#1a6db0;stroke-width:2}.monika-bar.self{fill:#59ae95}.monika .chart-wrap{overflow:auto;max-height:500px}.monika .split{display:grid;grid-template-columns:1fr 1fr;gap:16px}.monika .person-list{display:flex;flex-wrap:wrap;gap:6px}.monika .form-grid{display:grid;gap:12px;max-width:680px}.monika label{display:flex;gap:7px;align-items:center}.monika .form-grid label{display:grid;gap:5px}.monika .form-grid input:not([type=checkbox]),.monika .form-grid select{width:100%}.monika .avatar-img{width:38px;height:38px;object-fit:cover;border-radius:5px;background:var(--m-soft)}.monika .world-bar{height:5px;border-radius:3px;background:#589bd2;margin:6px 0 10px}.monika .pager{justify-content:flex-end;margin-top:12px}.monika .settings-layout{display:grid;grid-template-columns:minmax(260px,1fr) minmax(320px,1fr);gap:16px}.monika .success{color:#50ad7c}.monika .detail-title{word-break:break-word}.monika .avatar-cell{display:flex;gap:10px;align-items:center}.monika [hidden]{display:none!important}@media(max-width:900px){.monika{padding:15px}.monika .cards{grid-template-columns:repeat(2,1fr)}.monika .settings-layout,.monika .split{grid-template-columns:1fr}}`;

// Match VRCX's neutral surfaces, underlined tabs, pill labels and compact log rows.
const nativeCss=`
.monika .activity-record .chart-wrap{max-height:min(420px,45vh);overscroll-behavior:contain}.monika .activity-history .log-list{max-height:min(420px,45vh);overflow:auto;overscroll-behavior:contain}.monika .native-feed .table-wrap{max-height:min(560px,60vh);overflow:auto;overscroll-behavior:contain}.monika .native-feed th{position:sticky;top:0;background:var(--m-bg);z-index:1}.monika .feed-expander{border:0;width:24px;padding:0;height:24px;background:transparent}.monika .feed-summary{max-width:650px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.monika .feed-expanded td{background:var(--m-soft)}.monika .feed-expanded pre{font:inherit;white-space:pre-wrap;margin:0}.monika .x-text-added{background:#91cc7522;color:#91cc75}.monika .x-text-removed{background:#ee666622;color:#ee6666;text-decoration:line-through}.monika .feed-avatar-pair{display:flex;align-items:center;gap:20px}.monika .feed-avatar-pair img{width:160px;height:120px;object-fit:cover;border-radius:4px}.monika .feed-time{white-space:nowrap}
.monika .population-known{fill:#91cc75;fill-opacity:.65}.monika .population-unknown{fill:#8b95a5;fill-opacity:.35}.monika .population-gap{fill:var(--m-muted);fill-opacity:.08;stroke:var(--m-muted);stroke-opacity:.3;stroke-dasharray:2 4}.monika .population-total{fill:none;stroke:#73c0de;stroke-width:2;vector-effect:non-scaling-stroke}.monika .population-mismatch{stroke:#ee6666;stroke-dasharray:4 3}.monika .population-point{fill:#73c0de}.monika .population-heading{margin:20px 0 8px}.monika .population-heading h3{margin:0}.monika .population-legend{gap:16px;font-size:12px;color:var(--m-muted);margin:8px 0 12px}.monika .population-legend span{display:inline-flex;align-items:center;gap:6px}.monika .population-legend i{display:inline-block;width:14px;height:9px;border-radius:1px}.monika .legend-total{height:0!important;border-top:2px solid #73c0de}.monika .legend-known{background:#91cc75a6}.monika .legend-unknown{background:#8b95a55a}.monika .legend-gap{border:1px dashed var(--m-muted)}.monika .attendance-heading{margin:24px 0 8px}
.monika .connection-badge{white-space:nowrap}
.monika .timeline-frame{overflow-x:auto;overscroll-behavior:contain}.monika .timeline-inner{min-width:500px}.monika .timeline-body{max-height:min(420px,45vh);overflow-y:auto;overflow-x:hidden;scrollbar-gutter:stable;overscroll-behavior:contain}.monika .timeline-axis{overflow:hidden;scrollbar-gutter:stable;background:var(--m-bg)}.monika .monika-axis[data-visit]{cursor:pointer}.monika .monika-axis[data-visit]:hover{fill:var(--m-fg)}
.monika .activity-history .log-list{max-height:none;overflow:visible}.monika .activity-history .log-content .table-wrap{max-height:none;overflow-x:auto}.monika .log-group{scroll-margin-top:12px}.monika .visit-charts{padding-top:6px}.monika .activity-history{margin-bottom:0}.monika .footer{margin-bottom:16px}
.monika .visit-types{margin-top:16px}.monika .log-content .table-wrap{max-height:min(320px,35vh);overflow:auto;overscroll-behavior:contain}.monika .log-content th{position:sticky;top:0;background:var(--m-bg);z-index:1}.monika .log-group summary .entry-type{white-space:nowrap}.monika .log-group summary strong{min-width:0;overflow-wrap:anywhere}.monika .dot.pending{background:var(--m-muted)}
.monika .region-flag{display:inline-block;width:20px;height:14px;border-radius:2px;flex-shrink:0;vertical-align:middle}.monika .instance-pill{display:inline-flex;align-items:center;gap:6px}
.monika{--m-accent:var(--foreground,#333);font-family:inherit;padding:18px;line-height:1.5}.monika h1{font-size:18px}.monika .header{margin-bottom:8px}.monika .tabs{margin-bottom:16px;gap:0}.monika .tabs button{font-weight:600;padding:12px 18px;color:var(--m-muted);border-bottom-width:3px}.monika .tabs button.active{color:var(--m-fg);border-bottom-color:var(--m-fg)}.monika .panel{border-radius:8px;padding:16px;background:var(--m-bg)}.monika .cards{margin:12px 0;gap:8px}.monika .card{border:0;background:var(--m-soft);padding:10px 14px;border-radius:6px}.monika .stat{font-size:20px;letter-spacing:0}.monika button{height:34px;border-radius:4px;padding:5px 11px;background:var(--m-bg)}.monika button.primary{background:var(--m-fg);color:var(--m-bg);border-color:var(--m-fg)}.monika button.active{color:var(--m-fg);font-weight:600}.monika .tag{border:1px solid var(--m-border);border-radius:999px;padding:1px 8px;background:transparent;color:var(--m-muted)}.monika .tag.blue{background:var(--m-soft);color:var(--m-fg)}.monika .notice{background:transparent;padding:8px 12px}.monika .filters{gap:8px}.monika .filters input,.monika .filters select{height:34px}.monika .chart-wrap{max-height:none}.monika .chart-total{text-align:center;margin:12px 0 28px}.monika .chart-total strong{display:block;font-size:24px}.monika .monika-bar{opacity:1}.monika .monika-bar:hover,.monika .monika-bar.selected{stroke:var(--m-fg);stroke-width:1.5}.monika-chart-axis{stroke:var(--m-muted);fill:none;stroke-width:1}.monika .monika-axis[data-instance]{cursor:pointer}.monika .monika-axis[data-instance]:hover{fill:var(--m-fg)}.monika .link{border:0;background:transparent;color:inherit;padding:0;height:auto;white-space:normal;text-align:left}.monika .link:hover{text-decoration:underline;background:transparent}.monika .instance-card{background:var(--m-card);border:0;margin-top:12px}.monika .instance-card h2{font-size:12px;color:var(--m-muted);padding-bottom:10px;border-bottom:1px solid var(--m-border)}.monika .instance-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0}.monika .instance-row+.instance-row{border-top:1px solid var(--m-border)}.monika .instance-name{font-size:16px;font-weight:600;margin-bottom:7px}.monika .instance-meta{display:flex;gap:7px;align-items:center;flex-wrap:wrap}.monika .instance-meta .tag{font-size:12px;padding:2px 9px}.monika .icon-button{width:34px;padding:0;font-size:17px}.monika .log-list{border:1px solid var(--m-border);border-radius:6px;overflow:hidden}.monika .log-group summary{display:flex;align-items:center;gap:9px;padding:10px 12px;background:var(--m-soft);cursor:pointer;list-style:none}.monika .log-group summary::-webkit-details-marker{display:none}.monika .log-group summary:before{content:'›';color:var(--m-muted);font-size:18px;line-height:1}.monika .log-group[open] summary:before{content:'⌄'}.monika .log-group summary .log-actions{margin-left:auto;display:flex;align-items:center;gap:8px}.monika .log-group+.log-group{border-top:1px solid var(--m-border)}.monika .log-content{padding:12px}.monika .log-content p{margin-bottom:10px}.monika .log-content .tag{margin:2px}.monika table{font-size:13px}.monika th{font-weight:600;color:var(--m-fg)}.monika th,.monika td{padding:12px}.monika tr:hover td{background:var(--m-soft)}.monika .segments{display:flex;flex-wrap:wrap;gap:0;margin-bottom:12px}.monika .segments button{border-radius:0;margin-left:-1px}.monika .segments button:first-child{border-radius:4px 0 0 4px;margin-left:0}.monika .segments button:last-child{border-radius:0 4px 4px 0}.monika .person-list .tag{padding:4px 10px}.monika .detail-snapshots .panel{background:var(--m-card);border:0}.monika .observation-note{margin:10px 0;color:var(--m-muted);font-size:12px}.monika .settings-layout .panel{background:var(--m-card)}.monika .detail-title{font-size:17px}.monika .footer{margin-top:16px}.monika .summary-worlds{margin-bottom:16px}.monika .summary-worlds summary{cursor:pointer;font-weight:600;margin-bottom:12px}.monika .avatar-img{border-radius:50%}.monika .status-inline{font-size:12px;color:var(--m-muted)}
.monika .connection-badge,.monika .account-presence{display:inline-flex;align-items:center;gap:7px}.monika .connection-badge{font-size:12px;line-height:20px;padding:1px 8px;color:var(--m-muted)}.monika .connection-badge .dot,.monika .account-presence .dot{margin:0;flex-shrink:0}.monika .dot.healthy,.monika .dot.online{background:var(--status-online,#2ed319)}.monika .dot.unhealthy,.monika .dot.busy{background:var(--status-busy,#c80928)}.monika .dot.joinme{background:var(--status-joinme,#00b8ff)}.monika .dot.askme{background:var(--status-askme,#e97c03)}.monika .dot.offline{background:var(--status-offline,#737f8d)}.monika .account-presence{min-width:0}.monika .account-presence small{max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.monika .account-name{font-weight:500;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media(max-width:700px){.monika{padding:12px}.monika .header{gap:8px}.monika .tabs button{padding:10px}.monika .log-group summary{flex-wrap:wrap}.monika .log-group summary .log-actions{margin-left:0}.monika .filters input[type=date]{max-width:145px}.monika .chart-total strong{font-size:21px}.monika .account-presence small{max-width:140px}}
.monika .header{min-height:48px;padding:6px 0;margin-bottom:12px}.monika .tabs.vrcx-topbar{min-height:48px;padding:4px 0 0;gap:4px;flex-wrap:nowrap;overflow-x:auto;align-items:center;border-bottom-width:1px}.monika .tabs.vrcx-topbar button{display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;height:40px;padding:0 12px;line-height:20px;font-weight:500;border-bottom-width:2px;transition:color 200ms ease-out,border-color 200ms ease-out}.monika .tabs.vrcx-topbar button:hover{color:var(--m-fg)}.monika .filters{min-height:44px;margin:4px 0 16px}.monika .visit-types{padding:4px 0}
.monika .log-group summary:before{content:none;display:none}.monika .log-chevron{width:14px;height:14px;flex-shrink:0;color:var(--m-muted);transition:transform 150ms;display:block}.monika .log-group[open] > summary .log-chevron{transform:rotate(90deg)}.monika .monika-bar{transform-box:fill-box;transform-origin:left center}
.monika .chart-tooltip{position:fixed;z-index:1000;pointer-events:none;max-width:min(420px,calc(100vw - 16px));padding:10px;border:1px solid var(--m-border);border-radius:4px;background:var(--m-soft);color:var(--m-fg);box-shadow:0 3px 12px #0003;font-size:12px;line-height:19px;overflow-wrap:anywhere}.monika .chart-tooltip-content{display:flex;align-items:center}.monika .chart-tooltip-color{width:10px;height:55px;flex-shrink:0;margin-right:6px}.monika .monika-grid,.monika .monika-chart-axis{pointer-events:none}
@media(prefers-reduced-motion:reduce){.monika .log-chevron,.monika .tabs.vrcx-topbar button{transition:none}}
`;

export class MonikaView {
  constructor(controller) {
    this.controller = controller;
    this.tab = 'activity'; this.from = localDate(Date.now()-86400000); this.to = localDate(); this.rangeMode='rolling24'; this.search = ''; this.page = 1;
    this.nativeTypes=[];this.accountId = ''; this.busy = false; this.expandedVisits=new Set();
    this.expandedFeed=new Set();this.refreshVersion=0;this.loadingHistory=false;this.scrollPositions=new Map();
    this.statusInitialized=false;this.visitDetails=new Map();this.visitFilters=new Map();this.visitRequests=new Map();this.visitErrors=new Map();
    this.visitModes=new Map();this.selectedVisitId='';this.visitNavigationVersion=0;this.worldsExpanded=false;this.horizontalScrollPositions=new Map();
    this.seenCharts=new Set();this.tooltipTarget=null;
    this.status = { accounts: [] }; this.history = null; this.saved = {}; this.error = ''; this.message = '';
    this.socialView=new MonikaSocialView(this);
    this.root = document.createElement('section'); this.root.className = 'monika'; this.root.setAttribute('aria-label','Monika');
    this.root.addEventListener('click', e => {this.hideTooltip();void this.click(e);});
    this.root.addEventListener('pointermove',e=>this.showTooltip(e));
    this.root.addEventListener('pointerleave',()=>this.hideTooltip());
    this.root.addEventListener('focusin',e=>this.showTooltip(e));
    this.root.addEventListener('focusout',()=>this.hideTooltip());
    this.root.addEventListener('scroll',()=>this.hideTooltip(),true);
    this.root.addEventListener('change', e => void this.change(e));
    this.root.addEventListener('input',e=>{
      if(e.target.name!=='social-search')return;
      this.socialView.search=e.target.value;this.socialView.page=1;
      clearTimeout(this.socialSearchTimer);const id=this.accountId;
      this.socialSearchTimer=setTimeout(()=>{if(this.tab==='social' && this.accountId===id)this.render();},200);
    });
    this.root.addEventListener('submit', e => {if(e.target.closest('[data-monika-native]'))return; e.preventDefault(); void this.submit(e); });
    this.root.addEventListener('toggle', e=>{
      const node=e.target;if(!node.isConnected)return;
      if(node.matches('.summary-worlds')){this.worldsExpanded=node.open;return;}
      if(!node.matches('.log-group') || !node.dataset.group)return;
      const key=this.visitKey(node.dataset.group);
      if(node.open){if(!this.expandedVisits.has(key))this.resetVisitChartAnimation(node.dataset.group);this.expandedVisits.add(key);this.renderVisit(node.dataset.group);if(!this.visitDetails.has(key) && !this.visitErrors.has(key))void this.loadVisit(node.dataset.group);}
      else this.expandedVisits.delete(key);
    },true);
    this.root.addEventListener('keydown', e => {if(e.key==='Escape')this.hideTooltip();if (['Enter',' '].includes(e.key) && e.target.matches('[data-visit],[data-instance]') && e.target.tagName.toLowerCase()!=='button') { e.preventDefault(); void this.click(e); } });
    this.render();
  }
  options() { return { ...activityRange(this.rangeMode,this.from,this.to), search:this.search, page:this.page, limit:100,
    nativeTypes:this.tab==='native'?[...this.nativeTypes]:undefined }; }
  updateConnection(status) {
    this.statusInitialized=true;
    if(status){this.status=status;this.followTargetAccount();}
    this.renderConnection();
  }
  followTargetAccount() {
    const id=this.status.user?.id || this.controller.config?.().accountId || this.accountId || this.status.accounts[0]?.id || '';
    if(id===this.accountId)return false;
    this.accountId=id;this.history=null;this.page=1;this.selectedVisitId='';this.visitNavigationVersion++;
    this.expandedFeed?.clear();this.seenCharts?.clear();this.socialView?.reset(id);return true;
  }
  connectionHtml() {
    const connection=connectionState(this.status,this.controller.serviceConnected,this.statusInitialized);
    return `<span class="dot ${connection.healthy===null?'pending':connection.healthy?'healthy':'unhealthy'}" aria-hidden="true"></span>${escapeHtml(connection.label)}`;
  }
  presenceHtml() {
    const user=this.status.user;if(!user)return '';
    const presence=accountPresence(user),text=[presence.label,user.statusDescription].filter(Boolean).join(' · '),e=escapeHtml;
    return `<span class="account-name">${e(user.displayName)}</span><span class="dot ${presence.kind}" role="img" aria-label="${e(presence.label)}"></span><small title="${e(text)}">${e(text)}</small>`;
  }
  renderConnection() {
    const badge=this.root?.querySelector('.connection-badge');
    if(badge){const html=this.connectionHtml();if(badge.innerHTML!==html)badge.innerHTML=html;badge.title=connectionState(this.status,this.controller.serviceConnected,this.statusInitialized).title;}
    const presence=this.root?.querySelector('.account-presence');if(presence){const html=this.presenceHtml();if(presence.innerHTML!==html)presence.innerHTML=html;}
  }
  visitKey(id,accountId=this.accountId) {return `${accountId}:${id}`;}
  async loadVisit(id,{force=false,render=true}={}) {
    const accountId=this.accountId,key=this.visitKey(id);
    if(this.visitRequests.has(key))return this.visitRequests.get(key);
    if(!force && this.visitDetails.has(key))return this.visitDetails.get(key);
    this.visitErrors.delete(key);
    const request=Promise.resolve().then(async()=>{
      try {
        const detail=await this.controller.detail(accountId,id);
        if(detail.visit.id!==id || detail.visit.accountId!==accountId)throw new Error('实例记录账号不匹配');
        this.visitDetails.set(key,detail);return detail;
      } catch(error){this.visitErrors.set(key,errorText(error));}
      finally{this.visitRequests.delete(key);if(render && this.accountId===accountId)this.renderVisit(id);}
    });
    this.visitRequests.set(key,request);return request;
  }
  renderVisit(id) {
    const node=[...this.root.querySelectorAll('.log-group')].find(node=>node.dataset.group===id);
    if(node){const content=node.querySelector('.log-content');
      this.hideTooltip();this.saveScroll(content);content.innerHTML=this.visitContentHtml(id);this.restoreScroll(content);this.animateCharts(content);}
  }
  animationKey(key) {return JSON.stringify([this.accountId,this.from,this.to,this.page,this.search,key]);}
  resetVisitChartAnimation(id) {
    for(const type of ['people','population'])this.seenCharts.delete(this.animationKey(`${type}:${this.visitKey(id)}`));
  }
  animateCharts(root) {
    const reduced=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    root.querySelectorAll('[data-chart-animation]').forEach(chart=>{
      if(chart.getClientRects && !chart.getClientRects().length)return;
      const key=this.animationKey(chart.dataset.chartAnimation);if(this.seenCharts.has(key))return;
      const bars=chart.querySelectorAll('.monika-bar'),population=chart.querySelector?.('.population-timeline');
      if(!bars.length && !population)return;
      this.seenCharts.add(key);if(reduced)return;
      // Match VRCX InstanceActivity's 300ms chart transition, with bars growing from their left edge.
      bars.forEach((bar,index)=>bar.animate?.([{transform:'scaleX(0)',opacity:0},{transform:'scaleX(1)',opacity:1}],
        {duration:300,delay:Math.min(index,8)*20,easing:'cubic-bezier(.215,.61,.355,1)',fill:'backwards'}));
      if(!bars.length)population.animate?.([{opacity:0},{opacity:1}],{duration:300});
    });
  }
  hideTooltip() {
    const tooltip=this.root?.querySelector?.('[data-monika-tooltip]');if(tooltip)tooltip.hidden=true;
    this.tooltipTarget?.removeAttribute('aria-describedby');this.tooltipTarget=null;
  }
  showTooltip(event) {
    const target=event.target.closest?.('[data-chart-tooltip]'),tooltip=this.root.querySelector('[data-monika-tooltip]');
    if(!target || !tooltip){this.hideTooltip();return;}
    if(this.tooltipTarget!==target){
      this.hideTooltip();let data;try{data=JSON.parse(target.dataset.chartTooltip);}catch{return;}
      if(!data || typeof data!=='object')return;
      tooltip.innerHTML=chartTooltipHtml(data);tooltip.hidden=false;this.tooltipTarget=target;target.setAttribute('aria-describedby',tooltip.id);
    }
    const rect=target.getBoundingClientRect(),x=event.clientX ?? rect.right,y=event.clientY ?? rect.top;
    const position=chartTooltipPosition(x,y,tooltip.offsetWidth,tooltip.offsetHeight,window.innerWidth,window.innerHeight);
    tooltip.style.left=`${position.left}px`;tooltip.style.top=`${position.top}px`;
  }
  saveScroll(root) {
    root.querySelectorAll('[data-scroll]').forEach(node=>this.scrollPositions.set(node.dataset.scroll,node.scrollTop));
    root.querySelectorAll('[data-scroll-x]').forEach(node=>this.horizontalScrollPositions.set(node.dataset.scrollX,node.scrollLeft));
  }
  restoreScroll(root) {
    root.querySelectorAll('[data-scroll]').forEach(node=>{node.scrollTop=this.scrollPositions.get(node.dataset.scroll) || 0;});
    root.querySelectorAll('[data-scroll-x]').forEach(node=>{node.scrollLeft=this.horizontalScrollPositions.get(node.dataset.scrollX) || 0;});
  }
  visitContentHtml(id) {
    const key=this.visitKey(id),detail=this.visitDetails.get(key),e=escapeHtml;
    if(!detail)return this.visitErrors.has(key)?`<p class="error">${e(this.visitErrors.get(key))}</p><button data-retry-visit="${e(id)}">重试</button>`:'<div class="empty" role="status">正在加载…</div>';
    const types=this.visitFilters.get(key) || [],charts=this.visitModes.get(key)==='charts',selected=type=>!charts && (type==='All'?types.length===0:types.includes(type));
    const initial=detail.visit.initial,events=visitActivityEvents(detail,{types,search:this.search});
    const controls=`<div class="segments visit-types" role="group" aria-label="实例活动类型">${[['All','所有'],['person-join','加入实例'],['person-leave','离开实例'],['avatar','模型变化']].map(([type,label])=>`<button data-visit-filter="${e(id)}" data-activity-type="${type}" aria-pressed="${selected(type)}" class="${selected(type)?'active':''}">${label}</button>`).join('')}<button data-visit-chart="${e(id)}" aria-pressed="${charts}" class="${charts?'active':''}">图表</button></div>`;
    if(charts)return `${controls}${this.visitChartsHtml(detail)}`;
    return `<div><h3>进入时人员 · ${initial.length} 人</h3><div class="person-list">${initial.map(person=>`<span class="tag ${person.id===detail.visit.accountId?'blue':''}">${e(person.displayName)}${person.id===detail.visit.accountId?' · 目标账号':''}</span>`).join('') || '<small>暂无人员数据</small>'}</div></div>
      ${controls}${this.eventTable(events,{linked:false,scroll:`visit:${key}`})}`;
  }
  async refresh({localOnly=false}={}) {
    const version=++this.refreshVersion,refreshAccount=this.accountId,isCurrent=()=>version===this.refreshVersion;
    try {
      if(!localOnly){
      this.saved = await this.controller.savedAccounts();
      if(!isCurrent())return;
      let serviceError='';
      try{const status=await this.controller.status();if(!isCurrent())return;this.updateConnection(status);}catch(error){if(!isCurrent())return;serviceError=errorText(error);this.updateConnection({...this.status,user:null,recording:false,connected:false,accounts:await this.controller.storedAccounts()});}
      if (!serviceError) {try{await this.controller.syncDatabase(this.status);}catch(error){serviceError=errorText(error);}}
      if(!isCurrent())return;
      this.error=serviceError;
      }
      this.followTargetAccount();
      if (this.accountId) {
        if(this.tab==='social'){
          await this.socialView.load();if(!isCurrent())return;
        }else if(this.tab!=='settings'){
          const id=this.accountId,options=this.options(),native=this.tab==='native';
          const [history,feed]=await Promise.all([this.controller.history(id,options),native?this.controller.nativeHistory(id,options):null]);
          if(!isCurrent() || id!==this.accountId)return;
          this.history=native?{...history,...feed,range:{from:options.from,to:options.to}}:{...history,range:{from:options.from,to:options.to}};
          if(this.tab==='activity')await Promise.all((history.visits || []).filter(visit=>this.expandedVisits.has(this.visitKey(visit.id))).map(visit=>this.loadVisit(visit.id,{force:true,render:false})));
          if(!isCurrent())return;
        }
      }
    } catch (e) {if(isCurrent()) {this.error=errorText(e);this.history=null;}}
    finally {if(isCurrent()){this.loadingHistory=false;
      const focused=['settings','social'].includes(this.tab) && this.root?.contains?.(document.activeElement) && document.activeElement.matches('input,select');
      if(!(focused && (this.tab==='settings' || (this.tab==='social' && this.accountId===refreshAccount && document.activeElement.closest?.('form')))))this.render();}}
  }
  async refreshSelection() {
    this.seenCharts?.clear();this.visitNavigationVersion++;this.history=null;this.error='';this.loadingHistory=true;this.expandedFeed.clear();
    this.render();await this.refresh({localOnly:true});
  }
  async action(callback) {
    if(this.busy)return;
    this.busy = true; this.error = ''; this.message = ''; this.render();
    try { await callback(); } catch (e) { this.error = errorText(e); }
    finally { this.busy = false; this.render(); }
  }
  input(name) { return this.root.querySelector(`[name="${name}"]`)?.value || ''; }
  render() {
    const nativeFocus=this.socialView.host?.contains(document.activeElement)?document.activeElement:null;
    if(this.tab!=='social')this.socialView.native?.close();
    this.socialView.detach();
    this.root.className=this.tab==='social'?'monika-social-shell':'monika';
    this.hideTooltip();
    this.saveScroll(this.root);
    const active=this.root.contains?.(document.activeElement) && document.activeElement;
    const searchFocus=active && ['search','social-search'].includes(active.name)?{name:active.name,start:active.selectionStart,end:active.selectionEnd}:null;
    const parent=this.root.parentElement,parentScroll=parent?.scrollTop;
    const e = escapeHtml, status = this.status, history = this.history, stats = history?.stats;
    const connection=connectionState(status,this.controller.serviceConnected,this.statusInitialized);
    const disabled = this.busy ? 'disabled' : '';
    const footer=`<div class="row between muted footer"><span>最后更新：${dateText(status.lastSeen)}</span><span>Monika ${e(this.controller.metadata?.build || '0.1.21')}</span></div>`;
    this.root.innerHTML = `<style>${css}${nativeCss}${socialCss}${typeof MonikaNativeUi==='object'?MonikaNativeUi.css:''}</style>${this.tab==='social'?'<div class="monika">':''}
      <div class="row between header"><div class="row"><span class="account-presence">${this.presenceHtml()}</span><button data-action="refresh" ${disabled}>↻ 刷新</button></div>
      <div class="row"><h1>Monika</h1><span class="tag connection-badge" role="status" title="${e(connection.title)}">${this.connectionHtml()}</span></div></div>
      <nav class="row tabs vrcx-topbar" role="tablist" aria-label="Monika 页面">${[['activity','活动历史'],['native','好友动态'],['social','社交'],['settings','账号与设置']].map(([id,text])=>`<button role="tab" data-tab="${id}" aria-controls="monika-page-${id}" aria-selected="${this.tab===id}" class="${this.tab===id?'active':''}">${text}</button>`).join('')}</nav>
      ${this.error?`<div role="alert" class="notice error">${e(this.error)}</div>`:''}${this.message?`<div role="status" class="notice success">${e(this.message)}</div>`:''}
      ${status.lastError?`<div class="notice error">${e(status.lastError)}${status.retryAt ? ` 下次重试：${dateText(status.retryAt)}`:''}</div>`:''}
      ${this.tab==='social'?'<div data-native-error role="alert" class="notice error" hidden></div><div data-native-message role="status" class="notice" hidden></div></div>':''}
      <div role="tabpanel" id="monika-page-${this.tab}">${this.tab==='settings' ? this.settingsHtml(disabled) : this.tab==='social'?this.socialView.html():`
      <div class="row filters"><button data-action="rolling24" class="${this.rangeMode==='rolling24'?'active':''}">近 24 小时</button><input type="date" name="from" aria-label="开始日期" value="${this.from}"><span class="muted">至</span><input type="date" name="to" aria-label="结束日期" value="${this.to}"><button data-action="today">今天</button><button data-action="week">近 7 天</button><button data-action="prev" aria-label="前一天">‹</button><button data-action="next" aria-label="后一天">›</button><input type="search" name="search" placeholder="筛选世界、实例、人员或模型" aria-label="搜索" value="${e(this.search)}"><button data-action="export" ${disabled}>导出</button></div>
      ${this.currentInstancesHtml()}
      <div class="cards">${[['在线时长',durationText(stats?.elapsedDuration ?? stats?.duration ?? 0)],['活动段数',stats?.visits || 0],['可见好友',stats?.people || 0],['模型变化',stats?.avatarChanges || 0]].map(([label,value])=>`<div class="card"><small>${label}</small><div class="stat">${value}</div></div>`).join('')}</div>
      ${!this.accountId ? '<div class="panel empty">先登录目标账号，开始记录活动。</div>' : this.tab==='native' ? `${this.nativeFeedHtml()}${footer}` : this.activityHtml(footer)}`}</div><div id="monika-chart-tooltip" class="chart-tooltip" data-monika-tooltip role="tooltip" hidden></div>`;
    this.restoreScroll(this.root);if(parent)parent.scrollTop=parentScroll;this.animateCharts(this.root);
    if(this.tab==='social')this.socialView.mount();
    if(nativeFocus?.isConnected)nativeFocus.focus({preventScroll:true});
    if(searchFocus){const input=this.root.querySelector(`[name="${searchFocus.name}"]`);input?.focus({preventScroll:true});input?.setSelectionRange(searchFocus.start,searchFocus.end);}
  }
  instanceLink(location,name) { const e=escapeHtml;if(!/^wrld_[a-zA-Z0-9-]+(?::[^\s]+)?$/.test(location || ''))return e(name || ({offline:'离线',private:'私人实例',traveling:'加载中'})[location] || location || '—');const worldName=this.controller.worldName?.(this.accountId,location) || name || location.split(':')[0];return `<button class="link" data-instance="${e(location)}" title="打开 VRCX 世界页面">${e(worldName)}</button>`; }
  instanceMeta(location) { const info=instanceInfo(location);return `<span class="tag instance-pill">${regionFlag(info.region)} ${escapeHtml(info.access)} · #${escapeHtml(info.number)}</span>`; }
  currentInstancesHtml() {
    if(!this.status.recording)return '';
    if(this.tab!=='settings' && this.accountId!==this.status.user?.id)return '';
    const locations=this.status.locations || (this.status.location?[{location:this.status.location,worldName:this.status.location.split(':')[0]}]:[]);
    if(!locations.length)return '';
    return `<div class="panel instance-card"><h2>当前实例${locations.length>1?` · ${locations.length} 个并行活动`:''}</h2>${locations.map(v=>`<div class="instance-row"><div><div class="instance-name">${this.instanceLink(v.location,v.worldName)}</div><div class="instance-meta">${this.instanceMeta(v.location)}<span class="tag" title="目标账号 API 查询的实例总人数">${populationLabel(v.population)}</span><span class="tag">最后位置更新 ${dateText(v.lastSeen,false)}</span></div></div><div class="row"><button data-visit="${escapeHtml(v.visitId || '')}" data-visit-account="${escapeHtml(this.status.user?.id)}" title="展开该实例的图表">活动历史</button></div></div>`).join('')}</div>`;
  }
  activityHtml(footer='') {
    const history = this.history, visits = history?.visits || [], range = history?.range || activityRange(this.rangeMode,this.from,this.to), e = escapeHtml;
    return `<details class="panel summary-worlds" ${this.worldsExpanded?'open':''}><summary>常去世界</summary>${(history?.worlds || []).map(w=>`<div><div class="row between"><span>${e(w.name)}</span><small>${w.visits} 次 · ${durationText(w.duration)}</small></div><div class="world-bar" style="background:${chartColor(w.id)};width:${Math.max(1,w.duration/Math.max(1,history.worlds[0].duration)*100)}%"></div></div>`).join('') || '<p class="empty">暂无记录</p>'}</details>
    <div class="panel activity-record"><h2>活动记录</h2><div class="chart-total"><span class="muted">在线时长</span><strong>${durationText(history?.stats.elapsedDuration ?? history?.stats.duration ?? 0)}</strong></div>${timelineChartHtml([...visits].reverse(),{...range,width:Math.max(500,(this.root.clientWidth || 1000)-68),selected:this.selectedVisitId,labelVisits:true},'activity-chart')}</div>
    ${footer}<div class="panel activity-history"><h2>活动历史</h2><div class="log-list">${visits.map(v=>{
      const sample=entryPopulation(v),open=this.expandedVisits.has(this.visitKey(v.id));
      return `<details class="log-group" data-group="${e(v.id)}" ${open?'open':''}><summary><svg class="log-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg><small>${dateText(v.start)}</small><span class="tag entry-type">进入实例</span><strong>${this.instanceLink(v.location,v.worldName)}</strong>${this.instanceMeta(v.location)}<div class="log-actions"><span class="status-inline">进入时 ${populationLabel(sample,sample?.at)}</span><span class="tag ${v.end===null?'blue':''}">${v.end===null?'当前活动':durationText(v.duration)}</span></div></summary><div class="log-content">${open?this.visitContentHtml(v.id):''}</div></details>`;
    }).join('') || `<div class="empty">${this.loadingHistory?'正在加载…':'此范围内没有活动记录'}</div>`}</div>${this.pager(history?.visitTotal || 0)}</div>`;
  }
  pager(total) { return `<div class="row pager muted"><span>${total} 条 · 第 ${this.page} / ${Math.max(1,Math.ceil(total/100))} 页</span><button data-action="page-prev" ${this.page<=1?'disabled':''}>上一页</button><button data-action="page-next" ${this.page*100>=total?'disabled':''}>下一页</button></div>`; }
  nativeFeedHtml() {
    const events=this.history?.events || [],e=escapeHtml;
    const types=[['All','所有'],['GPS','位置变动'],['Online','上线'],['Offline','下线'],['Status','状态变动'],['Avatar','模型变动'],['Bio','简介变更']];
    const selected=type=>type==='All'?this.nativeTypes.length===0:this.nativeTypes.includes(type);
    return `<div class="panel native-feed"><h2>目标账号动态</h2><div class="segments" role="group" aria-label="动态类型">${types.map(([type,label])=>`<button data-native-type="${type}" aria-pressed="${selected(type)}" class="${selected(type)?'active':''}">${label}</button>`).join('')}</div><div class="table-wrap" data-scroll="native-feed"><table><thead><tr><th></th><th>时间</th><th>类型</th><th>玩家</th><th>详细信息</th></tr></thead><tbody>${events.map(event=>{
      const open=this.expandedFeed.has(event.id);
      return `<tr><td><button class="feed-expander" data-feed-row="${e(event.id)}" aria-label="${open?'收起':'展开'}${e(eventNames[event.type])}" aria-expanded="${open}">${open?'⌄':'›'}</button></td><td class="feed-time">${dateText(event.at,false)}</td><td><span class="tag">${e(eventNames[event.type])}</span></td><td>${e(event.displayName)}</td><td><div class="feed-summary">${this.nativeFeedContent(event)}</div></td></tr>${open?`<tr class="feed-expanded"><td></td><td colspan="4">${this.nativeFeedDetails(event)}</td></tr>`:''}`;
    }).join('') || `<tr><td colspan="5" class="empty" role="status">${this.loadingHistory?'正在加载…':'暂无数据'}</td></tr>`}</tbody></table></div>${this.pager(this.history?.eventTotal || 0)}</div>`;
  }
  nativeFeedContent(event) {
    const e=escapeHtml;
    if(['GPS','Online','Offline'].includes(event.type))return event.location?`${this.instanceLink(event.location,event.worldName)} ${/^wrld_/.test(event.location)?this.instanceMeta(event.location):''}`:'—';
    if(event.type==='Status')return event.statusDescription===event.previousStatusDescription
      ?`${statusIndicator(event.previousStatus)} → ${statusIndicator(event.status)}`:`${statusIndicator(event.status)} ${e(event.statusDescription)}`;
    if(event.type==='Bio')return e(event.bio || '—');
    if(event.type==='Avatar')return this.modelLink({id:/^avtr_/.test(event.avatarName)?event.avatarName:'',name:event.avatarName,image:event.currentAvatarImageUrl || event.currentAvatarThumbnailImageUrl});
    return '';
  }
  nativeFeedDetails(event) {
    const e=escapeHtml;
    if(event.type==='GPS')return `${event.previousLocation?`${this.instanceLink(event.previousLocation)}<br>↓<br>`:''}${this.nativeFeedContent(event)}`;
    if(event.type==='Status')return `${statusIndicator(event.previousStatus)} ${e(event.previousStatusDescription)} → ${statusIndicator(event.status)} ${e(event.statusDescription)}`;
    if(event.type==='Bio'){
      const difference=typeof vrcxFeedDifference==='function'?vrcxFeedDifference(event.previousBio,event.bio):`${e(event.previousBio)} → ${e(event.bio)}`;
      const links=typeof vrcxBioLinksDifference==='function'?vrcxBioLinksDifference(event.previousBioLinks || [],event.bioLinks || []):[];
      return `<pre>${difference}</pre>${links.filter(item=>/^https?:\/\//.test(item.link)).map(item=>`<div><a class="${e(item.className)}" href="${e(item.link)}" target="_blank" rel="noreferrer">${e(item.link)}</a></div>`).join('')}`;
    }
    if(event.type==='Avatar')return `<div class="feed-avatar-pair">${[event.previousCurrentAvatarImageUrl || event.previousCurrentAvatarThumbnailImageUrl,event.currentAvatarImageUrl || event.currentAvatarThumbnailImageUrl].map((url,i)=>`${i?'→':''}<div>${safeImage(url)?`<img src="${e(url)}" alt="${i?'当前':'上次'}模型" loading="lazy">`:''}${this.modelLink({image:url,...(i?{id:/^avtr_/.test(event.avatarName)?event.avatarName:'',name:event.avatarName}:{})})}</div>`).join('')}</div>`;
    return this.nativeFeedContent(event);
  }
  eventTable(events,{linked=false,scroll=''}={}) {
    const e = escapeHtml;
    return `<div class="table-wrap" ${scroll?`data-scroll="${e(scroll)}"`:''}><table><thead><tr><th>时间</th><th>类型</th><th>玩家</th><th>详细信息</th></tr></thead><tbody>${events.map(event=>`<tr ${linked && event.visitId ? `class="clickrow" data-visit="${e(event.visitId)}"`:''}><td>${dateText(event.at)}</td><td><span class="tag ${event.self?'blue':''}">${e(eventNames[event.type] || event.type)}</span></td><td>${e(event.displayName || event.person?.displayName || '—')}${event.self?' <span class="tag blue">自己</span>':''}</td><td>${this.eventContent(event)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">暂无数据</td></tr>'}</tbody></table></div>`;
  }
  eventContent(event) {
    const e = escapeHtml;
    if(event.type==='Avatar')return this.nativeFeedContent(event);
    if(event.type==='GPS')return `${this.instanceLink(event.location,event.worldName || event.location)} ${this.instanceMeta(event.location)}${event.previousLocation?`<br><small>${e(event.previousLocation)} → ${e(event.location)}</small>`:''}`;
    if(event.type==='Status')return `${e(event.previousStatus)} → ${e(event.status)} ${e(event.statusDescription)}`;
    if(event.type==='Bio')return e(event.bio);
    if (event.type==='avatar') return `<div class="avatar-cell">${[event.previous,event.avatar].filter(Boolean).map((avatar,index)=>`${index?'→':''}${safeImage(avatar.image)?`<img class="avatar-img" loading="lazy" referrerpolicy="no-referrer" src="${e(safeImage(avatar.image))}" alt="${index?'当前':'上次'}模型">`:''}${this.modelLink(avatar)}`).join('')}</div>`;
    if(['person-join','person-leave'].includes(event.type))return '';
    if(event.location && /^wrld_[a-zA-Z0-9-]+:[^\s]+$/.test(event.location))return `${this.instanceLink(event.location,this.history?.visits.find(v=>v.location===event.location)?.worldName || event.location.split(':')[0])} ${this.instanceMeta(event.location)}`;
    if(event.location)return e(event.location);
    return e(reasonNames[event.reason] || event.reason || '');
  }
  modelLink(avatar) {
    const info=this.controller.avatarInfo?.(this.accountId,avatar.id,avatar.image),id=info?.id || avatar.id;
    const name=info?.name || (avatar.name && !/^avtr_|ID 未知/.test(avatar.name)?avatar.name:'') || '未知模型';
    return /^avtr_[a-zA-Z0-9-]+$/.test(id || '')?`<button class="link" data-avatar="${escapeHtml(id)}" title="打开 VRCX 模型详情">${escapeHtml(name)}</button>`:`<span>${escapeHtml(name)}</span>`;
  }
  visitChartsHtml(detail) {
    const { visit } = detail, e = escapeHtml;
    const people = list => list.map(p=>`<span class="tag ${p.id===visit.accountId?'blue':''}" title="${e(p.id)}">${e(p.displayName)}${p.id===visit.accountId?' · 目标账号':''}</span>`).join('') || '<small>暂无人员数据</small>';
    const segments = attendance(detail).sort((a,b)=>Number(b.self)-Number(a.self) || a.start-b.start);
    const range={width:Math.max(500,(this.root.clientWidth || 1000)-84),from:visit.start,to:Math.max(visit.start+60000,visit.end ?? visit.lastSeen)};
    const population=populationTimeline(detail),last=populationLabel(population.latest,visit.end ?? visit.lastSeen);
    return `<div class="visit-charts"><p>${dateText(visit.start)} → ${dateText(visit.end ?? visit.lastSeen)}</p>
      <div class="row between population-heading"><h3>房间人数时间轴</h3><small>最后 ${last} · 峰值 ${population.peak ?? '—'} 人${population.average===null?'':` · 平均 ${population.average.toFixed(1)} 人`}</small></div>
      <div class="row population-legend"><span><i class="legend-total"></i>总人数</span><span><i class="legend-known"></i>可见人数</span><span><i class="legend-unknown"></i>未识别人数估算</span><span><i class="legend-gap"></i>人数未知</span></div>
      <div class="chart-wrap" data-chart-animation="population:${e(this.visitKey(visit.id))}">${populationSvg(detail,range)}</div>
      <h3 class="attendance-heading">可见好友活动</h3>${timelineChartHtml(segments,{...range,rowKey:s=>s.person.id,label:s=>`${s.person.displayName}${s.self?' · 目标账号':''}`,start:s=>s.start,end:s=>s.end,interactive:false},`people:${this.visitKey(visit.id)}`)}
      <div class="split detail-snapshots"><div class="panel"><h3>进入时人员 · ${dateText(visit.initialAt)}</h3><div class="person-list">${people(visit.initial)}</div></div><div class="panel"><h3>${visit.end!==null?'离开时人员':'当前人员'} · ${dateText(visit.finalAt)}</h3><div class="person-list">${people(visit.final)}</div></div></div>
      </div>`;
  }
  settingsHtml(disabled) {
    const e = escapeHtml, config = this.controller.config(), primary = this.controller.primaryId();
    const saved = Object.values(this.saved).filter(s=>s.user?.id!==primary);
    return `<div class="settings-layout"><div><div class="panel"><h2>本地服务</h2><form data-form="config" class="form-grid"><label>服务端口<input name="port" type="number" min="1024" max="65535" value="${e(config.port || 39123)}" required></label><label>轮询间隔（秒）<input name="interval" type="number" min="30" max="600" value="${(config.interval || 60000)/1000}" required></label><label>实例合并间隔（秒，0 为自动）<input name="locationBuffer" type="number" min="0" max="1800" value="${(config.locationBufferMs || 0)/1000}" required></label><label>网络代理（可选，保存后重新登录生效）<input name="proxy" value="${e(config.proxy || '')}" placeholder="http://127.0.0.1:7897"></label><label><span><input name="autoLogin" type="checkbox" ${config.autoLogin?'checked':''}> 启动插件时自动登录所选目标账号</span></label><button class="primary" ${disabled}>保存并连接</button></form><div class="notice">启动本地服务：<code>npm start</code></div></div>
      <div class="panel"><h2>记录状态</h2><p>主账号：${e(this.controller.primaryName() || '未登录')}</p><p>目标账号：${e(this.status.user?.displayName || '未登录')}</p><p class="muted">当前合并间隔：${durationText(this.status.locationBufferMs || (config.interval || 60000)*2)}</p>${this.currentInstancesHtml()}<p class="muted">最后观察：${dateText(this.status.lastSeen)}</p><button data-action="stop" ${disabled}>停止目标账号记录</button></div></div>
      <div><div class="panel"><h2>使用 VRCX 已保存账号</h2><form data-form="saved-login" class="form-grid"><label>目标账号<select name="savedAccount" required><option value="">选择账号</option>${saved.map(s=>`<option value="${e(s.user.id)}" ${config.accountId===s.user.id?'selected':''}>${e(s.user.displayName || s.user.id)}</option>`).join('')}</select></label><button class="primary" ${disabled}>登录目标账号</button></form></div>
      <div class="panel"><h2>添加账号 / 重新登录</h2><form data-form="new-login" class="form-grid"><label>用户名<input name="username" autocomplete="username" required></label><label>密码<input name="password" type="password" autocomplete="current-password" required></label><button class="primary" ${disabled}>登录并保存到 VRCX</button></form></div>
      ${this.status.pending2FA?.length?`<div class="panel"><h2>二步验证</h2><form data-form="verify" class="form-grid"><label>验证方式<select name="twoFactorType">${[...new Set([...this.status.pending2FA,'otp'])].map(type=>`<option value="${e(type)}">${e({totp:'验证器',emailOtp:'邮件验证码',otp:'恢复码'}[type] || type)}</option>`).join('')}</select></label><label>验证码<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,12}" required></label><button class="primary" ${disabled}>完成验证</button></form></div>`:''}</div></div>`;
  }
  async click(event) {
    if(event.target.closest?.('[data-monika-native]')?.hasAttribute?.('data-monika-native'))return;
    const target = event.target.closest('button,[data-visit],[data-instance]'); if (!target || target.disabled) return;
    if(this.socialView && await this.socialView.click(target,event))return;
    if(target.dataset.avatar){try{await this.controller.openAvatar(target.dataset.avatar,this.accountId);}catch(error){this.error=errorText(error);this.render();}return;}
    if(target.dataset.instance) {event.preventDefault();event.stopPropagation();try{await this.controller.openWorld(target.dataset.instance,this.accountId || this.status.user?.id);}catch(error){this.error=errorText(error);this.render();}return;}
    if(target.dataset.retryVisit){const id=target.dataset.retryVisit;this.visitErrors.delete(this.visitKey(id));this.renderVisit(id);await this.loadVisit(id);return;}
    if(target.dataset.visitChart){const id=target.dataset.visitChart;this.resetVisitChartAnimation(id);this.visitModes.set(this.visitKey(id),'charts');this.renderVisit(id);return;}
    if(target.dataset.visitFilter){
      const id=target.dataset.visitFilter,key=this.visitKey(id),current=this.visitModes.get(key)==='charts'?[]:this.visitFilters.get(key) || [],type=target.dataset.activityType;
      this.visitModes.set(key,'events');
      const selected=current.length?[...current]:['All'],value=selected.includes(type)?selected.filter(value=>value!==type):[...selected,type];
      this.visitFilters.set(key,vrcxFeedFilterChange(current,value,['person-join','person-leave','avatar']));
      this.renderVisit(id);return;
    }
    if(target.dataset.feedRow){const id=target.dataset.feedRow;if(this.expandedFeed.has(id))this.expandedFeed.delete(id);else this.expandedFeed.add(id);this.render();return;}
    if(target.dataset.nativeType){
      const type=target.dataset.nativeType,selected=this.nativeTypes.length?[...this.nativeTypes]:['All'];
      const value=selected.includes(type)?selected.filter(value=>value!==type):[...selected,type];
      this.nativeTypes=vrcxFeedFilterChange(this.nativeTypes,value);
      this.page=1;await this.refreshSelection();return;
    }
    if (target.dataset.tab) { this.tab = target.dataset.tab;this.page = 1;await this.refreshSelection(); return; }
    if (target.dataset.visit) { await this.openVisit(target.dataset.visit,target.dataset.visitAccount); return; }
    const action = target.dataset.action;
    if (['rolling24','today','week','prev','next'].includes(action)) {
      const now = new Date();
      if(action==='rolling24'){this.rangeMode='rolling24';this.from=localDate(Date.now()-86400000);this.to=localDate();}
      else if (action==='today' || action==='week') { this.rangeMode='dates';this.to=localDate(); if (action==='week') now.setDate(now.getDate()-6); this.from=localDate(now.getTime()); }
      else { if(this.rangeMode==='rolling24'){this.from=this.to=localDate();}this.rangeMode='dates';const delta=action==='prev'?-1:1; for (const key of ['from','to']) { const d = new Date(`${this[key]}T12:00:00`); d.setDate(d.getDate()+delta); this[key]=localDate(d.getTime()); } }
      this.seenCharts.clear();this.visitNavigationVersion++;this.page=1;this.selectedVisitId='';await this.refresh(); return;
    }
    if (action==='page-prev' || action==='page-next') { this.page+=action==='page-prev'?-1:1; await this.refreshSelection(); return; }
    if (action==='refresh') { await this.action(async()=>{await this.controller.refreshCloud();if(this.tab==='social')await this.socialView.load({force:true}); await this.refresh();}); }
    if (action==='stop') { await this.action(async()=>{await this.controller.stopRecording(); await this.refresh();}); }
    if (action==='export') { await this.action(async()=>{await this.controller.export(this.accountId,this.options()); this.message='已导出当前筛选范围的记录';}); }
  }
  async change(event) {
    if(event.target.closest?.('[data-monika-native]')?.hasAttribute?.('data-monika-native'))return;
    const target = event.target;
    if(this.socialView?.change(target))return;
    const keys = { from:'from', to:'to', search:'search' };
    if (keys[target.name]) {
      const key=keys[target.name],previous=this[key];this[key]=target.type==='checkbox'?target.checked:target.value;
      if(key==='from' || key==='to'){try{dateBounds(this.from,this.to);}catch(error){this[key]=previous;this.error=errorText(error);this.render();return;}}
      if(key==='from' || key==='to')this.rangeMode='dates';
      this.seenCharts.clear();this.visitNavigationVersion++;this.page=1;this.selectedVisitId='';await this.refresh();
    }
  }
  scrollToVisit(id) {
    const node=[...this.root.querySelectorAll('.log-group')].find(node=>node.dataset.group===id);
    node?.scrollIntoView({behavior:'smooth',block:'start'});
  }
  async findVisitPage(id,accountId,options,isCurrent) {
    for(let page=1;isCurrent();page++){
      const batch=await this.controller.history(accountId,{...options,page,limit:500});
      if(!isCurrent())return 0;
      const index=batch.visits.findIndex(visit=>visit.id===id);
      if(index>=0)return Math.floor(((page-1)*500+index)/100)+1;
      if(page*500>=batch.visitTotal || batch.visits.length<500)return 0;
    }
    return 0;
  }
  async openVisit(id,accountId=this.accountId || this.status.user?.id) {
    const version=++this.visitNavigationVersion,isCurrent=()=>version===this.visitNavigationVersion && this.accountId===accountId && this.tab==='activity';
    if(this.accountId!==accountId){this.accountId=accountId;this.history=null;}
    this.tab='activity';this.selectedVisitId=id;this.error='';
    const key=this.visitKey(id);this.expandedVisits.add(key);this.visitModes.set(key,'charts');this.visitFilters.set(key,[]);this.resetVisitChartAnimation(id);
    if(this.history?.visits?.some(visit=>visit.id===id)){
      this.render();this.scrollToVisit(id);const detail=await this.loadVisit(id);
      if(detail && isCurrent())this.scrollToVisit(id);return;
    }
    const detail=await this.loadVisit(id,{render:false});if(!isCurrent())return;
    if(!detail){this.error=this.visitErrors.get(key);this.render();return;}
    try {
      let page=await this.findVisitPage(id,accountId,this.options(),isCurrent);if(!isCurrent())return;
      if(!page){this.rangeMode='dates';this.from=localDate(detail.visit.start);this.to=localDate(detail.visit.end ?? detail.visit.lastSeen);this.search='';
        page=await this.findVisitPage(id,accountId,this.options(),isCurrent);if(!isCurrent())return;}
      if(!page)throw new Error('未找到该实例的活动记录');
      this.page=page;await this.refresh({localOnly:true});if(isCurrent())this.scrollToVisit(id);
    } catch(error){if(isCurrent()){this.error=errorText(error);this.render();}}
  }
  async submit(event) {
    // Capture form values before render replaces the form and clears passwords.
    const values = Object.fromEntries(new FormData(event.target));
    const form = event.target.dataset.form;
    await this.action(async()=>{
      if (form==='config') await this.controller.saveConfig({port:Number(values.port),interval:Number(values.interval)*1000,locationBufferMs:Number(values.locationBuffer)*1000,proxy:values.proxy,autoLogin:Boolean(values.autoLogin)});
      if (form==='saved-login') await this.controller.loginSaved(values.savedAccount);
      if (form==='new-login') await this.controller.loginNew(values.username,values.password);
      if (form==='verify') await this.controller.verify(values.twoFactorType,values.code);
      await this.refresh();
      if (this.status.user) this.accountId=this.status.user.id;
    });
  }
}
