import fsp from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {type AssetRecord,displayTitle} from '../shared/contracts';
import type {ProjectImportJob} from '../shared/project-contracts';
import type {ProjectProduct,ProjectProductPage,ProjectProductEvidence} from '../shared/project-product-contracts';
import type {ScanInput} from './store';
import {noLinks,relativeAssetPath,validateProject,type ProjectAccess} from './project-access';
import {isWithin} from './safety';
import {boothProductId,extractBoothIds,filenameIdentityConflict} from './matching';
import {inferAvatars,inferCategory} from './hints';
import {isOrganizationalFolderName} from './organization';
import {productName} from './grouping';
import {cleanImportedPaths} from './project-locations';

const GENERIC=new Set('assets|prefab|prefabs|materials|material|textures|texture|model|models|meshes|mesh|animations|animation|editor|scripts|script|resources|data|demo|samples|sample|examples|example|plugins|shaders|shader|psd|png|fbx|readme|preview|previews|images|icons|gizmos|streamingassets|衣服|衣装|服装|素材|模型|贴图|头发|饰品|マテリアル|テクスチャ'.split('|'));
const SKIP=new Set(['vrcalmasetup','vrcalimportbridge','library','temp','obj','logs','packages','projectsettings','usersettings','node_modules','build','builds']);
const PAYLOAD=/\.(?:prefab|fbx|blend|obj|vrm|glb|gltf|dae|mat|anim|controller|shader|hlsl|cs|png|jpe?g|tga|psd|exr|asset)$/i;
const DOC=/^(?:(?:readme|read[ _-]?me|license|booth|source|商品|说明|説明|利用規約|使用说明)[^/]*\.(?:md|txt|url)|[^/]*booth[^/]*\.url)$/i;
const normal=(value:string)=>productName(value.replace(/\.[^.]+$/,'')).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const meaningful=(name:string)=>(!!normal(name)||/^\d{1,12}$/.test(name))&&!GENERIC.has(name.normalize('NFKC').toLowerCase())&&!isOrganizationalFolderName(name);
const keyPath=(p:string)=>process.platform==='win32'?path.resolve(p).toLowerCase():path.resolve(p);
const parent=(relative:string)=>{const p=path.posix.dirname(relative);return p==='.'?'':p};
const under=(relative:string,dir:string)=>relative===dir||relative.startsWith(dir+'/');
const canonical=(id:string)=>'https://booth.pm/zh-cn/items/'+id;
interface Entry {relative:string;name:string;directory:boolean;links?:string[]}
interface Walk {entries:Entry[];inspected:number;scannedAt:string;truncated:boolean;warnings:string[]}
const cache=new Map<string,{identity:string;walk:Walk}>(),pending=new Map<string,Promise<Walk>>();
export function clearProjectProductCache(projectPath:string):void{cache.delete(keyPath(projectPath))}
async function nestedProject(folder:string):Promise<boolean>{for(const part of ['Assets','Packages','ProjectSettings'])try{const s=await fsp.lstat(path.join(folder,part));if(!s.isDirectory()||s.isSymbolicLink())return false}catch{return false}return true}
async function readWalk(project:ProjectAccess):Promise<Walk>{
 const assetsStat=await fsp.lstat(project.assets),identity=project.root+':'+project.device+':'+project.inode+':'+assetsStat.dev+':'+assetsStat.ino,cached=cache.get(keyPath(project.root));if(cached?.identity===identity)return cached.walk;
 const inFlight=pending.get(identity);if(inFlight)return inFlight;
 const operation=(async()=>{
  const result:Walk={entries:[],inspected:0,scannedAt:new Date().toISOString(),truncated:false,warnings:[]},queue=[{relative:'',depth:0}],deadline=Date.now()+8000;let docs=0,bytes=0,links=0,errors=0;
  outer:for(let cursor=0;cursor<queue.length;cursor++){
   const task=queue[cursor],folder=path.join(project.assets,task.relative);let handle;
   if(task.depth>20){result.truncated=true;continue}
   try{
    await noLinks(folder);if(task.relative&&await nestedProject(folder))continue;
    handle=await fsp.opendir(folder);
    for await(const e of handle){
     if(++result.inspected>60000||Date.now()>deadline){result.truncated=true;break outer}
     if(e.isSymbolicLink()){links++;continue}if(e.name.startsWith('.')||SKIP.has(e.name.toLowerCase())||/\.meta$/i.test(e.name))continue;
     if(!e.isDirectory()&&!e.isFile())continue;
     const relative=[task.relative,e.name].filter(Boolean).join('/');if(!cleanImportedPaths(['Assets/'+relative]).length)continue;
     const entry:Entry={relative,name:e.name,directory:e.isDirectory()};result.entries.push(entry);
     if(e.isDirectory())queue.push({relative,depth:task.depth+1});
     else if(DOC.test(e.name)&&docs<100&&bytes<2*1024*1024){
      docs++;const file=relativeAssetPath(project.assets,relative);await noLinks(file);const stat=await fsp.lstat(file);
      if(stat.isFile()&&stat.size<=128*1024&&bytes+stat.size<=2*1024*1024){
       const h=await fsp.open(file,'r');let data:Buffer;try{const b=Buffer.alloc(Math.min(128*1024+1,stat.size+1));const r=await h.read(b,0,b.length,0);data=b.subarray(0,r.bytesRead)}finally{await h.close()}
       bytes+=data.length;if(data.length>128*1024)continue;
       const text=data[0]===255&&data[1]===254?data.subarray(2).toString('utf16le'):data.toString('utf8');
       entry.links=[...new Set([...text.matchAll(/https:\/\/[^\s<>"'\u0000-\u0020]+/gi)].map(m=>boothProductId(m[0].replace(/[).,;，。）」】]+$/g,''))).filter((id):id is string=>!!id))].slice(0,10).map(canonical);
      }
     }
    }
   }catch{errors++}finally{await handle?.close().catch(()=>{})}
  }
  await noLinks(project.root);await noLinks(project.assets);const current=await fsp.lstat(project.root);if(current.dev!==project.device||current.ino!==project.inode)throw new Error('工程目录已变化，请重新选择工程。');
  if(errors)result.truncated=true;
  if(docs>=100||bytes>=2*1024*1024)result.warnings.push('工程说明读取达到上限，部分商品可能缺少来源链接。');
  if(links)result.warnings.push('已跳过文件或目录链接。');if(errors)result.warnings.push('部分工程目录或说明无法读取，当前结果不完整。');if(result.truncated)result.warnings.push('工程商品检查达到数量、深度或时间上限，请结合工程文件核对。');
  result.scannedAt=new Date().toISOString();if(cache.size>=8)cache.delete(cache.keys().next().value!);cache.set(keyPath(project.root),{identity,walk:result});return result;
 })();pending.set(identity,operation);try{return await operation}finally{pending.delete(identity)}
}
/** Read-only discovery. Directory names and README references remain clues until the user confirms or BOOTH verifies them. */
export async function inspectProjectProducts(projectRecord:AssetRecord,catalog:AssetRecord[],roots:string[],jobs:Pick<ProjectImportJob,'assetId'|'projectId'|'projectPath'|'state'|'mode'|'destinationContainer'|'importedAssetPaths'>[]=[]):Promise<ProjectProductPage>{
 const project=await validateProject(projectRecord,roots),walk=await readWalk(project),entries=new Map(walk.entries.map(e=>[e.relative,e])),products=new Map<string,ProjectProduct>();
 const docsByParent=new Map<string,Entry[]>(),meaningfulChildren=new Map<string,number>(),anchors=new Map<string,string>();
 for(const e of walk.entries){if(e.links?.length){const list=docsByParent.get(parent(e.relative))??[];list.push(e);docsByParent.set(parent(e.relative),list)}if(e.directory&&meaningful(e.name))meaningfulChildren.set(parent(e.relative),(meaningfulChildren.get(parent(e.relative))??0)+1)}
 let productLimit=false;
 const assets=catalog.filter(a=>a.kind!=='unity-project'),aliases=new Map<string,Set<AssetRecord>>(),ids=new Map<string,Set<AssetRecord>>(),paths=new Map<string,AssetRecord>();
 const add=(map:Map<string,Set<AssetRecord>>,key:string,a:AssetRecord)=>{if(!key)return;const values=map.get(key)??new Set();values.add(a);map.set(key,values)};
 for(const a of assets){for(const p of [a.path,...(a.members??[]).map(m=>m.path)])paths.set(keyPath(p),a);for(const name of [a.name,a.online.title??'',...(a.online.titleAliases??[]),...(a.localNameHints??[])])if(meaningful(name))add(aliases,normal(name),a);const id=boothProductId(a.manual.sourceUrl??a.online.url);if(id)add(ids,id,a)}
 const imported=new Map<string,AssetRecord>();
 for(const job of jobs){if(job.state!=='completed'||job.projectId!==projectRecord.id||job.projectPath!==project.root)continue;const a=assets.find(a=>a.id===job.assetId||(a.members??[]).some(m=>m.id===job.assetId));if(!a)continue;
  const locations=job.mode==='copy'&&job.destinationContainer?[path.relative(project.root,job.destinationContainer).split(path.sep).join('/')]:cleanImportedPaths(job.importedAssetPaths);
  for(const p of cleanImportedPaths(locations)){const relative=p.slice(7);if(entries.has(relative))imported.set(relative,a)}
 }
 const anchor=(e:Entry):string=>{
  const base=parent(e.relative);if(base&&anchors.has(base))return anchors.get(base)!;
  let relative=base,chosen='';while(relative){const name=path.posix.basename(relative);if(meaningful(name)){chosen=relative;break}relative=parent(relative)}
  if(!chosen)return !parent(e.relative)&&PAYLOAD.test(e.name)?e.relative:'';
  for(let cursor=chosen;cursor;cursor=parent(cursor))if(extractBoothIds(path.posix.basename(cursor)).length||imported.has(cursor)){chosen=cursor;break}
  for(;;){const p=parent(chosen);if(!p||normal(path.posix.basename(p))!==normal(path.posix.basename(chosen)))break;if(meaningfulChildren.get(p)!==1)break;chosen=p}
  if(base)anchors.set(base,chosen);return chosen;
 };
 for(const e of walk.entries){if(e.directory||!PAYLOAD.test(e.name)||/^(?:preview|cover|thumbnail)(?:[_.-]|\.)/i.test(e.name))continue;const location=anchor(e);if(!location)continue;
  let product=products.get(location);if(!product){if(products.size>=2000){productLimit=true;continue}const name=entries.get(location)?.name??e.name;product={key:createHash('sha256').update(projectRecord.id+'\0'+location).digest('hex').slice(0,32),name,paths:[location],hintUrls:[],localNameHints:[],evidence:[{kind:'directory',relativePath:location}],state:'pending'};products.set(location,product)}
  if(/\.(?:prefab|fbx|blend|obj|vrm|glb|gltf|dae)$/i.test(e.name))for(const id of extractBoothIds(e.name)){if(!product.hintUrls.includes(canonical(id)))product.hintUrls.push(canonical(id));if(product.evidence.length<12)product.evidence.push({kind:'filename-id',relativePath:e.relative,value:id})}
  if(product.localNameHints.length<12&&!/\.(?:png|jpe?g|psd|tga|exr|cs|mat)$/i.test(e.name))product.localNameHints.push(e.name.replace(/\.(?:prefab|fbx|blend|obj|vrm|glb|gltf|dae)$/i,''));
 }
 for(const [location,p] of products){
  const primary=extractBoothIds(p.name);for(const id of primary){if(!p.hintUrls.includes(canonical(id)))p.hintUrls.push(canonical(id));p.evidence.push({kind:'filename-id',relativePath:location,value:id})}
  for(const doc of docsByParent.get(location)??[]){for(const url of doc.links??[])if(!p.hintUrls.includes(url))p.hintUrls.push(url);for(const url of (doc.links??[]).slice(0,6))p.evidence.push({kind:'readme-link',relativePath:doc.relative,value:url})}
  const exact=paths.get(keyPath(path.join(project.assets,location))),receipt=[...imported].find(([where])=>under(where,location)||under(location,where)),byId=new Set(primary.flatMap(id=>[...(ids.get(id)??[])])),names=aliases.get(normal(p.name))??new Set<AssetRecord>();
  const chosen=exact??receipt?.[1]??(primary.length===1&&byId.size===1?[...byId][0]:names.size===1?[...names][0]:undefined);
  if(chosen){p.asset=chosen;const id=boothProductId(chosen.manual.sourceUrl??chosen.online.url),safeId=primary.length===1&&id===primary[0]&&!filenameIdentityConflict(p.name,{url:chosen.manual.sourceUrl??chosen.online.url??'',title:displayTitle(chosen),author:chosen.online.author,authorAliases:chosen.online.authorAliases});p.state=chosen.online.status==='matched'&&(exact||receipt||safeId)?'identified':'clue';p.evidence.push({kind:receipt?'import-record':'catalog-name',relativePath:location,value:displayTitle(chosen)})}
  else if(names.size>1||byId.size>1||primary.length>1||p.hintUrls.length>1)p.state='ambiguous';
  p.hintUrls=p.hintUrls.slice(0,10);p.evidence=p.evidence.slice(0,12);
 }
 const combined=new Map<string,ProjectProduct>();for(const p of products.values()){
  const id=extractBoothIds(p.name),group=p.asset&&(p.state==='identified'||p.evidence.some(e=>e.kind==='import-record'))?'asset:'+p.asset.id:id.length===1?'booth:'+id[0]:'path:'+p.paths[0],old=combined.get(group);
  if(old){old.paths=[...new Set([...old.paths,...p.paths])].slice(0,20);old.evidence=[...old.evidence,...p.evidence].slice(0,12);old.hintUrls=[...new Set([...old.hintUrls,...p.hintUrls])].slice(0,10)}else combined.set(group,p);
 }
 const linkedIds=new Set(projectRecord.manual.relatedIds??[]),projectIds=new Set([projectRecord.id,...(projectRecord.members??[]).map(m=>m.id)]);
 for(const a of assets)if((linkedIds.has(a.id)||(a.members??[]).some(m=>linkedIds.has(m.id))||(a.manual.relatedIds??[]).some(id=>projectIds.has(id)))&&![...combined.values()].some(p=>p.asset?.id===a.id&&(p.state==='identified'||p.evidence.some(e=>e.kind==='import-record')||p.paths.some(relative=>[a.path,...(a.members??[]).map(m=>m.path)].some(file=>keyPath(file)===keyPath(path.join(project.assets,relative)))))))combined.set('manual:'+a.id,{key:createHash('sha256').update(projectRecord.id+'\0manual:'+a.id).digest('hex').slice(0,32),name:a.name,paths:[],hintUrls:[],localNameHints:[],evidence:[],asset:a,state:'manual'});
 const items=[...combined.values()].sort((a,b)=>a.name.localeCompare(b.name,'zh-CN')),truncated=walk.truncated||productLimit||items.length>1000,warnings=[...walk.warnings];if(items.length>1000)warnings.push('工程商品较多，只显示前 1,000 项。');
 return {projectId:projectRecord.id,items:items.slice(0,1000),scannedAt:walk.scannedAt,inspectedEntries:Math.min(60000,walk.inspected),truncated,warnings};
}
export async function projectProductInput(projectRecord:AssetRecord,product:ProjectProduct,roots:string[]):Promise<ScanInput>{
 const project=await validateProject(projectRecord,roots),relative=product.paths[0];if(!relative||relative.includes('\\'))throw new Error('请选择有工程文件依据的商品。');const source=relativeAssetPath(project.assets,relative);if(source===project.assets||!isWithin(source,project.assets))throw new Error('工程商品位置无效。');await noLinks(source);const stat=await fsp.lstat(source);if(!stat.isDirectory()&&!stat.isFile())throw new Error('工程商品位置已不存在。');
 return {path:source,name:product.name,group:'工程内商品 · '+projectRecord.name+' ['+projectRecord.id.slice(0,8)+']',kind:stat.isDirectory()?'folder':'file',size:stat.isFile()?stat.size:0,mtimeMs:stat.mtimeMs,localCategory:inferCategory(product.name),localAvatars:inferAvatars(product.name),hintUrls:product.hintUrls.filter(url=>!!boothProductId(url)).slice(0,10),localNameHints:product.localNameHints.slice(0,12)};
}
