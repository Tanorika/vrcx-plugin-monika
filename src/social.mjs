// Adapted from VRCX FriendLog, Moderation and FriendList (MIT).
// These views share native presentation rules, while all data belongs to the target account.
const socialLogTypes={Friend:'添加好友',Unfriend:'解除好友',FriendRequest:'发送好友请求',CancelFriendRequest:'取消好友请求',DisplayName:'名称变更',TrustLevel:'信任等级变更'};
const socialModerationTypes={block:'屏蔽',unblock:'解除屏蔽',mute:'静音',unmute:'解除静音',interactOn:'允许互动',interactOff:'禁止互动',muteChat:'聊天静音',unmuteChat:'解除聊天静音'};
const socialSearchFields={'Display Name':'名称',Rank:'信任等级',Status:'状态',Bio:'简介',Note:'备注',Memo:'本地备注'};
export function socialLogRows(rows,{types=[],search='',hideUnfriends=false,descending=true}={}){
  const selected=new Set(types.map(value=>String(value).toLowerCase())),needle=search.trim().toLowerCase();
  return rows.filter(row=>(!hideUnfriends || row.type!=='Unfriend') && (!selected.size || selected.has(String(row.type).toLowerCase())) &&
    (!needle || String(row.displayName ?? '').toLowerCase().includes(needle)))
    .sort((a,b)=>(descending?-1:1)*(new Date(a.created_at)-new Date(b.created_at) || (a.rowId || 0)-(b.rowId || 0)));
}
export function socialModerationRows(rows,{types=[],search='',descending=true}={}){
  const selected=new Set(types.map(value=>String(value).toLowerCase())),needle=search.trim().toLowerCase();
  return rows.filter(row=>(!selected.size || selected.has(String(row.type).toLowerCase())) &&
    (!needle || [row.sourceDisplayName,row.targetDisplayName].some(name=>String(name ?? '').toLowerCase().includes(needle))))
    .sort((a,b)=>(descending?-1:1)*(new Date(a.created)-new Date(b.created)));
}
export function socialFriendRows(snapshot,{fields=[],search='',favoritesOnly=false,group='',sort='friendNumber',descending=true}={}){
  const favorites=new Set((snapshot.favorites || []).filter(f=>!group || f.tags?.includes(group)).map(f=>f.favoriteId));
  const selected=fields.length?fields:Object.keys(socialSearchFields),needle=search.trim().toLocaleLowerCase();
  const normalize=text=>String(text ?? '').normalize('NFKC').toLocaleLowerCase();
  const rows=(snapshot.friends || []).filter(user=>{
    if((favoritesOnly || group) && !favorites.has(user.id))return false;
    if(!needle)return true;
    const trust=vrcxComputeTrustLevel(user.tags || [],user.developerType);
    const entry={'Display Name':user.displayName,Rank:trust.trustLevel,Status:user.statusDescription,
      Bio:vrcxReplaceBioSymbols(user.bio || ''),Note:user.note,Memo:user.memo};
    return selected.some(field=>normalize(entry[field]).includes(normalize(needle)));
  });
  const value=user=>sort==='rank'?vrcxComputeTrustLevel(user.tags || [],user.developerType).trustSortNum:
    sort==='status'?({'join me':0,active:1,'ask me':2,busy:3,offline:4})[accountPresence(user).kind==='offline'?'offline':user.status] ?? 5:
    ['joinCount','timeSpent','lastSeen'].includes(sort)?user.stats?.[sort] ?? (sort==='lastSeen'?'':0):user[sort] ?? '';
  return rows.sort((a,b)=>{
    const av=value(a),bv=value(b),order=typeof av==='number' && typeof bv==='number'?av-bv:String(av).localeCompare(String(bv));
    return (descending?-1:1)*(order || (Number(a.friendNumber)||0)-(Number(b.friendNumber)||0));
  });
}
// The shared .monika page minimum must not make the social header consume the full panel.
export const socialCss=`.monika-social-shell{display:flex;flex-direction:column;height:100%;min-height:0;min-width:0;overflow:hidden}.monika-social-shell>.monika{flex:0 0 auto;min-height:0;height:auto;padding-bottom:0}.monika-social-shell>[role=tabpanel]{flex:1 1 0;min-height:0;min-width:0;display:flex;flex-direction:column;overflow:hidden}[data-monika-native]{flex:1 1 0;min-height:0;min-width:0;display:flex;flex-direction:column;box-sizing:border-box;padding:0 18px 18px}.monika-mutual-page{height:100%;min-height:320px;min-width:0;overflow:hidden}`;
export class MonikaSocialView {
  constructor(view){this.view=view;this.tab='log';this.accountId='';this.snapshot=null;}
  reset(id){this.accountId=id;this.snapshot=null;this.dispose();}
  async load({force=false}={}){
    const id=this.view.accountId;if(id!==this.accountId)this.reset(id);if(!id)return;
    const snapshot=await this.view.controller.social(id,{force});
    if(id!==this.view.accountId || id!==this.accountId)return;
    if(snapshot?.accountId!==id)throw new Error('社交数据账号不匹配');
    this.snapshot=snapshot;this.native?.update(snapshot,this.tab);
  }
  html(){return '<div data-monika-native></div>';}
  mount(){
    const placeholder=this.view.root.querySelector('[data-monika-native]');if(!placeholder)return;
    if(!this.host){this.host=placeholder;}
    else if(this.host!==placeholder)placeholder.replaceWith(this.host);
    if(!this.snapshot)return;
    if(!this.native){
      const owner=this.view.controller;
      this.native=MonikaNativeUi.mount(this.host,{view:this.view,
        nativeQuery:(...args)=>owner.nativeQuery(...args),nativeActivity:(...args)=>owner.nativeActivity(...args),socialUser:(...args)=>owner.socialUser(...args),socialAction:(...args)=>owner.socialAction(...args),social:(...args)=>owner.social(...args),
        confirm:(...args)=>owner.confirm(...args),prompt:(...args)=>owner.prompt(...args),database:owner.database,api:(...args)=>owner.api(...args),openWorld:(...args)=>owner.openWorld(...args),openAvatar:(...args)=>owner.openAvatar(...args),
        nativeError:error=>{this.view.error=errorText(error);this.view.renderConnection();const node=this.view.root.querySelector('[data-native-error]');if(node){node.textContent=this.view.error;node.hidden=false;}},
        nativeMessage:message=>{const node=this.view.root.querySelector('[data-native-message]');if(node){node.textContent=message;node.hidden=!message;}}
      },this.snapshot);
    }
    this.native.update(this.snapshot,this.tab);
  }
  detach(){this.host?.remove();}
  dispose(){this.native?.dispose();this.native=null;this.host?.remove();this.host=null;}
  async click(){return false;}
  change(){return false;}
}
