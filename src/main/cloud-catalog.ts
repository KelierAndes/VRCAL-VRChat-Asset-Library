import {createHash} from 'node:crypto';
import type {AssetRecord} from '../shared/contracts';
import type {CloudCapture,CloudCatalogData,CloudFile,CloudPage,CloudQuery,CloudRow,CloudStoredFile} from '../shared/cloud-contracts';
import {boothProductId,extractBoothIds} from './matching';

const empty=():CloudCatalogData=>({schema:1,captures:[],links:[]});
const fail=():never=>{throw new Error('云端目录记录无效；未修改已有索引。')};
const text=(v:unknown,max=1000):string=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\x00-\x1f\x7f]/.test(v)?v:fail();
function remotePath(v:unknown):string {const p=text(v,8192);if(!p.startsWith('/')||p.includes('\\')||p!=='/'&&p.endsWith('/')||p.slice(1).split('/').some(s=>!s||s==='.'||s==='..')){if(p==='/')return p;return fail()}return p}
const account=(v:unknown)=>{const s=text(v,160);return /^(?:[a-zA-Z0-9_-]+|baidu:[a-f0-9]{64})$/.test(s)?s:fail()};
const stamp=(v:unknown)=>{const s=text(v,50);return Number.isFinite(Date.parse(s))?s:fail()};
const entryKey=(a:string,p:string)=>createHash('sha256').update(a+'\0'+p).digest('hex');
function cleanCapture(value:any):CloudCapture {
 if(!value||value.source!=='web-visible'||value.complete!==false||!Array.isArray(value.items)||value.items.length>5000)return fail();
 const accountKey=account(value.accountKey),directoryPath=remotePath(value.directoryPath),capturedAt=stamp(value.capturedAt),seen=new Set<string>();
 const items:CloudFile[]=value.items.map((v:any)=>{if(!v||typeof v.directory!=='boolean')return fail();const name=text(v.name,1000);if(/[\\/]/.test(name)||name==='.'||name==='..')return fail();const p=remotePath(v.path);if(p!==(directoryPath==='/'?'':directoryPath)+'/'+name||seen.has(p))return fail();seen.add(p);const item:CloudFile={name,path:p,directory:v.directory,seenAt:v.seenAt===undefined?capturedAt:stamp(v.seenAt)};if(v.id!==undefined)item.id=text(v.id,200);if(v.size!==undefined){if(!Number.isSafeInteger(v.size)||v.size<0)return fail();item.size=v.size}if(v.modifiedAt!==undefined)item.modifiedAt=stamp(v.modifiedAt);if(v.productId!==undefined){if(typeof v.productId!=='string'||!/^\d{1,12}$/.test(v.productId))return fail();item.productId=v.productId}return item});
 if(value.warnings!==undefined&&(!Array.isArray(value.warnings)||value.warnings.length>30))return fail();
 return {accountKey,directoryPath,items,capturedAt,complete:false,source:'web-visible',warnings:(value.warnings??[]).map((v:unknown)=>{const warning=text(v,1000);return warning==='visible-partial'?'仅记录当前可见条目，目录中可能还有其他文件。':warning==='live-layout-unverified'?'真实登录和网页布局尚待验证。':warning})};
}
/** Metadata whitelist intentionally excludes every credential/session property. */
export function cleanCloudCatalog(value:unknown):CloudCatalogData {
 if(value===undefined||value===null)return empty();const v=value as any;
 if(v.schema!==1||!Array.isArray(v.captures)||v.captures.length>2000||!Array.isArray(v.links)||v.links.length>50000)return fail();
 const captures=v.captures.map(cleanCapture),keys=new Set<string>(),dirs=new Set<string>();let count=0;
 for(const c of captures){const d=c.accountKey+'\0'+c.directoryPath;if(dirs.has(d))return fail();dirs.add(d);for(const f of c.items){keys.add(entryKey(c.accountKey,f.path));if(++count>50000)return fail()}}
 const used=new Set<string>();const links=v.links.map((l:any)=>{if(!l||typeof l.entryKey!=='string'||!keys.has(l.entryKey)||used.has(l.entryKey)||l.separate!==undefined&&l.separate!==true||l.separate&&l.localId!==undefined)return fail();used.add(l.entryKey);if(l.localId!==undefined){const id=text(l.localId,100);if(!/^[A-Za-z0-9_-]+$/.test(id))return fail();return {entryKey:l.entryKey,localId:id}}if(l.separate===true)return {entryKey:l.entryKey,separate:true};return fail()});
 const result:CloudCatalogData={schema:1,captures,links};if(Buffer.byteLength(JSON.stringify(result))>32*1024*1024)return fail();return result;
}
export function mergeCloudCatalogData(oldValue:unknown,newValue:unknown):CloudCatalogData {
 const old=cleanCloudCatalog(oldValue),next=cleanCloudCatalog(newValue),captures=new Map(old.captures.map(c=>[c.accountKey+'\0'+c.directoryPath,c]));
 for(const c of next.captures){const key=c.accountKey+'\0'+c.directoryPath,previous=captures.get(key);if(!previous){captures.set(key,c);continue}const newer=Date.parse(c.capturedAt)>=Date.parse(previous.capturedAt),items=new Map((newer?previous:c).items.map(f=>[f.path,f]));for(const f of (newer?c:previous).items)items.set(f.path,f);captures.set(key,{...(newer?c:previous),items:[...items.values()]})}
 const links=new Map(old.links.map(l=>[l.entryKey,l]));for(const l of next.links)links.set(l.entryKey,l);
 return cleanCloudCatalog({schema:1,captures:[...captures.values()],links:[...links.values()]});
}
function localIds(a:AssetRecord):string[]{const official=boothProductId(a.manual.sourceUrl)||boothProductId(a.online.url);return official?[official]:[...new Set([a.name,...(a.members??[]).map(m=>m.name)].flatMap(extractBoothIds))]}
function cloudIds(f:CloudStoredFile):string[]{const named=extractBoothIds(f.name);return [...new Set([...(f.productId?[f.productId]:[]),...named])]}
export class CloudCatalog {
 constructor(private readonly repository:{read:()=>unknown;write:(data:CloudCatalogData)=>void;locals:()=>AssetRecord[]}){}
 capture(value:CloudCapture):void {const capture=cleanCapture(value),data=mergeCloudCatalogData(this.repository.read(),{schema:1,captures:[capture],links:[]});this.repository.write(data)}
 private rows():CloudRow[]{
  const data=cleanCloudCatalog(this.repository.read());if(!data.captures.some(c=>c.items.length))return [];
  const locals=this.repository.locals().filter(a=>a.kind!=='unity-project'),links=new Map(data.links.map(l=>[l.entryKey,l])),byProduct=new Map<string,AssetRecord[]>(),byFile=new Map<string,AssetRecord[]>(),byId=new Map(locals.map(a=>[a.id,a]));const idsByLocal=new Map<string,string[]>();for(const a of locals){const ids=localIds(a);idsByLocal.set(a.id,ids);if(ids.length===1){const group=byProduct.get(ids[0])??[];group.push(a);byProduct.set(ids[0],group)}if(!['folder','unity-project'].includes(a.kind)){const k=a.name.normalize('NFC')+'\0'+a.size,group=byFile.get(k)??[];group.push(a);byFile.set(k,group)}}return data.captures.flatMap(c=>c.items.map(f=>{
  const file:CloudStoredFile={...f,key:entryKey(c.accountKey,f.path),accountKey:c.accountKey,directoryPath:c.directoryPath,capturedAt:f.seenAt??c.capturedAt};const manual=links.get(file.key),ids=cloudIds(file);let basis:CloudRow['basis']='none',matches:AssetRecord[]=[],candidates:CloudRow['candidates']=[];
  if(manual?.localId){basis='manual';matches=byId.has(manual.localId)?[byId.get(manual.localId)!]:[]}
  else if(!manual?.separate){if(ids.length===1){const found=byProduct.get(ids[0])??[];if(found.length===1){basis='product-id';matches=found}else if(found.length>1)candidates=found.map(a=>({id:a.id,name:a.name,reason:'同一商品存在多个本地条目，请选择'}))}
   if(!matches.length&&!candidates.length&&ids.length<=1&&!f.directory&&typeof f.size==='number'&&f.size>0){const found=(byFile.get(f.name.normalize('NFC')+'\0'+f.size)??[]).filter(a=>{const ai=idsByLocal.get(a.id)!;return !ids.length||ai.length<=1&&(!ai.length||ai[0]===ids[0])});if(found.length===1){basis='filename-size';matches=found}else if(found.length>1)candidates=found.map(a=>({id:a.id,name:a.name,reason:'同名且大小相同，需人工核对'}))}
  }
  const available=matches.filter(a=>!a.missing);return {...file,relation:available.length?'both':candidates.length?'review':'cloud-only',localIds:matches.map(a=>a.id),candidates,basis,stale:Date.now()-Date.parse(file.capturedAt)>30*24*3600*1000,contentVerified:false} as CloudRow;
 }))}
 list(query:CloudQuery={}):CloudPage {if(!query||typeof query!=='object')throw new Error('云端查询无效。');const data=cleanCloudCatalog(this.repository.read()),search=typeof query.search==='string'?query.search.slice(0,1000).toLocaleLowerCase():'';const rows=this.rows().filter(r=>(!query.accountKey||r.accountKey===query.accountKey)&&(!query.relation||r.relation===query.relation)&&(!search||(r.name+' '+r.path).toLocaleLowerCase().includes(search)));const offset=Math.max(0,Math.trunc(Number(query.offset)||0)),limit=Math.min(5000,Math.max(1,Math.trunc(Number(query.limit)||100)));return {items:rows.slice(offset,offset+limit),total:rows.length,directories:data.captures.map(c=>({accountKey:c.accountKey,path:c.directoryPath,capturedAt:c.capturedAt,count:c.items.length})),warnings:[...new Set(data.captures.flatMap(c=>c.warnings))]}}
 decorate(assets:AssetRecord[]):AssetRecord[]{if(!assets.length)return [];const rows=this.rows(),byId=new Map<string,CloudRow[]>();for(const r of rows)for(const id of r.localIds){const entries=byId.get(id)??[];entries.push(r);byId.set(id,entries)}return assets.map(a=>{const entries=byId.get(a.id)??[];return {...a,storage:{kind:entries.length?(a.missing?'cloud':'both'):'local',cloudCount:entries.length,lastSeenAt:entries.map(r=>r.capturedAt).sort().at(-1),cloudEntries:entries.map(r=>({key:r.key,path:r.path,accountKey:r.accountKey,capturedAt:r.capturedAt,basis:r.basis}))}}})}
 link(key:string,localId?:string|null):void {const data=cleanCloudCatalog(this.repository.read());if(!this.rows().some(r=>r.key===key))throw new Error('未找到此云端条目。');if(localId!==null&&localId!==undefined&&!this.repository.locals().some(a=>a.id===localId&&a.kind!=='unity-project'))throw new Error('请选择已有的本地素材。');data.links=data.links.filter(l=>l.entryKey!==key);if(localId!==undefined)data.links.push(localId===null?{entryKey:key,separate:true}:{entryKey:key,localId});this.repository.write(cleanCloudCatalog(data))}
 forget(accountKey:string,directoryPath:string):void {const data=cleanCloudCatalog(this.repository.read());data.captures=data.captures.filter(c=>c.accountKey!==accountKey||c.directoryPath!==directoryPath);const keys=new Set(data.captures.flatMap(c=>c.items.map(f=>entryKey(c.accountKey,f.path))));data.links=data.links.filter(l=>keys.has(l.entryKey));this.repository.write(cleanCloudCatalog(data))}
}
