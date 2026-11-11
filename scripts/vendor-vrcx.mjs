import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Script } from 'node:vm';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const inputs=new Set();
const read=async path=>{inputs.add('vendor/vrcx/src/'+path);return (await readFile(resolve(root,'vendor/vrcx/src',path),'utf8')).replaceAll('\r\n','\n');};
const strip=text=>text.replace(/^import[\s\S]*?;\s*/gm,'').replace(/^export\s*\{[^}]*\};?\s*/gm,'').replace(/^export (?=(?:async )?function)/gm,'');
const names=['userProfile','feed','friendLogCurrent','friendLogHistory','notifications','moderation','activityV2','gameLog'];
const parts=await Promise.all(names.map(async name=>strip(await read(`services/database/${name}.js`))));
const index=await read('services/database/index.js');
const userInit=index.slice(index.indexOf('    async initUserTables('),index.indexOf('    async initTables()'));
const gameInit=index.slice(index.indexOf('    async initTables()'),index.indexOf('    begin()'));
const gameCreates=[...gameInit.matchAll(/`(CREATE (?:TABLE|INDEX) IF NOT EXISTS [\s\S]*?)`/g)].map(m=>m[1]).filter(sql=>/\bgamelog_/.test(sql));
const events=strip(await read('coordinators/userEventCoordinator.js'));
const presence=await read('coordinators/friendPresenceCoordinator.js');
const delayed=strip(presence.slice(0,presence.indexOf('/**\n * Handles immediate friend presence')));
const accountFactory=`export function createVrcxAccountDatabase(sqliteService, accountId) {
  if(!/^usr_[a-zA-Z0-9-]+$/.test(accountId))throw new Error('无效账号 ID');
  const dbVars={userId:accountId,userPrefix:accountId.replaceAll('-','').replaceAll('_',''),maxTableSize:500,searchTableSize:5000};
  ${parts.join('\n')}
  const database={${userInit} ...${names.join(',...')}};
  database.initScopedGameTables=async()=>{${gameCreates.map(sql=>`await sqliteService.executeNonQuery(${JSON.stringify(sql)});`).join('\n')}};
  return database;
}
`;
const cloudFactory=`export function createVrcxCloudContext(database, metadata) {
  const noop=()=>{}; const AppDebug={debugFriendState:false};
  const friends=new Map(),cachedUsers=new Map();
  const friendStore={friends,localFavoriteFriends:new Map(),updateOnlineFriendCounter:noop,reindexSortedFriend:noop};
  const userStore={currentUser:{id:metadata.accountId},state:{instancePlayerCount:new Map()},userDialog:{$location:{tag:''}},applyUserDialogLocation:noop,checkNote:noop,cachedUsers};
  const useFriendStore=()=>friendStore,useUserStore=()=>userStore,useWorldStore=()=>({worldDialog:{id:''}}),useGroupStore=()=>({groupDialog:{id:''}}),useInstanceStore=()=>({applyWorldDialogInstances:noop,applyGroupDialogInstances:noop});
  const useFeedStore=()=>({addFeedEntry:noop}),useNotificationStore=()=>({queueFeedNoty:noop}),useSharedFeedStore=()=>({addEntry:noop});
  const syncFriendSearchIndex=noop;
  const parseLocation=value=>({tag:value || '',worldId:typeof value==='string'?value.split(':')[0]:'',groupId:''});
  const getWorldName=async location=>metadata.worldName(location),getGroupName=async()=>'',getAvatarName=async image=>metadata.avatarName?.(image) || {ownerId:'',avatarName:''};
  ${events}\n${delayed}
  return {
    seed(entries){for(const entry of entries){const ref=entry.ref;cachedUsers.set(ref.id,ref);friends.set(ref.id,{id:ref.id,name:ref.displayName,ref,state:entry.state});}},
    snapshot(){return [...friends.values()].map(ctx=>({ref:ctx.ref,state:ctx.state}));},
    async observe(patch,at,{skipLocationFeed=false}={}){
      let ref=cachedUsers.get(patch.id),ctx=friends.get(patch.id);
      if(!ref){ref={id:patch.id,displayName:patch.displayName || patch.id,location:'offline',state:'offline',$location_at:at,$previousLocation:'',$travelingToTime:at};ctx={id:patch.id,name:ref.displayName,ref,state:'offline'};cachedUsers.set(patch.id,ref);friends.set(patch.id,ctx);}
      const previous={...ref},props={};
      for(const [key,value]of Object.entries(patch)){if(value!==undefined && JSON.stringify(ref[key])!==JSON.stringify(value)){props[key]=[value,ref[key]];ref[key]=value;}}
      if(props.location){props.location[2]=Math.max(0,at-(previous.$location_at || at));ref.$location_at=at;}
      if(skipLocationFeed)delete props.location;
      const state=patch.state || (patch.location==='offline'?'offline':patch.location && patch.location!=='offline'?'online':ctx.state);
      if(state!==ctx.state)props.state=[state,ctx.state];
      const now=()=>at,nowIso=()=>new Date(at).toISOString();
      await runHandleUserUpdateFlow(ref,props,{now,nowIso});
      await runUpdateFriendDelayedCheckFlow(ctx,state,state==='online'?ref.location:previous.location,previous.$location_at || at,{now,nowIso});
      if(props.bio){const existing=await database.getUserProfile(ref.id);if(existing && (existing.bio!==ref.bio || JSON.stringify(existing.bioLinks)!==JSON.stringify(ref.bioLinks || [])))await database.addBioToDatabase({created_at:nowIso(),userId:ref.id,displayName:ref.displayName,bio:ref.bio,previousBio:existing.bio,bioLinks:ref.bioLinks || [],previousBioLinks:existing.bioLinks});database.setUserProfile({...ref,bioLinks:ref.bioLinks || []});}
    }
  };
}
`;
const feedColumns=await read('views/Feed/columns.jsx');
const feedHelpers=feedColumns.slice(feedColumns.indexOf('function getBioLinksDifference('))
  .replace('function getBioLinksDifference(', 'export function vrcxBioLinksDifference(')
  .replace('function formatDifference(', 'export function vrcxFeedDifference(');
const worldRef=(await read('shared/utils/worldTransforms.js')).replace('createDefaultWorldRef','createVrcxWorldRef');
const avatarRef=(await read('shared/utils/avatarTransforms.js')).replace('createDefaultAvatarRef','createVrcxAvatarRef');
const strings=await read('shared/utils/base/string.js');
const bioSymbols=strings.slice(strings.indexOf('function replaceBioSymbols('),strings.indexOf('/**',strings.indexOf('function replaceBioSymbols(')))
  .replace('function replaceBioSymbols(','export function vrcxReplaceBioSymbols(');
const fileHelpers=strip(await read('shared/utils/fileUtils.js')).replace('function extractFileId(','export function vrcxExtractFileId(');
const avatarHelpers=strip(await read('shared/utils/avatar.js'))
  .replaceAll('replaceBioSymbols(','vrcxReplaceBioSymbols(')
  .replace('function storeAvatarImage(','export function vrcxStoreAvatarImage(')
  .replace('function getPlatformInfo(','export function vrcxAvatarPlatforms(');
const userTransforms=await read('shared/utils/userTransforms.js');
const trustHelper=userTransforms.slice(userTransforms.indexOf('export function computeTrustLevel('),userTransforms.indexOf('/**',userTransforms.indexOf('export function computeTrustLevel(')))
  .replace('computeTrustLevel(','vrcxComputeTrustLevel(');
const locationSource=await read('shared/utils/locationParser.js');
const locationParser=locationSource.slice(locationSource.indexOf('function parseLocation('),locationSource.indexOf('/**\n * @param {object} L'))
  .replace('function parseLocation(', 'export function vrcxParseLocation(');
const feedView=await read('views/Feed/Feed.vue');
const feedTypes=/const feedFilterTypes = (\[[^\n]+\]);/.exec(feedView)?.[1];
if(!feedTypes)throw new Error('VRCX feed filter types not found');
// Preserve Feed.vue's All/multiple selection rules without touching the main account Feed Store.
const feedFilterChange=feedView.slice(feedView.indexOf('    function handleFeedFilterChange('),feedView.indexOf('\n</script>')).trim()
  .replace('function handleFeedFilterChange(value) {',`export function vrcxFeedFilterChange(current, value, feedFilterTypes = ${feedTypes}) {\n        let filter = [];`)
  .replace('activeFilterSelection.value',"(current.length ? current : ['All'])")
  .replaceAll('feedTable.value.filter','filter').replace('feedTableLookup();','return filter;');
const output=`/* Generated from VRCX 2026.09.16 (MIT). Run npm run build to regenerate. */\n${accountFactory}${cloudFactory}${feedHelpers}\n${worldRef}\n${avatarRef}\n${bioSymbols}\n${fileHelpers}\n${avatarHelpers}\n${trustHelper}\n${locationParser}\n${feedFilterChange}\n`;
new Script(output.replace(/^export /gm,''));
await writeFile(resolve(root,'src/vendor-vrcx.mjs'),output.replace(/[ \t]+$/gm,''));
const recorder=await readFile(resolve(root,'server/recorder.mjs'),'utf8');
await writeFile(resolve(root,'src/archive.mjs'),`/* Shared Monika extension reducer, generated for browser read-only archives. */\nconst randomUUID=()=>globalThis.crypto.randomUUID();\n${recorder.replace(/^import .*;\s*/m,'').replaceAll('Recorder','MonikaArchive')}`);
console.log('Generated isolated VRCX database and cloud event contexts');
await writeFile(resolve(root,'dist/vendor-context-inputs.json'),JSON.stringify([...inputs].sort(),null,2));
