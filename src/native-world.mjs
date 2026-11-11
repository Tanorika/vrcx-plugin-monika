// Present secondary-account cloud data in the existing VRCX WorldDialog and dialog stack.
// Uses the same world defaults and selected-instance layout as worldCoordinator/instance store.
export function openVrcxWorldPage(stores,utils,data,location,stats={}) {
  const worldStore=stores?.world,ui=stores?.ui,D=worldStore?.worldDialog;
  if(!D)throw new Error('当前 VRCX 未提供 world.worldDialog');
  if(typeof ui?.openDialog!=='function')throw new Error('当前 VRCX 未提供 ui.openDialog');
  const parseLocation=typeof utils?.parseLocation==='function'?tag=>utils.parseLocation(tag):vrcxParseLocation;
  const worldId=data.world.id,L=parseLocation(location),scope=Symbol('Monika world');
  const ref=createVrcxWorldRef(data.world);ref[scope]=true;
  for(const key of ['slimInstances','instances','unityPackages','tags'])if(!Array.isArray(ref[key]))ref[key]=[];
  const rooms=new Map();
  const members=new Map();
  for(const room of data.rooms || []) {
    const L=parseLocation(room.location);
    if(L.worldId===worldId && L.instanceId)members.set(L.instanceId,room.people || []);
  }
  const usersById=new Map([...(data.people || []),...(data.rooms || []).flatMap(room=>room.people || [])].map(user=>[user.id,user]));
  const addRoom=(instanceId,instance={},users=[])=>{
    const tag=`${worldId}:${instanceId}`,$location=parseLocation(tag);
    if(!$location.instanceId)return;
    if(!$location.userId && /^usr_[a-zA-Z0-9-]+$/.test(instance.ownerId || ''))$location.userId=instance.ownerId;
    $location.user=data.creators?.[$location.userId] || usersById.get($location.userId) || {};
    $location.shortName=instance.shortName || $location.shortName;
    if(instance.displayName)$location.instanceName=instance.displayName;
    rooms.set(instanceId,{id:instanceId,tag,location:tag,$location,users,friendCount:users.length,
      shortName:instance.shortName || '',ref:instance,[scope]:true});
  };
  if(L.instanceId)addRoom(L.instanceId,data.instance || {},data.people || []);
  const publicRooms=ref.slimInstances.length?ref.slimInstances:(ref.instances || []).map(([instanceId,n_users])=>({instanceId,n_users}));
  for(const instance of publicRooms)if(instance.instanceId && !rooms.has(instance.instanceId))addRoom(instance.instanceId,{userCount:instance.n_users,capacity:ref.capacity},members.get(instance.instanceId) || []);
  for(const [instanceId,users]of members)if(!rooms.has(instanceId))addRoom(instanceId,{},users);
  const ordered=[...rooms.values()]; // selected instance is inserted first, including private instances.
  L.shortName=data.instance?.shortName || L.shortName;
  ui.openDialog({type:'world',id:worldId,tag:location,label:ref.name});
  Object.assign(D,{id:worldId,$location:L,ref,rooms:ordered,visible:true,loading:false,activeTab:'Instances',lastActiveTab:'Instances',
    inCache:false,cacheSize:'',cacheLocked:false,cachePath:'',fileAnalysis:{},lastVisit:stats.lastVisit || '',visitCount:stats.visitCount || 0,
    timeSpent:stats.timeSpent || 0,isFavorite:false,memo:'',hasPersistData:false,listings:[],
    isPC:ref.unityPackages.some(p=>p.platform==='standalonewindows'),isQuest:ref.unityPackages.some(p=>p.platform==='android'),
    isIos:ref.unityPackages.some(p=>p.platform==='ios'),avatarScalingDisabled:ref.tags.includes('feature_avatar_scaling_disabled'),
    focusViewDisabled:ref.tags.includes('feature_focus_view_disabled')});
  ui.setDialogCrumbLabel?.('world',worldId,ref.name);
  let updating=false,unsubscribe=()=>{};
  if(worldStore.$subscribe)unsubscribe=worldStore.$subscribe(()=>{
    if(updating)return;
    if(!D.visible || D.id!==worldId){unsubscribe();return;}
    // Primary-account presence events can rebuild native rooms; keep this page's observations isolated.
    updating=true;
    try{if(!D.ref?.[scope])D.ref=ref;if(!Array.isArray(D.rooms) || D.rooms.some(room=>!room[scope]) || D.rooms.length!==ordered.length)D.rooms=ordered;}
    finally{updating=false;}
  },{detached:true,flush:'sync'});
  return ()=>{unsubscribe();};
}
