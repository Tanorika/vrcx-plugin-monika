import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { Recorder } from '../server/recorder.mjs';
import { DatabaseSync } from 'node:sqlite';
import { Script } from 'node:vm';
import { createHttpServer } from '../server/http.mjs';
import { buildPreviewStyles } from './build-preview-styles.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),port=Number(process.argv.find(arg=>arg.startsWith('--port='))?.split('=')[1] || 49231);
const r=new Recorder('usr_demo');
const date='2026-11-11', at=time=>new Date(`${date}T${time}:00+08:00`).getTime();
const self=(location,avatar='avtr_demo_1')=>({id:'usr_demo',displayName:'Monika',username:'monika_demo',location,currentAvatar:avatar});
const friend=(id,name,location,avatar='avtr_friend_1')=>({id,displayName:name,location,currentAvatar:avatar});
if(process.argv.includes('--dense')){
  for(let i=0;i<75;i++){
    const now=at('00:00')+i*300000,location=`wrld_demo${i}:1~region(jp)`;
    r.observeSelf({...self(location),status:i%2?'ask me':'active',bio:i<74?'旧简介':'新简介'},now);
    r.emit('world',{worldId:`wrld_demo${i}`,name:`演示世界 ${i+1}`},now+1000);
    r.observeSelf(self(location),now+240000);
  }
  r.close(at('06:15'));
}
let user=self('wrld_home:87328~friends(usr_demo)~region(jp)');
r.observeSelf(user,at('18:05'));r.observeRoster([friend('usr_yuki','Yuki',user.location),friend('usr_sora','Sora',user.location)],user,at('18:06'));
r.observeFriend(friend('usr_mio','Mio',user.location),at('18:21'));r.observeSelf({...user,currentAvatar:'avtr_demo_2'},at('18:35'));
r.observeFriend(friend('usr_sora','Sora','offline'),at('18:50'));
user=self('wrld_cafe:62811~hidden(usr_demo)~region(jp)','avtr_demo_2');r.observeSelf(user,at('19:10'));r.emit('world',{worldId:'wrld_home',name:'The Midnight Rooftop'},at('19:10'));
r.observeRoster([friend('usr_yuki','Yuki',user.location),friend('usr_mio','Mio',user.location)],user,at('19:11'));
r.observeFriend(friend('usr_yuki','Yuki',user.location,'avtr_friend_2'),at('19:30'));r.observeSelf(user,at('20:15'));r.markGap(at('20:16'),'api-unavailable');
r.observeSelf(user,at('20:25'));r.observeRoster([friend('usr_mio','Mio',user.location)],user,at('20:26'));r.observeSelf(user,at('20:50'));
user=self('wrld_stars:10719~region(us)','avtr_demo_3');r.observeSelf(user,at('21:00'));r.emit('world',{worldId:'wrld_cafe',name:'Rainy Night Café'},at('21:00'));
r.observeRoster([friend('usr_mio','Mio',user.location),friend('usr_luna','Luna',user.location)],user,at('21:01'));r.observeSelf(user,at('22:40'));r.emit('world',{worldId:'wrld_stars',name:'星空の散歩道'},at('22:40'));
r.close(at('22:40'),'manual-stop','last-observed');r.locationBufferMs=120000;
const sleepLocation='wrld_decay:54835~friends(usr_demo)~region(us)',idleLocation='wrld_egg:42794~private(usr_demo)~region(jp)';
for(let minute=0;minute<=50;minute++){
  const now=at('23:00')+minute*60000;
  r.observeSelf(self(sleepLocation,'avtr_sleep'),now);
  r.observeSelf(self(idleLocation,'avtr_idle'),now+30000);
  r.observeRoster([...(minute<14 || minute>=24?[friend('usr_yuki','Yuki',sleepLocation)]:[]),
    ...(minute<18 || minute>=30?[friend('usr_mio','Mio',idleLocation,minute>=25?'avtr_mio_new':'avtr_mio')]:[])],self(idleLocation),now+30000);
  r.observeInstanceCount(sleepLocation,{total:4+Math.floor(minute/10)%3,capacity:16,intervalMs:60000},now+30000);
  r.observeInstanceCount(idleLocation,{total:minute>=21 && minute<24?null:12+Math.floor(minute/8)%5,capacity:16,intervalMs:60000,
    ...(minute>=21 && minute<24?{reason:'unavailable'}:{})},now+30000);
}
r.emit('world',{worldId:'wrld_decay',name:'Let me decay'},at('23:51'));r.emit('world',{worldId:'wrld_egg',name:'Steal an egg!'},at('23:51'));
user={...self(idleLocation,'avtr_idle'),status:'active',statusDescription:'在这里休息一下'};
let recording=true;
const profile={user,cookies:Buffer.from('[]').toString('base64')};
const demoNames=['Yuki','Sora','Mio','Luna','Haru','Aoi','Nagi','Rin'];
const demoFriends=demoNames.map((name,index)=>({id:'usr_'+name.toLowerCase(),displayName:name,
  tags:[index%3===0?'system_trust_veteran':index%3===1?'system_trust_trusted':'system_trust_basic','language_ja','language_zh'],
  status:index===3?'busy':index===6?'ask me':'active',statusDescription:index===6?'稍后再见':'一起散步吧',
  bio:'合成数据：喜欢世界探索和朋友聊天。',bioLinks:[],profileLoaded:true,
  location:index<3?user.location:'offline',state:index<3?'online':'offline',friendNumber:index+1,mutualCount:3+index%4}));
const graphSnapshot=demoFriends.map((friend,index)=>[friend.id,demoFriends.filter((_,other)=>other!==index && (Math.abs(index-other)<=2 || (index+other)%3===0)).map(friend=>friend.id)]);
const demoSocial={accountId:'usr_demo',friends:demoFriends,
  groups:[{type:'friend',name:'group_0',displayName:'夜间伙伴',visibility:'private'},{type:'friend',name:'group_1',displayName:'世界探索',visibility:'private'}],
  favorites:demoFriends.slice(0,5).map((friend,index)=>({id:'fvrt_demo_'+index,type:'friend',favoriteId:friend.id,tags:[index<3?'group_0':'group_1']})),
  moderations:[{id:'pmod_demo',created:date+'T10:00:00Z',type:'mute',sourceUserId:'usr_demo',sourceDisplayName:'Monika',targetUserId:'usr_haru',targetDisplayName:'Haru'}],
  history:demoFriends.map((friend,index)=>({rowId:index+1,created_at:date+'T10:'+String(index*5).padStart(2,'0')+':00Z',type:index%3===0?'DisplayName':'Friend',userId:friend.id,displayName:friend.displayName,previousDisplayName:index%3===0?friend.displayName+' old':''}))};
const service={profiles:{usr_demo:profile},retryAt:0,interval:60000,
  recorder:()=>r,settings(){},status:()=>({user:recording?user:null,pending2FA:[],connected:recording,recording,lastSeen:r.lastSeen,lastRosterAt:r.lastSeen,lastError:'',retryAt:0,location:user.location,locationBufferMs:120000,locations:[...r.activeVisits.values()].map(v=>({location:v.location,worldName:v.worldName,lastSeen:v.locationSeen,visitId:v.id,population:v.population.at(-1) || null})),accounts:[user],scope:'visible-friends'}),
  credentials:()=>profile,poll:async()=>{},stop(){recording=false;},login:async()=>{recording=true;return profile;},verify:async()=>profile,
  socialSnapshot:async()=>demoSocial,
  socialUserDetails:async(accountId,id)=>({accountId,user:demoFriends.find(friend=>friend.id===id) || {...user,id},mutuals:{friends:3,groups:0}}),
  nativeSocialQuery:async({accountId,kind,params={}})=>({accountId,data:kind==='currentUser'?user:kind==='profile'?{bio:'合成数据：目标账号可见的公开资料',bioLinks:[],pronouns:'she/her'}:kind==='mutualFriends'?(params.offset?[]:demoFriends.filter(friend=>graphSnapshot.find(row=>row[0]===params.userId)?.[1].includes(friend.id))):kind==='mutuals'?{friends:3,groups:0}:[]}),
  resolveAvatarMetadata:async({accountId})=>({accountId,assets:[]}),
  resolveWorldNames:async({accountId,worldIds})=>({accountId,names:Object.fromEntries(worldIds.map(id=>[id,r.worldNames.get(id) || '演示世界']))}),
  worldDetails:async(accountId,worldId,location)=>({accountId,world:{id:worldId,name:r.worldNames.get(worldId) || '演示世界',capacity:16,
    slimInstances:[{instanceId:'public~region(jp)',n_users:8}]},instance:{userCount:13,capacity:16},people:r.activeVisits.get(location)?.final || []})};
const api=createHttpServer(service,{projectRoot:root,port});
const sqlite=new DatabaseSync(':memory:');
sqlite.exec('CREATE TABLE configs (key TEXT PRIMARY KEY,value TEXT)');
sqlite.prepare('INSERT INTO configs VALUES (?,?)').run('config:savedcredentials',JSON.stringify({usr_demo:{...profile,loginParams:{username:'monika_demo',password:'',endpoint:'',websocket:''}}}));
const previewCss = await readFile(await buildPreviewStyles(), 'utf8');
const html=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Monika · VRCX 插件预览</title><style>${previewCss}</style><style>
:root{--background:#f9fafb;--foreground:#242e3b;--card:#fff;--muted:#f3f5f8;--muted-foreground:#7c8796;--border:#e3e7ee}.dark{--background:#16191f;--foreground:#e1e6ed;--card:#1c2027;--muted:#252b34;--muted-foreground:#97a1b1;--border:#303743}body{margin:0;font:14px "Microsoft YaHei",sans-serif;background:var(--background);color:var(--foreground)}#root{display:flex;height:100vh}aside{width:195px;flex-shrink:0;border-right:1px solid var(--border);padding:20px 12px;background:var(--card)}aside h2{margin:0 0 8px;padding:0 8px;font-size:21px}aside p{font-size:11px;color:var(--muted-foreground);padding:0 8px}aside ul{list-style:none;padding:0;margin-top:25px}aside button{width:100%;padding:10px;text-align:left;border:0;background:transparent;color:inherit;border-radius:6px;margin-bottom:5px;font:inherit;cursor:pointer}aside button:hover,aside button[data-active=true]{background:var(--muted);color:#4a91d3}aside span{padding-left:6px}main{flex:1;overflow:auto;min-width:0}.native{padding:35px}.preview-note{position:fixed;bottom:12px;left:14px;font-size:10px;color:var(--muted-foreground);width:165px;line-height:1.5}code{font-size:12px}</style></head><body><div id="root"><aside data-slot="sidebar"><h2>VRCX</h2><p>插件开发预览</p><ul><li><button data-native="feed">◷ 动态</button></li><li><button data-native="friends">♙ 好友</button></li><li><button data-native="charts">▥ 图表</button></li></ul><button id="theme">◐ 切换主题</button><div class="preview-note">所有活动与账号均为合成数据<br>不连接 VRChat，不读取真实 credentials</div></aside><main><div class="native"><h2>原生 VRCX 页面</h2><p>点击 Monika 查看目标账号活动；返回此页可验证导航恢复。</p></div></main></div>
<script>
document.documentElement.classList.add('dark');
const themeStyle=document.createElement('style');themeStyle.textContent='.dark{--background:#171717;--foreground:#e5e5e5;--card:#1f1f1f;--muted:#242424;--muted-foreground:#a1a1a1;--border:#333}dialog{background:var(--background);color:var(--foreground);border:1px solid var(--border);border-radius:8px;padding:26px;width:650px;max-width:90vw}dialog::backdrop{background:#0008;backdrop-filter:blur(3px)}dialog h2{margin:0 0 20px}dialog label{display:block;margin:14px 0}dialog input{display:block;width:100%;margin-top:8px;padding:10px;background:var(--muted);color:inherit;border:1px solid var(--border);border-radius:5px;box-sizing:border-box}dialog button{padding:10px;background:var(--muted);color:inherit;border:1px solid var(--border);border-radius:5px;cursor:pointer}dialog p{color:var(--muted-foreground);font-size:12px}';document.head.append(themeStyle);
const launchDialog=document.createElement('dialog');launchDialog.setAttribute('aria-label','VRCX 原生启动接口预览');launchDialog.innerHTML='<div style="display:flex;justify-content:space-between"><h2>启动</h2><button id="close-launch">×</button></div><label>链接<input id="launch-link" readonly></label><label>地点<input id="launch-tag" readonly></label><p>合成数据预览 · 调用 VRCX 主账号启动接口，预览不会邀请或启动 VRChat。</p><div style="display:flex;gap:10px;justify-content:flex-end"><button disabled>邀请</button><button disabled>在 VRChat 中打开</button><button disabled>启动（VR模式）</button></div>';document.body.append(launchDialog);launchDialog.querySelector('#close-launch').onclick=()=>launchDialog.close();
const nativeFetch=window.fetch.bind(window);window.fetch=(input,init)=>{const url=new URL(String(input),location.href);if(url.origin!==location.origin)return Promise.reject(new Error('Preview blocks external requests'));return nativeFetch(input,init);};
location.hash='#/feed';const subscribers=[];let active='feed';window.$pinia={auth:{loginForm:{loading:false}},user:{currentUser:{id:'usr_main',displayName:'主账号（预览）'},$subscribe:()=>()=>{}},ui:{$subscribe:fn=>{subscribers.push(fn);return()=>{}},get menuActiveIndex(){return active},set menuActiveIndex(value){active=value;subscribers.forEach(fn=>fn({}, {menuActiveIndex:value}));}},dialog:{$subscribe:()=>()=>{}},advancedSettings:{enablePrimaryPassword:false}};
const routerHooks=[],routerRoutes=[],routeFromHash=()=>{const path=location.hash.slice(1)||'/feed',id=path.startsWith('/customjs/')?path.slice(10).split('/')[0]:'';return {name:id?'customjs-page':'native',path,fullPath:path,params:id?{pluginId:decodeURIComponent(id)}:{},meta:{}};};
const router={currentRoute:{value:routeFromHash()},getRoutes:()=>[{path:'/',components:{default:{name:'PreviewLayout'}}}],hasRoute:name=>routerRoutes.some(route=>route.name===name || route.children?.some(child=>child.name===name)),addRoute:route=>routerRoutes.push(route),afterEach:fn=>{routerHooks.push(fn);return()=>{};},push:async route=>{location.hash='/customjs/'+encodeURIComponent(route.params.pluginId);},replace:async path=>{location.hash=path;}};
document.getElementById('root').__vue_app__={config:{globalProperties:{$router:router}}};
window.addEventListener('hashchange',()=>{const from=router.currentRoute.value;router.currentRoute.value=routeFromHash();routerHooks.forEach(fn=>fn(router.currentRoute.value,from));});
window.$pinia.modal={confirm:async()=>({ok:true}),prompt:async()=>({ok:false})};
localStorage.setItem('monika:usr_demo:mutual-graph',JSON.stringify({snapshot:${JSON.stringify(graphSnapshot)},meta:${JSON.stringify(demoFriends.map(friend=>[friend.id,{optedOut:false,lastFetchedAt:date+'T16:00:00Z'}]))}}));
window.$pinia.launch={showLaunchDialog:async tag=>{window.previewLaunchCall={accountId:window.$pinia.user.currentUser.id,tag};launchDialog.querySelector('#launch-tag').value=tag;const [worldId,...instance]=tag.split(':');launchDialog.querySelector('#launch-link').value='https://vrchat.com/home/launch?worldId='+encodeURIComponent(worldId)+'&instanceId='+encodeURIComponent(instance.join(':'));launchDialog.showModal();}};
const worldPage=document.createElement('dialog');worldPage.setAttribute('aria-label','VRCX 世界页面接口预览');document.body.append(worldPage);
window.$pinia.world={worldDialog:{},$subscribe:()=>()=>{}};
window.utils={parseLocation:tag=>({tag,worldId:tag.split(':')[0],instanceId:tag.split(':')[1] || '',user:{}})};
window.$pinia.ui.openDialog=args=>{window.previewWorldCall=args;queueMicrotask(()=>{const D=window.$pinia.world.worldDialog;worldPage.replaceChildren();const title=document.createElement('h2');title.textContent=D.ref.name;worldPage.append(title);const note=document.createElement('p');note.textContent='合成数据 · 原生世界页面接口预览 · 目标账号云端数据';worldPage.append(note);for(const room of D.rooms){const line=document.createElement('p');line.textContent=room.tag+' · '+room.ref.userCount+' 人 · '+room.users.map(user=>user.displayName).join('、');worldPage.append(line);}const close=document.createElement('button');close.textContent='关闭';close.onclick=()=>worldPage.close();worldPage.append(close);worldPage.showModal();});};
window.webApiService={execute:()=>{throw new Error('Monika must not use the primary HTTP client');}};
// Reproduce hosts that expose only query/non-query methods: Monika must adapt INSERT IDs itself.
const sqliteCall=async(op,sql,args)=>{const res=await nativeFetch('/preview-sqlite',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,sql,args})});const data=await res.json();if(data.error)throw new Error(data.error);return data.result;};window.sqliteService={execute:async(fn,sql,args)=>{for(const row of await sqliteCall('all',sql,args))fn(row);},executeNonQuery:(sql,args)=>sqliteCall('run',sql,args)};
window.configRepository={getString:async(key,fallback=null)=>(await sqliteCall('all','SELECT value FROM configs WHERE key=@key',{'@key':'config:'+key.toLowerCase()}))[0]?.[0] ?? fallback,
setString:(key,value)=>sqliteCall('run','INSERT OR REPLACE INTO configs VALUES (@key,@value)',{'@key':'config:'+key.toLowerCase(),'@value':value})};
localStorage.setItem('customjs.monika.connection',JSON.stringify({port:${port},interval:60000,proxy:'',accountId:'usr_demo',autoLogin:false}));
document.querySelectorAll('[data-native]').forEach(b=>b.onclick=()=>router.replace('/'+b.dataset.native));document.querySelector('#theme').onclick=()=>document.documentElement.classList.toggle('dark');
</script><script src="/framework.js"></script><script>
let importing=false;
const ready=setInterval(async()=>{if(importing || window.customjs?.compatibility?.stage!=='ready')return;importing=true;clearInterval(ready);
try{const code=await(await nativeFetch('/plugin/monika.js')).text();const imported=await window.customjs.importLocalPlugin(new File([code],'monika.js',{type:'text/javascript'}));if(!imported.success)throw new Error(imported.message);
const plugin=imported.module;plugin.view.from='${date}';plugin.view.to='${date}';plugin.view.rangeMode='date';plugin.show();window.previewPlugin=plugin;
}catch(error){console.error(error);document.querySelector('.native').textContent='Preview failed: '+error.message;}},100);
</script></body></html>`;
for(const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new Script(match[1]);
const server=http.createServer(async(req,res)=>{
  if(req.url==='/preview-sqlite' && req.method==='POST'){
    let text='';for await(const chunk of req)text+=chunk;
    try{const {op,sql,args}=JSON.parse(text),statement=sqlite.prepare(sql),values=args?Object.fromEntries(Object.entries(args).map(([k,v])=>[k,v===undefined?null:v])):{};
      const raw=op==='all'?statement.all(values).map(row=>Object.values(row)):statement.run(values);const result=op==='all'?raw:op==='insert'?(raw.changes?Number(raw.lastInsertRowid):0):Number(raw.changes);
      res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({result}));
    }catch(error){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error.message}));}return;
  }
  if(req.url==='/' || req.url==='/index.html'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);return;}
  if(req.url==='/framework.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end(await readFile(resolve(root,'tests/fixtures/framework-fixed.js')));return;}
  api.emit('request',req,res);
});
server.listen(port,'127.0.0.1',()=>console.log(`Monika 合成数据预览：http://127.0.0.1:${port}`));
server.on('error',e=>{console.error(e.message);process.exitCode=1;});
