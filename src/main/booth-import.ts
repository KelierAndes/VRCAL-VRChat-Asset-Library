import fsp from 'node:fs/promises';
import path from 'node:path';
import type {BigIntStats} from 'node:fs';
import type {AssetKind,AssetRecord,AvatarEvidence,FileListing} from '../shared/contracts';
import {Store} from './store';
import {inferAvatars,inferCategory,isAvatarName} from './hints';
import {boothProductId,canonicalSourceKey,MATCH_RULE_VERSION} from './matching';
import {assertSafeWrite,isWithin} from './safety';
import {assertUserStorage} from './storage';
import {readArchive} from './archive-reader';

const DEFAULT_ROOT='E:\\VRChat';
const ARCHIVES=new Set(['.zip','.rar','.7z']);
const ARCHIVE_LIMITS={limit:1000,maxBytes:32*1024*1024,maxTime:5000};
const RESOURCE=/\.(?:zip|rar|7z|unitypackage|prefab|fbx|blend|vrm|obj|mat|anim|controller|psd|spp)$/i;
const PREVIEW=/^(?:preview(?:image)?|cover|thumbnail|サムネイル|封面|预览)(?:[-_ .()\d]|$)/i;
const GENERIC=/^(?:assets?|packages?|projectsettings|materials?|textures?|meshes?|models?|prefabs?|animations?|readme|psd|素材|材质|贴图|新建文件夹)$/i;
interface ValidatedDownload {file:string;directory:string;stat:BigIntStats}

async function validateDownload(file:string,downloadDir:string,roots:string[]):Promise<ValidatedDownload>{
  if(typeof file!=='string'||typeof downloadDir!=='string'||!path.isAbsolute(file)||!path.isAbsolute(downloadDir))throw new Error('BOOTH 下载文件和保存位置必须是绝对路径。');
  // The desktop location picker enforces the user's drive preference. Here we
  // validate an already selected location, including isolated test profiles.
  const directory=assertUserStorage(downloadDir,[DEFAULT_ROOT,...roots],true);
  const source=assertSafeWrite(file,directory,[DEFAULT_ROOT,...roots],true);
  if(!isWithin(source,directory)||source===directory)throw new Error('下载文件不在已选择的 BOOTH 下载目录内。');
  const directoryStat=await fsp.lstat(directory);
  if(!directoryStat.isDirectory()||directoryStat.isSymbolicLink())throw new Error('BOOTH 下载目录不是普通文件夹。');
  const stat=await fsp.lstat(source,{bigint:true});
  if(!stat.isFile()||stat.isSymbolicLink())throw new Error('只登记已经完成的普通下载文件，目录或文件链接不会导入。');
  const [actualFile,actualDirectory]=await Promise.all([fsp.realpath(source),fsp.realpath(directory)]);
  if(!isWithin(actualFile,actualDirectory))throw new Error('下载文件的实际位置不在已选择目录内。');
  assertSafeWrite(actualFile,actualDirectory,[DEFAULT_ROOT,...roots],true);
  return {file:source,directory,stat};
}
function unchanged(first:BigIntStats,second:BigIntStats):boolean{return first.dev===second.dev&&first.ino===second.ino&&first.birthtimeNs===second.birthtimeNs&&first.size===second.size&&first.mtimeNs===second.mtimeNs;}
function sourceItemUrl(raw:string|undefined):string|undefined{
  if(raw===undefined||raw==='')return;
  const id=boothProductId(raw);if(!id)throw new Error('下载来源必须是可信的 HTTPS BOOTH 商品网址。');
  return 'https://booth.pm/ja/items/'+id;
}
function evidenceAndHints(file:string,listing?:FileListing):{localEvidence:AvatarEvidence[];localNameHints:string[]}{
  const evidence=new Map<string,AvatarEvidence>(),hints=new Set<string>();
  const add=(name:string,reference:string,basis:AvatarEvidence['basis'])=>{for(const avatar of inferAvatars(name)){const key=avatar+':'+basis,entry=evidence.get(key)??{avatar,files:[],basis};if(entry.files.length<80&&!entry.files.includes(reference))entry.files.push(reference);evidence.set(key,entry);}};
  add(path.basename(file),file,'filename');
  for(const entry of listing?.entries??[]){
    const normalized=entry.name.replace(/\\/g,'/'),basename=path.posix.basename(normalized);
    if(!entry.directory&&(!RESOURCE.test(basename)||PREVIEW.test(basename)))continue;
    add(normalized,file+'!/'+entry.name,'archive-entry');
    if(hints.size>=20)continue;
    const clue=entry.directory?basename:ARCHIVES.has(path.posix.extname(basename).toLowerCase())||/\.unitypackage$/i.test(basename)?basename:basename.replace(/\.[^.]+$/,'');
    if(clue&&!/[\\/:\x00-\x1f]/.test(clue)&&!GENERIC.test(clue)&&!isAvatarName(clue))hints.add(clue.slice(0,500));
  }
  return {localEvidence:[...evidence.values()],localNameHints:[...hints]};
}

/** Register only the completed file supplied by the download owner. No source is moved, copied, unpacked or executed. */
export async function importBoothDownload(store:Store,file:string,sourceItem:string|undefined,downloadDir:string):Promise<{assetId:string}>{
  return importCompletedDownload(store,file,downloadDir,'booth',sourceItem);
}

/** Register exactly one finalized app download; never starts a directory scan. */
export async function importCompletedDownload(store:Store,file:string,downloadDir:string,provider:'booth'|'baidu',sourceItem?:string):Promise<{assetId:string}>{
  if(provider!=='booth'&&provider!=='baidu')throw new Error('下载来源无效。');
  if(provider==='baidu'&&sourceItem)throw new Error('百度分享链接不能作为 BOOTH 商品来源。');
  const roots=store.settings().roots,sourceUrl=sourceItemUrl(sourceItem),first=await validateDownload(file,downloadDir,roots),extension=path.extname(first.file).toLowerCase();
  const dataRelative=path.relative(store.dataDir,first.file).replace(/\\/g,'/').toLowerCase();
  if(isWithin(first.file,store.dataDir)&&/^(?:library\.sqlite(?:-(?:wal|shm))?|queue\.json)$|^cache(?:\/|$)/.test(dataRelative))throw new Error('应用资料库和封面缓存不能作为下载素材登记，请使用独立的下载文件或子目录。');
  const kind:AssetKind=extension==='.unitypackage'?'unitypackage':ARCHIVES.has(extension)?'archive':'file';
  let listing:FileListing|undefined;
  if(extension==='.zip'||extension==='.unitypackage')try{listing=await readArchive(first.file,[first.directory],ARCHIVE_LIMITS);}catch{/* A damaged or incomplete listing must not prevent registration of the user's completed download. */}
  const latest=await validateDownload(first.file,first.directory,store.settings().roots);
  if(!unchanged(first.stat,latest.stat))throw new Error('下载文件在读取过程中发生变化，请等下载完成后重试。');
  const {localEvidence,localNameHints}=evidenceAndHints(first.file,listing),fileIdentity=latest.stat.ino>0n&&latest.stat.birthtimeNs>0n?{device:latest.stat.dev.toString(),inode:latest.stat.ino.toString(),birthtime:latest.stat.birthtimeNs.toString()}:undefined;
  const record=store.upsertScan({path:first.file,name:path.basename(first.file),group:provider==='baidu'?'百度网盘下载':'BOOTH 下载',kind,size:Number(latest.stat.size),mtimeMs:Number(latest.stat.mtimeNs)/1e6,localCategory:inferCategory(path.basename(first.file)),localAvatars:[...new Set(localEvidence.map(entry=>entry.avatar))],localEvidence,compatibilityComplete:!!listing&&!listing.truncated&&listing.entries.length>0&&localEvidence.length>0,localNameHints,hintUrls:sourceUrl?[sourceUrl]:[],fileIdentity});
  // The download owner supplies an observed product identity, not a name search
  // hint. Keep it separate from human annotations and never revive a skipped,
  // excluded, rematching or differently linked asset during a history repair.
  if(sourceUrl&&record.manual.matchingMode!=='manual'&&!record.online.rematchRequested&&!record.online.confirmedSource&&
     (!record.manual.sourceUrl||canonicalSourceKey(record.manual.sourceUrl)===canonicalSourceKey(sourceUrl))&&
     (!record.online.url||canonicalSourceKey(record.online.url)===canonicalSourceKey(sourceUrl))&&
     !record.online.rejectedUrls?.some(url=>canonicalSourceKey(url)===canonicalSourceKey(sourceUrl))){
    store.updateOnline(record.id,{status:'pending',url:sourceUrl,confirmedSource:true,candidates:[],matchEvidence:{method:'booth-download',signals:['BOOTH 内置下载记录提供明确商品来源'],ruleVersion:MATCH_RULE_VERSION,recordedAt:new Date().toISOString()}});
  }
  return {assetId:record.id};
}

/** The caller must first match this exact path to its own completed download record. */
export async function importedDownloadFiles(asset:AssetRecord,downloadDir:string):Promise<FileListing>{
  const first=await validateDownload(asset.path,downloadDir,[]),extension=path.extname(first.file).toLowerCase();
  let listing:FileListing;
  if(ARCHIVES.has(extension)||extension==='.unitypackage'){
    try{listing=await readArchive(first.file,[first.directory],{limit:2000,maxBytes:128*1024*1024,maxTime:15000});}
    catch(error){listing={entries:[],truncated:false,message:error instanceof Error?error.message:'素材包目录无法读取。'};}
  }else listing={entries:[{name:path.basename(first.file),size:Number(first.stat.size),directory:false}],truncated:false,message:'只展示已下载文件；应用不会运行或自动导入它。'};
  const latest=await validateDownload(first.file,first.directory,[]);
  if(!unchanged(first.stat,latest.stat))throw new Error('下载文件在读取过程中发生变化，请重试。');
  return listing;
}
