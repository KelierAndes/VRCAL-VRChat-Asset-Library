import fsp from 'node:fs/promises';
import path from 'node:path';
import {AssetRecord,ProjectMaterialEvidence,ProjectMaterialMatch,ProjectMaterialPage,displayCategory,displayTitle} from '../shared/contracts';
import {isWithin} from './safety';
import {isOrganizationalAsset,isOrganizationalFolderName} from './organization';
import {isAvatarName} from './hints';
import {productName} from './grouping';
import {creatorClue} from './matching';

const MAX_ENTRIES=12000,MAX_DEPTH=12,MAX_TIME=2500,MAX_EVIDENCE=12,CACHE_TIME=5*60*1000;
const MODEL=/\.(?:fbx|blend|vrm|obj|glb|gltf|dae)$/i;
const CACHES=new Set(['library','temp','obj','logs','usersettings','.git','.svn','node_modules','.vs','.vscode','build','builds']);
const SOFTWARE=/^(?:unity(?:hub)?|vrchat[ _-]*creator[ _-]*companion|vrc[ _-]*companion)$/i;
const GENERIC=new Set('assets|asset|materials|material|textures|texture|psd|png|prefab|prefabs|model|models|mesh|meshes|animation|animations|animator|controller|controllers|readme|editor|scripts|script|resources|data|demo|sample|samples|example|examples|unitypackage|package|pack|packages|plugins|gizmos|streamingassets|projectsettings|library|temp|logs|presets|preview|cover|thumbnail|matcap|mask|body|face|head|hair|shoe|shoes|dress|outfit|clothes|clothing|shader|shaders|服装|衣装|衣服|素材|模型|贴图|头发|饰品|封面|预览|マテリアル|テクスチャ|サムネイル'.split('|'));
type PhysicalEvidence=Omit<ProjectMaterialEvidence,'alias'>;
type Walk={entries:PhysicalEvidence[];inspectedEntries:number;scannedAt:string;truncated:boolean;warnings:string[]};
type CachedWalk={key:string;expires:number;walk:Walk};
const cache=new Map<string,CachedWalk>();
const normalizedAliases=new Map<string,string>();
class Deadline extends Error{}
class Cancelled extends Error{}
class Unavailable extends Error{}
function canonicalPath(value:string):string{return process.platform==='win32'?path.resolve(value).toLowerCase():path.resolve(value)}
export function clearProjectMaterialCache(projectPath:string):void{cache.delete(canonicalPath(projectPath))}
function normalizeAlias(value:string):string {const existing=normalizedAliases.get(value);if(existing!==undefined)return existing;const result=productName(value.replace(/\.(?:zip|rar|7z|unitypackage|prefab|fbx|blend|vrm|obj|glb|gltf|dae)$/i,'')).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');if(normalizedAliases.size<20000&&value.length<=1000)normalizedAliases.set(value,result);return result}
function isDistinctive(value:string,asset:AssetRecord,creators:Set<string>):boolean {
  const normalized=normalizeAlias(value);if(normalized.length<2||normalized.length<3&&!/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]{2}$/u.test(normalized)||/^\d+$/.test(normalized)||GENERIC.has(normalized)||isOrganizationalFolderName(value))return false;
  if(/^(?:[a-z]*\d+)?(?:materials?|textures?|psd|prefabs?|meshes?|fbx|unitypackage|packages?|pack|readme|matcap|mask)+$/.test(normalized))return false;
  if(creators.has(normalized))return false;
  if(displayCategory(asset)!=='模型'&&isAvatarName(value.replace(/\.[^.]+$/,'')))return false;
  return true;
}
function addWarning(warnings:string[],message:string):void {if(warnings.length<20&&!warnings.includes(message))warnings.push(message)}

/** Name evidence reports imported-looking content; it does not establish use, licensing, or completion. */
export async function inspectProjectMaterials(project:AssetRecord,assets:AssetRecord[],roots:string[],signal?:AbortSignal):Promise<ProjectMaterialPage>{
  if(project.kind!=='unity-project'||!path.isAbsolute(project.path))throw new Error('请选择有效的 Unity 工程。');
  if(signal?.aborted)throw new Error('工程素材检查已取消。');
  const candidates=roots.filter(root=>path.isAbsolute(root)&&isWithin(project.path,root));if(!candidates.length)throw new Error('工程不在已登记的素材目录内。');
  const warnings:string[]=[];let timer:ReturnType<typeof setTimeout>|undefined,onAbort:(()=>void)|undefined;
  let rejectStop:(reason:Error)=>void=()=>{};const stopped=new Promise<never>((_resolve,reject)=>{rejectStop=reject});stopped.catch(()=>{});
  let physicalStopped=false;timer=setTimeout(()=>{physicalStopped=true;rejectStop(new Deadline('工程目录检查达到时间上限。'))},MAX_TIME);
  if(signal){onAbort=()=>rejectStop(new Cancelled('工程素材检查已取消。'));signal.addEventListener('abort',onAbort,{once:true})}
  const bounded=<T>(operation:Promise<T>):Promise<T>=>Promise.race([operation,stopped]);
  let walk:Walk={entries:[],inspectedEntries:0,scannedAt:new Date().toISOString(),truncated:false,warnings:[]};
  try{
    let rootReal:string|undefined,linkedRoot=false;
    for(const root of candidates){try{const stat=await bounded(fsp.lstat(root));if(stat.isSymbolicLink()){linkedRoot=true;continue}if(!stat.isDirectory())continue;const resolved=await bounded(fsp.realpath(root));if(!rootReal||root.length>rootReal.length)rootReal=resolved}catch(error){if(error instanceof Deadline||error instanceof Cancelled)throw error}}
    if(!rootReal){if(linkedRoot)throw new Error('素材根目录是目录链接，已拒绝检查。');throw new Unavailable('素材根目录暂时无法读取；仍显示已有手动关联。');}
    const projectStat=await bounded(fsp.lstat(project.path));if(!projectStat.isDirectory()||projectStat.isSymbolicLink())throw new Error('工程不是普通目录，目录链接不会检查。');
    const projectReal=await bounded(fsp.realpath(project.path));if(!isWithin(projectReal,rootReal))throw new Error('工程的真实位置超出素材根目录。');
    for(let cursor=project.path;canonicalPath(cursor)!==canonicalPath(rootReal);){const stat=await bounded(fsp.lstat(cursor));if(stat.isSymbolicLink())throw new Error('工程路径经过目录链接，已拒绝检查。');const parent=path.dirname(cursor);if(parent===cursor)break;cursor=parent}
    const assetsPath=path.join(project.path,'Assets'),stat=await bounded(fsp.lstat(assetsPath));if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('工程 Assets 不是普通目录，目录链接不会检查。');
    const assetsReal=await bounded(fsp.realpath(assetsPath));if(!isWithin(assetsReal,projectReal)||!isWithin(assetsReal,rootReal))throw new Error('工程 Assets 的真实位置超出素材根目录。');
    const key=assetsReal+':'+stat.dev+':'+stat.ino+':'+stat.mtimeMs+':'+rootReal,cached=cache.get(canonicalPath(project.path));
    if(cached&&cached.key===key&&cached.expires>Date.now())walk=cached.walk;
    else{
      const queue=[{directory:assetsPath,depth:0}],entries:PhysicalEvidence[]=[];let cursor=0,inspectedEntries=0,truncated=false,skippedLinks=0,unreadable=0;walk={entries,inspectedEntries:0,scannedAt:new Date().toISOString(),truncated:false,warnings:[]};
      while(cursor<queue.length&&!truncated){const task=queue[cursor++];if(task.depth>MAX_DEPTH){truncated=true;break}let handle:Awaited<ReturnType<typeof fsp.opendir>>|undefined;
        try{
          const dirStat=await bounded(fsp.lstat(task.directory));if(dirStat.isSymbolicLink()||!dirStat.isDirectory()){skippedLinks++;continue}const real=await bounded(fsp.realpath(task.directory));if(!isWithin(real,assetsReal)){skippedLinks++;continue}
          const opening=fsp.opendir(task.directory,{bufferSize:64});opening.then(open=>{if(signal?.aborted||physicalStopped)void open.close().catch(()=>{})}).catch(()=>{});handle=await bounded(opening);
          if(!isWithin(await bounded(fsp.realpath(task.directory)),assetsReal)){skippedLinks++;continue}
          for(;;){const entry=await bounded(handle.read());if(!entry)break;walk.inspectedEntries=Math.min(++inspectedEntries,MAX_ENTRIES);if(inspectedEntries>MAX_ENTRIES){truncated=true;break}if(signal?.aborted)throw new Cancelled('工程素材检查已取消。');if(entry.isSymbolicLink()){skippedLinks++;continue}if(CACHES.has(entry.name.toLowerCase())||SOFTWARE.test(entry.name))continue;
            const source=path.join(task.directory,entry.name);let kind:PhysicalEvidence['kind']|undefined;if(entry.isDirectory())kind='directory';else if(entry.isFile()&&/\.prefab$/i.test(entry.name))kind='prefab';else if(entry.isFile()&&MODEL.test(entry.name))kind='model';
            if(kind){const entryStat=await bounded(fsp.lstat(source));if(entryStat.isSymbolicLink()||!isWithin(await bounded(fsp.realpath(source)),assetsReal)){skippedLinks++;continue}entries.push({path:source,name:entry.name,kind});if(kind==='directory')queue.push({directory:source,depth:task.depth+1})}
            if(inspectedEntries%64===0)await bounded(new Promise<void>(resolve=>setImmediate(resolve)));
          }
        }catch(error){if(error instanceof Deadline||error instanceof Cancelled)throw error;unreadable++}finally{if(handle)await bounded(handle.close()).catch(()=>{})}
      }
      walk={entries,inspectedEntries,scannedAt:new Date().toISOString(),truncated,warnings:[]};if(truncated)addWarning(walk.warnings,'工程内容较多或目录过深；只显示本次检查范围内的名称线索。');if(skippedLinks)addWarning(walk.warnings,'已跳过文件或目录链接。');if(unreadable)addWarning(walk.warnings,'部分 Assets 目录或文件无法读取。');
      if(cache.size>=8&&!cache.has(canonicalPath(project.path)))cache.delete(cache.keys().next().value!);cache.set(canonicalPath(project.path),{key,expires:Date.now()+CACHE_TIME,walk});
    }
  }catch(error){if(error instanceof Cancelled)throw error;if(error instanceof Deadline){walk.truncated=true;addWarning(warnings,'工程目录检查达到时间上限；已保留检查范围内的线索。')}else if(error instanceof Unavailable)addWarning(warnings,error.message);else if((error as NodeJS.ErrnoException).code==='ENOENT'||(error as NodeJS.ErrnoException).code==='ENOTDIR')addWarning(warnings,'工程或 Assets 目录不存在；仍显示已有手动关联。');else throw error;}
  finally{if(timer)clearTimeout(timer);if(signal&&onAbort)signal.removeEventListener('abort',onAbort)}
  if(signal?.aborted)throw new Cancelled('工程素材检查已取消。');
  const projectIds=new Set([project.id,...(project.members??[]).map(member=>member.id)]),manualIds=new Set(project.manual.relatedIds??[]),catalog=new Map<string,AssetRecord>();for(const asset of assets)if(asset.id!==project.id&&asset.kind!=='unity-project')catalog.set(asset.id,asset);
  const aliases=new Map<string,Map<string,{asset:AssetRecord;alias:string}>>(),result=new Map<string,{asset:AssetRecord;manual:boolean;certain:boolean;uncertain:boolean;evidence:ProjectMaterialEvidence[]}>();
  let processedAssets=0;for(const asset of catalog.values()){
    if(++processedAssets%64===0){await new Promise<void>(resolve=>setImmediate(resolve));if(signal?.aborted)throw new Cancelled('工程素材检查已取消。')}
    const ids=[asset.id,...(asset.members??[]).map(member=>member.id)],related=[...(asset.manual.relatedIds??[]),...(asset.members??[]).flatMap(member=>member.manual?.relatedIds??[])],manual=ids.some(id=>manualIds.has(id))||related.some(id=>projectIds.has(id));if(manual)result.set(asset.id,{asset,manual:true,certain:false,uncertain:false,evidence:[]});
    if(isOrganizationalAsset(asset))continue;
    const creators=new Set([asset.online.author,creatorClue(asset.name)].filter((value):value is string=>!!value).map(normalizeAlias));for(const alias of new Set([asset.name,asset.online.title??'',...(asset.localNameHints??[]),...(asset.members??[]).slice(0,100).map(member=>member.name)]))if(isDistinctive(alias,asset,creators)){const normalized=normalizeAlias(alias),bucket=aliases.get(normalized)??new Map();if(!bucket.has(asset.id))bucket.set(asset.id,{asset,alias});aliases.set(normalized,bucket)}
  }
  let ambiguous=0;for(const entry of walk.entries){const bucket=aliases.get(normalizeAlias(entry.name));if(!bucket)continue;if(bucket.size>1)ambiguous++;for(const {asset,alias} of bucket.values()){const item=result.get(asset.id)??{asset,manual:false,certain:false,uncertain:false,evidence:[]};if(bucket.size===1)item.certain=true;else item.uncertain=true;if(item.evidence.length<MAX_EVIDENCE&&!item.evidence.some(previous=>previous.path===entry.path))item.evidence.push({...entry,alias});result.set(asset.id,item)}}
  if(ambiguous)addWarning(warnings,'部分名称同时对应多个库内素材，已标为不确定；请手动核对。');for(const message of walk.warnings)addWarning(warnings,message);
  const items:ProjectMaterialMatch[]=[...result.values()].map(item=>({assetId:item.asset.id,asset:item.asset,relation:item.manual?(item.certain?'both':'manual'):item.uncertain?'uncertain':'detected',evidence:item.evidence}));items.sort((a,b)=>Number(b.relation==='manual'||b.relation==='both')-Number(a.relation==='manual'||a.relation==='both')||displayTitle(a.asset).localeCompare(displayTitle(b.asset),'zh-CN'));
  return {projectId:project.id,items,inspectedEntries:Math.min(walk.inspectedEntries,MAX_ENTRIES),scannedAt:walk.scannedAt,truncated:walk.truncated,warnings};
}
