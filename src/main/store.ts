import fs from 'node:fs';
import {normalizeLanguage} from '../shared/i18n';
import path from 'node:path';
import crypto from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {AssetRecord,AssetQuery,AssetPage,Stats,ManualInfo,OnlineInfo,AppSettings,AvatarEvidence,FileIdentity,LibraryCollection,CollectionInput,TagSummary,SourceUndoInfo,CATEGORIES,REVIEW_SORTS,THEME_IDS,LANGUAGE_IDS,normalizeTheme,displayCategory,displayAvatars,displayTags,displayTitle} from '../shared/contracts';
import {assertSafeWrite,isWithin,safeCoverPath} from './safety';
import {ProjectionIndex} from './projection';
import {SearchIndex,normalizeSearch} from './search';
import {isOrganizationalAsset} from './organization';
import {inferLocalCategory,inferProductCategory,normalizeCategory,officialProductCategory} from './hints';
import {boothProductId} from './matching';
import {validateWrapper} from './wrappers';
import {normalizeSourceRoots,sourcePathKey,sourcePathActive} from './source-roots';

export type ScanInput=Pick<AssetRecord,'path'|'name'|'group'|'kind'|'size'|'mtimeMs'|'localCategory'|'localAvatars'|'hintUrls'|'previewFile'|'localEvidence'|'compatibilityComplete'|'localNameHints'|'fileIdentity'|'wrapper'>;
const kinds=['folder','archive','unitypackage','file','unity-project'];
const statuses=['pending','matched','review','not-found','failed','blocked'];
const validDownloadConcurrency=(value:unknown):value is number=>typeof value==='number'&&Number.isInteger(value)&&value>=1&&value<=6;
const cleanStrings=(value:unknown,max=100):string[]=>Array.isArray(value)?[...new Set(value.filter((v):v is string=>typeof v==='string').map(v=>v.trim().slice(0,500)).filter(Boolean))].slice(0,max):[];
function cleanLocalNameHints(value:unknown):string[]{return Array.isArray(value)?[...new Set(value.filter((entry):entry is string=>typeof entry==='string').map(entry=>entry.trim()).filter(entry=>entry!=='.'&&entry!=='..'&&!/[\\/:\x00-\x1f]/.test(entry)&&entry.length>0).map(entry=>entry.slice(0,500)))].slice(0,20):[]}
function candidateCoverFile(value:unknown):string|undefined {if(typeof value!=='string'||!value)return undefined;if(value.length>500||value!==path.basename(value)||/[\\/:\x00-\x1f]/.test(value)||value==='.'||value==='..')throw new Error('候选封面文件名无效。');return value}
function cleanIdentity(value:any):FileIdentity|undefined {return value&&['device','inode','birthtime'].every(key=>typeof value[key]==='string'&&/^\d{1,40}$/.test(value[key]))&&value.inode!=='0'?{device:value.device,inode:value.inode,birthtime:value.birthtime}:undefined}
function sourceUrl(value:unknown):string {if(typeof value!=='string'||value.length>2048)throw new Error('来源网址无效。');if(!value)return '';let url:URL;try{url=new URL(value)}catch{throw new Error('来源网址无效。')}if(url.protocol!=='https:'||url.username||url.password)throw new Error('来源必须是无账号信息的 HTTPS 网址。');return url.href}
const clone=<T>(value:T):T=>structuredClone(value);
const stableId=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(value);
type FieldValue={exists:boolean;value?:unknown};
type ManualDelta={id:string;before:Record<string,FieldValue>};
type Undo={manual?:ManualDelta[];collections?:{id:string;before:LibraryCollection|null}[];aliases?:Record<string,string[]>};
type SourceUndo=SourceUndoInfo&{entries:{id:string;online:OnlineInfo;source:FieldValue}[]};
type RecoveryRecord={kind:'asset'|'collection'|'tag-alias'|'settings';key:string;record:string;error:string};
type StoredAsset=AssetRecord&{scanContainer?:boolean};
const BOOTH_TASK_DIRECTORY=/^booth-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function safeBoothDownloadPath(value:string,dataDir:string,roots:string[]):string {
  if(typeof value!=='string'||!path.isAbsolute(value)||/[\x00-\x1f]/.test(value)||/[\\/:]/.test(path.basename(value))||!BOOTH_TASK_DIRECTORY.test(path.basename(path.dirname(value))))throw new Error('备份的 BOOTH 下载引用无效。');
  const resolved=assertSafeWrite(value,dataDir,['E:\\VRChat',...roots],true),relative=path.relative(dataDir,resolved).replace(/\\/g,'/').toLowerCase();
  if(isWithin(resolved,dataDir)&&/^(?:library\.sqlite(?:-(?:wal|shm))?|queue\.json|booth-downloads\.json|booth-session-cookies\.bin)$|^(?:cache|session|crashes|booth-session)(?:\/|$)/.test(relative))throw new Error('应用资料文件不能作为 BOOTH 下载引用恢复。');
  try{const stat=fs.lstatSync(resolved);if(!stat.isFile()||stat.isSymbolicLink())throw new Error('BOOTH 下载引用必须是普通文件。')}catch(error:any){if(!['ENOENT','ENOTDIR'].includes(error.code))throw error}
  return resolved;
}
function safeBackupDownloadDirectory(value:unknown,dataDir:string,roots:string[]):string|undefined {
  if(typeof value!=='string'||!path.isAbsolute(value))return;
  try{const resolved=assertSafeWrite(value,dataDir,['E:\\VRChat',...roots],true),relative=path.relative(dataDir,resolved).replace(/\\/g,'/').toLowerCase();if(isWithin(resolved,dataDir)&&/^(?:cache|session|crashes|booth-session)(?:\/|$)/.test(relative))return;try{if(!fs.lstatSync(resolved).isDirectory())return}catch(error:any){if(!['ENOENT','ENOTDIR'].includes(error.code))return}return resolved}catch{return}
}
function absent(file:string):boolean {try{fs.lstatSync(file);return false}catch(error:any){return ['ENOENT','ENOTDIR'].includes(error.code)}}
function cleanQuery(value:any):AssetQuery {const result:AssetQuery={};if(!value||typeof value!=='object'||Array.isArray(value))return result;for(const key of ['search','category','group','avatar','status','tag','author'] as const)if(typeof value[key]==='string')result[key]=(key==='category'&&value[key]==='鞋子'?'服装':value[key]).slice(0,500);for(const key of ['favorite','hasCover','untagged'] as const)if(typeof value[key]==='boolean')result[key]=value[key];if(['materials','projects','all','manual'].includes(value.view))result.view=value.view;if(['name','recent','size','relevance','added','added-asc','modified','modified-asc'].includes(value.sort))result.sort=value.sort;for(const key of ['addedAfter','addedBefore'] as const)if(typeof value[key]==='string'&&Number.isFinite(Date.parse(value[key])))result[key]=new Date(value[key]).toISOString();return result}
function localCategory(value:any):AssetRecord['localCategory'] {if(value.kind==='unity-project')return '工程';const inferred=inferLocalCategory(value.name,cleanLocalNameHints(value.localNameHints));return inferred!=='未分类'?inferred:normalizeCategory(value.localCategory)??'未分类'}
function cleanEvidence(value:unknown):AvatarEvidence[]{return Array.isArray(value)?value.slice(0,100).filter(entry=>entry&&typeof entry.avatar==='string'&&['filename','archive-entry','manual'].includes(entry.basis)).map(entry=>({avatar:entry.avatar.slice(0,500),basis:entry.basis,files:cleanStrings(entry.files,80)})):[]}
function manualInfo(value:any):ManualInfo {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('标注格式无效。');
  const result:ManualInfo={};
  for(const key of ['title','notes'] as const)if(key in value){if(typeof value[key]!=='string')throw new Error('标注内容必须是文字。');result[key]=value[key].slice(0,key==='notes'?20000:500)}
  if('category' in value){const category=normalizeCategory(value.category);if(!category)throw new Error('分类无效。');result.category=category}
  for(const key of ['tags','avatars','relatedIds'] as const)if(key in value){if(!Array.isArray(value[key]))throw new Error('标签列表无效。');result[key]=cleanStrings(value[key])}
  if('favorite' in value)result.favorite=Boolean(value.favorite);
  if('projectStatus' in value){if(!['制作中','已完成'].includes(value.projectStatus))throw new Error('工程状态无效。');result.projectStatus=value.projectStatus}
  if('coverFile' in value){if(typeof value.coverFile!=='string'||(value.coverFile&&path.basename(value.coverFile)!==value.coverFile))throw new Error('封面路径无效。');result.coverFile=value.coverFile}
  if('sourceUrl' in value)result.sourceUrl=sourceUrl(value.sourceUrl);
  if('matchingMode' in value){if(!['auto','manual'].includes(value.matchingMode))throw new Error('匹配方式无效。');result.matchingMode=value.matchingMode}
  return result;
}
function onlineInfo(value:any):OnlineInfo {
  const online:OnlineInfo={status:statuses.includes(value?.status)?value.status:'pending'};
  for(const key of ['title','author','url','coverUrl','coverFile','description','fetchedAt','message','metadataSourceUrl','classificationCheckedVersion','matchingCheckedVersion'] as const)if(typeof value?.[key]==='string')online[key]=value[key].slice(0,key==='description'?40000:2000);
  const savedCategory=normalizeCategory(value?.category);if(savedCategory)online.category=savedCategory;
  if(typeof value?.classificationPending==='boolean')online.classificationPending=value.classificationPending;
  for(const key of ['titleAliases','authorAliases'] as const)if(Array.isArray(value?.[key]))online[key]=cleanStrings(value[key],20);
  const categoryEvidence=cleanCategoryEvidence(value?.categoryEvidence,value?.metadataSourceUrl||value?.url);if(categoryEvidence)online.categoryEvidence=categoryEvidence;
  if(Array.isArray(value?.tags))online.tags=cleanStrings(value.tags);
  const inferredCategory=inferProductCategory({...online,categories:categoryEvidence?[categoryEvidence.rawCategory]:undefined});if(inferredCategory!=='未分类'&&!(online.classificationPending&&savedCategory&&!categoryEvidence))online.category=inferredCategory;
  if(Array.isArray(value?.avatars))online.avatars=cleanStrings(value.avatars);
  if(typeof value?.confirmedSource==='boolean')online.confirmedSource=value.confirmedSource;
  if(Array.isArray(value?.rejectedUrls))online.rejectedUrls=cleanStrings(value.rejectedUrls,100);
  const evidence=value?.matchEvidence;if(evidence&&['filename-id','readme-link','name-search','child-package','manual','known-source'].includes(evidence.method)&&typeof evidence.ruleVersion==='string'&&typeof evidence.recordedAt==='string')online.matchEvidence={method:evidence.method,signals:cleanStrings(evidence.signals,20),ruleVersion:evidence.ruleVersion.slice(0,100),recordedAt:evidence.recordedAt.slice(0,100)};
  if(Array.isArray(value?.candidates))online.candidates=value.candidates.slice(0,10).filter((candidate:any)=>typeof candidate?.url==='string'&&typeof candidate?.title==='string').map((candidate:any)=>({url:candidate.url.slice(0,2000),title:candidate.title.slice(0,500),titleAliases:Array.isArray(candidate.titleAliases)?cleanStrings(candidate.titleAliases,20):undefined,author:typeof candidate.author==='string'?candidate.author.slice(0,500):undefined,authorAliases:Array.isArray(candidate.authorAliases)?cleanStrings(candidate.authorAliases,20):undefined,category:normalizeCategory(candidate.category),categoryEvidence:cleanCategoryEvidence(candidate.categoryEvidence,candidate.url),coverUrl:typeof candidate.coverUrl==='string'?candidate.coverUrl.slice(0,2000):undefined,coverFile:candidateCoverFile(candidate.coverFile),reason:typeof candidate.reason==='string'?candidate.reason.slice(0,1000):undefined}));
  return online;
}
function cleanCategoryEvidence(value:any,itemUrl:unknown):OnlineInfo['categoryEvidence'] {
  if(!value||typeof value.rawCategory!=='string'||value.rawCategory.length>500||typeof value.itemId!=='string'||!/^\d{1,12}$/.test(value.itemId)||boothProductId(typeof itemUrl==='string'?itemUrl:undefined)!==value.itemId||typeof value.ruleVersion!=='string'||!value.ruleVersion||value.ruleVersion.length>100||typeof value.sourceUrl!=='string'||value.sourceUrl.length>2048||!officialProductCategory([value.rawCategory]))return undefined;
  try{const url=new URL(value.sourceUrl);if(url.protocol!=='https:'||url.username||url.password||url.port&&url.port!=='443'||!/(?:^|\.)booth\.pm$/i.test(url.hostname)||!(boothProductId(url.href)===value.itemId||/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?search\//i.test(url.pathname)))return undefined;return {rawCategory:value.rawCategory.trim(),sourceUrl:url.href,itemId:value.itemId,ruleVersion:value.ruleVersion};}catch{return undefined;}
}
export function assetId(source:string):string{return crypto.createHash('sha256').update(process.platform==='win32'?path.resolve(source).toLowerCase():path.resolve(source)).digest('hex').slice(0,24)}

export class Store {
  readonly dataDir:string;
  private db:DatabaseSync;
  private rootPaths:string[];
  private detachedRootPaths:string[]=[];
  private projection?:ProjectionIndex;
  private raw=new Map<string,StoredAsset>();private paths=new Map<string,string>();private identities=new Map<string,Set<string>>();private groups=new Map<string,string>();private statsCache:Stats|null=null;
  private search:SearchIndex;private searchDirty=true;readonly recoveryWarnings:string[]=[];
  constructor(dataDir:string,roots:string[]){
    this.dataDir=path.resolve(dataDir);this.rootPaths=normalizeSourceRoots(roots);
    fs.mkdirSync(assertSafeWrite(this.dataDir,this.dataDir,this.protectedPaths()),{recursive:true});
    this.db=new DatabaseSync(assertSafeWrite(path.join(this.dataDir,'library.sqlite'),this.dataDir,this.protectedPaths()));
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, record TEXT NOT NULL); CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS collections(id TEXT PRIMARY KEY,record TEXT NOT NULL); CREATE TABLE IF NOT EXISTS tag_aliases(name TEXT PRIMARY KEY,record TEXT NOT NULL); CREATE TABLE IF NOT EXISTS metadata_undo(id INTEGER PRIMARY KEY AUTOINCREMENT,record TEXT NOT NULL); CREATE TABLE IF NOT EXISTS damaged_records(id TEXT PRIMARY KEY,record TEXT NOT NULL,error TEXT NOT NULL); CREATE TABLE IF NOT EXISTS recovery_records(kind TEXT NOT NULL,key TEXT NOT NULL,record TEXT NOT NULL,error TEXT NOT NULL,PRIMARY KEY(kind,key));');
    this.db.exec('CREATE TABLE IF NOT EXISTS source_undo(id INTEGER PRIMARY KEY AUTOINCREMENT,token TEXT NOT NULL UNIQUE,record TEXT NOT NULL)');
    const saved=this.db.prepare('SELECT value FROM settings WHERE key=?').get('app') as {value:string}|undefined;
    if(saved)try{const data=JSON.parse(saved.value);if(Array.isArray(data.roots)){const loaded=normalizeSourceRoots(data.roots),detached=normalizeSourceRoots(data.detachedRoots??[]);assertSafeWrite(this.dataDir,this.dataDir,['E:\\VRChat',...loaded,...detached]);this.rootPaths=loaded;this.detachedRootPaths=detached}}catch(error){this.noteRecovery({kind:'settings',key:'app',record:saved.value,error:'设置记录损坏，原记录已保留。'})}
    this.loadRaw();this.search=new SearchIndex(this.db);for(const entry of this.recoveryRecords())this.recoveryWarnings.push(`${entry.kind} ${entry.key} 的损坏记录已原样保全；有效资料保持可用。`);
  }
  private loadRaw():void {this.projection=undefined;this.raw.clear();this.groups.clear();this.paths.clear();this.identities.clear();for(const row of this.db.prepare('SELECT id,path,record FROM assets').all() as {id:string;path:string;record:string}[])try{const value=JSON.parse(row.record);if(!value||typeof value.path!=='string'||!path.isAbsolute(value.path)||typeof value.name!=='string'||!kinds.includes(value.kind))throw new Error('素材记录结构无效');const now=new Date().toISOString(),asset:AssetRecord={...value,id:row.id,path:path.resolve(value.path),group:typeof value.group==='string'?value.group:'本地',size:Math.max(0,Number(value.size)||0),mtimeMs:Number(value.mtimeMs)||0,missing:value.missing===true,localCategory:localCategory(value),createdAt:typeof value.createdAt==='string'?value.createdAt:now,updatedAt:typeof value.updatedAt==='string'?value.updatedAt:now,manual:manualInfo(value.manual??{}),online:onlineInfo(value.online),localAvatars:cleanStrings(value.localAvatars),localEvidence:Array.isArray(value.localEvidence)?cleanEvidence(value.localEvidence):undefined,compatibilityComplete:value.compatibilityComplete===true,hintUrls:cleanStrings(value.hintUrls,20),localNameHints:cleanLocalNameHints(value.localNameHints),fileIdentity:cleanIdentity(value.fileIdentity),wrapper:validateWrapper(value.wrapper,value.path)};this.raw.set(row.id,asset);this.groups.set(row.id,asset.group);this.paths.set(this.pathKey(asset.path),row.id);this.indexIdentity(asset,true);}catch(error){const message=error instanceof Error?error.message:'记录损坏';this.recoveryWarnings.push(`素材记录 ${row.id} 无法读取；原数据保留，可从备份恢复。`);this.db.prepare('INSERT INTO damaged_records(id,record,error) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record,error=excluded.error').run(row.id,row.record,message)}this.invalidate();}
  private pathKey(value:string):string {const resolved=path.resolve(value);return process.platform==='win32'?resolved.toLowerCase():resolved}
  private identityKey(record:Pick<AssetRecord,'kind'|'fileIdentity'|'path'>):string|undefined {const identity=record.fileIdentity;return identity?`${record.kind}:${['folder','unity-project'].includes(record.kind)?'directory':path.extname(record.path).toLowerCase()}:${identity.device}:${identity.inode}:${identity.birthtime}`:undefined}
  private indexIdentity(record:AssetRecord,add:boolean):void {const key=this.identityKey(record);if(!key)return;const ids=this.identities.get(key)??new Set<string>();if(add)ids.add(record.id);else ids.delete(record.id);if(ids.size)this.identities.set(key,ids);else this.identities.delete(key)}
  private invalidate():void {this.statsCache=null;this.searchDirty=true}
  private noteRecovery(entry:RecoveryRecord):void {const existing=this.db.prepare('SELECT record FROM recovery_records WHERE kind=? AND key=?').get(entry.kind,entry.key) as {record:string}|undefined,damaged=entry.kind==='asset'?this.db.prepare('SELECT record FROM damaged_records WHERE id=?').get(entry.key) as {record:string}|undefined:undefined;if(existing&&existing.record!==entry.record||damaged&&damaged.record!==entry.record)entry={...entry,key:entry.key.slice(0,420)+'#'+crypto.createHash('sha256').update(entry.record).digest('hex')};this.db.prepare('INSERT INTO recovery_records(kind,key,record,error) VALUES(?,?,?,?) ON CONFLICT(kind,key) DO UPDATE SET error=excluded.error').run(entry.kind,entry.key,entry.record,entry.error);const message=`${entry.kind} ${entry.key} 的损坏记录已原样保全；有效资料保持可用。`;if(!this.recoveryWarnings.includes(message))this.recoveryWarnings.push(message)}
  private recoveryRecords():RecoveryRecord[]{const records=new Map<string,RecoveryRecord>();for(const row of this.db.prepare('SELECT id,record,error FROM damaged_records').all() as {id:string;record:string;error:string}[])records.set('asset:'+row.id,{kind:'asset',key:row.id,record:row.record,error:row.error});for(const row of this.db.prepare('SELECT kind,key,record,error FROM recovery_records').all() as RecoveryRecord[])records.set(row.kind+':'+row.key,row);return [...records.values()]}
  private protectedPaths():string[]{return ['E:\\VRChat',...this.rootPaths,...this.detachedRootPaths]}
  isPathActive(source:string):boolean{return sourcePathActive(source,this.rootPaths,this.detachedRootPaths)}
  private active(record:AssetRecord):boolean{return this.isPathActive(record.path)}
  private visible(record:StoredAsset):boolean{return this.active(record)&&!record.scanContainer&&!isOrganizationalAsset(record)}
  private writable():void {assertSafeWrite(path.join(this.dataDir,'library.sqlite'),this.dataDir,this.protectedPaths())}
  private transaction(action:()=>void):void {this.writable();this.db.exec('BEGIN IMMEDIATE');try{action();this.db.exec('COMMIT')}catch(error){this.db.exec('ROLLBACK');this.loadRaw();throw error}}
  private put(record:AssetRecord):void {this.db.prepare('INSERT INTO assets(id,path,record) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET path=excluded.path,record=excluded.record').run(record.id,record.path,JSON.stringify(record));const previous=this.raw.get(record.id);if(previous){this.paths.delete(this.pathKey(previous.path));this.indexIdentity(previous,false)}const next=clone(record);this.raw.set(record.id,next);if(this.visible(next))this.projection?.update(previous&&this.visible(previous)?previous:undefined,next);else if(previous&&this.visible(previous))this.projection=undefined;this.paths.set(this.pathKey(record.path),record.id);this.indexIdentity(record,true);this.groups.set(record.id,record.group);this.invalidate()}
  private allStored():AssetRecord[]{return [...this.raw.values()].map(clone)}
  all():AssetRecord[]{return [...this.raw.values()].filter(record=>this.active(record)).map(clone)}
  getRaw(id:string):AssetRecord|null {const record=this.raw.get(id);return record?clone(record):null}
  private displayed():AssetRecord[]{return (this.projection??(this.projection=new ProjectionIndex([...this.raw.values()].filter(record=>this.visible(record))))).values()}
  get(id:string):AssetRecord|null {if(this.raw.has(id)&&!this.visible(this.raw.get(id)!))return null;this.displayed();const record=this.projection!.get(id);return record?clone(record):null}
  private aliases():Record<string,string[]> {const result:Record<string,string[]>=Object.create(null);for(const row of this.db.prepare('SELECT name,record FROM tag_aliases').all() as {name:string;record:string}[])try{const values=JSON.parse(row.record);if(!Array.isArray(values)||values.some(value=>typeof value!=='string'))throw new Error('标签别名格式无效');result[row.name]=cleanStrings(values,20)}catch(error){this.noteRecovery({kind:'tag-alias',key:row.name,record:row.record,error:error instanceof Error?error.message:'别名记录损坏'})}return result}
  private ensureSearch():void {if(!this.searchDirty)return;this.search.rebuild(this.displayed(),this.aliases(),this.groups);this.searchDirty=false}
  list(query:AssetQuery={}):AssetPage {
    if(query.category==='鞋子')query={...query,category:'服装'};
    this.ensureSearch();let effective={...query};let allowed:Set<string>|undefined;
    if(query.collectionId){const collection=this.listCollections().find(item=>item.id===query.collectionId);if(!collection)return {items:[],total:0};
      if(collection.kind==='manual')allowed=new Set(collection.assetIds??[]);
      else {const saved=collection.query??{};effective={...saved,...query};for(const key of ['category','group','avatar','status','tag','author'] as const){if(saved[key]&&query[key]&&saved[key]!==query[key])return {items:[],total:0};if(saved[key]&&!query[key])effective[key]=saved[key]}
        effective.search=[...new Set([saved.search,query.search].filter((value):value is string=>!!value))].join(' ');if(saved.view)effective.view=saved.view;if(saved.favorite)effective.favorite=true;if(saved.hasCover!==undefined)effective.hasCover=saved.hasCover;if(saved.untagged)effective.untagged=true;
        effective.addedAfter=[saved.addedAfter,query.addedAfter].filter((value):value is string=>!!value).sort().at(-1);effective.addedBefore=[saved.addedBefore,query.addedBefore].filter((value):value is string=>!!value).sort().at(0);
      }
    }
    const page=this.search.list(effective,allowed);return {total:page.total,items:page.items.map(clone)};
  }
  stats():Stats {
    if(!this.statsCache){const all=this.displayed(),categories:Record<string,number>={};for(const category of CATEGORIES)categories[category]=0;for(const record of all)categories[displayCategory(record)]++;
      this.statsCache={total:all.length,materials:all.filter(a=>a.kind!=='unity-project').length,projects:all.filter(a=>a.kind==='unity-project').length,favorites:all.filter(a=>a.manual.favorite).length,matched:all.filter(a=>a.online.status==='matched').length,review:all.filter(a=>a.online.status==='review'&&a.manual.matchingMode!=='manual').length,manual:all.filter(a=>a.kind!=='unity-project'&&a.manual.matchingMode==='manual').length,missing:all.filter(a=>a.missing).length,groups:[...new Set([...this.raw.values()].filter(a=>this.visible(a)).map(a=>a.group))].sort((a,b)=>a.localeCompare(b,'zh-CN')),avatars:[...new Set(all.flatMap(a=>[...a.localAvatars,...(a.manual.avatars??[])]))].sort(),categories};
    }return clone(this.statsCache);
  }
  upsertScan(input:ScanInput):AssetRecord {
    this.writable();const source=path.resolve(input.path),identity=cleanIdentity(input.fileIdentity),now=new Date().toISOString();
    let existing=this.raw.get(this.paths.get(this.pathKey(source))??'');
    if(!existing&&identity){const key=this.identityKey({...input,path:source,fileIdentity:identity})!,candidates=[...(this.identities.get(key)??[])].map(id=>this.raw.get(id)!);if(candidates.length===1&&absent(candidates[0].path))existing=candidates[0]}
    let id=existing?.id??assetId(source);if(!existing&&this.raw.has(id))id=crypto.randomUUID();
    const record:AssetRecord={...input,localCategory:localCategory(input),localNameHints:cleanLocalNameHints(input.localNameHints),fileIdentity:Object.hasOwn(input,'fileIdentity')?identity:existing?.fileIdentity,wrapper:Object.hasOwn(input,'wrapper')?validateWrapper(input.wrapper,source):existing?.wrapper,path:source,id,missing:false,manual:existing?.manual??{},online:existing?.online??{status:'pending'},createdAt:existing?.createdAt??now,updatedAt:existing?.updatedAt??now};
    if(existing&&!input.previewFile)record.previewFile=existing.previewFile;
    const unchanged=existing&&JSON.stringify({...record,updatedAt:''})===JSON.stringify({...existing,updatedAt:''});
    if(!unchanged){record.updatedAt=now;this.put(record)}return record;
  }
  markScanMissing(root:string,seen:Set<string>,excluded:string[]):void {
    this.transaction(()=>{for(const source of this.raw.values())if(this.active(source)&&isWithin(source.path,root)&&!seen.has(source.id)&&!excluded.some(dir=>isWithin(source.path,dir))){const missing=source.scanContainer||isOrganizationalAsset(source)?absent(source.path):true;if(source.missing!==missing){const record=clone(source);record.missing=missing;record.updatedAt=new Date().toISOString();this.put(record)}}});
  }
  updateAvailability(id:string,missing:boolean):boolean {const record=this.getRaw(id);if(!record||record.missing===missing)return false;this.writable();record.missing=missing;record.updatedAt=new Date().toISOString();this.put(record);return true}
  private changeManual(record:AssetRecord,patch:ManualInfo,deltas:ManualDelta[]):void {const before:ManualDelta['before']={};let changed=false;for(const [key,value] of Object.entries(patch)){if(JSON.stringify((record.manual as any)[key])===JSON.stringify(value))continue;changed=true;if(key!=='sourceUrl')before[key]={exists:Object.hasOwn(record.manual,key),value:clone((record.manual as any)[key])};(record.manual as any)[key]=clone(value)}if(!changed)return;if(Object.keys(before).length)deltas.push({id:record.id,before});record.updatedAt=new Date().toISOString();this.put(record)}
  private recordUndo(value:Undo):void {if(!value.manual?.length&&!value.collections?.length&&value.aliases===undefined)return;const serialized=JSON.stringify(value);if(Buffer.byteLength(serialized)>32*1024*1024)throw new Error('更改内容过多，请减少一次批量修改的素材数量。');this.db.prepare('INSERT INTO metadata_undo(record) VALUES(?)').run(serialized);this.db.exec('DELETE FROM metadata_undo WHERE id NOT IN (SELECT id FROM metadata_undo ORDER BY id DESC LIMIT 50)')}
  updateManual(ids:string[],patch:ManualInfo,recordUndo=true):void {
    const clean=manualInfo(patch);if(clean.coverFile)safeCoverPath(this.dataDir,clean.coverFile);
    this.transaction(()=>{const deltas:ManualDelta[]=[];for(const id of cleanStrings(ids,10000)){const record=this.getRaw(id);if(record)this.changeManual(record,clean,deltas)}if(recordUndo)this.recordUndo({manual:deltas})});
  }
  updateOnline(id:string,patch:Partial<OnlineInfo>):void {
    this.writable();const record=this.getRaw(id);if(!record)return;
    const merged=onlineInfo({...record.online,...patch});if(merged.coverFile)safeCoverPath(this.dataDir,merged.coverFile);
    for(const candidate of merged.candidates??[])if(candidate.coverFile)safeCoverPath(this.dataDir,candidate.coverFile);
    record.online=merged;record.updatedAt=new Date().toISOString();this.put(record);
  }
  /** Sources have their own history: network metadata must be restored as well as the link. */
  beginSourceChange(ids:string[],url:string,assetId:string,title:string):SourceUndoInfo {
    const source=sourceUrl(url),unique=cleanStrings(ids,10000);if(!source||!unique.length||!stableId(assetId))throw new Error('来源确认无效。');
    const records=unique.map(id=>{const asset=this.getRaw(id);if(!asset||asset.kind==='unity-project')throw new Error('请选择有效的素材。');return asset});
    const info:SourceUndoInfo={token:crypto.randomUUID(),assetId,title:title.slice(0,1000),sourceUrl:source,recordedAt:new Date().toISOString()},undo:SourceUndo={...info,entries:records.map(record=>({id:record.id,online:clone(record.online),source:{exists:Object.hasOwn(record.manual,'sourceUrl'),value:record.manual.sourceUrl}}))};
    const serialized=JSON.stringify(undo);if(Buffer.byteLength(serialized)>32*1024*1024)throw new Error('一次来源确认包含过多信息，请分批处理。');
    this.transaction(()=>{
      this.db.prepare('INSERT INTO source_undo(token,record) VALUES(?,?)').run(info.token,serialized);
      this.db.exec('DELETE FROM source_undo WHERE id NOT IN (SELECT id FROM source_undo ORDER BY id DESC LIMIT 50)');
      for(const record of records){record.manual.sourceUrl=source;const metadataSourceUrl=record.online.metadataSourceUrl||(record.online.status==='matched'?record.online.url:undefined);record.online={...record.online,status:'pending',url:source,metadataSourceUrl,confirmedSource:false,candidates:[],message:'正在读取已确认的来源'};record.updatedAt=info.recordedAt;this.put(record)}
    });return clone(info);
  }
  private lastSourceUndo():SourceUndo|undefined {
    const row=this.db.prepare('SELECT record FROM source_undo ORDER BY id DESC LIMIT 1').get() as {record:string}|undefined;if(!row)return;
    try{const undo:SourceUndo=JSON.parse(row.record);if(typeof undo.token!=='string'||!stableId(undo.assetId)||typeof undo.title!=='string'||typeof undo.sourceUrl!=='string'||typeof undo.recordedAt!=='string'||!Array.isArray(undo.entries)||!undo.entries.length||undo.entries.length>10000||undo.entries.some(entry=>!stableId(entry.id)||!entry.online||typeof entry.source?.exists!=='boolean'))throw new Error();return undo}catch{const message='最近一次来源撤回记录无法读取，原记录仍保留。';if(!this.recoveryWarnings.includes(message))this.recoveryWarnings.push(message);return}
  }
  sourceUndoInfo():SourceUndoInfo|undefined {const undo=this.lastSourceUndo();if(undo){const {entries,...info}=undo;return clone(info)}}
  sourceUndoIds(token:string):string[]|null {const undo=this.lastSourceUndo();return undo?.token===token?undo.entries.map(entry=>entry.id):null}
  undoSource(token:string):boolean {
    const undo=this.lastSourceUndo();if(!undo||undo.token!==token)return false;
    this.transaction(()=>{for(const entry of undo.entries){const record=this.getRaw(entry.id);if(!record)continue;record.online=onlineInfo(entry.online);if(entry.source.exists)record.manual.sourceUrl=sourceUrl(entry.source.value);else delete record.manual.sourceUrl;record.updatedAt=new Date().toISOString();this.put(record)}this.db.prepare('DELETE FROM source_undo WHERE token=?').run(token)});return true;
  }
  listCollections():LibraryCollection[]{const result:LibraryCollection[]=[];for(const row of this.db.prepare('SELECT id,record FROM collections').all() as {id:string;record:string}[])try{const collection=JSON.parse(row.record);if(!stableId(collection.id)||typeof collection.name!=='string'||!['manual','smart'].includes(collection.kind)||collection.kind==='manual'&&!Array.isArray(collection.assetIds)||collection.kind==='smart'&&(!collection.query||typeof collection.query!=='object'||Array.isArray(collection.query)))throw new Error('集合结构无效');if(collection.kind==='smart')collection.query=cleanQuery(collection.query);result.push(collection)}catch(error){this.noteRecovery({kind:'collection',key:row.id,record:row.record,error:error instanceof Error?error.message:'集合记录损坏'})}return result.sort((a,b)=>a.name.localeCompare(b.name,'zh-CN')).map(clone)}
  private putCollection(collection:LibraryCollection):void {this.db.prepare('INSERT INTO collections(id,record) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record').run(collection.id,JSON.stringify(collection))}
  saveCollection(input:CollectionInput):LibraryCollection {if(!input||typeof input.name!=='string'||!input.name.trim()||input.name.trim().length>100||!['manual','smart'].includes(input.kind))throw new Error('集合名称或类型无效。');const all=this.listCollections(),existing=input.id?all.find(item=>item.id===input.id):undefined;if(input.id&&!existing)throw new Error('集合不存在。');const name=input.name.trim();if(all.some(item=>item.id!==existing?.id&&normalizeSearch(item.name)===normalizeSearch(name)))throw new Error('已经有相同名称的集合。');const now=new Date().toISOString(),collection:LibraryCollection={id:existing?.id??crypto.randomUUID(),name,kind:input.kind,createdAt:existing?.createdAt??now,updatedAt:now,...(input.kind==='manual'?{assetIds:existing?.kind==='manual'?existing.assetIds??[]:[]}:{query:cleanQuery(input.query)})};this.transaction(()=>{this.putCollection(collection);this.recordUndo({collections:[{id:collection.id,before:existing??null}]})});return clone(collection)}
  updateCollectionMembers(collectionId:string,ids:string[],mode:'add'|'remove'):void {const collection=this.listCollections().find(item=>item.id===collectionId);if(!collection||collection.kind!=='manual')throw new Error('请选择普通集合。');if(!['add','remove'].includes(mode))throw new Error('集合操作无效。');const before=clone(collection),members=new Set(collection.assetIds??[]);for(const id of cleanStrings(ids,10000)){if(mode==='remove')members.delete(id);else if(this.raw.has(id))members.add(id)}collection.assetIds=[...members];if(JSON.stringify(collection.assetIds)===JSON.stringify(before.assetIds??[]))return;collection.updatedAt=new Date().toISOString();this.transaction(()=>{this.putCollection(collection);this.recordUndo({collections:[{id:collection.id,before}]})})}
  deleteCollection(id:string):void {const before=this.listCollections().find(collection=>collection.id===id);if(!before)return;this.transaction(()=>{this.db.prepare('DELETE FROM collections WHERE id=?').run(id);this.recordUndo({collections:[{id,before}]})})}
  private putAliases(aliases:Record<string,string[]>):void {this.db.exec('DELETE FROM tag_aliases');const insert=this.db.prepare('INSERT INTO tag_aliases(name,record) VALUES(?,?)');for(const [name,values] of Object.entries(aliases))insert.run(name,JSON.stringify(values));this.searchDirty=true}
  private canonicalTag(name:string,aliases=this.aliases()):string {const norm=normalizeSearch(name);return Object.keys(aliases).find(canonical=>normalizeSearch(canonical)===norm||aliases[canonical].some(alias=>normalizeSearch(alias)===norm))??name.trim()}
  listTags():TagSummary[]{this.ensureSearch();return this.search.tags().map(clone)}
  setTagAliases(name:string,values:string[]):void {if(typeof name!=='string'||!name.trim()||name.length>500||!Array.isArray(values))throw new Error('标签别名无效。');const canonical=name.trim(),before=this.aliases(),aliases=cleanStrings(values,20).filter(alias=>normalizeSearch(alias)!==normalizeSearch(canonical));const requested=new Set([canonical,...aliases].map(normalizeSearch));for(const [other,otherAliases] of Object.entries(before))if(other!==canonical&&[other,...otherAliases].some(alias=>requested.has(normalizeSearch(alias))))throw new Error('此别名已经属于其他标签。');const next={...before,[canonical]:aliases};this.transaction(()=>{this.putAliases(next);this.recordUndo({aliases:before})})}
  updateTags(ids:string[],add:string[],remove:string[]):void {if(!Array.isArray(add)||!Array.isArray(remove))throw new Error('标签列表无效。');const aliases=this.aliases(),added=cleanStrings(add).map(tag=>this.canonicalTag(tag,aliases)),removed=new Set(cleanStrings(remove).map(tag=>normalizeSearch(this.canonicalTag(tag,aliases))));this.transaction(()=>{const deltas:ManualDelta[]=[];for(const id of cleanStrings(ids,10000)){const record=this.getRaw(id);if(!record)continue;const result=new Map<string,string>();for(const tag of [...displayTags(record),...added]){const canonical=this.canonicalTag(tag,aliases),key=normalizeSearch(canonical);if(!removed.has(key))result.set(key,canonical)}if(result.size>100)throw new Error('标签超过 100 个，请先移除一些标签。');this.changeManual(record,{tags:[...result.values()]},deltas)}this.recordUndo({manual:deltas})})}
  mergeTags(names:string[],target:string):void {if(!Array.isArray(names)||typeof target!=='string'||!target.trim()||target.length>500)throw new Error('标签合并内容无效。');const selected=cleanStrings(names),canonical=target.trim(),before=this.aliases(),wanted=new Set(selected.map(name=>normalizeSearch(this.canonicalTag(name,before))));if(!wanted.size)return;const next={...before},targetAliases=new Set(before[canonical]??[]);for(const name of selected)targetAliases.add(name);for(const [name,aliases] of Object.entries(before))if(wanted.has(normalizeSearch(name))&&name!==canonical){targetAliases.add(name);aliases.forEach(alias=>targetAliases.add(alias));delete next[name]}next[canonical]=[...targetAliases].filter(alias=>normalizeSearch(alias)!==normalizeSearch(canonical)).slice(0,20);this.transaction(()=>{const deltas:ManualDelta[]=[];for(const source of this.raw.values()){const current=displayTags(source);if(!current.some(tag=>wanted.has(normalizeSearch(this.canonicalTag(tag,before)))))continue;const record=clone(source),tags=[...new Map(current.map(tag=>{const value=wanted.has(normalizeSearch(this.canonicalTag(tag,before)))?canonical:tag;return [normalizeSearch(value),value]})).values()];this.changeManual(record,{tags},deltas)}this.putAliases(next);this.recordUndo({manual:deltas,aliases:before})})}
  hasUndo():boolean {return !!this.db.prepare('SELECT id FROM metadata_undo ORDER BY id DESC LIMIT 1').get()}
  undoMetadata():boolean {const row=this.db.prepare('SELECT id,record FROM metadata_undo ORDER BY id DESC LIMIT 1').get() as {id:number;record:string}|undefined;if(!row)return false;const undo:Undo=JSON.parse(row.record);this.transaction(()=>{for(const delta of undo.manual??[]){const record=this.getRaw(delta.id);if(!record)continue;for(const [field,before] of Object.entries(delta.before)){if(before.exists)(record.manual as any)[field]=clone(before.value);else delete (record.manual as any)[field]}record.updatedAt=new Date().toISOString();this.put(record)}for(const item of undo.collections??[])if(item.before)this.putCollection(item.before);else this.db.prepare('DELETE FROM collections WHERE id=?').run(item.id);if(undo.aliases)this.putAliases(undo.aliases);this.db.prepare('DELETE FROM metadata_undo WHERE id=?').run(row.id)});return true}
  settings():AppSettings {
    const row=this.db.prepare('SELECT value FROM settings WHERE key=?').get('app') as {value:string}|undefined;
    let saved:any;try{saved=row?JSON.parse(row.value):undefined}catch{}
    return {roots:[...this.rootPaths],...(this.detachedRootPaths.length?{detachedRoots:[...this.detachedRootPaths]}:{}),onlineEnabled:saved?Boolean(saved.onlineEnabled):true,dataDir:this.dataDir,backupDir:typeof saved?.backupDir==='string'&&path.isAbsolute(saved.backupDir)?saved.backupDir:undefined,...(typeof saved?.boothDownloadDir==='string'&&path.isAbsolute(saved.boothDownloadDir)?{boothDownloadDir:saved.boothDownloadDir}:{}),uiZoom:typeof saved?.uiZoom==='number'&&saved.uiZoom>=0.67&&saved.uiZoom<=2?saved.uiZoom:1,downloadConcurrency:validDownloadConcurrency(saved?.downloadConcurrency)?saved.downloadConcurrency:3,...(['grid','list'].includes(saved?.viewMode)?{viewMode:saved.viewMode}:{}),...(['compact','standard','spacious'].includes(saved?.density)?{density:saved.density}:{}),...(['contain','cover'].includes(saved?.coverFit)?{coverFit:saved.coverFit}:{}),...(REVIEW_SORTS.includes(saved?.reviewSort)?{reviewSort:saved.reviewSort}:{}),theme:normalizeTheme(saved?.theme),language:normalizeLanguage(saved?.language),xThemeIntroduced:saved?.xThemeIntroduced===true};
  }
  /** Run once at application startup, before creating any native window. Both values share one atomic settings write. */
  introduceXTheme():AppSettings {
    const current=this.settings();return current.xThemeIntroduced?current:this.saveSettings({theme:'x',xThemeIntroduced:true});
  }
  saveSettings(patch:Partial<AppSettings>):AppSettings {
    const current=this.settings(),allowed=new Set(['roots','onlineEnabled','backupDir','uiZoom','downloadConcurrency','boothDownloadDir','viewMode','density','coverFit','reviewSort','theme','language','xThemeIntroduced']);
    const next={...current,...Object.fromEntries(Object.entries(patch).filter(([key])=>allowed.has(key))),dataDir:this.dataDir};
    next.roots=normalizeSourceRoots(next.roots);
    const enabled=next.roots.filter(root=>!current.roots.some(old=>sourcePathKey(old)===sourcePathKey(root)));
    const removed=current.roots.filter(root=>!next.roots.some(active=>isWithin(root,active)));
    next.detachedRoots=normalizeSourceRoots([...this.detachedRootPaths,...removed]).filter(root=>!enabled.some(active=>isWithin(root,active)));
    const protectedPaths=['E:\\VRChat',...next.roots,...next.detachedRoots];
    assertSafeWrite(path.join(this.dataDir,'library.sqlite'),this.dataDir,protectedPaths);
    if(next.backupDir!==undefined){if(typeof next.backupDir!=='string'||!path.isAbsolute(next.backupDir))throw new Error('备份路径必须为绝对路径。');next.backupDir=assertSafeWrite(next.backupDir,this.dataDir,protectedPaths,true)}
    if(next.boothDownloadDir!==undefined){if(typeof next.boothDownloadDir!=='string'||!path.isAbsolute(next.boothDownloadDir))throw new Error('BOOTH 下载路径必须为绝对路径。');next.boothDownloadDir=assertSafeWrite(next.boothDownloadDir,this.dataDir,protectedPaths,true)}
    if(typeof next.uiZoom!=='number'||!Number.isFinite(next.uiZoom)||next.uiZoom<0.67||next.uiZoom>2)throw new Error('界面缩放必须在 67% 到 200% 之间。');
    if(!validDownloadConcurrency(next.downloadConcurrency))throw new Error('并行补全数量必须是 1 到 6 之间的整数。');
    if(next.viewMode!==undefined&&!['grid','list'].includes(next.viewMode)||next.density!==undefined&&!['compact','standard','spacious'].includes(next.density)||next.coverFit!==undefined&&!['contain','cover'].includes(next.coverFit))throw new Error('显示偏好无效。');
    if(next.reviewSort!==undefined&&!REVIEW_SORTS.includes(next.reviewSort))throw new Error('待确认排序无效。');
    if(!THEME_IDS.includes(next.theme as any))throw new Error('主题无效。');
    if(!LANGUAGE_IDS.includes(next.language as any))throw new Error('界面语言无效。');
    if(typeof next.xThemeIntroduced!=='boolean')throw new Error('主题引入标记无效。');
    next.xThemeIntroduced=current.xThemeIntroduced||next.xThemeIntroduced;
    if(!next.detachedRoots.length)delete next.detachedRoots;
    this.writable();this.db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('app',JSON.stringify(next));this.rootPaths=next.roots;this.detachedRootPaths=next.detachedRoots??[];this.projection=undefined;this.invalidate();return next;
  }
  /** Unregister a scan scope; stored records and all original files remain intact. */
  removeRoot(root:string):void {
    const [resolved]=normalizeSourceRoots([root]);
    this.saveSettings({roots:this.rootPaths.filter(current=>sourcePathKey(current)!==sourcePathKey(resolved))});
  }
  /** Retain old aggregate annotations while removing a proven category shelf
   * from current product views. No filesystem or record deletion is involved. */
  markScanContainer(source:string):void {
    const existing=this.raw.get(this.paths.get(this.pathKey(source))??'');if(!existing||existing.scanContainer)return;
    this.writable();this.put({...existing,scanContainer:true} as StoredAsset);this.projection=undefined;this.invalidate();
  }
  exportData(target:string):void {
    const protectedPaths=this.protectedPaths(),destination=assertSafeWrite(target,this.dataDir,protectedPaths,true),assets=this.allStored(),collections=this.listCollections(),tagAliases=this.aliases(),recoveryRecords=this.recoveryRecords(),covers:Record<string,string>=Object.create(null),coverManifest:Record<string,{sha256:string;bytes:number}>=Object.create(null),manualCovers=new Set(assets.map(asset=>asset.manual.coverFile).filter(Boolean));let total=0;
    const downloadPaths=assets.filter(asset=>![...this.rootPaths,...this.detachedRootPaths].some(root=>isWithin(asset.path,root))).map(asset=>{if(asset.group!=='BOOTH 下载'||!['archive','unitypackage','file'].includes(asset.kind))throw new Error('备份包含未登记的素材范围外文件。');return safeBoothDownloadPath(asset.path,this.dataDir,protectedPaths)});
    const downloadReferences=downloadPaths.length?{downloadPaths}:{};
    for(const file of new Set(assets.flatMap(asset=>[asset.manual.coverFile,asset.online.coverFile,asset.previewFile,...(asset.online.candidates??[]).map(candidate=>candidate.coverFile)]).filter((file):file is string=>!!file))){
      const source=safeCoverPath(this.dataDir,file);try{const stat=fs.lstatSync(source);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>25*1024*1024){if(manualCovers.has(file))throw new Error('手动封面无法完整备份，请重新选择该图片。');continue;}total+=stat.size;if(total>256*1024*1024)throw new Error('封面超过 256 MB，请减少一次备份的图片数量。');const bytes=fs.readFileSync(source);covers[file]=bytes.toString('base64');coverManifest[file]={sha256:crypto.createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length};}catch(error:any){if(error.code!=='ENOENT')throw error;if(manualCovers.has(file))throw new Error('手动封面文件缺失，请重新选择该图片后备份。');}
    }
    const {dataDir:_dataDir,...settings}=this.settings(),metadataSha256=crypto.createHash('sha256').update(JSON.stringify({settings,assets,collections,tagAliases,recoveryRecords,...downloadReferences})).digest('hex'),serialized=JSON.stringify({format:'vrchat-asset-library',version:2,exportedAt:new Date().toISOString(),settings,assets,collections,tagAliases,recoveryRecords,...downloadReferences,covers,coverManifest,metadataSha256});
    if(Buffer.byteLength(serialized)>512*1024*1024)throw new Error('备份超过 512 MB，请减少一次备份的内容。');
    const temporary=assertSafeWrite(destination+'.'+crypto.randomUUID()+'.tmp',this.dataDir,protectedPaths,true);try{fs.writeFileSync(temporary,serialized,{flag:'wx'});assertSafeWrite(destination,this.dataDir,protectedPaths,true);fs.renameSync(temporary,destination)}catch(error){try{fs.unlinkSync(temporary)}catch{}throw error}
  }
  importData(source:string):void {
    const stat=fs.lstatSync(source);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>512*1024*1024)throw new Error('备份文件无效或超过 512 MB。');const backup=JSON.parse(fs.readFileSync(source,'utf8'));
    if(backup.format!=='vrchat-asset-library'||![1,2].includes(backup.version)||!Array.isArray(backup.assets)||backup.assets.length>100000)throw new Error('这不是可识别的素材库备份。');
    if(backup.version===2){const digest=crypto.createHash('sha256').update(JSON.stringify({settings:backup.settings,assets:backup.assets,collections:backup.collections,tagAliases:backup.tagAliases,recoveryRecords:backup.recoveryRecords,...(backup.downloadPaths!==undefined?{downloadPaths:backup.downloadPaths}:{})})).digest('hex');if(typeof backup.metadataSha256!=='string'||digest!==backup.metadataSha256)throw new Error('备份整理信息校验失败；当前标注和集合保持原样。');}
    const recoveryRecords:RecoveryRecord[]=[];if(backup.version===2&&backup.recoveryRecords!==undefined){if(!Array.isArray(backup.recoveryRecords)||backup.recoveryRecords.length>100000)throw new Error('备份保全记录格式无效。');for(const entry of backup.recoveryRecords){if(!entry||!['asset','collection','tag-alias','settings'].includes(entry.kind)||typeof entry.key!=='string'||entry.key.length>500||typeof entry.record!=='string'||Buffer.byteLength(entry.record)>32*1024*1024||typeof entry.error!=='string'||entry.error.length>2000)throw new Error('备份保全记录格式无效。');recoveryRecords.push({kind:entry.kind,key:entry.key,record:entry.record,error:entry.error});}}
    const roots=normalizeSourceRoots(backup.settings?.roots),detachedRoots=normalizeSourceRoots(backup.settings?.detachedRoots??[]),backupScopes=[...roots,...detachedRoots];
    const nextRoots=normalizeSourceRoots([...this.rootPaths,...roots]).filter(root=>!detachedRoots.some(detached=>isWithin(root,detached))||roots.some(active=>isWithin(root,active)));
    const nextDetachedRoots=normalizeSourceRoots([...this.detachedRootPaths.filter(root=>!roots.some(active=>isWithin(root,active))),...detachedRoots]);
    const protectedPaths=['E:\\VRChat',...nextRoots,...nextDetachedRoots];assertSafeWrite(this.dataDir,this.dataDir,protectedPaths);
    const downloads=new Set<string>();if(backup.downloadPaths!==undefined){if(backup.version!==2||!Array.isArray(backup.downloadPaths)||backup.downloadPaths.length>100000)throw new Error('备份的 BOOTH 下载白名单无效。');for(const value of backup.downloadPaths){const reference=safeBoothDownloadPath(value,this.dataDir,protectedPaths),key=this.pathKey(reference);if(downloads.has(key))throw new Error('备份的 BOOTH 下载白名单重复。');downloads.add(key);}}
    const usedDownloads=new Set<string>();
    const idMap=new Map<string,string>(),used=new Set<string>(),paths=new Set<string>();
    const records:AssetRecord[]=backup.assets.map((entry:any)=>{
      if(typeof entry?.path!=='string'||!path.isAbsolute(entry.path)||!kinds.includes(entry.kind))throw new Error('备份包含无效的素材记录。');
      if(!backupScopes.some(root=>isWithin(entry.path,root))){const key=this.pathKey(entry.path);if(entry.group!=='BOOTH 下载'||!['archive','unitypackage','file'].includes(entry.kind)||!downloads.has(key))throw new Error('备份包含无效的素材记录。');safeBoothDownloadPath(entry.path,this.dataDir,protectedPaths);usedDownloads.add(key);}
      let reference=path.resolve(entry.path),id=stableId(entry.id)?entry.id:assetId(reference);const atPath=this.paths.get(this.pathKey(reference));if(atPath)id=atPath;
      const existing=this.raw.get(id);if(existing&&existing.path!==reference&&(!sourcePathActive(existing.path,nextRoots,nextDetachedRoots)||!absent(existing.path)))reference=existing.path;
      if(used.has(id)||paths.has(this.pathKey(reference)))throw new Error('备份存在重复的素材身份或路径。');used.add(id);paths.add(this.pathKey(reference));if(typeof entry.id==='string')idMap.set(entry.id,id);idMap.set(assetId(entry.path),id);
      const now=new Date().toISOString(),record:StoredAsset={...(entry.scanContainer===true?{scanContainer:true}:{}),id,path:reference,name:typeof entry.name==='string'?entry.name.slice(0,1000):path.basename(reference),group:typeof entry.group==='string'?entry.group.slice(0,500):'导入',kind:entry.kind,size:Math.max(0,Number(entry.size)||0),mtimeMs:Number(entry.mtimeMs)||0,missing:sourcePathActive(reference,nextRoots,nextDetachedRoots)?absent(reference):entry.missing===true,localCategory:normalizeCategory(entry.localCategory)??'未分类',localAvatars:cleanStrings(entry.localAvatars),localEvidence:Array.isArray(entry.localEvidence)?cleanEvidence(entry.localEvidence):undefined,compatibilityComplete:entry.compatibilityComplete===true,hintUrls:cleanStrings(entry.hintUrls,20),localNameHints:cleanLocalNameHints(entry.localNameHints),fileIdentity:cleanIdentity(entry.fileIdentity),wrapper:validateWrapper(entry.wrapper,reference),previewFile:typeof entry.previewFile==='string'?entry.previewFile:undefined,manual:manualInfo(entry.manual??{}),online:onlineInfo(entry.online),createdAt:typeof entry.createdAt==='string'?entry.createdAt:now,updatedAt:now};
      if(existing&&reference===existing.path&&reference!==path.resolve(entry.path))for(const key of ['path','name','group','kind','size','mtimeMs','localCategory','localAvatars','localEvidence','compatibilityComplete','hintUrls','localNameHints','fileIdentity','wrapper','missing'] as const)(record as any)[key]=clone(existing[key]);
      for(const container of [record.manual,record.online,record,...(record.online.candidates??[])])for(const key of ['coverFile','previewFile'] as const){const value=(container as any)[key];if(value)safeCoverPath(this.dataDir,value)}return record;
    });
    if(downloads.size!==usedDownloads.size)throw new Error('备份下载白名单必须对应已登记的 BOOTH 下载文件。');
    for(const record of records)if(record.manual.relatedIds)record.manual.relatedIds=record.manual.relatedIds.map(id=>idMap.get(id)??id);
    const incomingCollections:LibraryCollection[]=[];for(const entry of Array.isArray(backup.collections)?backup.collections:[]){if(!stableId(entry?.id)||typeof entry.name!=='string'||!entry.name.trim()||entry.name.length>100||!['manual','smart'].includes(entry.kind))throw new Error('备份集合格式无效。');incomingCollections.push({id:entry.id,name:entry.name,kind:entry.kind,createdAt:typeof entry.createdAt==='string'?entry.createdAt:new Date().toISOString(),updatedAt:typeof entry.updatedAt==='string'?entry.updatedAt:new Date().toISOString(),...(entry.kind==='manual'?{assetIds:cleanStrings(entry.assetIds,100000).map(id=>idMap.get(id)??id).filter(id=>used.has(id)||this.raw.has(id))}:{query:cleanQuery(entry.query)})});}
    const aliases:Record<string,string[]>=Object.create(null);if(backup.tagAliases&&typeof backup.tagAliases==='object'&&!Array.isArray(backup.tagAliases))for(const [name,values] of Object.entries(backup.tagAliases)){if(!name.trim()||name.length>500||!Array.isArray(values))throw new Error('备份标签别名无效。');aliases[name]=cleanStrings(values,20)}
    const decoded:{name:string;file:string;bytes:Buffer}[]=[],renamed=new Map<string,string>();let coverBytes=0;
    if(!backup.covers||typeof backup.covers!=='object'||Array.isArray(backup.covers))throw new Error('备份封面清单无效。');
    for(const [name,encoded] of Object.entries(backup.covers)){
      safeCoverPath(this.dataDir,name);const extension=path.extname(name).toLowerCase();if(!['.png','.jpg','.jpeg','.webp','.gif','.bmp'].includes(extension)||typeof encoded!=='string'||encoded.length>36*1024*1024)throw new Error('备份封面格式无效。');
      const bytes=Buffer.from(encoded,'base64');coverBytes+=bytes.length;if(bytes.length>25*1024*1024||coverBytes>256*1024*1024)throw new Error('备份封面过大。');const digest=crypto.createHash('sha256').update(bytes).digest('hex');
      if(backup.version===2){const expected=backup.coverManifest?.[name];if(!expected||expected.sha256!==digest||expected.bytes!==bytes.length||bytes.toString('base64')!==encoded)throw new Error('备份封面校验失败；当前标注和集合保持原样。');}
      const file=digest+extension;decoded.push({name,file,bytes});renamed.set(name,file);
    }
    if(backup.version===2&&Object.keys(backup.coverManifest??{}).some(name=>!(name in backup.covers)))throw new Error('备份封面清单不完整。');
    if(backup.version===2&&records.some(record=>record.manual.coverFile&&!Object.hasOwn(backup.covers,record.manual.coverFile)))throw new Error('备份缺少手动封面；当前标注和集合保持原样。');
    for(const record of records)for(const container of [record.manual,record.online,record,...(record.online.candidates??[])])for(const key of ['coverFile','previewFile'] as const){const value=(container as any)[key];if(value)(container as any)[key]=renamed.get(value)??(fs.existsSync(safeCoverPath(this.dataDir,value))?value:undefined)}
    const current=this.settings();let backupDir=current.backupDir;const savedBackup=backup.settings?.backupDir;if(typeof savedBackup==='string'&&path.isAbsolute(savedBackup))try{backupDir=assertSafeWrite(savedBackup,this.dataDir,protectedPaths,true)}catch{}
    const boothDownloadDir=safeBackupDownloadDirectory(backup.settings?.boothDownloadDir,this.dataDir,protectedPaths)??safeBackupDownloadDirectory(current.boothDownloadDir,this.dataDir,protectedPaths);
    const preferences:Partial<AppSettings>={};for(const [key,values] of [['viewMode',['grid','list']],['density',['compact','standard','spacious']],['coverFit',['contain','cover']],['reviewSort',REVIEW_SORTS],['theme',THEME_IDS],['language',LANGUAGE_IDS]] as const)if(values.includes(backup.settings?.[key] as never))(preferences as any)[key]=backup.settings[key];
    const settings={...current,...preferences,xThemeIntroduced:current.xThemeIntroduced||backup.settings?.xThemeIntroduced===true,roots:nextRoots,detachedRoots:nextDetachedRoots,dataDir:this.dataDir,onlineEnabled:Boolean(backup.settings?.onlineEnabled),backupDir,boothDownloadDir,uiZoom:typeof backup.settings?.uiZoom==='number'&&Number.isFinite(backup.settings.uiZoom)&&backup.settings.uiZoom>=.67&&backup.settings.uiZoom<=2?backup.settings.uiZoom:current.uiZoom,downloadConcurrency:validDownloadConcurrency(backup.settings?.downloadConcurrency)?backup.settings.downloadConcurrency:3};
    const stage=assertSafeWrite(path.join(this.dataDir,'.restore-'+crypto.randomUUID()),this.dataDir,protectedPaths),cache=assertSafeWrite(path.join(this.dataDir,'cache'),this.dataDir,protectedPaths),created:string[]=[];fs.mkdirSync(stage);fs.mkdirSync(cache,{recursive:true});
    try{
      for(const item of decoded){const temporary=assertSafeWrite(path.join(stage,item.file),this.dataDir,protectedPaths);if(!fs.existsSync(temporary))fs.writeFileSync(temporary,item.bytes,{flag:'wx'});const target=assertSafeWrite(path.join(cache,item.file),this.dataDir,protectedPaths);if(!fs.existsSync(target)){fs.renameSync(temporary,target);created.push(target)}else if(crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex')!==path.basename(item.file, path.extname(item.file)))fs.renameSync(temporary,target);}
      this.transaction(()=>{for(const record of records)this.put(record);for(const collection of incomingCollections)this.putCollection(collection);if(backup.version===2)this.putAliases({...this.aliases(),...aliases});for(const entry of recoveryRecords)this.noteRecovery(entry);this.db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('app',JSON.stringify(settings));this.db.exec('DELETE FROM metadata_undo; DELETE FROM source_undo');});this.rootPaths=nextRoots;this.detachedRootPaths=nextDetachedRoots;this.projection=undefined;this.invalidate();
    }catch(error){for(const file of created)try{fs.unlinkSync(assertSafeWrite(file,this.dataDir,protectedPaths))}catch{}throw error}
    finally{for(const name of fs.readdirSync(stage))try{fs.unlinkSync(assertSafeWrite(path.join(stage,name),this.dataDir,protectedPaths))}catch{}try{fs.rmdirSync(stage)}catch{}}
  }
  waitSearchIdle():Promise<void>{return this.search.waitIdle()}
  close():void {this.search.close();this.db.close()}
}
