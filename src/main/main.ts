import {acknowledgeUpdateStartup} from './update-receipt';
import {Updater} from './updater';
import {translate,normalizeLanguage,localizeDialogOptions} from '../shared/i18n';
import {app,BrowserWindow,ipcMain,dialog,clipboard,shell,protocol,net,Menu,session} from 'electron';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {Store,safeBoothDownloadPath} from './store';
import {Scanner} from './scanner';
import {assertSafeWrite,safeCoverPath,copyCover} from './safety';
import {EnrichmentQueue,publicHttpsUrl} from './online';
import {ProductPreview} from './preview';
import {BoothWorkspace,prepareBoothSessionMigration} from './booth-workspace';
import {matchingCatalog} from './matching-catalog';
import {assetLocation} from './asset-location';
import {importBoothDownload} from './booth-import';
import {canonicalSourceKey,searchClue,extractBoothIds} from './matching';
import {isOrganizationalAsset} from './organization';
import {inspectProjectMaterials,clearProjectMaterialCache} from './project-materials';
import {ProxyMonitor} from './proxy';
import {readLocation,writeLocation,rememberLibraryLocation,prepareSessionData,assertUserStorage,copyLibraryData} from './storage';
import type {BrowserCookieSnapshot} from './storage';
import {CATEGORIES,REVIEW_SORTS,THEME_IDS,LANGUAGE_IDS,normalizeTheme,THEME_BACKGROUNDS} from '../shared/contracts';
import type {AssetRecord,AssetQuery,LibraryEvent,ManualInfo,BoothTab} from '../shared/contracts';

const DEFAULT_ROOT='E:\\VRChat';
const legacyDir=path.join(process.env.LOCALAPPDATA || app.getPath('userData'),'VRChatAssetLibrary');
const testProfile=!!process.env.VRC_LIBRARY_DATA_DIR;
const launcherDir=process.env.PORTABLE_EXECUTABLE_DIR || (app.isPackaged?path.dirname(app.getPath('exe')):path.resolve(__dirname,'../../..'));
const locationFile=process.env.VRC_LIBRARY_LOCATION_FILE || path.join(launcherDir,'VRC-library-location.json');
const fallbackLocationFile=path.join(process.env.LOCALAPPDATA || app.getPath('userData'),'VRC-library-location.json');
const localLocation=readLocation(locationFile);
const location=localLocation.dataDir?localLocation:readLocation(fallbackLocationFile);
let dataDir=path.resolve(process.env.VRC_LIBRARY_DATA_DIR || location.dataDir || legacyDir);
const initialRoots=[process.env.VRC_LIBRARY_ROOT || DEFAULT_ROOT];
// Keep the original user library protected even when a test profile or another library is chosen.
function contained(parent:string,child:string){const rel=path.relative(path.resolve(parent),path.resolve(child));return !rel || (!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel))}
if(contained(DEFAULT_ROOT,dataDir))throw new Error('应用数据目录不能放在素材目录内。');
assertSafeWrite(dataDir,dataDir,[DEFAULT_ROOT,...initialRoots]);
app.setPath('userData',dataDir);
// Chromium captures these paths during ready. Changing them afterwards leaves
// local toolbars and cached images using a different profile from the library.
app.setPath('sessionData',prepareSessionData(dataDir,[DEFAULT_ROOT,...initialRoots]));
const crashDir=assertSafeWrite(path.join(dataDir,'crashes'),dataDir,[DEFAULT_ROOT,...initialRoots]);fs.mkdirSync(crashDir,{recursive:true});app.setPath('crashDumps',crashDir);
protocol.registerSchemesAsPrivileged([{scheme:'library-cover',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}}]);
app.setName('VRC素材库');
let window:BrowserWindow|null=null;
let closing=false;
let migrating=false;
let proxy:ProxyMonitor;
let preview:ProductPreview;
let booth:BoothWorkspace;let sourceChanges:Promise<void>=Promise.resolve();
let updater:Updater;
let store:Store;let scanner:Scanner;let queue:EnrichmentQueue;let debounce:ReturnType<typeof setTimeout>|undefined;
function emit(event:LibraryEvent){if(!closing && window && !window.isDestroyed())window.webContents.send('library:event',event)}
function changed(){if(migrating||debounce)return;debounce=setTimeout(()=>{debounce=undefined;emit({type:'change'})},150)}
function uiLanguage(){return normalizeLanguage(store?.settings().language)}
function refreshTheme(){window?.setTitle(translate('VRC素材库',uiLanguage()));window?.setBackgroundColor(THEME_BACKGROUNDS[normalizeTheme(store.settings().theme)]);preview?.refreshTheme();booth?.refreshTheme()}
function getAsset(id:unknown):AssetRecord{if(typeof id!=='string')throw new Error('请选择一个素材。');const item=store.get(id);if(!item)throw new Error('素材不存在，请刷新列表。');return item}
function getRawAsset(id:unknown):AssetRecord{if(typeof id!=='string')throw new Error('请选择一个素材。');const item=store.getRaw(id);if(!item)throw new Error('素材不存在，请刷新列表。');return item}
function matchingAsset(id:string):AssetRecord|null {return matchingCatalog(store).get(id)}
function protectedRoots(){const settings=store?.settings();return [...new Set([DEFAULT_ROOT,...(settings?.roots??initialRoots),...(settings?.detachedRoots??[])])]}
async function prepareCookieMigration(directory:string,roots:string[]):Promise<BrowserCookieSnapshot[]>{const snapshot=await prepareBoothSessionMigration(directory,roots);return snapshot?[snapshot]:[]}
function boothReadRoots(asset:AssetRecord):string[]{const roots=new Set<string>();for(const id of asset.members?.map(member=>member.id)||[asset.id]){const raw=store.getRaw(id);if(raw?.group==='BOOTH 下载')try{roots.add(path.dirname(safeBoothDownloadPath(raw.path,dataDir,protectedRoots())))}catch{/* Invalid references do not widen the read scope. */}}return [...roots]}
async function refreshDownloadAvailability(){let updated=false;for(const asset of store.all()){if(closing||migrating)break;if(asset.group!=='BOOTH 下载')continue;try{const file=safeBoothDownloadPath(asset.path,dataDir,protectedRoots()),stat=await fsp.lstat(file);if(!closing&&!migrating)updated=store.updateAvailability(asset.id,!stat.isFile()||stat.isSymbolicLink())||updated}catch(error:any){if(['ENOENT','ENOTDIR'].includes(error.code)&&!closing&&!migrating)updated=store.updateAvailability(asset.id,true)||updated}}if(updated)changed()}
function rememberLocation(selected:string,backupDir?:string,roots=protectedRoots()){
 const config={dataDir:selected,backupDir};
 if(testProfile){if(process.env.VRC_LIBRARY_LOCATION_FILE)writeLocation(locationFile,config,roots);return}
 rememberLibraryLocation(locationFile,fallbackLocationFile,config,roots);
}
function setupServices(){
 updater?.close();
 updater=new Updater({version:app.getVersion(),dataDir,roots:protectedRoots,executable:process.env.PORTABLE_EXECUTABLE_FILE,packaged:app.isPackaged,canNetwork:()=>!closing&&!migrating&&store.settings().onlineEnabled&&!process.env.VRC_LIBRARY_NO_NETWORK,fetch:(url,init)=>net.fetch(url,init),onChange:changed,quit:()=>app.quit()});
 preview?.close();
 booth?.close();
 scanner=new Scanner(store,p=>{emit({type:'scan',progress:p});changed()});
 proxy=new ProxyMonitor({resolveProxy:url=>session.defaultSession.resolveProxy(url),fetch:(url,init)=>net.fetch(url,init),onChange:changed});
 proxy.setEnabled(store.settings().onlineEnabled && !process.env.VRC_LIBRARY_NO_NETWORK);
 const catalog=matchingCatalog(store);
 queue=new EnrichmentQueue({dataDir,roots:protectedRoots,concurrency:()=>store.settings().downloadConcurrency||3,canonicalId:id=>store.get(id)?.id,all:catalog.all,get:catalog.get,updateOnline:(id,patch)=>{if(!closing){catalog.updateOnline(id,patch);changed()}},fetch:(url,init)=>net.fetch(url,init),onProgress:progress=>{proxy.observeTransfer(progress);emit({type:'queue',progress})},onChange:changed});
 preview=new ProductPreview({parent:()=>window,getTheme:()=>store.settings().theme||'nasa',getLanguage:()=>store.settings().language,validate:(id,url)=>{if(!store.settings().onlineEnabled)throw new Error('请先开启联网后预览商品网页。');const item=getAsset(id),candidate=item.online.candidates?.find(c=>c.url===url);if(!candidate&&item.online.url!==url)throw new Error('只能预览当前候选或已登记商品来源。');return {title:candidate?.title||item.online.title||item.name,canConfirm:!!candidate};},accept:confirmCandidate});
 booth=new BoothWorkspace({parent:()=>window,getTheme:()=>store.settings().theme||'nasa',getLanguage:()=>store.settings().language,dataDir,roots:protectedRoots,getDownloadDir:()=>store.settings().boothDownloadDir,canNetwork:()=>!closing&&!migrating&&store.settings().onlineEnabled&&!process.env.VRC_LIBRARY_NO_NETWORK,validateAsset:id=>{const item=getAsset(id);if(item.kind==='unity-project')throw new Error('请选择素材后搜索商品。');return {title:item.manual.title||item.name}},applyProduct:(id,url)=>changeSource(id,url,false),onChanged:changed,onDownloaded:async(file,sourceItem)=>{
  if(closing||migrating)throw new Error('资料库正在关闭或迁移；文件已保存，可稍后重试导入。');
  const imported=await importBoothDownload(store,file,sourceItem,path.dirname(file));changed();
  if(store.settings().onlineEnabled&&!process.env.VRC_LIBRARY_NO_NETWORK)await queue.enqueue([imported.assetId]);return imported;
 }});
}
function editSource<T>(action:()=>Promise<T>):Promise<T>{const pending=sourceChanges.then(()=>{if(migrating||closing)throw new Error('资料库正在关闭或迁移。');return action()});sourceChanges=pending.then(()=>undefined,()=>undefined);return pending;}
function changeSource(id:string,url:string,candidate:boolean):Promise<void>{return editSource(async()=>{
 const item=getAsset(id);if(item.kind==='unity-project')throw new Error('工程不参与商品匹配。');if(!store.settings().onlineEnabled)throw new Error('请先开启联网补全。');if(typeof url!=='string'||url.length>2048)throw new Error('商品网址无效。');const source=publicHttpsUrl(url).href;
 if(candidate&&!item.online.candidates?.some(value=>value.url===source))throw new Error('请选择当前候选商品。');const ids=item.members?.map(member=>member.id)||[item.id];
 // Supersede the old workers before taking the undo snapshot. All subsequent callbacks recheck cancellation.
 queue.exclude(ids);store.beginSourceChange(ids,source,item.id,item.manual.title||item.name);
 try{for(const memberId of ids){if(!candidate){const raw=getRawAsset(memberId);store.updateOnline(memberId,{rejectedUrls:(raw.online.rejectedUrls||[]).filter(value=>canonicalSourceKey(value)!==canonicalSourceKey(source))})}}await queue.acceptCandidate(item.id,source,true)}finally{changed()}
})}
function confirmCandidate(id:string,url:string):Promise<void>{return changeSource(id,url,true)}
async function pickDataLocation(parent?:BrowserWindow):Promise<string|null>{
 const options:Electron.OpenDialogOptions={title:'选择资料库保存的上级文件夹（C盘之外）',defaultPath:path.dirname(DEFAULT_ROOT),properties:['openDirectory','createDirectory']};
 const result=parent?await dialog.showOpenDialog(parent,localizeDialogOptions(options,uiLanguage())):await dialog.showOpenDialog(localizeDialogOptions(options,uiLanguage()));if(result.canceled)return null;
 const target=path.join(await fsp.realpath(result.filePaths[0]),'VRChatAssetLibrary');return assertUserStorage(target,protectedRoots(),testProfile);
}
async function initializeLocation():Promise<boolean>{
 if(testProfile)return true;
 if(location.dataDir){assertUserStorage(dataDir,protectedRoots());if(!fs.existsSync(path.join(dataDir,'library.sqlite')))throw new Error('已登记的资料库无法读取，请确认保存资料库的磁盘已连接。原记录未被重建或覆盖。');return true}
 const target=await pickDataLocation();if(!target)return false;
 if(!fs.existsSync(path.join(target,'library.sqlite'))&&fs.existsSync(path.join(legacyDir,'library.sqlite'))){
  const previous=new Store(legacyDir,initialRoots),settings=previous.settings(),roots=[DEFAULT_ROOT,...settings.roots,...(settings.detachedRoots??[])];previous.close();const snapshots=await prepareCookieMigration(legacyDir,roots);await copyLibraryData(legacyDir,target,roots,false,snapshots);
 }
 if(!fs.existsSync(path.join(target,'library.sqlite')))new Store(target,initialRoots).close();
 rememberLocation(target,location.backupDir);
 // The folder picker requires ready, so activate the chosen profile in a fresh
 // process instead of changing Chromium storage underneath a running session.
 app.relaunch({execPath:process.env.PORTABLE_EXECUTABLE_FILE || app.getPath('exe')});return false;
}
async function selectBackupLocation():Promise<boolean>{
 const result=await dialog.showOpenDialog(window!,localizeDialogOptions({title:'选择备份保存位置（C盘之外）',defaultPath:store.settings().backupDir || path.dirname(dataDir),properties:['openDirectory','createDirectory']},uiLanguage()));if(result.canceled)return false;
 const target=assertUserStorage(await fsp.realpath(result.filePaths[0]),protectedRoots(),testProfile);store.saveSettings({backupDir:target});rememberLocation(dataDir,target);changed();return true;
}
async function ensureBackupLocation():Promise<string|null>{
 const saved=store.settings().backupDir;if(saved){try{return assertUserStorage(saved,protectedRoots(),testProfile)}catch{/* a legacy C location must be reselected */}}
 return await selectBackupLocation()?store.settings().backupDir!:null;
}
function applyZoom(factor:number):number{if(!Number.isFinite(factor))throw new Error('缩放比例无效。');const zoom=Math.max(0.67,Math.min(2,Math.round(factor*100)/100));store.saveSettings({uiZoom:zoom});window?.webContents.setZoomFactor(zoom);changed();return zoom}
function parseIds(input:unknown):string[]{if(!Array.isArray(input)||input.length>5000||input.some(x=>typeof x!=='string'))throw new Error('素材选择无效。');return input as string[]}
function expandedIds(input:unknown):string[]{return [...new Set(parseIds(input).flatMap(id=>getAsset(id).members?.map(member=>member.id)||[id]))]}
function parsePatch(input:unknown):ManualInfo{
 if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('标注内容无效。');
 const p=input as Record<string,unknown>;const result:ManualInfo={};
 for(const field of ['title','notes'] as const){if(p[field]!==undefined){if(typeof p[field]!=='string'||p[field].length>(field==='notes'?20000:1000))throw new Error('文字过长。');result[field]=p[field]}}
 if(p.category!==undefined){if(!CATEGORIES.includes(p.category as any))throw new Error('分类无效。');result.category=p.category as ManualInfo['category']}
 for(const field of ['tags','avatars','relatedIds'] as const){if(p[field]!==undefined){if(!Array.isArray(p[field])||p[field].length>200||p[field].some(x=>typeof x!=='string'||x.length>300))throw new Error('标签或关联内容无效。');result[field]=[...new Set(p[field] as string[])]}}
 if(p.favorite!==undefined){if(typeof p.favorite!=='boolean')throw new Error('收藏状态无效。');result.favorite=p.favorite}
 if(p.projectStatus!==undefined){if(!['制作中','已完成'].includes(p.projectStatus as string))throw new Error('工程状态无效。');result.projectStatus=p.projectStatus as ManualInfo['projectStatus']}
 return result;
}
async function performScan(){await scanner.scan();if(closing)return;await refreshDownloadAvailability();changed();if(store.settings().onlineEnabled && !process.env.VRC_LIBRARY_NO_NETWORK)await queue.enqueue();}
function handle(name:string,fn:(...args:any[])=>any){ipcMain.handle(`library:${name}`,async(event,...args)=>{try{if(!window||event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame)throw new Error('操作来源无效。');if(migrating)throw new Error('正在更改资料库位置，请稍候。');return await fn(...args)}catch(error){if(error instanceof Error)throw new Error(translate(error.message,uiLanguage()));throw error}})}
function registerHandlers(){
 handle('snapshot',()=>({stats:store.stats(),scan:scanner.progress(),queue:queue.progress,settings:store.settings(),proxy:proxy.status,undoAvailable:store.hasUndo(),sourceUndo:store.sourceUndoInfo(),warnings:store.recoveryWarnings.slice(0,100)}));
 handle('list',(query:AssetQuery={})=>store.list(query));handle('get',(id:string)=>store.get(id));
 handle('scan',performScan);handle('cancelScan',()=>scanner.cancel());
 handle('annotate',(ids:unknown,patch:unknown)=>{const clean=parsePatch(patch);const views=parseIds(ids).map(getAsset);const shared={...clean};delete shared.title;delete shared.notes;
  store.updateManual([...new Set(views.flatMap(a=>a.members?.map(m=>m.id)||[a.id]))],shared);
  const singular:ManualInfo={};if(clean.title!==undefined)singular.title=clean.title;if(clean.notes!==undefined)singular.notes=clean.notes;if(Object.keys(singular).length)store.updateManual([...new Set(views.map(a=>a.id))],singular);changed()});
 handle('reveal',async(id:string,requested?:string)=>{const target=requested===undefined?getRawAsset(id).path:assetLocation(getAsset(id),requested);await fsp.access(target);shell.showItemInFolder(target)});
 handle('copyPath',(id:string,requested?:string)=>clipboard.writeText(requested===undefined?getRawAsset(id).path:assetLocation(getAsset(id),requested)));
 handle('openSource',async(id:string)=>{const url=getAsset(id).online.url;if(!url)throw new Error('还没有商品来源链接。');const parsed=new URL(url);if(parsed.protocol!=='https:'||parsed.username||parsed.password)throw new Error('商品链接无效。');await shell.openExternal(parsed.href)});
 handle('files',(id:string)=>{const asset=getAsset(id);return scanner.files(asset.id,boothReadRoots(asset))});
 handle('setCover',async(id:string)=>{
  const item=getAsset(id);const result=await dialog.showOpenDialog(window!,localizeDialogOptions({title:item.kind==='unity-project'?'选择工程截图':'选择素材封面',properties:['openFile'],filters:[{name:'图片',extensions:['png','jpg','jpeg','webp','gif','bmp']}]},uiLanguage()));
  if(result.canceled)return false;const coverFile=await copyCover(result.filePaths[0],dataDir,protectedRoots());store.updateManual(item.members?.map(m=>m.id)||[item.id],{coverFile});changed();return true;
 });
 handle('enrich',async(ids?:unknown,retry?:boolean)=>{if(!store.settings().onlineEnabled)throw new Error('请先开启联网补全。');await queue.enqueue(ids===undefined?undefined:expandedIds(ids),!!retry)});
 handle('loadCandidateCovers',async(ids:unknown)=>{if(!store.settings().onlineEnabled)throw new Error('请先开启联网补全。');await queue.enqueueCandidateCovers(expandedIds(ids))});
 handle('pauseEnrichment',()=>queue.pause());handle('resumeEnrichment',async()=>{if(!store.settings().onlineEnabled)throw new Error('请先开启联网补全。');await queue.enqueue();await queue.resume()});
 handle('linkSource',(id:string,url:string)=>changeSource(id,url,false));
 handle('acceptCandidate',confirmCandidate);
 handle('undoSource',(token:string)=>editSource(async()=>{if(typeof token!=='string'||token.length>100)throw new Error('撤回记录无效。');const ids=store.sourceUndoIds(token);if(!ids)throw new Error('最近的来源确认已变化，请刷新后重试。');queue.exclude(ids);const restored=store.undoSource(token);if(restored){try{if(!store.settings().onlineEnabled||process.env.VRC_LIBRARY_NO_NETWORK)queue.pause();for(const id of new Set(ids.map(id=>store.get(id)?.id).filter((id):id is string=>!!id))){const asset=matchingAsset(id);if(asset?.online.status==='pending'&&asset.manual.sourceUrl)await queue.acceptCandidate(id,asset.manual.sourceUrl,true)}}finally{changed()}}return restored}));
 handle('searchBooth',async(id:string,query:string)=>{getAsset(id);if(typeof query!=='string'||!query.trim()||query.length>300)throw new Error('请输入 1 至 300 字的搜索词。');const ids=extractBoothIds(query),term=/^(?:https:\/\/|\d{1,12}$)/i.test(query.trim())?query.trim():ids.length===1?ids[0]:searchClue(query).query;await booth.open({tab:'search',assetId:id,query:term||query.trim()})});
 handle('boothState',()=>booth.snapshot());
 handle('openBooth',async(tab:BoothTab)=>{if(!['login','favorites','gifts','library'].includes(tab))throw new Error('BOOTH 页面无效。');await booth.open({tab})});
 handle('chooseBoothDownloadDir',async()=>{const result=await dialog.showOpenDialog(window!,localizeDialogOptions({title:'选择 BOOTH 下载保存文件夹（C盘之外）',defaultPath:store.settings().boothDownloadDir||dataDir,properties:['openDirectory','createDirectory']},uiLanguage()));if(result.canceled)return false;const target=assertUserStorage(await fsp.realpath(result.filePaths[0]),protectedRoots(),testProfile);store.saveSettings({boothDownloadDir:target});changed();return true});
 handle('revealBoothDownload',async(id:string)=>{if(typeof id!=='string')throw new Error('下载记录无效。');const file=booth.downloadPath(id);if(!file)throw new Error('下载文件还未完成或无法找到。');await fsp.access(file);shell.showItemInFolder(file)});
 handle('cancelBoothDownload',(id:string)=>{if(typeof id!=='string')throw new Error('下载记录无效。');booth.cancelDownload(id);changed()});
 handle('retryBoothImport',async(id:string)=>{if(typeof id!=='string')throw new Error('下载记录无效。');await booth.retryImport(id);changed()});
 handle('clearBoothSession',async()=>{await booth.clearSession();changed()});
 handle('previewSource',async(id:string,url:string)=>{if(typeof url!=='string'||url.length>2048)throw new Error('商品网址无效。');await preview.open(id,publicHttpsUrl(url).href)});
 handle('rejectCandidate',(id:string,url:string)=>{const asset=getAsset(id),source=publicHttpsUrl(url).href,key=canonicalSourceKey(source);if(!asset.online.candidates?.some(candidate=>canonicalSourceKey(candidate.url)===key))throw new Error('请选择当前候选商品。');for(const memberId of asset.members?.map(member=>member.id)||[asset.id]){const raw=getRawAsset(memberId);store.updateOnline(memberId,{rejectedUrls:[...new Set([...(raw.online.rejectedUrls||[]),source])],candidates:(raw.online.candidates||[]).filter(candidate=>canonicalSourceKey(candidate.url)!==key),message:'已排除此商品；后续匹配会记住你的选择，可随时恢复排除记录'});}changed()});
 handle('restoreRejectedCandidates',async(id:string)=>{const ids=expandedIds([id]);for(const memberId of ids)store.updateOnline(memberId,{rejectedUrls:[],status:'pending',message:'已恢复排除记录，等待重新匹配'});if(store.settings().onlineEnabled&&!process.env.VRC_LIBRARY_NO_NETWORK)await queue.enqueue(ids,true);changed()});
 handle('listCollections',()=>store.listCollections());
 handle('skipMatching',(id:string)=>{const asset=getAsset(id);if(asset.kind==='unity-project')throw new Error('工程不参与商品匹配。');const ids=expandedIds([id]);store.updateManual(ids,{matchingMode:'manual'});queue.exclude(ids);changed()});
 handle('restoreMatching',(id:string)=>{const asset=getAsset(id);if(asset.kind==='unity-project')throw new Error('工程不参与商品匹配。');store.updateManual(expandedIds([id]),{matchingMode:'auto'});changed()});
 handle('projectMaterials',async(id:string,refresh=false)=>{if(typeof refresh!=='boolean')throw new Error('刷新选项无效。');const project=getAsset(id);if(project.kind!=='unity-project')throw new Error('请选择一个 Unity 工程。');if(refresh)clearProjectMaterialCache(project.path);const catalog=store.list({view:'materials',limit:5000});const result=await inspectProjectMaterials(project,catalog.items,store.settings().roots);if(catalog.total>catalog.items.length){result.truncated=true;result.warnings.push('素材库较大，本次只核对前 5,000 个素材；未覆盖全部来源包。')}return result;});
 handle('saveCollection',(input:unknown)=>{const result=store.saveCollection(input as any);changed();return result});
 handle('updateCollectionMembers',(id:string,ids:unknown,mode:'add'|'remove')=>{if(mode!=='add'&&mode!=='remove')throw new Error('集合操作无效。');store.updateCollectionMembers(id,expandedIds(ids),mode);changed()});
 handle('deleteCollection',(id:string)=>{store.deleteCollection(id);changed()});
 handle('listTags',()=>store.listTags());
 handle('mergeTags',(names:unknown,target:string)=>{store.mergeTags(names as any,target);changed()});
 handle('setTagAliases',(name:string,aliases:unknown)=>{store.setTagAliases(name,aliases as any);changed()});
 handle('updateTags',(ids:unknown,add:unknown,remove:unknown)=>{store.updateTags(expandedIds(ids),add as any,remove as any);changed()});
 handle('setViewPreferences',(preferences:unknown)=>{if(!preferences||typeof preferences!=='object'||Array.isArray(preferences))throw new Error('显示设置无效。');const value=preferences as any;if(Object.keys(value).some(key=>!['viewMode','density','coverFit','reviewSort','theme','language'].includes(key))||value.viewMode!==undefined&&!['grid','list'].includes(value.viewMode)||value.density!==undefined&&!['compact','standard','spacious'].includes(value.density)||value.coverFit!==undefined&&!['contain','cover'].includes(value.coverFit)||value.reviewSort!==undefined&&!REVIEW_SORTS.includes(value.reviewSort)||Object.hasOwn(value,'theme')&&!THEME_IDS.includes(value.theme)||Object.hasOwn(value,'language')&&!LANGUAGE_IDS.includes(value.language))throw new Error('显示设置无效。');const settings=store.saveSettings(value);if(Object.hasOwn(value,'theme')||Object.hasOwn(value,'language'))refreshTheme();changed();return settings});
 handle('undoMetadata',()=>{const restored=store.undoMetadata();if(restored)changed();return restored});
 handle('setOnlineEnabled',async(enabled:boolean)=>{if(typeof enabled!=='boolean')throw new Error('设置无效。');store.saveSettings({onlineEnabled:enabled});proxy.setEnabled(enabled);booth.networkChanged();if(enabled){await proxy.inspect();await queue.resume();await queue.enqueue()}else{updater.cancel();preview.close();booth.close();queue.pause()}changed()});
 handle('setZoom',applyZoom);handle('checkProxy',()=>proxy.check());
 handle('setConcurrency',(value:number)=>{if(!Number.isInteger(value)||value<1||value>6)throw new Error('并发数量必须是 1 到 6 的整数。');store.saveSettings({downloadConcurrency:value});queue.setConcurrency(value);changed();return value});
 handle('openNetworkUrl',async(url:string)=>{if(typeof url!=='string'||url.length>4000)throw new Error('网址无效。');const visible=[queue.progress.transfer?.url,...(queue.progress.activeTransfers||[]).map(x=>x.url),...(queue.progress.recentTransfers||[]).map(x=>x.url)];if(!visible.includes(url))throw new Error('只能打开当前网络任务中的链接。');await shell.openExternal(publicHttpsUrl(url).href)});
 handle('chooseBackupDir',selectBackupLocation);
 handle('chooseDataDir',async()=>{
  const target=await pickDataLocation(window!);if(!target||path.resolve(target).toLowerCase()===dataDir.toLowerCase())return false;
  updater.cancel();
  if(fs.existsSync(target)&&(await fsp.readdir(target)).length)throw new Error('目标资料库文件夹已有内容，请选择一个新位置。');
  const old=dataDir,settings=store.settings();await sourceChanges;await booth.shutdown();const snapshots=await prepareCookieMigration(old,[DEFAULT_ROOT,...settings.roots,...(settings.detachedRoots??[])]);migrating=true;preview.close();if(debounce){clearTimeout(debounce);debounce=undefined}
  proxy.setEnabled(false);queue.stop();scanner.cancel();await Promise.all([queue.waitIdle(),scanner.waitIdle()]);store.close();
  try{
   await copyLibraryData(old,target,[DEFAULT_ROOT,...settings.roots,...(settings.detachedRoots??[])],testProfile,snapshots);rememberLocation(target,settings.backupDir,[DEFAULT_ROOT,...settings.roots,...(settings.detachedRoots??[])]);
   if(process.env.VRC_LIBRARY_NO_RELAUNCH){dataDir=target;store=new Store(dataDir,settings.roots);setupServices();migrating=false;changed();return true}
   if(testProfile)process.env.VRC_LIBRARY_DATA_DIR=target;
   app.relaunch({execPath:process.env.PORTABLE_EXECUTABLE_FILE || app.getPath('exe')});setTimeout(()=>app.quit(),250);return true;
  }catch(error){store=new Store(old,settings.roots);setupServices();migrating=false;if(settings.onlineEnabled&&!process.env.VRC_LIBRARY_NO_NETWORK){await queue.resume()}changed();throw error}
 });
 handle('removeRoot',async(root:unknown)=>{
  if(scanner.progress().running)throw new Error('请先停止扫描，再修改素材目录。');
  if(typeof root!=='string'||!path.isAbsolute(root)||!store.settings().roots.some(value=>path.resolve(value).toLowerCase()===path.resolve(root).toLowerCase()))throw new Error('素材目录未登记。');
  const affected=store.all().filter(asset=>contained(root,asset.path)).flatMap(asset=>asset.members?.map(member=>member.id)||[asset.id]);queue.exclude(affected);store.removeRoot(root);preview.close();changed();return true;
 });
 handle('updateState',()=>updater.state());
 handle('checkForUpdates',()=>updater.check());
 handle('downloadUpdate',()=>updater.download());
 handle('cancelUpdate',()=>updater.cancel());
 handle('openUpdatePage',()=>shell.openExternal('https://github.com/NecoAya/VRCAL-VRChat-Asset-Library/releases/latest'));
 handle('installUpdate',async()=>{
  if(scanner.progress().running||queue.progress.running||booth.snapshot().downloads.some(value=>value.state==='downloading'))throw new Error('请先停止扫描、联网补全和下载，再安装更新。');
  if(updater.state().status!=='ready')throw new Error('请先下载并校验更新。');
  const answer=await dialog.showMessageBox(window!,localizeDialogOptions({type:'question',title:'重启并更新',message:'现在关闭程序并安装已校验的更新？',detail:'更新只替换当前免安装程序，资料库与原素材保持原样。更新失败时会尝试还原旧程序。',buttons:['重启并更新','取消'],defaultId:1,cancelId:1,noLink:true},uiLanguage()));
  if(answer.response!==0)return false;return updater.install();
 });
 handle('chooseRoot',async()=>{
  if(scanner.progress().running)throw new Error('请先停止扫描，再修改素材目录。');
  const result=await dialog.showOpenDialog(window!,localizeDialogOptions({title:'添加素材目录',defaultPath:DEFAULT_ROOT,properties:['openDirectory']},uiLanguage()));if(result.canceled)return false;
  const root=await fsp.realpath(result.filePaths[0]);if(contained(root,dataDir)||store.settings().backupDir&&contained(root,store.settings().backupDir!))throw new Error('此母目录包含资料库或备份位置。请先在设置中将资料库和备份迁移到母目录之外，再添加；原素材不需要移动。');
  const roots=store.settings().roots;if(roots.some(x=>contained(x,root))&&store.isPathActive(root))throw new Error('此文件夹已包含在素材范围内，无需再次添加。');
  const nextRoots=[...roots.filter(value=>!contained(root,value)),root];store.saveSettings({roots:nextRoots});changed();setTimeout(()=>void performScan().catch(error=>emit({type:'scan',progress:{running:false,found:0,current:'',errors:[error.message]}})),0);return true;
 });
 handle('backup',async()=>{
  const folder=await ensureBackupLocation();if(!folder)return null;
  const result=await dialog.showSaveDialog(window!,localizeDialogOptions({title:'备份分类、备注和封面',defaultPath:path.join(folder,`VRC素材库-${new Date().toLocaleDateString('sv-SE')}.vrclib.json`),filters:[{name:'素材库备份',extensions:['vrclib.json','json']}]},uiLanguage()));
  if(result.canceled||!result.filePath)return null;
  const target=assertUserStorage(result.filePath,protectedRoots(),testProfile);
  store.exportData(target);store.saveSettings({backupDir:path.dirname(target)});rememberLocation(dataDir,path.dirname(target));changed();return target;
 });
 handle('restore',async()=>{
  if(scanner.progress().running)throw new Error('请先停止扫描，再恢复资料库。');
  const result=await dialog.showOpenDialog(window!,localizeDialogOptions({title:'恢复素材库备份',properties:['openFile'],filters:[{name:'素材库备份',extensions:['json']}]},uiLanguage()));if(result.canceled)return false;
  const stat=await fsp.stat(result.filePaths[0]);if(stat.size>512*1024*1024)throw new Error('备份文件超过 512 MB。');
  const contents=JSON.parse(await fsp.readFile(result.filePaths[0],'utf8'));
  if(contents.format!=='vrchat-asset-library'||![1,2].includes(contents.version)||!Array.isArray(contents.assets))throw new Error('不是有效的素材库备份。');
  const result2=await dialog.showMessageBox(window!,localizeDialogOptions({type:'question',title:'恢复资料库',message:'合并恢复备份中的分类、备注和封面？',detail:'会更新备份里对应的资料库记录，保留现有的其他记录。原素材保持原样；当前资料库会先自动备份。',buttons:['恢复','取消'],defaultId:1,cancelId:1},uiLanguage()));if(result2.response!==0)return false;
  const backup=await ensureBackupLocation();if(!backup)return false;
  await sourceChanges;await booth.shutdown();preview.close();queue.pause();scanner.cancel();await Promise.all([queue.waitIdle(),scanner.waitIdle()]);store.exportData(assertUserStorage(path.join(backup,`before-restore-${Date.now()}.json`),protectedRoots(),testProfile));
  store.importData(result.filePaths[0]);queue.exclude(store.all().map(asset=>asset.id));store.saveSettings({backupDir:backup});rememberLocation(dataDir,backup);window?.webContents.setZoomFactor(store.settings().uiZoom||1);refreshTheme();changed();return true;
 });
}
async function createWindow(){
 window=new BrowserWindow({width:1480,height:940,minWidth:980,minHeight:660,backgroundColor:THEME_BACKGROUNDS[normalizeTheme(store.settings().theme)],title:translate('VRC素材库',uiLanguage()),icon:path.resolve(__dirname,'../../../assets/library.png'),autoHideMenuBar:true,show:false,
  webPreferences:{preload:path.join(__dirname,'preload.js'),additionalArguments:['--vrc-theme='+normalizeTheme(store.settings().theme),'--vrc-language='+uiLanguage()],contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}});
 window.setMenu(null);window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',event=>event.preventDefault());
 window.webContents.on('context-menu',(_event,params)=>{if(params.isEditable)Menu.buildFromTemplate([{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{type:'separator'},{role:'selectAll'}]).popup({window:window!})});
 window.once('ready-to-show',()=>{if(!process.env.VRC_LIBRARY_TEST_HIDDEN)window?.show()});
 await window.loadFile(path.resolve(__dirname,'../../renderer/index.html'));
 window.webContents.setZoomFactor(store.settings().uiZoom||1);
 await proxy.inspect();
 if(process.env.VRC_LIBRARY_SMOKE){
  const report=assertSafeWrite(path.join(dataDir,'smoke-ready.json'),dataDir,[DEFAULT_ROOT,...store.settings().roots]);
  await fsp.writeFile(report,JSON.stringify({version:app.getVersion(),electron:process.versions.electron,node:process.versions.node,packaged:app.isPackaged,stats:store.stats(),sqlite:true}));
  if(process.env.VRC_LIBRARY_SMOKE_EXIT)setTimeout(()=>app.quit(),1200);
 }
 if(process.env.VRC_LIBRARY_NO_NETWORK)queue.pause();else if(store.settings().onlineEnabled && !queue.progress.paused){await queue.resume();await queue.enqueue()}
 if(!process.env.VRC_LIBRARY_NO_AUTOSCAN && (store.stats().total===0||store.all().some(a=>!a.fileIdentity||a.kind!=='unity-project'&&(!Array.isArray(a.localEvidence)||!Array.isArray(a.localNameHints)))))setTimeout(()=>void performScan().catch(e=>emit({type:'scan',progress:{running:false,found:0,current:'',errors:[e.message]}})),700);
}
const primary=app.requestSingleInstanceLock();
if(!primary)app.quit();
app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.show();window.focus()}});
if(primary)app.whenReady().then(async()=>{
 if(!await initializeLocation()){app.quit();return}
 store=new Store(dataDir,initialRoots);
 rememberLocation(dataDir,store.settings().backupDir);
 store.introduceXTheme();
 setupServices();
 protocol.handle('library-cover',async request=>{
  try{const url=new URL(request.url);if(url.hostname!=='cache')return new Response('',{status:404});const file=safeCoverPath(dataDir,decodeURIComponent(url.pathname.slice(1)));const actual=await fsp.realpath(file);const cache=await fsp.realpath(path.join(dataDir,'cache'));if(!contained(cache,actual))return new Response('',{status:403});return net.fetch(pathToFileURL(actual).href)}catch{return new Response('',{status:404})}
 });
 registerHandlers();await refreshDownloadAvailability();await createWindow();
 try{await acknowledgeUpdateStartup(dataDir,protectedRoots(),app.getVersion())}catch(error){console.error(translate('更新启动确认无效；将保留或恢复原版本。',uiLanguage()),error instanceof Error?error.message:String(error))}
}).catch(error=>{dialog.showErrorBox('素材库启动失败',error instanceof Error?error.message:String(error));app.quit()});
app.on('window-all-closed',()=>app.quit());
let exitReady=false;
app.on('before-quit',event=>{if(exitReady)return;event.preventDefault();closing=true;updater?.close();preview?.close();scanner?.cancel();if(!migrating){proxy?.setEnabled(false);queue?.stop()}void Promise.allSettled([sourceChanges,booth?.shutdown(),queue?.waitIdle(),scanner?.waitIdle()]).then(()=>{exitReady=true;app.quit()})});
