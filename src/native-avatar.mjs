// Reuse VRCX AvatarDialog with cloud data fetched using the target account.
export function openVrcxAvatarPage(stores,data){
  const store=stores?.avatar,D=store?.avatarDialog,ui=stores?.ui;
  if(!D || typeof ui?.openDialog!=='function')throw new Error('当前 VRCX 未提供模型详情窗口');
  const scope=Symbol('Monika avatar'),ref=createVrcxAvatarRef(data.avatar);ref[scope]=true;
  ref.gallery=data.gallery || [];
  for(const key of ['tags','unityPackages','publishedListings'])if(!Array.isArray(ref[key]))ref[key]=[];
  const platformInfo=vrcxAvatarPlatforms(ref.unityPackages);
  for(const key of ['pc','android','ios'])if(platformInfo[key]?.platform)platformInfo[key]={...platformInfo[key],performanceRating:platformInfo[key].performanceRating || 'None'};else platformInfo[key]=null;
  const galleryImages=[...(data.gallery || [])].sort((a,b)=>(a.order || 0)-(b.order || 0)).flatMap(file=>{
    const url=file.versions?.at(-1)?.file?.url;return url?[{id:file.id,url}]:[];
  });
  galleryImages[scope]=true;
  D.loading=true;ui.openDialog({type:'avatar',id:ref.id,label:ref.name});
  Object.assign(D,{id:ref.id,ref,visible:true,loading:false,activeTab:'Info',lastActiveTab:'Info',platformInfo,
    isPC:Boolean(platformInfo.pc),isQuest:Boolean(platformInfo.android),isIos:Boolean(platformInfo.ios),
    hasImposter:ref.unityPackages.some(pkg=>pkg.variant==='impostor'),imposterVersion:ref.unityPackages.find(pkg=>pkg.variant==='impostor')?.impostorizerVersion || '',
    isQuestFallback:ref.tags.some(tag=>/quest/.test(tag)),isFavorite:false,isBlocked:false,inCache:false,cacheSize:'',cacheLocked:false,cachePath:'',fileAnalysis:{},
    galleryImages,galleryLoading:false,memo:'',timeSpent:0});
  ui.setDialogCrumbLabel?.('avatar',ref.id,ref.name);
  let updating=false,unsubscribe=()=>{};
  if(store.$subscribe)unsubscribe=store.$subscribe(()=>{
    if(updating)return;if(!D.visible || D.id!==ref.id){unsubscribe();return;}
    updating=true;try{if(!D.ref?.[scope])D.ref=ref;if(!D.galleryImages?.[scope])D.galleryImages=galleryImages;if(D.timeSpent!==0)D.timeSpent=0;}finally{updating=false;}
  },{detached:true,flush:'sync'});
  return ()=>unsubscribe();
}
