import { ApiError } from './vrchat.mjs';
import { vrcxExtractFileId,vrcxStoreAvatarImage } from '../src/vendor-vrcx.mjs';

const validUser=id=>/^usr_[a-zA-Z0-9-]+$/.test(id || '');
const validAvatar=id=>/^avtr_[a-zA-Z0-9-]+$/.test(id || '');
function current(service,active,generation){if(service.active!==active || service.generation!==generation)throw new ApiError(409,'目标账号会话已变化');}
export function publicSocialUser(user){
  const keys=['id','displayName','username','status','statusDescription','state','location','bio','bioLinks','tags','developerType','date_joined','last_login','last_activity','last_platform','currentAvatar','currentAvatarImageUrl','currentAvatarThumbnailImageUrl','userIcon','profilePicOverride','iconUrl','note','isFriend','hasSharedConnectionsOptOut','pronouns','badges','ageVerificationStatus','ageVerified','allowAvatarCopying','bannerColor','bannerType','bannerUrl','iconFrame','nameplateEffect','profileEffect','discordId','platform','worldId','instanceId','friendRequestStatus','isEconomyCreator','profilePicOverrideThumbnail'];
  return Object.fromEntries(keys.filter(key=>Object.hasOwn(user,key)).map(key=>[key,user[key]]));
}
export function publicSocialProfile(profile){
  const keys=['id','userId','displayName','bio','bioLinks','pronouns','iconUrl','userIcon','bannerUrl','bannerColor','bannerType','badges','iconFrame','nameplateEffect','profileEffect','theme','themes','themeId','representedGroup','backgroundType','backgroundTextureId','backgroundGradientBottom','backgroundGradientTop','ageVerified','ageVerificationStatus'];
  return Object.fromEntries(keys.filter(key=>Object.hasOwn(profile,key)).map(key=>[key,profile[key]]));
}
// A fixed set of native view requests; URLs and authentication headers cannot be supplied by the browser.
export async function nativeSocialQuery(service,{accountId,kind,params={}}){
  const active=service.requireAccount(accountId),generation=service.generation;
  const userId=params.userId || params.targetUserId || params.ownerId || accountId;
  const id=value=>{if(!validUser(value))throw new Error('无效的用户 ID');return encodeURIComponent(value);};
  const page={n:Math.max(1,Math.min(100,Number(params.n) || 100)),offset:Math.max(0,Math.min(20000,Number(params.offset) || 0))};
  const get=async(path,query)=>{const result=await active.client.request(path+(query?`?${new URLSearchParams(query)}`:''));current(service,active,generation);return result;};
  let data;
  if(kind==='profile')data=publicSocialProfile(await get(`profile/${id(userId)}`));
  else if(kind==='currentUser')data=publicSocialUser(await get('auth/user'));
  else if(kind==='mutualFriends')data=(await get(`users/${id(userId)}/mutuals/friends`,page)).map(publicSocialUser);
  else if(kind==='mutuals')data=await get(`users/${id(userId)}/mutuals`);
  else if(kind==='userGroups')data=await get(`users/${id(userId)}/groups`);
  else if(kind==='favoriteGroups')data=await get('favorite/groups',{...page,ownerId:id(userId)});
  else if(kind==='favoriteWorlds'){if(!/^[\w-]+$/.test(params.tag || ''))throw new Error('无效的世界收藏分组');data=await get('worlds/favorites',{...page,userId:id(userId),tag:params.tag});}
  else if(kind==='worldsByUser')data=await get('worlds',{...page,userId:id(userId),sort:['updated','created','name','popularity','heat','favorites'].includes(params.sort)?params.sort:'updated',order:params.order==='ascending'?'ascending':'descending',releaseStatus:userId===accountId?'all':'public',...(userId===accountId?{user:'me'}:{})});
  else if(kind==='avatarsByUser'){if(userId!==accountId)throw new Error('VRChat 不提供其他用户完整模型列表');data=await get('avatars',{...page,user:'me'});}
  else if(kind==='world'){if(!/^wrld_[\w-]+$/.test(params.worldId || ''))throw new Error('无效的世界 ID');data=await get(`worlds/${encodeURIComponent(params.worldId)}`);}
  else if(kind==='group'){if(!/^grp_[\w-]+$/.test(params.groupId || ''))throw new Error('无效的群组 ID');data=await get(`groups/${encodeURIComponent(params.groupId)}`);}
  else if(kind==='worldContext'){if(!/^wrld_[\w-]+:[^\s]+$/.test(params.location || ''))throw new Error('无效的实例位置');data=await service.worldDetails(accountId,params.location.split(':')[0],params.location);}
  else if(kind==='instance'){const location=params.location;if(!/^wrld_[\w-]+:[^\s]+$/.test(location || ''))throw new Error('无效的实例位置');const split=location.indexOf(':');data=await get(`instances/${encodeURIComponent(location.slice(0,split))}:${encodeURIComponent(location.slice(split+1))}`);}
  else if(kind==='saveNote'){if(typeof params.note!=='string' || params.note.length>2000)throw new Error('备注过长');id(userId);data=await active.client.request('userNotes',{method:'POST',body:{targetUserId:userId,note:params.note}});current(service,active,generation);}
  else throw new Error('不支持的原生社交请求');
  current(service,active,generation);return {accountId,data};
}
async function pages(active,path,params={}){
  const rows=[];
  for(let offset=0;offset<20000;offset+=100){
    const batch=await active.client.request(`${path}?${new URLSearchParams({...params,n:100,offset})}`);
    if(!Array.isArray(batch))throw new Error('列表响应不完整，保留上次数据');
    rows.push(...batch);if(batch.length<100)return rows;
  }
  throw new Error('列表超过分页上限，保留上次数据');
}
export async function resolveAvatarMetadata(service,{accountId,avatars}){
  const active=service.requireAccount(accountId),generation=service.generation;
  if(!Array.isArray(avatars) || avatars.length>8)throw new Error('每次最多查询 8 个模型');
  const assets=[];service.avatarMetadataCache ||= new Map();service.avatarMetadataRetry ||= new Map();
  for(const input of avatars){
    const id=validAvatar(input?.id)?input.id:'',image=typeof input?.image==='string'?input.image:'',fileId=vrcxExtractFileId(image),key=id || image;
    if(!key || (!id && !/^file_[a-zA-Z0-9-]+$/.test(fileId)))continue;
    const cacheKey=`${accountId}:${id || fileId}`;
    let asset=service.avatarMetadataCache.get(cacheKey);
    if(!asset && Date.now()>=Math.max(service.retryAt,service.avatarMetadataRetry.get(cacheKey) || 0)){
      try{
        if(id){
          try{
            const avatar=await active.client.request(`avatars/${encodeURIComponent(id)}`);current(service,active,generation);
            if(avatar.id!==id || !avatar.name)throw new Error('模型响应与请求不匹配');
            asset={id,name:avatar.name,ownerId:avatar.authorId || '',image:avatar.thumbnailImageUrl || avatar.imageUrl || image};
          }catch(error){if(![403,404].includes(error.status) || !fileId)throw error;}
        }
        if(!asset && fileId){
          const file=await active.client.request(`file/${encodeURIComponent(fileId)}`);current(service,active,generation);
          if(file.id && file.id!==fileId)throw new Error('模型图片响应与请求不匹配');
          if(!file.tags?.includes('icon') && Array.isArray(file.versions) && file.versions.length){
            const info=vrcxStoreAvatarImage({json:file,params:{fileId}},new Map());
            if(info.avatarName)asset={id,name:info.avatarName,ownerId:info.ownerId || '',image,fileCreatedAt:info.fileCreatedAt};
          }
        }
        if(asset)service.avatarMetadataCache.set(cacheKey,asset);
        else service.avatarMetadataRetry.set(cacheKey,Date.now()+300000);
      }catch(error){
        current(service,active,generation);service.avatarMetadataRetry.set(cacheKey,Date.now()+300000);
        if(error.status===429){service.retryAt=Date.now()+Math.max(60000,(error.retryAfter || 60)*1000);break;}
      }
    }
    if(asset)assets.push({...asset,key});
  }
  current(service,active,generation);return {accountId,assets};
}
export async function avatarDetails(service,accountId,avatarId){
  if(!validAvatar(avatarId))throw new Error('无效的模型 ID');
  const active=service.requireAccount(accountId),generation=service.generation;
  const avatar=await active.client.request(`avatars/${encodeURIComponent(avatarId)}`);current(service,active,generation);
  if(avatar.id!==avatarId || !avatar.name)throw new Error('模型响应与请求不匹配');
  let gallery=[];
  try{gallery=await pages(active,'files',{tag:'avatargallery',galleryId:avatarId});}catch(error){if(error.status===429)throw error;}
  current(service,active,generation);return {accountId,avatar,gallery};
}
export async function socialSnapshot(service,accountId,{force=false}={}){
  const active=service.requireAccount(accountId),generation=service.generation;
  service.socialCache ||= new Map();service.socialRequests ||= new Map();
  const cached=service.socialCache.get(accountId);
  if(Date.now()<service.retryAt){if(cached)return cached;throw new ApiError(429,'VRChat 请求限流，请稍后刷新');}
  if(!force && cached && Date.now()-cached.updatedAt<60000)return cached;
  service.socialRevisions ||= new Map();
  const revision=service.socialRevisions.get(accountId) || 0,requestKey=`${accountId}:${generation}:${revision}`;
  if(service.socialRequests.has(requestKey))return service.socialRequests.get(requestKey);
  const request=(async()=>{
    const result={accountId,friends:cached?.friends || [],favorites:cached?.favorites || [],groups:cached?.groups || [],moderations:cached?.moderations || [],friendsComplete:false,errors:{},updatedAt:Date.now()};
    const tasks={friends:async()=>{
      const [online,offline]=await Promise.all([active.client.friends(),active.client.friends({offline:true})]);
      if([...online,...offline].some(user=>!validUser(user.id) || !user.displayName))throw new Error('好友列表不完整');
      const map=new Map(offline.map(user=>[user.id,{...publicSocialUser(user),state:'offline',location:'offline'}]));
      for(const user of online)map.set(user.id,publicSocialUser(user));return [...map.values()];
    },favorites:()=>pages(active,'favorites',{type:'friend'}),groups:()=>pages(active,'favorite/groups',{type:'friend'}),
      moderations:()=>active.client.request('auth/user/playermoderations')};
    const entries=Object.entries(tasks),responses=await Promise.allSettled(entries.map(([,task])=>task()));
    current(service,active,generation);
    if(revision!==(service.socialRevisions.get(accountId) || 0))throw new ApiError(409,'社交数据已更新，请重新读取');
    responses.forEach((response,index)=>{const name=entries[index][0];if(response.status==='fulfilled' && Array.isArray(response.value)){
      result[name]=response.value;if(name==='friends')result.friendsComplete=true;
    }else {const error=response.status==='rejected'?response.reason:new Error('列表响应无效');result.errors[name]=error?.message || String(error);
      if(error.status===429)service.retryAt=Math.max(service.retryAt,Date.now()+Math.max(60000,(error.retryAfter || 60)*1000));}});
    service.socialCache.set(accountId,result);return result;
  })();service.socialRequests.set(requestKey,request);
  try{return await request;}finally{if(service.socialRequests.get(requestKey)===request)service.socialRequests.delete(requestKey);}
}
export async function socialUserDetails(service,accountId,userId,{mutuals=false}={}){
  if(!validUser(userId))throw new Error('无效的用户 ID');
  const active=service.requireAccount(accountId),generation=service.generation;
  const user=await active.client.request(`users/${encodeURIComponent(userId)}`);current(service,active,generation);
  if(user.id!==userId)throw new Error('用户响应与请求不匹配');
  const ref=publicSocialUser(user);
  try{const profile=await active.client.request(`profile/${encodeURIComponent(userId)}`);if(Array.isArray(profile.bioLinks))ref.bioLinks=profile.bioLinks;if(typeof profile.bio==='string')ref.bio=profile.bio;}catch(error){if(error.status===429)throw error;}
  if(mutuals){const data=await active.client.request(`users/${encodeURIComponent(userId)}/mutuals`);if(Number.isInteger(data.friends))ref.mutualCount=data.friends;}
  current(service,active,generation);return {accountId,user:ref};
}
export async function socialAction(service,{accountId,action,...data}){
  const active=service.requireAccount(accountId),generation=service.generation;
  const snapshot=await socialSnapshot(service,accountId);current(service,active,generation);
  const request=async(path,options)=>{const result=await active.client.request(path,options);current(service,active,generation);return result;};
  const group=snapshot.groups.find(group=>group.name===data.group && group.type==='friend');
  const types=['block','unblock','mute','unmute','interactOn','interactOff','muteChat','unmuteChat'];
  if(action==='unfriend'){
    if(!Array.isArray(data.userIds) || !data.userIds.length || data.userIds.length>500 || data.userIds.some(id=>!validUser(id) || !snapshot.friends.some(user=>user.id===id)))throw new Error('请选择有效的好友');
    for(const id of new Set(data.userIds))await request(`auth/user/friends/${encodeURIComponent(id)}`,{method:'DELETE'});
  }else if(['friendRequest','cancelFriendRequest'].includes(action)){
    if(!validUser(data.userId) || data.userId===accountId)throw new Error('无效的用户 ID');
    await request(`user/${encodeURIComponent(data.userId)}/friendRequest`,{method:action==='friendRequest'?'POST':'DELETE'});
    service.recorder(accountId).emit('friend-log',{kind:action==='friendRequest'?'FriendRequest':'CancelFriendRequest',userId:data.userId,displayName:data.displayName || data.userId},Date.now());
  }else if(action==='moderationDelete' || action==='moderationClear'){
    if(!types.includes(data.type))throw new Error('无效的管理类型');
    if(action==='moderationDelete' && !snapshot.moderations.some(row=>row.sourceUserId===accountId && row.targetUserId===data.userId && row.type===data.type))throw new Error('无法删除其他账号的管理记录');
    await request('auth/user/unplayermoderate',{method:'PUT',body:{type:data.type,...(action==='moderationDelete'?{moderated:data.userId}:{})}});
  }else if(action==='favoriteAdd'){
    if(!group || !snapshot.friends.some(user=>user.id===data.userId))throw new Error('请选择好友及好友分组');
    await request('favorites',{method:'POST',body:{type:'friend',favoriteId:data.userId,tags:data.group}});
  }else if(action==='favoriteRemove'){
    if(!snapshot.favorites.some(favorite=>favorite.id===data.favoriteId && favorite.type==='friend'))throw new Error('未找到该账号的好友收藏');
    await request(`favorites/${encodeURIComponent(data.favoriteId)}`,{method:'DELETE'});
  }else if(action==='groupEdit' || action==='groupClear'){
    if(!group)throw new Error('未找到好友分组');
    const path=`favorite/group/friend/${encodeURIComponent(data.group)}/${encodeURIComponent(accountId)}`;
    if(action==='groupClear')await request(path,{method:'DELETE'});
    else{
      const displayName=data.displayName ?? group.displayName,visibility=data.visibility ?? group.visibility;
      if(typeof displayName!=='string' || !displayName.trim() || displayName.length>64 || !['private','friends','public'].includes(visibility))throw new Error('分组名称或可见性无效');
      await request(path,{method:'PUT',body:{displayName:displayName.trim(),visibility}});
    }
  }else throw new Error('不支持的社交操作');
  service.socialRevisions.set(accountId,(service.socialRevisions.get(accountId) || 0)+1);
  service.socialCache.delete(accountId);return socialSnapshot(service,accountId,{force:true});
}
