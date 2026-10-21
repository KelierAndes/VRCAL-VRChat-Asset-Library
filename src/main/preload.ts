import {contextBridge,ipcRenderer} from 'electron';
import type {AppTheme,AppLanguage,LibraryAPI,LibraryEvent} from '../shared/contracts';
// Sandbox preloads cannot require arbitrary local modules. Keep this allowlist aligned with THEME_IDS.
const requestedTheme=process.argv.find(value=>value.startsWith('--vrc-theme='))?.slice('--vrc-theme='.length);
const initialTheme:AppTheme=['nasa','swiss','x','x-light'].includes(requestedTheme??'')?requestedTheme as AppTheme:'nasa';
const requestedLanguage=process.argv.find(value=>value.startsWith('--vrc-language='))?.slice('--vrc-language='.length);
const initialLanguage:AppLanguage=['zh-CN','ja','en'].includes(requestedLanguage??'')?requestedLanguage as AppLanguage:'zh-CN';
const invoke=(method:string,...args:unknown[])=>ipcRenderer.invoke(`library:${method}`,...args);
const api:LibraryAPI={
 openCommunityLink:id=>invoke('openCommunityLink',id),copyCommunityGroup:()=>invoke('copyCommunityGroup'),
 initialTheme,initialLanguage,
 updateState:()=>invoke('updateState'),checkForUpdates:()=>invoke('checkForUpdates'),downloadUpdate:()=>invoke('downloadUpdate'),installUpdate:()=>invoke('installUpdate'),cancelUpdate:()=>invoke('cancelUpdate'),openUpdatePage:()=>invoke('openUpdatePage'),removeRoot:root=>invoke('removeRoot',root),
 snapshot:()=>invoke('snapshot'),list:q=>invoke('list',q),get:id=>invoke('get',id),
 scan:()=>invoke('scan'),cancelScan:()=>invoke('cancelScan'),annotate:(ids,patch)=>invoke('annotate',ids,patch),
 reveal:(id,memberPath)=>invoke('reveal',id,memberPath),copyPath:(id,memberPath)=>invoke('copyPath',id,memberPath),openSource:id=>invoke('openSource',id),
 files:id=>invoke('files',id),setCover:id=>invoke('setCover',id),enrich:(ids,retry)=>invoke('enrich',ids,retry),
 pauseEnrichment:()=>invoke('pauseEnrichment'),resumeEnrichment:()=>invoke('resumeEnrichment'),
 linkSource:(id,url)=>invoke('linkSource',id,url),acceptCandidate:(id,url)=>invoke('acceptCandidate',id,url),
 undoSource:token=>invoke('undoSource',token),searchBooth:(id,query)=>invoke('searchBooth',id,query),
 boothState:()=>invoke('boothState'),openBooth:tab=>invoke('openBooth',tab),chooseBoothDownloadDir:()=>invoke('chooseBoothDownloadDir'),revealBoothDownload:id=>invoke('revealBoothDownload',id),cancelBoothDownload:id=>invoke('cancelBoothDownload',id),retryBoothImport:id=>invoke('retryBoothImport',id),clearBoothSession:()=>invoke('clearBoothSession'),
 previewSource:(id,url)=>invoke('previewSource',id,url),loadCandidateCovers:ids=>invoke('loadCandidateCovers',ids),
 rejectCandidate:(id,url)=>invoke('rejectCandidate',id,url),restoreRejectedCandidates:id=>invoke('restoreRejectedCandidates',id),
 skipMatching:id=>invoke('skipMatching',id),restoreMatching:id=>invoke('restoreMatching',id),
 projectMaterials:(id,refresh)=>invoke('projectMaterials',id,refresh),
 projectFiles:(id,relative,offset)=>invoke('projectFiles',id,relative,offset),projectFileAction:(id,relative,action)=>invoke('projectFileAction',id,relative,action),
 importSources:id=>invoke('importSources',id),previewProjectImport:(asset,project,choice)=>invoke('previewProjectImport',asset,project,choice),executeProjectImport:token=>invoke('executeProjectImport',token),
 projectImportJobs:id=>invoke('projectImportJobs',id),cancelProjectImport:id=>invoke('cancelProjectImport',id),openProjectEditor:id=>invoke('openProjectEditor',id),chooseProject:()=>invoke('chooseProject'),chooseUnityEditor:id=>invoke('chooseUnityEditor',id),
 listCollections:()=>invoke('listCollections'),saveCollection:input=>invoke('saveCollection',input),updateCollectionMembers:(id,ids,mode)=>invoke('updateCollectionMembers',id,ids,mode),deleteCollection:id=>invoke('deleteCollection',id),
 listTags:()=>invoke('listTags'),mergeTags:(names,target)=>invoke('mergeTags',names,target),setTagAliases:(name,aliases)=>invoke('setTagAliases',name,aliases),updateTags:(ids,add,remove)=>invoke('updateTags',ids,add,remove),setViewPreferences:preferences=>invoke('setViewPreferences',preferences),undoMetadata:()=>invoke('undoMetadata'),
 backup:()=>invoke('backup'),restore:()=>invoke('restore'),chooseRoot:()=>invoke('chooseRoot'),
 chooseBackupDir:()=>invoke('chooseBackupDir'),chooseDataDir:()=>invoke('chooseDataDir'),openNetworkUrl:url=>invoke('openNetworkUrl',url),setZoom:factor=>invoke('setZoom',factor),checkProxy:()=>invoke('checkProxy'),
 setConcurrency:value=>invoke('setConcurrency',value),
 setOnlineEnabled:enabled=>invoke('setOnlineEnabled',enabled),
 onEvent:listener=>{const fn=(_e:Electron.IpcRendererEvent,event:LibraryEvent)=>listener(event);ipcRenderer.on('library:event',fn);return()=>ipcRenderer.removeListener('library:event',fn)}
};
contextBridge.exposeInMainWorld('library',api);
