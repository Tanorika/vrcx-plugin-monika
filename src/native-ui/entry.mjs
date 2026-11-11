import { createApp, h, effectScope, defineAsyncComponent } from 'vue';
import FriendLog from '../../vendor/vrcx/src/views/FriendLog/FriendLog.vue';
import FriendList from '../../vendor/vrcx/src/views/FriendList/FriendList.vue';
import Moderation from '../../vendor/vrcx/src/views/Moderation/Moderation.vue';
import FavoritesFriend from '../../vendor/vrcx/src/views/Favorites/FavoritesFriend.vue';
import { createChartsStore } from 'monika-native-charts';
import UserDialog from '../../vendor/vrcx/src/components/dialogs/UserDialog/UserDialog.vue';
import { Dialog, DialogContent } from '../../vendor/vrcx/src/components/ui/dialog';
import { TooltipProvider, TooltipWrapper } from '../../vendor/vrcx/src/components/ui/tooltip';
import { TabsUnderline } from '../../vendor/vrcx/src/components/ui/tabs';
import Timer from '../../vendor/vrcx/src/components/Timer.vue';
import Location from '../../vendor/vrcx/src/components/Location.vue';
import DisplayName from '../../vendor/vrcx/src/components/DisplayName.vue';
import { configure, sync, state, installChartsStore, selectSocialTab } from './adapters.mjs';
const MutualFriends=defineAsyncComponent(()=>import('./mutual-graph.mjs').then(module=>module.default));

export function mount(element,controller,snapshot){
  configure(controller);
  const scope=effectScope();scope.run(()=>installChartsStore(createChartsStore));
  sync(snapshot);
  const pages={log:FriendLog,friends:FriendList,moderation:Moderation,groups:FavoritesFriend};
  const previousIds={};
  const app=createApp({setup:()=>()=>h(TooltipProvider,{},()=>[
    h(TabsUnderline,{class:'flex-1 min-h-0',fill:true,key:state.user.currentUser.id,modelValue:state.ui.socialTab,'onUpdate:modelValue':selectSocialTab,items:[{value:'log',label:'好友日志'},{value:'friends',label:'好友列表'},{value:'moderation',label:'玩家管理'},{value:'groups',label:'好友分组'},{value:'graph',label:'关系网'}]}, {...Object.fromEntries(Object.keys(pages).map(key=>[key,()=>h(pages[key])])),graph:()=>state.ui.socialTab==='graph'?h(MutualFriends):null}),
    h(Dialog,{open:state.user.userDialog.visible,'onUpdate:open':v=>{state.user.userDialog.visible=v;}},()=>h(DialogContent,{class:'x-dialog monika-user-dialog translate-y-0 sm:max-w-270 overflow-hidden flex flex-col',style:{top:'10vh',...state.user.userDialog.themeStyle}},()=>h(UserDialog,{previousIds,updatePreviousId:(key,value)=>{previousIds[key]=value;}})))
  ])});
  app.component('TooltipWrapper',TooltipWrapper);
  app.component('Timer',Timer);app.component('Location',Location);app.component('DisplayName',DisplayName);
  app.config.errorHandler=e=>controller.nativeError(e);
  app.mount(element);
  return {update:snapshot=>sync(snapshot),close:()=>{state.user.userDialog.visible=false;if(state.ui.socialTab==='graph')selectSocialTab('friends');state.charts.requestMutualGraphCancel();},dispose:()=>{state.charts.requestMutualGraphCancel();app.unmount();scope.stop();}};
}
