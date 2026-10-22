import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {assertSafeWrite} from './safety';
import {SPONSORS_REFRESH_MS,type Sponsor,type SponsorsDocument,type SponsorsState} from '../shared/sponsors';
export const SPONSORS_URL='https://raw.githubusercontent.com/NecoAya/VRCAL-VRChat-Asset-Library/main/community/sponsors.json';
const ASSETS='https://raw.githubusercontent.com/NecoAya/VRCAL-VRChat-Asset-Library/main/community/';
const MAX_JSON=262144,MAX_AVATAR=1048576;
const invalid=()=>new Error('赞助者名单格式无效，已保留上次内容。');
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw invalid();return value as Record<string,unknown>}
function text(value:unknown,max:number):string {if(typeof value!=='string'||!value.trim()||value.length>max||/[\x00-\x1f\x7f]/.test(value))throw invalid();return value.trim()}
function date(value:unknown):string {const s=text(value,40);if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(s)||!Number.isFinite(Date.parse(s)))throw invalid();return s}
function link(value:unknown):string {
 const s=text(value,2048);let u:URL;try{u=new URL(s)}catch{throw invalid()}
 const host=u.hostname.toLowerCase();
 if(u.protocol!=='https:'||u.username||u.password||u.port||!host.includes('.')||host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||/^[\d.]+$/.test(host)||host.includes(':'))throw invalid();
 return u.href;
}
export function parseSponsors(value:unknown):SponsorsDocument {
 const d=object(value);if(d.schemaVersion!==1||!Array.isArray(d.sponsors)||d.sponsors.length>300)throw invalid();
 const ids=new Set<string>(),sponsors:Sponsor[]=d.sponsors.map((value:unknown)=>{
  const p=object(value),id=text(p.id,80);if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id)||ids.has(id))throw invalid();ids.add(id);
  if(p.anonymous!==undefined&&typeof p.anonymous!=='boolean')throw invalid();
  const person:Sponsor={id,links:[]};
  if(p.order!==undefined){if(typeof p.order!=='number'||!Number.isSafeInteger(p.order)||Math.abs(p.order)>100000)throw invalid();person.order=p.order}
  if(p.anonymous===true){person.anonymous=true;return person}
  person.name=text(p.name,80);
  if(p.note!==undefined)person.note=text(p.note,180);
  if(p.avatar!==undefined){const a=text(p.avatar,120);if(!/^avatars\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}\.(png|jpg|jpeg|webp)$/.test(a))throw invalid();person.avatar=a}
  if(p.links!==undefined){if(!Array.isArray(p.links)||p.links.length>5)throw invalid();person.links=p.links.map(v=>{const l=object(v);return {label:text(l.label,24),url:link(l.url)}})}
  return person;
 });
 sponsors.sort((a,b)=>(a.order??100000)-(b.order??100000));
 return {schemaVersion:1,updatedAt:date(d.updatedAt),sponsors};
}
interface Dependencies {dataDir:string;roots:()=>string[];fetch:(url:string,init?:RequestInit)=>Promise<Response>;canNetwork:()=>boolean;onChange?:()=>void;now?:()=>number;timeoutMs?:number}
/** Public credits only. No material names, account cookies or GitHub credentials are sent. */
export class Sponsors {
 private document?:SponsorsDocument;private etag?:string;private checkedAt?:string;private value: SponsorsState['status']='unloaded';private message?:string;
 private readonly now:()=>number;private lastAttempt=-Infinity;private generation=0;private closed=false;private active=new Set<AbortController>();private pending?:Promise<SponsorsState>;
 constructor(private readonly deps:Dependencies){this.now=deps.now??(()=>Date.now());this.load()}
 private cachePath(name='community-sponsors.json'):string{return assertSafeWrite(path.join(this.deps.dataDir,'cache',name),this.deps.dataDir,this.deps.roots())}
 private load():void {
  try{const file=this.cachePath(),stat=fs.lstatSync(file);if(!stat.isFile()||stat.size>MAX_JSON+4096)throw invalid();const saved=object(JSON.parse(fs.readFileSync(file,'utf8')));this.document=parseSponsors(saved.document);this.checkedAt=date(saved.checkedAt);this.etag=this.validETag(saved.etag);this.value='cached'}catch{this.document=undefined;this.checkedAt=undefined;this.etag=undefined}
 }
 private validETag(value:unknown):string|undefined {return typeof value==='string'&&value.length<=200&&!/[\r\n\x00]/.test(value)?value:undefined}
 private save(document:SponsorsDocument,checkedAt:string,etag?:string):void {
  const file=this.cachePath(),temp=this.cachePath('community-sponsors.json.tmp');fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(temp,JSON.stringify({document,checkedAt,etag}));fs.renameSync(temp,file);
 }
 private avatarName(p:Sponsor):string|undefined {return p.avatar&&this.document?'community-avatar-'+crypto.createHash('sha256').update(p.avatar+'|'+this.document.updatedAt).digest('hex')+path.extname(p.avatar):undefined}
 snapshot():SponsorsState {
  const sponsors=(this.document?.sponsors??[]).map(p=>{const result={...p,links:p.links.map(l=>({...l}))},name=this.avatarName(p);try{if(name&&fs.lstatSync(this.cachePath(name)).isFile())result.avatarFile=name}catch{/* Use initials until a valid local avatar is available. */}return result});
  return {status:this.value,sponsors,updatedAt:this.document?.updatedAt,checkedAt:this.checkedAt,message:this.message};
 }
 link(id:unknown,index:unknown):string {if(typeof id!=='string'||typeof index!=='number'||!Number.isSafeInteger(index)||index<0)throw new Error('赞助者链接无效。');const found=this.document?.sponsors.find(p=>p.id===id)?.links[index];if(!found)throw new Error('赞助者链接无效。');return link(found.url)}
 private available(generation:number):boolean{return !this.closed&&generation===this.generation&&this.deps.canNetwork()}
 private async request(url:string,limit:number,headers:Record<string,string>,generation:number):Promise<{status:number;headers:Headers;bytes:Buffer}> {
  const controller=new AbortController();this.active.add(controller);let timer:ReturnType<typeof setTimeout>|undefined;
  try{
   return await Promise.race([(async()=>{
    const response=await this.deps.fetch(url,{credentials:'omit',redirect:'manual',cache:'no-cache',signal:controller.signal,headers:{Accept:url===SPONSORS_URL?'application/json,text/plain':'image/png,image/jpeg,image/webp',...headers}});
    if(!this.available(generation)||controller.signal.aborted){await response.body?.cancel();throw new Error('cancelled')}
    if(response.url&&response.url!==url){await response.body?.cancel();throw invalid()}
    if(response.status===304){await response.body?.cancel();return {status:304,headers:response.headers,bytes:Buffer.alloc(0)}}
    if(!response.ok){await response.body?.cancel();throw invalid()}
    if(Number(response.headers.get('content-length'))>limit){await response.body?.cancel();throw invalid()}
    const reader=response.body?.getReader(),chunks:Buffer[]=[];let size=0;
    if(reader)try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit||!this.available(generation)||controller.signal.aborted)throw invalid();chunks.push(Buffer.from(value))}}catch(error){await reader.cancel().catch(()=>{});throw error}
    return {status:response.status,headers:response.headers,bytes:Buffer.concat(chunks)};
   })(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('timeout'))},process.env.NODE_ENV==='test'?(this.deps.timeoutMs??10000):10000)})]);
  }finally{if(timer)clearTimeout(timer);this.active.delete(controller)}
 }
 refresh(force=false):Promise<SponsorsState> {
  if(!this.deps.canNetwork()||this.closed){this.value='offline';this.message='联网已关闭，显示上次保存的赞助者。';return Promise.resolve(this.snapshot())}
  if(this.pending)return this.pending;
  const checked=Date.parse(this.checkedAt??''),elapsed=this.now()-this.lastAttempt;
  if(elapsed<10000||!force&&Number.isFinite(checked)&&this.now()>=checked&&this.now()-checked<SPONSORS_REFRESH_MS)return Promise.resolve(this.snapshot());
  this.lastAttempt=this.now();const generation=this.generation;
  const task=this.update(generation);this.pending=task;void task.finally(()=>{if(this.pending===task)this.pending=undefined});return task;
 }
 private async update(generation:number):Promise<SponsorsState> {
  try{
   const response=await this.request(SPONSORS_URL,MAX_JSON,this.etag?{'If-None-Match':this.etag}:{},generation);
   if(!this.available(generation))return this.snapshot();
   const contentType=response.headers.get('content-type')??'';
   if(contentType&&/html|xml/i.test(contentType))throw invalid();
   const document=response.status===304?this.document:parseSponsors(JSON.parse(response.bytes.toString('utf8')));if(!document)throw invalid();
   const checkedAt=new Date(this.now()).toISOString(),etag=this.validETag(response.headers.get('etag'))??(response.status===304?this.etag:undefined);
   this.save(document,checkedAt,etag);this.document=document;this.checkedAt=checkedAt;this.etag=etag;this.value='fresh';this.message=undefined;this.deps.onChange?.();
   // Metadata returns immediately. Avatars fill in independently, with at most two requests at once.
   void this.loadAvatars(generation).catch(()=>{});
  }catch{
   if(this.available(generation)){this.value='error';this.message='暂时无法更新赞助者，已保留上次内容。';this.deps.onChange?.()}
  }
  return this.snapshot();
 }
 private async loadAvatars(generation:number):Promise<void> {
  const document=this.document;if(!document)return;const items=document.sponsors.filter(p=>p.avatar);let next=0;
  await Promise.all([0,1].map(async()=>{while(next<items.length&&this.available(generation)&&this.document===document){const person=items[next++],name=this.avatarName(person)!;
   try{const file=this.cachePath(name);if(fs.existsSync(file))continue;
    const response=await this.request(ASSETS+person.avatar+'?v='+encodeURIComponent(document.updatedAt),MAX_AVATAR,{},generation),bytes=response.bytes;
    const valid=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes[0]===255&&bytes[1]===216&&bytes[2]===255||bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';
    if(!valid||!this.available(generation)||this.document!==document)continue;
    const target=this.cachePath(name);fs.writeFileSync(target,bytes,{flag:'wx'});this.deps.onChange?.();
   }catch{/* An absent/broken avatar never removes the person's public credit. */}
  }}));
 }
 networkChanged():void {this.generation++;for(const controller of this.active)controller.abort();this.active.clear();this.pending=undefined;this.value=this.deps.canNetwork()?'cached':'offline';this.message=this.deps.canNetwork()?undefined:'联网已关闭，显示上次保存的赞助者。';this.deps.onChange?.()}
 close():void {this.closed=true;this.networkChanged()}
}
