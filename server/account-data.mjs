import { accountKey } from './storage.mjs';

const kinds=new Set(['avatar-metadata','memos']);
export function readAccountData(service,id,kind) {
  accountKey(id);
  if(!kinds.has(kind))throw new Error('无效的扩展数据类型');
  if(id===service.primaryId)throw new Error('不能读写主账号的 Monika 扩展数据');
  if(!service.profiles[id])throw new Error('目标账号不存在');
  return service.storage.read(`${id}.${kind}.json`,{});
}
export function writeAccountData(service,{accountId:id,kind,key,value}) {
  const previous=readAccountData(service,id,kind);
  if(typeof key!=='string' || !key || key.length>2048)throw new Error('无效的扩展数据键');
  if(kind==='memos'){accountKey(key);if(typeof value!=='string' || value.length>10000)throw new Error('备注过长');}
  if(kind==='avatar-metadata' && (typeof value?.name!=='string' || typeof value?.key!=='string'))throw new Error('模型名称响应无效');
  service.storage.write(`${id}.${kind}.json`,{...previous,[key]:value});
  return {ok:true};
}

export function peopleStats(recorder) {
  const stats=new Map(),byVisit=new Map();
  for(const event of recorder.events){
    if(!event.visitId)continue;
    if(!byVisit.has(event.visitId))byVisit.set(event.visitId,[]);
    byVisit.get(event.visitId).push(event);
  }
  for(const visit of recorder.visits.values()){
    const joined=new Map(),end=visit.end ?? visit.lastSeen;
    const finish=(id,at)=>{
      const start=joined.get(id);if(start===undefined)return;
      const row=stats.get(id);row.timeSpent+=Math.max(0,at-start);
      row.lastSeen=new Date(Math.max(Date.parse(row.lastSeen) || 0,at)).toISOString();joined.delete(id);
    };
    for(const event of byVisit.get(visit.id) || []){
      if(event.type==='snapshot' || event.type==='person-join')for(const person of event.people || [event.person]){
        if(person.id===recorder.accountId)continue;
        const row=stats.get(person.id) || {userId:person.id,displayName:person.displayName,joinCount:0,timeSpent:0,lastSeen:''};
        row.displayName=person.displayName;
        if(!joined.has(person.id)){row.joinCount++;joined.set(person.id,event.at);}
        stats.set(person.id,row);
      }
      if(event.type==='person-leave')finish(event.person.id,event.at);
    }
    for(const id of joined.keys())finish(id,end);
  }
  return [...stats.values()];
}
