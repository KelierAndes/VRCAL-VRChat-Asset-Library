import fsp from 'node:fs/promises';
import path from 'node:path';
import type {BigIntStats} from 'node:fs';
import type {AssetRecord} from '../shared/contracts';

export type RecycleAsset = Pick<AssetRecord,'id'|'path'|'kind'>;
export interface PrepareAssetRecycleInput {
  selectedIds:readonly string[];
  /** Unmerged original records, including registered children of selected folders. */
  assets:readonly RecycleAsset[];
  roots:readonly string[];
  /** Protect these directories and their ancestors; ordinary child assets remain eligible. */
  protectedPaths?:readonly string[];
  dataDir:string;
  /** Exact ordinary files already validated by the BOOTH download policy. */
  allowedDownloadFiles?:readonly string[];
  /** Exact selected assets recorded as direct/manual sources, never shared roots. */
  allowedSourceRootAssets?:readonly string[];
  knownProjectPaths?:readonly string[];
  maxEntries?:number;
  maxDepth?:number;
}
export interface AssetRecycleTarget {
  readonly path:string;
  readonly assetIds:readonly string[];
  readonly kind:'file'|'folder';
}
export interface AssetRecyclePlan { readonly targets:readonly AssetRecycleTarget[] }
export interface AssetRecycleResult {
  path:string;
  assetIds:string[];
  status:'recycled'|'failed'|'not-run';
  error?:string;
}
export interface AssetRecycleOutcome { cancelled:boolean;results:AssetRecycleResult[] }
export interface ExecuteAssetRecycleOptions {
  /** Production adapter: Electron shell.trashItem. No permanent-delete fallback. */
  trashItem:(file:string)=>Promise<void>;
  /** Also used to stop when the active library changes, closes or migrates. */
  shouldCancel?:()=>boolean|Promise<boolean>;
}

interface PolicyPath { source:string;initialAliases:string[] }
interface Policy {
  roots:PolicyPath[];
  protectedPaths:PolicyPath[];
  dataDir:PolicyPath;
  allowedDownloadFiles:Set<string>;
  allowedSourceRootAssets:Set<string>;
  selectedPaths:Set<string>;
  projectPaths:PolicyPath[];
  maxEntries:number;
  maxDepth:number;
}
interface Snapshot { ancestors:Map<string,string>;entries:Map<string,string> }
interface Prepared { policy:Policy;snapshots:Snapshot[];used:boolean }
// The displayed plan contains no editable security decisions or filesystem snapshot.
const prepared = new WeakMap<AssetRecyclePlan,Prepared>();

function absolute(value:string):string {
  if(typeof value!=='string'||!value||value.includes('\0')||!path.isAbsolute(value)||
    process.platform==='win32'&&(value.startsWith('\\\\')||value.includes(':',3))) {
    throw new Error('素材路径必须是本机普通文件或文件夹的绝对路径。');
  }
  return path.resolve(value);
}
function key(value:string):string { const resolved=path.resolve(value);return process.platform==='win32'?resolved.toLowerCase():resolved }
function within(file:string,directory:string):boolean {
  const relative=path.relative(key(directory),key(file));
  return !relative||relative!=='..'&&!relative.startsWith(`..${path.sep}`)&&!path.isAbsolute(relative);
}
function same(a:string,b:string):boolean {return key(a)===key(b)}
function message(error:unknown):string {return error instanceof Error?error.message:String(error)}
/** Protection declarations may be links; deletion targets never may. */
async function pathAliases(source:string):Promise<string[]> {
  try {
    const actual=await fsp.realpath(source);
    return same(source,actual)?[source]:[source,actual];
  }catch(error:any) {
    if(error.code==='ENOENT'||error.code==='ENOTDIR')return [source];
    throw error;
  }
}
async function policyPath(value:string):Promise<PolicyPath> {
  const source=absolute(value);
  return {source,initialAliases:await pathAliases(source)};
}
async function protectedAliases(value:PolicyPath):Promise<string[]> {
  // Retain the confirmed location, and also protect any newly redirected alias.
  return [...value.initialAliases,...await pathAliases(value.source)];
}
function identity(stat:BigIntStats):string {
  return [stat.dev,stat.ino,stat.birthtimeNs,stat.mode].map(String).join(':');
}
function metadata(stat:BigIntStats):string {
  return [identity(stat),stat.size,stat.mtimeNs,stat.ctimeNs,stat.isDirectory()?'folder':'file'].map(String).join(':');
}
async function ordinary(file:string):Promise<BigIntStats> {
  const stat=await fsp.lstat(file,{bigint:true});
  if(stat.isSymbolicLink())throw new Error(`路径包含文件或目录链接，不能移入回收站：${file}`);
  if(!stat.isFile()&&!stat.isDirectory())throw new Error(`只能将普通文件或文件夹移入回收站：${file}`);
  return stat;
}
async function optionalStat(file:string):Promise<BigIntStats|undefined> {
  try{return await fsp.lstat(file,{bigint:true})}catch(error:any){if(error.code==='ENOENT'||error.code==='ENOTDIR')return undefined;throw error}
}
async function unityProject(directory:string):Promise<boolean> {
  const assets=await optionalStat(path.join(directory,'Assets'));
  if(!assets||!assets.isDirectory()&&!assets.isSymbolicLink())return false;
  const settings=await optionalStat(path.join(directory,'ProjectSettings'));
  if(!settings)return false;
  // Never follow a linked settings directory just to inspect a project marker.
  if(settings.isSymbolicLink())return true;
  if(!settings.isDirectory())return false;
  const packages=await optionalStat(path.join(directory,'Packages'));
  if(packages&&(packages.isDirectory()||packages.isSymbolicLink()))return true;
  const version=await optionalStat(path.join(directory,'ProjectSettings','ProjectVersion.txt'));
  // Linked markers still identify a protected project; they cannot authorize deletion.
  return !!version&&(version.isFile()||version.isSymbolicLink());
}

async function assertScope(file:string,stat:BigIntStats,policy:Policy):Promise<void> {
  if(same(file,path.parse(file).root))throw new Error('磁盘根目录受保护，不能移入回收站。');
  const approvedFile=stat.isFile()&&policy.allowedDownloadFiles.has(key(file));
  if((await protectedAliases(policy.dataDir)).some(directory=>within(directory,file)||within(file,directory)&&!approvedFile)) {
    throw new Error('资料库及其祖先、缓存和会话目录受保护，不能移入回收站。');
  }
  for(const protectedPath of policy.protectedPaths) {
    if((await protectedAliases(protectedPath)).some(directory=>within(directory,file))) {
      throw new Error('固定保护目录及其祖先不能移入回收站，手动素材根例外不适用。');
    }
  }
  let allowedScope=approvedFile;
  for(const root of policy.roots) {
    const current=await pathAliases(root.source);
    if(current.some(directory=>within(file,directory)))allowedScope=true;
    if(![...root.initialAliases,...current].some(directory=>within(directory,file)))continue;
    // The exception belongs to this exact root declaration. A second manual
    // alias cannot override a shared root that points at the same real folder.
    const approvedManualRoot=same(file,root.source)&&policy.selectedPaths.has(key(file))&&policy.allowedSourceRootAssets.has(key(file));
    if(!approvedManualRoot)throw new Error('素材根目录及其祖先受保护，不能移入回收站。');
  }
  if(!allowedScope)throw new Error('素材已脱离已登记的扫描或下载范围。');
  for(const project of policy.projectPaths) {
    if((await protectedAliases(project)).some(directory=>within(directory,file)||within(file,directory))) {
      throw new Error('Unity 工程及其祖先和内部文件受保护，不能移入回收站。');
    }
  }
}

/** Inspect the entire ancestor chain without enumerating any ancestor directory. */
async function ancestorSnapshot(file:string):Promise<Map<string,string>> {
  const result=new Map<string,string>();
  for(let cursor=file;;cursor=path.dirname(cursor)) {
    const stat=await ordinary(cursor);
    if(cursor!==file&&!stat.isDirectory())throw new Error(`素材祖先路径不是普通文件夹：${cursor}`);
    result.set(key(cursor),identity(stat));
    if(stat.isDirectory()&&await unityProject(cursor))throw new Error(`Unity 工程及其内部文件受保护：${cursor}`);
    if(path.dirname(cursor)===cursor)break;
  }
  const actual=await fsp.realpath(file);
  if(!same(actual,file))throw new Error('素材真实路径与登记路径不一致，可能包含目录链接。');
  return result;
}
function assertMapUnchanged(before:Map<string,string>,after:Map<string,string>):void {
  if(before.size!==after.size||[...before].some(([file,value])=>after.get(file)!==value)) {
    throw new Error('素材或目录身份已变化，请重新选择并确认回收站操作。');
  }
}

/** Only selected folder subtrees are enumerated, with explicit depth and entry limits. */
async function inspectTarget(target:AssetRecycleTarget,policy:Policy):Promise<Snapshot> {
  const stat=await ordinary(target.path);
  await assertScope(target.path,stat,policy);
  if((stat.isDirectory()?'folder':'file')!==target.kind)throw new Error('素材文件或文件夹类型已变化，请重新确认。');
  const ancestors=await ancestorSnapshot(target.path),entries=new Map<string,string>();
  let count=0;
  async function visit(file:string,current:BigIntStats,depth:number):Promise<void> {
    if(++count>policy.maxEntries)throw new Error(`待回收文件夹超过检查规模上限（${policy.maxEntries} 项），请缩小选择范围。`);
    if(depth>policy.maxDepth)throw new Error(`待回收文件夹超过目录深度上限（${policy.maxDepth} 层），请缩小选择范围。`);
    entries.set(key(file),metadata(current));
    if(!current.isDirectory())return;
    if(await unityProject(file))throw new Error(`待回收文件夹包含 Unity 工程，已保护整个文件夹：${file}`);
    if(!same(await fsp.realpath(file),file))throw new Error(`素材子目录包含目录链接：${file}`);
    const directory=await fsp.opendir(file);
    for await(const entry of directory) {
      const child=path.join(file,entry.name);
      await visit(child,await ordinary(child),depth+1);
    }
    if(metadata(await ordinary(file))!==metadata(current))throw new Error(`素材文件夹在检查期间已变化：${file}`);
  }
  await visit(target.path,stat,0);
  await assertScope(target.path,stat,policy);
  assertMapUnchanged(ancestors,await ancestorSnapshot(target.path));
  if(metadata(await ordinary(target.path))!==metadata(stat))throw new Error('素材在检查期间已变化，请重新确认。');
  return {ancestors,entries};
}
function assertSnapshotUnchanged(before:Snapshot,after:Snapshot):void {
  assertMapUnchanged(before.ancestors,after.ancestors);
  assertMapUnchanged(before.entries,after.entries);
}
function positiveLimit(value:number|undefined,fallback:number,allowZero=false):number {
  if(value===undefined)return fallback;
  if(!Number.isSafeInteger(value)||value<(allowZero?0:1)||value>1_000_000)throw new Error('回收站检查规模上限无效。');
  return value;
}

/** Prepare a trusted, immutable plan for a native user confirmation dialog. No files are changed. */
export async function prepareAssetRecycle(input:PrepareAssetRecycleInput):Promise<AssetRecyclePlan> {
  if(!Array.isArray(input.selectedIds)||!input.selectedIds.length||input.selectedIds.length>1000||
    !Array.isArray(input.assets)||!Array.isArray(input.roots))throw new Error('请选择 1 至 1000 个已登记素材。');
  const records=input.assets.map(asset=>({id:asset.id,path:absolute(asset.path),kind:asset.kind}));
  const byId=new Map<string,RecycleAsset>();
  for(const record of records) {
    if(typeof record.id!=='string'||!record.id||byId.has(record.id))throw new Error('素材登记记录无效或 ID 重复。');
    byId.set(record.id,record);
  }
  const selected=[...new Set(input.selectedIds)].map(id=>{
    const record=byId.get(id);
    if(!record)throw new Error('所选素材尚未登记或已不在资料库中。');
    if(record.kind==='unity-project')throw new Error('Unity 工程不能通过素材回收站操作删除。');
    return record;
  });
  const policy:Policy={
    roots:await Promise.all(input.roots.map(policyPath)),dataDir:await policyPath(input.dataDir),
    protectedPaths:await Promise.all((input.protectedPaths??[]).map(policyPath)),
    allowedDownloadFiles:new Set((input.allowedDownloadFiles??[]).map(file=>key(absolute(file)))),
    allowedSourceRootAssets:new Set((input.allowedSourceRootAssets??[]).map(file=>key(absolute(file)))),
    selectedPaths:new Set(selected.map(record=>key(record.path))),
    projectPaths:await Promise.all([...records.filter(record=>record.kind==='unity-project').map(record=>record.path),...(input.knownProjectPaths??[])].map(policyPath)),
    maxEntries:positiveLimit(input.maxEntries,100_000),maxDepth:positiveLimit(input.maxDepth,64,true)
  };
  const candidates:AssetRecycleTarget[]=[];
  for(const record of selected) {
    const stat=await ordinary(record.path);
    await assertScope(record.path,stat,policy);
    if(!candidates.some(target=>same(target.path,record.path)))candidates.push({path:record.path,assetIds:[],kind:stat.isDirectory()?'folder':'file'});
  }
  const targets=candidates.filter(target=>!candidates.some(parent=>parent!==target&&parent.kind==='folder'&&within(target.path,parent.path))).map(target=>Object.freeze({
    ...target,
    assetIds:Object.freeze(records.filter(record=>same(record.path,target.path)||target.kind==='folder'&&within(record.path,target.path)).map(record=>record.id))
  }));
  const snapshots:Snapshot[]=[];
  let totalEntries=0;
  for(const target of targets) {
    const snapshot=await inspectTarget(target,policy);
    totalEntries+=snapshot.entries.size;
    if(totalEntries>policy.maxEntries)throw new Error(`回收站计划超过检查规模上限（${policy.maxEntries} 项），请缩小选择范围。`);
    snapshots.push(snapshot);
  }
  const plan:AssetRecyclePlan=Object.freeze({targets:Object.freeze(targets)});
  prepared.set(plan,{policy,snapshots,used:false});
  return plan;
}

/** Execute once, reporting only OS-confirmed trash successes; errors never trigger permanent deletion. */
export async function executeAssetRecycle(plan:AssetRecyclePlan,options:ExecuteAssetRecycleOptions):Promise<AssetRecycleOutcome> {
  const saved=prepared.get(plan);
  if(!saved||saved.used)throw new Error('回收站计划无效或已经执行，请重新准备并确认。');
  if(typeof options.trashItem!=='function')throw new Error('缺少系统回收站适配器。');
  saved.used=true;
  const outcome:AssetRecycleOutcome={cancelled:false,results:plan.targets.map(target=>({path:target.path,assetIds:[...target.assetIds],status:'not-run'}))};
  async function cancelled():Promise<boolean> {
    try {
      if(!await options.shouldCancel?.())return false;
    }catch(error) {
      for(const result of outcome.results)if(result.status==='not-run')result.error=message(error);
    }
    outcome.cancelled=true;
    return true;
  }
  if(await cancelled())return outcome;
  // Fail the whole batch before the first OS call if any confirmed target changed.
  let invalid=false;
  for(let index=0;index<plan.targets.length;index++) {
    try {assertSnapshotUnchanged(saved.snapshots[index],await inspectTarget(plan.targets[index],saved.policy))}
    catch(error) {invalid=true;outcome.results[index].status='failed';outcome.results[index].error=message(error)}
  }
  if(invalid)return outcome;
  for(let index=0;index<plan.targets.length;index++) {
    if(await cancelled())break;
    const target=plan.targets[index],result=outcome.results[index];
    try {
      assertSnapshotUnchanged(saved.snapshots[index],await inspectTarget(target,saved.policy));
      if(await cancelled())break;
      // No external hook is awaited after this complete subtree/identity check.
      // A path-based OS trash API cannot atomically bind the call to these stats.
      assertSnapshotUnchanged(saved.snapshots[index],await inspectTarget(target,saved.policy));
      await options.trashItem(target.path);
      result.status='recycled';
    }catch(error) {result.status='failed';result.error=message(error)}
  }
  return outcome;
}
