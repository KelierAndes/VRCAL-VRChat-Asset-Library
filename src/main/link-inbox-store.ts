import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {assertSafeWrite} from './safety';
import {DEFAULT_INBOX_SETTINGS,validateInboxSettings as settings,extractShareLinks,recency,type InboxSettings,type InboxItem,type InboxObservation,type InboxState,type InboxLink} from '../shared/link-inbox';
import {validInboxConsent,type InboxConsent} from '../shared/inbox-policy';
import {parseBaiduShare} from '../shared/baidu-download';

interface Deps {dataDir:string;roots:()=>string[];cipher:{encrypt:(text:string)=>Buffer;decrypt:(bytes:Buffer)=>string};now?:()=>number;changed?:()=>void}
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
export function inboxBoothLibraryItemUrl(item:unknown):string {if(typeof item!=='string'||! /^[1-9]\d{0,11}$/.test(item))throw new Error('BOOTH 资料库条目无效。');return 'https://booth.pm/items/'+item}
export function inboxSourceUrl(raw:string,platform:'booth'|'xianyu'):string {
 const u=new URL(raw);if(u.protocol!=='https:'||u.port||u.username||u.password||u.hash)throw new Error('交付页面地址无效。');
 if(platform==='xianyu'?(u.hostname!=='www.goofish.com'||u.pathname!=='/im'):(u.hostname!=='accounts.booth.pm'||!/^\/(?:library|orders)(?:\/|$)/.test(u.pathname)))throw new Error('这里只识别消息或已购页面中的链接。');
 // Tracking query strings are unnecessary for reopening the source page.
 return u.origin+u.pathname;
}
export class LinkInboxStore {
 private preferences={...DEFAULT_INBOX_SETTINGS};private items:InboxItem[]=[];private error?:string;private approval?:InboxConsent;
 constructor(private readonly deps:Deps){this.load()}
 private now(){return this.deps.now?.()??Date.now()}
 private file(){return assertSafeWrite(path.join(this.deps.dataDir,'link-inbox.bin'),this.deps.dataDir,this.deps.roots())}
 private writable(){if(this.error)throw new Error(this.error)}
 state():InboxState {
  const now=this.now(),items=this.items.filter(i=>i.completed||i.taskIds.length||recency(i.sourceAt,now,this.preferences.hours)!=='old').sort((a,b)=>b.discoveredAt-a.discoveredAt);
  return {settings:{...this.preferences},items:structuredClone(items),unread:items.filter(i=>!i.read&&!i.dismissed&&!i.completed&&!i.codeConflict&&recency(i.sourceAt,now,this.preferences.hours)==='recent').length,statuses:[],...(this.error?{error:this.error}:{})};
 }
 consent():InboxConsent|undefined{return this.approval?{...this.approval}:undefined}
 configure(value:unknown,consent?:InboxConsent){this.writable();const next=settings(value),approval=consent??this.approval;if(next.enabled&&!validInboxConsent(approval,next.background,this.now()))throw new Error('请先阅读并确认当前版本的链接识别说明。');this.persist(this.items,next,approval);this.preferences=next;this.approval=approval;this.deps.changed?.()}
 clearRecords(){this.writable();const preferences={...DEFAULT_INBOX_SETTINGS,hours:this.preferences.hours};this.persist([],preferences,null);this.items=[];this.preferences=preferences;this.approval=undefined;this.deps.changed?.()}
 ingest(observation:InboxObservation):void {
  this.writable();if(!this.preferences.enabled)return;
  const o=observation;if(!o||!['booth','xianyu'].includes(o.platform)||typeof o.accountKey!=='string'||!o.accountKey||o.accountKey.length>512||typeof o.sourceKey!=='string'||o.sourceKey.length>512||typeof o.title!=='string'||typeof o.text!=='string'||o.text.length>32768)throw new Error('交付记录格式无效。');
  const sourceUrl=inboxSourceUrl(o.sourceUrl,o.platform),now=this.now();
  const at=typeof o.sourceAt==='number'&&Number.isFinite(o.sourceAt)&&o.sourceAt>0&&o.sourceAt<=now?o.sourceAt:undefined;
  if(recency(at,now,this.preferences.hours)==='old')return;
  const accountKey=hash(o.platform+'\0'+o.accountKey),links:Array<InboxLink&{kind:'baidu'|'booth';boothLibraryItem?:string}>=extractShareLinks(o.text).map(v=>({...v,kind:'baidu'}));
  if(o.boothLibraryItem!==undefined){if(o.platform!=='booth'||sourceUrl!=='https://accounts.booth.pm/library'||o.boothDownloadPage)throw new Error('BOOTH 资料库条目来源无效。');const url=inboxBoothLibraryItemUrl(o.boothLibraryItem);links.push({url,code:'',codeConflict:false,kind:'booth',boothLibraryItem:o.boothLibraryItem})}
  if(o.platform==='booth'&&o.boothDownloadPage){const url=inboxSourceUrl(o.boothDownloadPage,'booth');if(url==='/library'||url==='https://accounts.booth.pm/library')throw new Error('请定位具体的已购条目。');links.push({url,code:'',codeConflict:false,kind:'booth'})}
  const next=structuredClone(this.items);let changed=false;
  for(const link of links){const id=hash(accountKey+'\0'+link.url),existing=next.find(i=>i.id===id);
   if(existing){
    if(link.codeConflict||existing.code&&link.code&&existing.code!==link.code){if(!existing.codeConflict){existing.codeConflict=true;existing.code='';changed=true}}
    else if(!existing.codeConflict&&!existing.code&&link.code){existing.code=link.code;changed=true}
    if(at!==undefined&&at<=now&&(existing.sourceAt===undefined||at>existing.sourceAt)){existing.sourceAt=at;changed=true}
   }else{if(next.length>=5000)throw new Error('链接记录已达到 5000 条，已暂停新增；现有记录仍保留。');next.push({...link,id,platform:o.platform,accountKey,sourceUrl,title:o.title.trim().slice(0,160)||'交付链接',sourceAt:at!==undefined&&at<=now?at:undefined,discoveredAt:now,read:false,dismissed:false,taskIds:[],completed:false});changed=true}
  }
  if(changed){this.persist(next);this.items=next;this.deps.changed?.()}
 }
 mark(id:string,action:'read'|'dismiss'|'restore'){
  if(!['read','dismiss','restore'].includes(action))throw new Error('链接操作无效。');
  this.edit(id,item=>{item.read=true;if(action!=='read')item.dismissed=action==='dismiss'})
 }
 downloadTarget(id:string,confirmedCode?:string):InboxItem {const row=this.items.find(i=>i.id===id);if(!row)throw new Error('链接记录不存在。');if(row.codeConflict&&!confirmedCode)throw new Error('提取码有冲突，请核对原消息后在下载框中手动填写。');const result=structuredClone(row);if(row.kind==='baidu'){result.code=parseBaiduShare(row.url,confirmedCode??row.code).code;result.codeConflict=false}else if(row.boothLibraryItem!==undefined){if(row.url!==inboxBoothLibraryItemUrl(row.boothLibraryItem)||row.sourceUrl!=='https://accounts.booth.pm/library')throw new Error('BOOTH 资料库条目来源无效。')}else inboxSourceUrl(row.url,'booth');return result}
 attachTask(id:string,taskId:string){if(typeof taskId!=='string'||!taskId||taskId.length>128)throw new Error('下载记录无效。');this.edit(id,item=>{if(!item.taskIds.includes(taskId))item.taskIds=[...item.taskIds,taskId].slice(-100);item.read=true})}
 syncCompleted(ids:string[]){const done=new Set(ids),next=structuredClone(this.items);let changed=false;for(const item of next)if(!item.completed&&item.taskIds.some(id=>done.has(id))){item.completed=true;item.read=true;changed=true}if(changed){this.persist(next);this.items=next;this.deps.changed?.()}}
 private edit(id:string,action:(i:InboxItem)=>void){this.writable();const next=structuredClone(this.items),item=next.find(i=>i.id===id);if(!item)throw new Error('链接记录不存在。');action(item);this.persist(next);this.items=next;this.deps.changed?.()}
 private persist(items:InboxItem[],preferences=this.preferences,approval:InboxConsent|null|undefined=this.approval){
  this.writable();const bytes=this.deps.cipher.encrypt(JSON.stringify({version:1,settings:preferences,items,consent:approval??undefined}));if(bytes.length>16*1024*1024)throw new Error('链接记录过大，未覆盖原记录。');const file=this.file(),tmp=assertSafeWrite(file+'.'+randomUUID()+'.tmp',this.deps.dataDir,this.deps.roots());
  try{fs.writeFileSync(tmp,bytes,{flag:'wx'});this.file();fs.renameSync(tmp,file)}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp)}
 }
 private load(){
  try{const file=this.file();if(!fs.existsSync(file))return;const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16*1024*1024)throw new Error();
   const data=JSON.parse(this.deps.cipher.decrypt(fs.readFileSync(file)));if(data.version!==1||!Array.isArray(data.items)||data.items.length>5000)throw new Error();const next=settings(data.settings),seen=new Set<string>();
   for(const row of data.items){if(!row||!['xianyu','booth'].includes(row.platform)||!['baidu','booth'].includes(row.kind)||typeof row.accountKey!=='string'||! /^[a-f0-9]{64}$/.test(row.accountKey)||row.id!==hash(row.accountKey+'\0'+row.url)||seen.has(row.id)||typeof row.title!=='string'||row.title.length>160||!Number.isFinite(row.discoveredAt)||row.discoveredAt<=0||row.sourceAt!==undefined&&(!Number.isFinite(row.sourceAt)||row.sourceAt<=0)||['read','dismissed','completed','codeConflict'].some(key=>typeof row[key]!=='boolean')||!Array.isArray(row.taskIds)||row.taskIds.length>100||row.taskIds.some((id:unknown)=>typeof id!=='string'||id.length>128))throw new Error();
    inboxSourceUrl(row.sourceUrl,row.platform);if(row.boothLibraryItem!==undefined&&(row.platform!=='booth'||row.kind!=='booth'||row.sourceUrl!=='https://accounts.booth.pm/library'||row.url!==inboxBoothLibraryItemUrl(row.boothLibraryItem)))throw new Error();if(row.kind==='baidu')parseBaiduShare(row.url,row.code);else {if(row.platform!=='booth'||row.code!=='')throw new Error();if(row.boothLibraryItem===undefined)inboxSourceUrl(row.url,'booth')}seen.add(row.id);
   }this.approval=validInboxConsent(data.consent,next.background,this.now())?data.consent:undefined;this.preferences={...next,enabled:next.enabled&&!!this.approval};this.items=data.items;
  }catch{this.error='待下载链接记录无法解密或读取。原文件已保留，未覆盖；请使用原 Windows 账号及资料库位置。'}
 }
}
