import { parse as parseSfc } from '@vue/compiler-sfc';
import { parse as parseTemplate } from '@vue/compiler-dom';

const expr=(node,name,arg)=>node.props?.find(p=>p.type===7 && p.name===name && (arg===undefined || p.arg?.content===arg))?.exp?.content || '';
const fragment=node=>node.loc.source;
const has=(node,text)=>fragment(node).includes(text);
const readCommands=new Set(['Refresh','Copy Profile URL','Copy DisplayName','Copy UserId','Show Fallback Avatar Details','Show Avatar Details']);

function removeTemplateNodes(template,predicate){
  const ranges=[];
  function walk(node){
    if(node.type===1 && predicate(node)){ranges.push([node.loc.start.offset,node.loc.end.offset]);return;}
    for(const child of node.children || [])walk(child);
  }
  walk(parseTemplate(template));
  for(const [start,end] of ranges.sort((a,b)=>b[0]-a[0]))template=template.slice(0,start)+template.slice(end);
  return template;
}

// Keep the original layouts and controls, removing only unavailable data and account writes.
export function adaptNativeSource(file,source){
  const {descriptor}=parseSfc(source),template=descriptor.template?.content;
  if(!template)return source;
  const drop=node=>{
    const click=expr(node,'on','click');
    if(file==='views/FriendList/FriendList.vue'){
      return node.tag==='div' && (expr(node,'if')==='friendsListBulkUnfriendMode' || node.children?.some(c=>c.type===1 && (c.tag==='Switch' && has(c,'friendsListBulkUnfriendMode') || c.tag==='Button' && expr(c,'on','click')==='loadMutualFriends'))) ||
        node.tag==='Button' && click==='friendsListLoadUsers' || node.tag==='Dialog' && has(node,'friendsListLoadDialogVisible');
    }
    if(file==='views/Moderation/Moderation.vue')return node.tag==='DropdownMenu' && has(node,'clearPlayerModerationsByType');
    if(file==='views/Favorites/FavoritesFriend.vue')return node.tag==='DropdownMenu' && has(node,'handleRemoteRename') || node.tag==='div' && node.props?.some(p=>p.type===6 && p.name==='class' && p.value?.content==='flex flex-col gap-2') && has(node,"t('view.favorite.worlds.local_favorites')");
    if(file==='views/Favorites/components/FavoritesContentHeader.vue')return node.tag==='div' && (node.children?.some(c=>c.type===1 && c.tag==='Switch') || expr(node,'if')==='editModeVisible');
    if(file==='views/Favorites/components/FavoritesToolbar.vue')return node.tag==='DropdownMenuItem' && click.includes("$emit('import')");
    if(file==='views/Favorites/components/FavoritesFriendItem.vue')return node.tag==='template' && node.props?.some(p=>p.type===7 && p.name==='slot' && p.arg?.content==='append') || node.tag==='ItemActions' || node.tag==='DropdownMenuItem' && click!=='handleOpenProfile' || node.tag==='DropdownMenuSeparator';
    if(file==='components/UserContextMenu.vue')return node.tag==='ContextMenuItem' && click!=='handleViewDetails' || node.tag==='ContextMenuSeparator';
    if(file==='components/dialogs/UserDialog/UserActionDropdown.vue'){
      if(node.tag==='template' && has(node,"userDialogCommand('Add Favorite')"))return true;
      const command=click.match(/onCommand\('([^']+)'\)/)?.[1];
      if(node.tag==='DropdownMenuItem' && (!command || !readCommands.has(command)))return true;
      return node.tag==='DropdownMenuSub' && !has(node,"onCommand('Copy Profile URL')") || node.tag==='DropdownMenuSeparator';
    }
    if(file==='components/dialogs/UserDialog/UserSummaryHeader.vue')return /^(toggleAvatarCopying|toggleAllowBooping|toggleSharedConnectionsOptOut|toggleDiscordFriendsOptOut|toggleReducedProfileAnimations|toggleBadgeVisibility|toggleBadgeShowcased)/.test(click) || node.tag==='DropdownMenuItem' && /toggleBadge/.test(click);
    if(file==='components/dialogs/UserDialog/UserDialogInfoTab.vue'){
      return node.tag==='div' && expr(node,'if')==='!hideUserMemos' || node.tag==='div' && node.props?.some(p=>p.type===6 && p.name==='class' && p.value?.content.includes('rounded-xl bg-(--profile-card) p-3')) && has(node,"t('dialog.user.info.vrcx_info')") ||
        node.tag==='Button' && has(node,'<Pencil') || node.tag==='Button' && click==='showEditProfileDialog';
    }
    return false;
  };
  let result=source.replace(template,removeTemplateNodes(template,drop));
  if(file==='views/FriendList/FriendList.vue'){
    result=result.replace("import { createColumns } from './columns.jsx';",`import { createColumns as nativeCreateColumns } from './columns.jsx';
    const createColumns=options=>nativeCreateColumns(options).filter(column=>!['bulkSelect','friendNumber','joinCount','timeTogether','lastSeen','unfriend'].includes(column.id));`)
      .replace("const defaultSorting = [{ id: 'friendNumber', desc: true }];","const defaultSorting = [{ id: 'displayName', desc: false }];")
      .replace(/,\s*'Memo'/g,'');
  }
  if(file==='views/Moderation/Moderation.vue')result=result.replace("import { createColumns } from './columns.jsx';",`import { createColumns as nativeCreateColumns } from './columns.jsx';
    const createColumns=options=>nativeCreateColumns(options).filter(column=>column.id!=='action');`);
  if(file==='views/Favorites/components/FavoritesFriendItem.vue')result=result.replace('<DropdownMenu v-else>','<DropdownMenu>');
  if(file==='components/dialogs/UserDialog/UserDialog.vue')result=result.replace('<TabsUnderline','<TabsUnderline class="flex-1 min-h-0"')
    .replace('return tabs;','return tabs.filter(tab=>tab.value!==\'Avatars\' || userDialog.value.id===currentUser.value.id);');
  if(file==='components/dialogs/UserDialog/UserDialogInfoTab.vue')result=result.replace('@click="isEditNoteAndMemoDialogVisible = true"','');
  if(file==='components/dialogs/UserDialog/UserSummaryHeader.vue')result=result.replace('@click="userDialog.ref.id === currentUser.id ? showEditProfileDialog() : undefined"','');
  if(file==='views/Charts/components/MutualFriends.vue'){
    result=result.replace("import { useLocalStorage } from '@vueuse/core';","import { useLocalStorage } from '@vueuse/core';\nimport { storageKey } from 'monika-adapter';")
      .replace("const EXCLUDED_FRIENDS_KEY = 'VRCX_MutualGraphExcludedFriends';","const EXCLUDED_FRIENDS_KEY = storageKey('VRCX_MutualGraphExcludedFriends');")
      .replace(/function promptEnableMutualFriendsSharing\(\) \{[\s\S]*?\n    \}/,"function promptEnableMutualFriendsSharing() { showStatusMessage(t('view.charts.mutual_friend.context_menu.user_opted_out')); }")
      .replace('<div id="chart" class="x-container">','<div id="monika-mutual-graph" class="x-container monika-mutual-page">')
      .replace('target="#chart"','target="#monika-mutual-graph"')
      .replace('mt-0 flex min-h-[calc(100vh-140px)] flex-col items-center justify-betweenpt-12','flex h-full min-h-0 flex-col items-center')
      .replace('mt-3 h-[calc(100vh-260px)] min-h-[520px] w-full flex-1 rounded-lg bg-transparent','mt-3 min-h-64 w-full flex-1 rounded-lg bg-transparent')
      .replace('<Button class="rounded-full" size="icon" variant="ghost">','<Button class="rounded-full" size="icon" variant="ghost" :aria-label="t(\'view.charts.mutual_friend.settings.title\')">')
      .replace('const availableHeight = window.innerHeight - 100;','const availableHeight = mutualGraphRef.value.parentElement.clientHeight;')
      .replace('mutualGraphResizeObserver.observe(mutualGraphRef.value);','mutualGraphResizeObserver.observe(mutualGraphRef.value.parentElement);')
      .replace('const graphNodeCount = ref(0);','let graphDisposed = false;\n    const graphNodeCount = ref(0);')
      .replace('onBeforeUnmount(() => {','onBeforeUnmount(() => {\n        graphDisposed = true;')
      .replace('graphMeta.value = meta;','if (graphDisposed) return;\n            graphMeta.value = meta;')
      .replace('if (!ok) return;','if (!ok || graphDisposed) return;')
      .replace('if (!mutualMap) return;','if (!mutualMap || graphDisposed) return;');
  }
  return result;
}

export function adaptChartsStore(source){
  return source.replace("import { defineStore } from 'pinia';","import { beginGraphSession, checkGraphSession } from 'monika-adapter';")
    .replace("export const useChartsStore = defineStore('Charts', () => {",'export function createChartsStore() {')
    .replace(/\}\);\s*$/,'}')
    .replace('async function fetchMutualGraph() {','async function fetchMutualGraph() {\n const graphSession=beginGraphSession();')
    .replace('const friend = friendSnapshot[index];','checkGraphSession(graphSession);\n const friend = friendSnapshot[index];')
    .replace('if (metaEntries.size > 0) {','checkGraphSession(graphSession);\n if (metaEntries.size > 0) {')
    .replace('async function fetchSingleFriendMutuals(friendId) {','async function fetchSingleFriendMutuals(friendId) {\n const graphSession=beginGraphSession();')
    .replace('await database.updateMutualsForFriend(friendId, mutualIds);','checkGraphSession(graphSession);\n await database.updateMutualsForFriend(friendId, mutualIds);')
    .replaceAll('const status = err?.status;','checkGraphSession(graphSession);\n const status = err?.status;')
    .replaceAll('await database.','checkGraphSession(graphSession); await database.');
}
