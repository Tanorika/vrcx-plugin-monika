// Original VRCX UI with target-account data and read-only command adaptations.
// This scope never imports the host HTTP client, Pinia instance, or cookie container.
import { reactive, toRefs, ref, computed } from 'vue';
import dayjs from 'dayjs';
import zh from '../../vendor/vrcx/src/localization/zh-CN.json';
import en from '../../vendor/vrcx/src/localization/en.json';
import { createUserDialog } from './user-defaults.mjs';
import { createDefaultUserRef, computeTrustLevel } from '../../vendor/vrcx/src/shared/utils/userTransforms.js';
import { parseLocation } from '../../vendor/vrcx/src/shared/utils/location.js';
import { computeActivityView,computeOverlapView,buildDailySummary } from '../../vendor/vrcx/src/shared/utils/activityEngine.js';
let controller,accountId='',generation=0,dialogVersion=0,graphCache={snapshot:new Map(),meta:new Map()};
const locale=ref('zh-CN');
const table=()=>({data:[],loading:false,filters:[{value:[]},{value:''},{value:false}]});
export const state=reactive({
 user:{userDialog:createUserDialog(),currentUser:createDefaultUserRef({}),cachedUsers:new Map(),currentUserClientConfig:{},currentUserCredits:null,isLocalUserVrcPlusSupporter:false},
 friend:{friends:new Map(),allFavoriteFriendIds:new Set(),friendLogTable:table()},moderation:{playerModerationTable:table()},
 favorite:{favoriteFriends:new Map(),favoriteFriendGroups:[],groupedByGroupKeyFavoriteFriends:{},selectedFavoriteFriends:[],friendImportDialogInput:'',isFavoriteLoading:false,localFriendFavorites:{},localFriendFavoriteGroups:[]},
 search:{friendsListSearch:'',stringComparer:computed(()=>Intl.Collator(locale.value.replace('_','-'),{usage:'search',sensitivity:'base'}))},appearance:{hideUnfriends:false,tablePageSize:100,tablePageSizes:[20,50,100,200,500],randomUserColours:false,sortFavorites:false,isDarkMode:false,weekStartsOn:1,hideUserNotes:false,hideUserMemos:false},
 ui:{shiftHeld:false,socialTab:'log'},charts:{mutualGraphStatus:{isFetching:false}},location:{lastLocation:'',lastLocationDestination:''},game:{isGameRunning:false},advanced:{avatarRemoteDatabase:false,bioLanguage:'zh-CN',translationApi:'',translationApiType:'google'},
 group:{currentUserGroups:new Map(),inGameGroupOrder:[],inviteGroupDialog:{},moderateGroupDialog:{visible:false}},gallery:{fullscreenImageDialog:{visible:false},inventoryTable:table()},auth:{cachedConfig:{},isLoggedIn:true},
 avatar:{cachedAvatars:new Map()},world:{cachedWorlds:new Map()},invite:{inviteMessageTable:table()},notification:{notificationTable:table()},general:{},vrcx:{},externalLink:{},launch:{},instance:{},updateLoop:{},activity:{fullCacheReady:new Set(),userActivity:new Map()}
});
export const storeToRefs=toRefs;
export async function processBulk({fn,params,N=-1,handle,done}){let count=0;try{while(N<0 || count<N){const args=await fn(params);handle?.(args);count+=args.json.length;if(args.json.length<(params.n || 100))break;params={...params,offset:(params.offset || 0)+(params.n || 100)};if(params.offset>20000)throw new Error('分页超出上限');}done?.(true);}catch(error){done?.(false);controller.nativeError(error);}}
export const request=()=>failure('未适配的请求');
const valueAt=(messages,key)=>key.split('.').reduce((value,part)=>value?.[part],messages);
const recentActions=reactive({});
export function recordRecentAction(id,type){recentActions[`${accountId}:${id}:${type}`]=Date.now();}
export function isActionRecent(id,type){return !!state.general.recentActionCooldownEnabled && Date.now()-(recentActions[`${accountId}:${id}:${type}`] || 0)<(state.general.recentActionCooldownMinutes || 5)*60000;}
export function clearRecentActions(){for(const key of Object.keys(recentActions))delete recentActions[key];}
const translation=(key,language=locale.value)=>valueAt(language.startsWith('zh')?zh:en,key) ?? valueAt(en,key);
const t=(key,args={})=>String(translation(key) ?? key).replace(/\{(\w+)\}/g,(_,name)=>args[name] ?? `{${name}}`);
const te=(key,language=locale.value)=>typeof translation(key,language)==='string';
export const i18n={global:{t,te,locale}},useI18n=()=>i18n.global;
export const toast={success:message=>controller?.nativeMessage(message),error:error=>controller?.nativeError(error),warning:message=>controller?.nativeMessage(message),info:message=>controller?.nativeMessage(message)};
export const useRoute=()=>reactive({path:'/friend-list',name:'friend-list'}),router={push:()=>selectSocialTab('graph')};
export const useRouter=()=>router;
export const watchState=reactive({isLoggedIn:true,isFriendsLoaded:true});
const failure=feature=>{const error=new Error(`目标账号暂不支持此操作：${feature}`);controller?.nativeError(error);return Promise.reject(error);};
export const storageKey=key=>`monika:${accountId}:${key}`;
export const scopedStorage={getItem:key=>accountId?localStorage.getItem(storageKey(key)):null,setItem:(key,value)=>{if(accountId)localStorage.setItem(storageKey(key),value);},removeItem:key=>{if(accountId)localStorage.removeItem(storageKey(key));}};
const config={async getString(key,fallback=''){return localStorage.getItem(storageKey(key)) ?? fallback;},async setString(key,value){localStorage.setItem(storageKey(key),value);},async getBool(key,fallback=false){const value=await this.getString(key);return value?value==='true':fallback;},async setBool(key,value){return this.setString(key,String(value));},async getInt(key,fallback=0){return Number(await this.getString(key,String(fallback)));},async setInt(key,value){return this.setString(key,String(value));},async getFloat(key,fallback=0){return Number(await this.getString(key,String(fallback)));},async setFloat(key,value){return this.setString(key,String(value));}};
export default config;
const getStore=name=>()=>state[name];
export const useUserStore=getStore('user'),useFriendStore=getStore('friend'),useFavoriteStore=getStore('favorite'),useAppearanceSettingsStore=getStore('appearance'),useModerationStore=getStore('moderation'),useSearchStore=getStore('search'),useUiStore=getStore('ui'),useChartsStore=getStore('charts'),useLocationStore=getStore('location'),useGameStore=getStore('game'),useAdvancedSettingsStore=getStore('advanced'),useGroupStore=getStore('group'),useGalleryStore=getStore('gallery'),useAuthStore=getStore('auth'),useAvatarStore=getStore('avatar'),useWorldStore=getStore('world'),useInviteStore=getStore('invite'),useNotificationStore=getStore('notification'),useGeneralSettingsStore=getStore('general'),useVrcxStore=getStore('vrcx'),useExternalLinkStore=getStore('externalLink'),useLaunchStore=getStore('launch'),useInstanceStore=getStore('instance'),useUpdateLoopStore=getStore('updateLoop'),useActivityStore=getStore('activity');
export const useModalStore=()=>({confirm:async options=>({ok:await controller.confirm(options)}),prompt:async options=>{const value=await controller.prompt(options);return {ok:value!==null,value};},alert:async options=>controller.nativeMessage(options.description || options.title)});
function userRef(json){const trust=computeTrustLevel(json.tags || [],json.developerType),r=createDefaultUserRef(json);Object.assign(r,{$trustLevel:trust.trustLevel,$trustClass:trust.trustClass,$trustSortNum:trust.trustSortNum,$isModerator:trust.isModerator,$isTroll:trust.isTroll,$isProbableTroll:trust.isProbableTroll,$isVRCPlus:(json.tags || []).includes('system_supporter'),$userColour:`var(--${trust.trustColorKey}, var(--foreground))`,$friendNumber:json.friendNumber || 0,$joinCount:0,$timeSpent:0,$lastSeen:'',$mutualCount:graphCache.snapshot.get(json.id)?.length ?? json.mutualCount ?? 0,$mutualOptedOut:graphCache.meta.get(json.id)?.optedOut ?? json.hasSharedConnectionsOptOut ?? false,$memo:'',$languages:(json.tags || []).filter(tag=>tag.startsWith('language_')).map(tag=>({key:tag,value:tag.slice(9)})),$location:parseLocation(json.location || '')});if(json.state==='offline')r.status='offline';return r;}
export function configure(next){generation++;controller=next;state.ui.socialTab='log';}
export function selectSocialTab(tab){
 if(state.ui.socialTab==='graph' && tab!=='graph')state.charts.requestMutualGraphCancel?.();
 state.ui.socialTab=tab;
}
export function sync(snapshot){
 if(!snapshot)return;if(snapshot.accountId!==controller.view.accountId)throw new Error('社交数据账号不匹配');
 if(accountId!==snapshot.accountId){state.charts.requestMutualGraphCancel?.();state.ui.socialTab='log';accountId=snapshot.accountId;generation++;dialogVersion++;loadGraphCache();state.user.userDialog=createUserDialog();state.user.cachedUsers.clear();state.friend.friends.clear();state.favorite.selectedFavoriteFriends=[];state.search.friendsListSearch='';state.avatar.cachedAvatars.clear();state.world.cachedWorlds.clear();state.favorite.localFriendFavorites={};state.favorite.localFriendFavoriteGroups=[];}
 const current=controller.view.status.user;state.user.currentUser=userRef(current?.id===accountId?current:{id:accountId});
 for(const key of ['tablePageSize','tablePageSizes','randomUserColours','isDarkMode','weekStartsOn','hideUserNotes','hideUserMemos'])if(window.$pinia?.appearanceSettings?.[key]!==undefined)state.appearance[key]=window.$pinia.appearanceSettings[key];
 const configuredLocale=window.$pinia?.appearanceSettings?.appLanguage || window.$pinia?.generalSettings?.language;if(typeof configuredLocale==='string')locale.value=configuredLocale.replace('_','-');
 const ids=new Set();for(const user of snapshot.friends || []){ids.add(user.id);const next=userRef(user),existing=state.user.cachedUsers.get(user.id);if(existing)Object.assign(existing,next);else state.user.cachedUsers.set(user.id,next);const r=state.user.cachedUsers.get(user.id),ctx=state.friend.friends.get(user.id);if(ctx)ctx.ref=r;else state.friend.friends.set(user.id,{id:user.id,ref:r});}
 for(const id of state.friend.friends.keys())if(!ids.has(id))state.friend.friends.delete(id);
 state.friend.friendLogTable.data=snapshot.history || [];state.moderation.playerModerationTable.data=snapshot.moderations || [];
 state.friend.allFavoriteFriendIds=new Set((snapshot.favorites || []).map(f=>f.favoriteId));const grouped={},favorites=[];for(const f of snapshot.favorites || []){const ctx={id:f.favoriteId,favoriteId:f.id,groupKey:`friend:${f.tags?.[0]}`,ref:state.user.cachedUsers.get(f.favoriteId),name:state.user.cachedUsers.get(f.favoriteId)?.displayName || f.favoriteId};favorites.push(ctx);(grouped[ctx.groupKey] ||= []).push(ctx);}
 state.favorite.favoriteFriends_=favorites;state.favorite.groupedByGroupKeyFavoriteFriends=grouped;state.favorite.favoriteFriendGroups=(snapshot.groups || []).filter(g=>g.type==='friend').map(g=>({...g,key:`friend:${g.name}`,count:(grouped[`friend:${g.name}`] || []).length,capacity:g.capacity || 100}));state.location.lastLocation={location:state.user.currentUser.location || '',friendList:[],...parseLocation(state.user.currentUser.location || '')};
}
const session=()=>({id:accountId,generation});
function check(s){if(s.id!==accountId || s.generation!==generation || s.id!==controller.view.accountId)throw new Error('目标账号会话已变化');}
export const beginGraphSession=session,checkGraphSession=check;
export function installChartsStore(factory){state.charts=factory();state.charts.showMutualGraph=()=>selectSocialTab('graph');}
async function query(kind,params={}){const s=session();kind=kind.split('.')[0];const data=await controller.nativeQuery(s.id,kind,params);check(s);if(kind==='world')state.world.cachedWorlds.set(data.id,data);if(kind==='instance'){state.instance.cachedInstances.set(data.id || params.location,data);state.instance.lastInstanceApplied=params.location;}return {json:data,ref:data,params};}
async function action(){return failure('社交为只读模式');}
async function getUser(params){const s=session(),user=await controller.socialUser(s.id,params.userId,params);check(s);const existing=state.user.cachedUsers.get(user.id),next=userRef({...existing,...user});if(existing)Object.assign(existing,next);else state.user.cachedUsers.set(user.id,next);return {json:user,params,ref:state.user.cachedUsers.get(user.id)};}
export async function showUserDialog(id){
 const s=session(),version=++dialogVersion;if(!/^usr_[\w-]+$/.test(id))return;
 const initial=createUserDialog();initial.id=id;initial.visible=true;initial.loading=true;initial.ref=userRef(state.user.cachedUsers.get(id) || {id});state.user.userDialog=initial;const D=state.user.userDialog;
 try{const [args,profile]=await Promise.all([getUser({userId:id}),query('profile',{userId:id})]);check(s);if(version!==dialogVersion)return;const r=state.user.cachedUsers.get(id);Object.assign(D,{ref:r,publicProfileRef:profile.json,isFriend:state.friend.friends.has(id),friend:state.friend.friends.get(id) || {},isFavorite:state.friend.allFavoriteFriendIds.has(id),note:r.note || '',memo:r.$memo || '',$location:parseLocation(r.location || ''),joinCount:r.$joinCount,timeSpent:r.$timeSpent,lastSeen:r.$lastSeen,mutualFriendCount:r.$mutualCount});
 for(const row of state.moderation.playerModerationTable.data.filter(row=>row.sourceUserId===accountId && row.targetUserId===id)){const key=({block:'isBlock',mute:'isMute',unblock:'isShowAvatar',interactOff:'isInteractOff',muteChat:'isMuteChat'})[row.type];if(key)D[key]=true;}
 D.theme=profile.json?.theme || D.theme;D.$avatarInfo=await getAvatarName(r.currentAvatarImageUrl || profile.json.iconUrl);check(s);if(version!==dialogVersion)return;
 if(/^wrld_.*:/.test(r.location || '')){D.instance.tag=r.location;D.instance.id=D.$location.instanceId;D.instance.$location=D.$location;D.instance.ref={};void query('worldContext',{location:r.location}).then(args=>{if(version!==dialogVersion)return;state.world.cachedWorlds.set(args.json.world.id,args.json.world);D.users=(args.json.people || []).map(userRef);D.instance.ref=args.json.instance || {};D.instance.users=D.users;D.instance.friendCount=D.users.length;D.$location.user=args.json.creators?.[D.$location.userId];}).catch(error=>{if(version===dialogVersion)controller.nativeError(error);});}if(profile.json.representedGroup)D.representedGroup=profile.json.representedGroup;
 }catch(error){if(version===dialogVersion)controller.nativeError(error);}finally{if(version===dialogVersion)D.loading=false;}
}
export const userRequest={getUser,getPublicProfile:params=>query('profile',params),getMutualFriends:params=>query('mutualFriends',params),getUserMutuals:params=>query('mutuals',params),getCurrentUser:()=>query('currentUser'),saveCurrentUser:()=>failure('修改账号资料'),saveProfile:()=>failure('修改账号资料')};
export const getCurrentUser=()=>userRequest.getCurrentUser(),queryRequest={fetch:(key,params={})=>key.startsWith('user')?getUser(params):key==='publicProfile'?query('profile',params):query(key,params)};
export const friendRequest={deleteFriend:params=>action('unfriend',{userIds:[params.userId]}),sendFriendRequest:params=>action('friendRequest',params),cancelFriendRequest:params=>action('cancelFriendRequest',params)};
export const playerModerationRequest={deletePlayerModeration:params=>action('moderationDelete',{type:params.type,userId:params.moderated}),deletePlayerModerations:params=>action('moderationClear',params),sendPlayerModeration:params=>query('moderationCreate',params)};
export const favoriteRequest={getFavoriteGroups:params=>query('favoriteGroups',params),getFavoriteWorlds:params=>query('favoriteWorlds',params),deleteFavorite:params=>action('favoriteRemove',{favoriteId:state.favorite.favoriteFriends.find(f=>f.id===params.objectId)?.favoriteId || params.objectId}),saveFavoriteGroup:async params=>{await action('groupEdit',params);return {json:state.favorite.favoriteFriendGroups.find(g=>g.name===params.group),params};},clearFavoriteGroup:params=>action('groupClear',params),addFavorite:params=>action('favoriteAdd',{userId:params.favoriteId,group:params.tags})};
export const groupRequest={getGroups:params=>query('userGroups',params)},worldRequest={getWorld:params=>query('world',params),getWorlds:params=>query('worldsByUser',params)},miscRequest={saveNote:params=>query('saveNote',params),updateBadge:()=>failure('修改徽章')};
export const instanceRequest={selfInvite:params=>query('selfInvite',params)},notificationRequest={sendInvite:params=>query('sendInvite',params),sendRequestInvite:params=>query('sendRequestInvite',params)},inviteMessagesRequest={},vrcPlusIconRequest={},vrcPlusImageRequest={};
export function handleFriendDelete(){}
export const getFriendRequest=()=>Promise.resolve();
export async function confirmDeleteFriend(id){if((await useModalStore().confirm({title:'Confirm',description:t('confirm.delete_friend')})).ok)await friendRequest.deleteFriend({userId:id});}
export async function refreshFavorites(){const s=session();state.favorite.isFavoriteLoading=true;try{const snapshot=await controller.social(s.id,{force:true});check(s);sync(snapshot);}finally{if(s.id===accountId)state.favorite.isFavoriteLoading=false;}}
export const runRefreshPlayerModerationsFlow=refreshFavorites;
export const showWorldDialog=location=>controller.openWorld(location,accountId),showAvatarDialog=id=>controller.openAvatar(id,accountId),showAvatarAuthorDialog=showUserDialog;
export async function getAvatarName(image){if(!image)return {ownerId:'',avatarName:''};const s=session(),result=await controller.api('/avatars/resolve',{accountId:s.id,avatars:[{image}]});check(s);const asset=result.assets?.[0];return {ownerId:asset?.ownerId || '',avatarName:asset?.name || ''};}
export const refreshUserDialogAvatars=async()=>{const D=state.user.userDialog,result=await query('avatarsByUser',{userId:D.id});if(D.id===state.user.userDialog.id)D.avatars=result.json;},lookupAvatars=()=>Promise.resolve([]);
export const showGroupDialog=id=>failure(`群组详情 ${id}`),showGroupMemberModerationDialog=showGroupDialog,refreshInstancePlayerCount=location=>query('instance',{location:typeof location==='string'?location:location?.tag}),runNewInstanceSelfInviteFlow=()=>failure('创建实例');
export const applyGroup=group=>group,handleGroupList=()=>{},saveCurrentUserGroups=()=>{},updateInGameGroupOrder=()=>Promise.resolve(),isSoleGroupOwner=(group,id)=>group.ownerId===id,leaveGroup=()=>failure('退出群组'),leaveGroupPrompt=leaveGroup,setGroupVisibility=()=>failure('修改群组可见性');
export const handleFavoriteWorldList=args=>{for(const world of args.json || [])state.world.cachedWorlds.set(world.id,world);};
function saveLocal(){localStorage.setItem(storageKey('local-friend-favorites'),JSON.stringify(state.favorite.localFriendFavorites));state.favorite.localFriendFavoriteGroups=Object.keys(state.favorite.localFriendFavorites);}
export const getLocalFriendFavorites=()=>{saveLocal();},getLocalWorldFavorites=()=>{};
export function removeLocalFriendFavorite(id,group){state.favorite.localFriendFavorites[group]=(state.favorite.localFriendFavorites[group] || []).filter(value=>value!==id);saveLocal();}
export function deleteLocalFriendFavoriteGroup(group){delete state.favorite.localFriendFavorites[group];saveLocal();}
export function renameLocalFriendFavoriteGroup(name,group){state.favorite.localFriendFavorites[name]=state.favorite.localFriendFavorites[group] || [];delete state.favorite.localFriendFavorites[group];saveLocal();}
export async function saveUserMemo(id,memo){const s=session();await controller.database.saveUserMemo(s.id,id,memo);check(s);const r=state.user.cachedUsers.get(id);if(r)r.$memo=memo;state.user.userDialog.memo=memo;}
export const formatDateFilter=(value,format)=>dayjs(value).isValid()?dayjs(value).format(format==='short'?'MM-DD HH:mm:ss':format==='long'?'YYYY-MM-DD HH:mm:ss':format || 'YYYY-MM-DD HH:mm:ss'):'';
export const getBundleDateSize=()=>Promise.resolve({}),checkVRChatCache=()=>false,deleteVRChatCache=()=>failure('修改游戏缓存');
function loadGraphCache(){let data;try{data=JSON.parse(scopedStorage.getItem('mutual-graph') || '{}');}catch{data={};}const valid=id=>typeof id==='string' && /^usr_[\w-]+$/.test(id);graphCache={snapshot:new Map((Array.isArray(data.snapshot)?data.snapshot:[]).filter(row=>Array.isArray(row) && valid(row[0]) && Array.isArray(row[1])).map(([id,ids])=>[id,ids.filter(valid)])),meta:new Map((Array.isArray(data.meta)?data.meta:[]).filter(row=>Array.isArray(row) && valid(row[0]) && row[1] && typeof row[1]==='object'))};}
function saveGraphCache(){scopedStorage.setItem('mutual-graph',JSON.stringify({snapshot:[...graphCache.snapshot],meta:[...graphCache.meta]}));}
function applyGraphCounts(){for(const [id,r] of state.user.cachedUsers){if(graphCache.snapshot.has(id))r.$mutualCount=graphCache.snapshot.get(id).length;if(graphCache.meta.has(id))r.$mutualOptedOut=!!graphCache.meta.get(id).optedOut;}}
export const database={getAllUserProfiles:async()=>[...state.user.cachedUsers.values()].filter(u=>u.profileLoaded).map(u=>({userId:u.id,bio:u.bio,bioLinks:u.bioLinks})),deleteFriendLogHistory:async row=>controller.database.deleteSocialHistory(accountId,row.rowId),getUserMemo:async()=>'',
 getMutualGraphSnapshot:async()=>new Map(graphCache.snapshot),getMutualGraphMeta:async()=>new Map(graphCache.meta),
 updateMutualsForFriend:async(id,ids)=>{graphCache.snapshot.set(id,[...new Set(ids)]);applyGraphCounts();saveGraphCache();},
 upsertMutualGraphMeta:async(id,meta)=>{graphCache.meta.set(id,{...meta,lastFetchedAt:new Date().toISOString()});applyGraphCounts();saveGraphCache();},
 bulkUpsertMutualGraphMeta:async rows=>{for(const [id,meta] of rows)graphCache.meta.set(id,{...meta,lastFetchedAt:new Date().toISOString()});applyGraphCounts();saveGraphCache();},
 saveMutualGraphSnapshot:async rows=>{const next=new Map(rows);for(const [id,ids] of graphCache.snapshot)if(graphCache.meta.get(id)?.optedOut && !next.has(id))next.set(id,ids);graphCache.snapshot=next;applyGraphCounts();saveGraphCache();}
};
Object.assign(state.friend,{getAllUserStats:async()=>{},getAllUserMutualCount:async()=>{},getAllUserMutualOptedOut:async()=>{}});
Object.assign(state.appearance,{setSortFavorites:()=>{state.appearance.sortFavorites=!state.appearance.sortFavorites;}});
Object.assign(state.moderation,{handlePlayerModerationDelete:()=>{},applyPlayerModeration:()=>{},showModerationReportDialog:()=>failure('举报')});
Object.assign(state.user,{sortUserDialogAvatars:rows=>rows.sort((a,b)=>String(b.updated_at).localeCompare(String(a.updated_at))),sortUserDialogLicensedAvatars:rows=>rows.sort((a,b)=>String(a.name).localeCompare(String(b.name))),showSendBoopDialog:()=>failure('Boop'),showEditProfileDialog:()=>failure('修改账号资料')});
Object.assign(state.favorite,{handleFavoriteGroup:()=>{},localFriendFavGroupLength:group=>(state.favorite.localFriendFavorites[group] || []).length,newLocalFriendFavoriteGroup:name=>{if(!state.favorite.localFriendFavorites[name])state.favorite.localFriendFavorites[name]=[];saveLocal();},showFavoriteDialog:async(type,id)=>{if(type!=='friend')return failure('非好友收藏');const name=await controller.prompt({title:t('view.favorite.worlds.vrchat_favorites'),description:state.favorite.favoriteFriendGroups.map(g=>`${g.name}: ${g.displayName}`).join('\n')});if(name)await action('favoriteAdd',{userId:id,group:name});},showFriendImportDialog:()=>failure('导入好友收藏')});
Object.assign(state.gallery,{showFullscreenImageDialog:url=>window.$pinia?.gallery?.showFullscreenImageDialog?.(url),clearInviteImageUpload:()=>{},showGalleryPage:()=>failure('图库')});
Object.assign(state.group,{showModerateGroupDialog:()=>failure('群组管理'),showCreateGroupDialog:()=>failure('创建群组')});Object.assign(state.invite,{refreshInviteMessageTableData:()=>{}});
Object.assign(state.launch,{showLaunchDialog:location=>controller.openWorld(location,accountId)});Object.assign(state.world,{applyWorld:world=>{state.world.cachedWorlds.set(world.id,world);return world;}});Object.assign(state.instance,{showPreviousInstancesListDialog:()=>controller.nativeMessage('请在 Monika 活动历史查看目标账号记录。')});
Object.assign(state.user,{cachedIconFrames:new Map(),cachedNameplateEffects:new Map(),cachedProfileEffects:new Map()});
Object.assign(state.appearance,{isDataTableStriped:false,displayVRCProfileCosmetics:true,isAgeGatedInstancesVisible:true,showInstanceIdInLocation:false});
state.favorite.favoriteFriends_=[];state.favorite.favoriteFriends=computed(()=>[...state.favorite.favoriteFriends_].sort((a,b)=>state.appearance.sortFavorites?state.favorite.favoriteFriends_.indexOf(b)-state.favorite.favoriteFriends_.indexOf(a):a.name.toLowerCase().localeCompare(b.name.toLowerCase())));
Object.assign(state.instance,{lastInstanceApplied:null,instanceJoinHistory:new Map()});
Object.assign(state.invite,{inviteRequestMessageTable:table()});Object.assign(state.gallery,{inviteImageUpload:{imageUrl:'',fileId:'',loading:false}});
Object.assign(state.instance,{cachedInstances:new Map()});Object.assign(state.invite,{canOpenInstanceInGame:false});Object.assign(state.launch,{isOpeningInstance:false});
Object.assign(state.favorite,{favoriteDialog:{visible:false,loading:false,type:'friend',objectId:'',currentGroup:{}},friendImportDialogVisible:false,favoriteAvatarGroups:[],favoriteWorldGroups:[],localWorldFavoriteGroups:[],localAvatarFavoriteGroups:[],
 localFriendFavoritesList:computed(()=>[...new Set(Object.values(state.favorite.localFriendFavorites).flat())]),
 showFriendImportDialog:()=>{state.favorite.friendImportDialogVisible=true;},getCachedFavoritesByObjectId:id=>state.favorite.favoriteFriends.find(f=>f.id===id),
 showFavoriteDialog:(type,id)=>{const favorite=state.favorite.favoriteFriends.find(f=>f.id===id);Object.assign(state.favorite.favoriteDialog,{visible:true,type,objectId:id,currentGroup:state.favorite.favoriteFriendGroups.find(g=>g.key===favorite?.groupKey) || {}});},
 deleteFavoriteNoConfirm:async id=>{await favoriteRequest.deleteFavorite({objectId:id});state.favorite.favoriteDialog.visible=false;},
 hasLocalFriendFavorite:(id,group)=>(state.favorite.localFriendFavorites[group] || []).includes(id),hasLocalWorldFavorite:()=>false,hasLocalAvatarFavorite:()=>false,localWorldFavGroupLength:()=>0,localAvatarFavGroupLength:()=>0
});
export function addLocalFriendFavorite(id,group){if(!(state.favorite.localFriendFavorites[group] || []).includes(id))(state.favorite.localFriendFavorites[group] ||= []).push(id);saveLocal();}
export const addLocalWorldFavorite=()=>failure('收藏世界'),removeLocalWorldFavorite=addLocalWorldFavorite,addLocalAvatarFavorite=()=>failure('收藏模型'),removeLocalAvatarFavorite=addLocalAvatarFavorite;
state.activity.fullCacheReady=true;state.activity.userActivity={lastLoadedUserId:'',activeRequestId:0,activeOverlapRequestId:0,activeTopWorldsRequestId:0};
async function activityData(id){const s=session(),data=await controller.nativeActivity(s.id,id);check(s);return data;}
Object.assign(state.activity,{
 async getCache(id,isSelf){const data=await activityData(id);return {sessions:isSelf?data.selfSessions:data.friendSessions};},
 async loadActivityView(options){const data=await activityData(options.userId);return computeActivityView({...options,sessions:options.isSelf?data.selfSessions:data.friendSessions});},
 async loadOverlapView(options){const data=await activityData(options.targetUserId);return computeOverlapView({...options,selfSessions:data.selfSessions,targetSessions:data.friendSessions});},
 async loadTopWorldsView(options){const data=await activityData(options.userId),groups=new Map(),from=Date.now()-options.rangeDays*86400000;for(const v of data.worldVisits.filter(v=>(v.end ?? v.lastSeen)>=from && v.worldId!==options.excludeWorldId)){const g=groups.get(v.worldId) || {worldId:v.worldId,worldName:v.worldName,visitCount:0,totalTime:0};g.visitCount++;g.totalTime+=Math.max(0,(v.end ?? v.lastSeen)-Math.max(from,v.start));groups.set(v.worldId,g);}return [...groups.values()].sort((a,b)=>options.sortBy==='time'?b.totalTime-a.totalTime:b.visitCount-a.visitCount).slice(0,options.limit || 5);},
 async loadDailySummary(options){const data=await activityData(options.userId);return buildDailySummary(options.isSelf?data.selfSessions:data.friendSessions,options.rangeStartMs,options.rangeEndMs);}
});
Object.assign(state.general,{disableGpuAcceleration:false});Object.assign(state.vrcx,{isBrowserFocused:true});
