import { randomUUID } from 'node:crypto';
import { createVrcxCloudContext } from '../src/vendor-vrcx.mjs';

// Native records are delivered to VRCX, never persisted in Monika's journal.
// The stream identity and offset live only for this service process.
export class NativeRecords {
  constructor(accountId, metadata) {
    this.accountId=accountId;this.streamId=randomUUID();this.records=[];this.offset=0;this.sequence=0;this.pending=Promise.resolve();
    const profiles=new Map(),database={
      getUserProfile:async id=>profiles.get(id) || null,
      setUserProfile:profile=>{profiles.set(profile.id,{...profile});this.push('profile',profile);}
    };
    for(const [method,kind] of Object.entries({addGPSToDatabase:'GPS',addStatusToDatabase:'Status',
      addBioToDatabase:'Bio',addAvatarToDatabase:'Avatar',addOnlineOfflineToDatabase:'Presence'}))
      database[method]=async entry=>{this.push(kind,entry);return entry;};
    this.cloud=createVrcxCloudContext(database,{accountId,...metadata});
  }
  push(kind,entry){this.records.push({seq:++this.sequence,kind,entry:structuredClone(entry)});}
  observe(event) {
    if(!['cloud-user','friend-log'].includes(event.type))return;
    this.pending=this.pending.then(async()=>{
      if(event.type==='cloud-user')await this.cloud.observe(event.user,event.at);
      else if(event.type==='friend-log')this.push('friend-log',{created_at:new Date(event.at).toISOString(),type:event.kind,userId:event.userId,displayName:event.displayName});
    });
    // Keep the failure observable by read() without an unhandled background rejection.
    this.pending.catch(()=>{});
  }
  async read({after=0,streamId=''}={}) {
    await this.pending;
    if(!Number.isInteger(after) || after<0)throw new Error('无效的原生记录进度');
    const reset=streamId!==this.streamId || after<this.offset || after>this.sequence;
    if(reset)after=this.offset;
    const records=this.records.slice(after-this.offset,after-this.offset+500);
    return {accountId:this.accountId,streamId:this.streamId,reset,after,records,total:this.sequence,hasMore:after+records.length<this.sequence};
  }
  acknowledge({streamId,after}) {
    if(streamId!==this.streamId)return {ok:true,reset:true};
    if(!Number.isInteger(after) || after<0 || after>this.sequence)throw new Error('无效的原生记录进度');
    if(after>this.offset){this.records.splice(0,after-this.offset);this.offset=after;}
    return {ok:true};
  }
}
