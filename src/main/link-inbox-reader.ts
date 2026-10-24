import {createHash} from 'node:crypto';
import {extractShareLinks,recency,sourceTime,type InboxPlatform,type InboxObservation} from '../shared/link-inbox';
import type {InboxReadContext,InboxReadResult} from './link-inbox-monitor';
import {inboxAccountStatus} from './link-inbox-account';
import {inboxCaptureScript} from './link-inbox-dom';
import {relativeInboxTime} from './inbox-relative-time';

export interface InboxDomRow {key:string;kind:'message'|'conversation'|'purchase';text:string;title?:string;time?:string;day?:string;unread?:boolean;purchaseUrl?:string;libraryItem?:string}
const diagnostics=['account-header','account-avatar','conversation-root','message-root','message-layout','conversation-empty','chat-unselected','empty'] as const;
export interface InboxDomSnapshot {url:string;account:string;supported:boolean;login?:boolean;diagnostic?:typeof diagnostics[number];rows:InboxDomRow[]}
export interface InboxPage {isDestroyed():boolean;getURL():string;executeJavaScript(code:string):Promise<unknown>}
/** Keep direct user-initiated reads bounded as well as monitor-driven checks. */
export async function evaluateInboxPage(page:Pick<InboxPage,'executeJavaScript'>,script:string,signal:AbortSignal,timeoutMs=10000):Promise<unknown> {
 if(signal.aborted)throw new Error('cancelled');let timer:ReturnType<typeof setTimeout>|undefined,abort:(()=>void)|undefined;
 const cancelled=new Promise<never>((_,reject)=>{abort=()=>reject(new Error('cancelled'));signal.addEventListener('abort',abort,{once:true})});
 const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('timeout')),Math.max(1,Math.min(10000,timeoutMs)))});
 try{return await Promise.race([page.executeJavaScript(script),cancelled,deadline])}finally{if(timer)clearTimeout(timer);if(abort)signal.removeEventListener('abort',abort)}
}
const result=(state:InboxReadResult['state'],message:string,observations:InboxObservation[]=[]):InboxReadResult=>({state,message,observations});
function pageUrl(platform:InboxPlatform,raw:string):string|undefined {
 try{const u=new URL(raw);if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash)return;
  if(platform==='xianyu'?u.hostname!=='www.goofish.com'||u.pathname!=='/im':u.hostname!=='accounts.booth.pm'||!/^\/(?:library|orders)(?:\/[A-Za-z0-9_-]+)*\/?$/.test(u.pathname))return;
  return u.origin+u.pathname;
 }catch{return}
}
function purchaseUrl(raw:unknown):string|undefined {
 if(typeof raw!=='string'||raw.length>512)return;try{const u=new URL(raw);if(u.search||u.hash||!/^\/(?:orders|library)\/[A-Za-z0-9_-]+\/?$/.test(u.pathname)||/\/(?:gifts|new|create|edit)\/?$/.test(u.pathname))return;return pageUrl('booth',raw)}catch{return}
}
/** An explicit timezone is interpreted as displayed; otherwise use the platform's local day. */
export function inboxSourceTime(raw:string|undefined,platform:InboxPlatform,now:number,day?:string):number|undefined {
 if(!raw||raw.length>100)return;
 if(platform==='xianyu'){const relative=relativeInboxTime(raw,now);if(relative!==undefined)return relative}
 const value=raw.trim().replace(/年|月/g,'-').replace(/(\d)日\s*/,'$1 ').replace(/\//g,'-');
 const iso=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?)(Z|[+-]\d{2}:\d{2})$/.exec(value);
 if(iso){const zone=iso[2],hours=zone==='Z'?0:Number(zone.slice(1,3)),minutes=zone==='Z'?0:Number(zone.slice(4,6));if(hours>14||minutes>59||hours===14&&minutes!==0)return;const offset=zone==='Z'?0:(zone[0]==='-'?-1:1)*(hours*60+minutes);return sourceTime(iso[1],now,offset)}
 return sourceTime(value,now,platform==='booth'?540:480,day);
}
function knownOldDay(raw:string|undefined,platform:InboxPlatform,context:InboxReadContext):boolean {
 if(!raw)return false;const value=raw.trim().replace(/年|月/g,'-').replace(/日$/,'').replace(/\//g,'-');
 if(!/^\d{4}-\d{1,2}-\d{1,2}$/.test(value))return false;
 const end=inboxSourceTime(value+' 23:59:59',platform,context.now);return end!==undefined&&recency(end,context.now,context.hours)==='old';
}
function validSnapshot(value:unknown):value is InboxDomSnapshot {
 if(!value||typeof value!=='object')return false;const s=value as InboxDomSnapshot;
 return typeof s.url==='string'&&s.url.length<=2048&&typeof s.account==='string'&&s.account.length<=512&&typeof s.supported==='boolean'&&(s.login===undefined||typeof s.login==='boolean')&&(s.diagnostic===undefined||diagnostics.includes(s.diagnostic))&&Array.isArray(s.rows)&&s.rows.length<=100&&s.rows.every(r=>r&&typeof r.key==='string'&&r.key.length>0&&r.key.length<=512&&['message','conversation','purchase'].includes(r.kind)&&typeof r.text==='string'&&r.text.length<=32768&&(r.title===undefined||typeof r.title==='string'&&r.title.length<=160)&&(r.libraryItem===undefined||typeof r.libraryItem==='string'&&r.libraryItem.length<=12)&&(r.purchaseUrl===undefined||typeof r.purchaseUrl==='string'&&r.purchaseUrl.length<=512)&&(r.time===undefined||typeof r.time==='string'&&r.time.length<=100)&&(r.day===undefined||typeof r.day==='string'&&r.day.length<=20)&&(r.unread===undefined||typeof r.unread==='boolean'))&&s.rows.reduce((n,r)=>n+r.text.length,0)<=262144;
}
export function interpretInboxSnapshot(platform:InboxPlatform,value:unknown,mode:'foreground'|'background',context:InboxReadContext):InboxReadResult {
 if(value&&typeof value==='object'&&(value as InboxDomSnapshot).login===true)return result('login','请在官方窗口完成登录后重试。');
 if(!validSnapshot(value)||!pageUrl(platform,value.url))return result('unsupported','当前页面结构或网址无法确认，请等待官方消息／已购页面完成加载。');
 if(!value.account)return result('unsupported','尚未确认页面中的本人账号栏；请等待头像和账号信息加载，无需先清除登录状态。');
 if(!value.supported){
  const message=value.diagnostic==='chat-unselected'?'账号已识别；请先在官方消息页打开要检查的会话，再点击“检查新链接”。':value.diagnostic==='conversation-empty'?'账号已识别，当前会话列表为空或仍在加载；稍后再检查。':platform==='xianyu'?'账号已识别，但当前聊天消息结构尚未适配；没有读取其他会话。':'账号已识别，但当前已购交付区域尚未适配；请打开资料库列表后重试。';
  return result('unsupported',message);
 }
 const accountKey=createHash('sha256').update(platform+'\0'+value.account).digest('hex'),observations:InboxObservation[]=[];let oldShare=false,timeReview=false,codeReview=false;
 for(const row of value.rows){
  if(platform==='booth'&&row.kind!=='purchase'||platform==='xianyu'&&row.kind==='purchase')continue;
  const shares=platform==='xianyu'?extractShareLinks(row.text):[];
  const sourceAt=inboxSourceTime(row.time,platform,context.now,row.day),age=recency(sourceAt,context.now,context.hours);
  if(age==='old'||knownOldDay(row.time,platform,context)||knownOldDay(row.day,platform,context)){oldShare||=shares.length>0;continue}
  if(mode==='background'&&(age!=='recent'||platform==='xianyu'&&(row.kind!=='conversation'||row.unread!==true)))continue;
  const download=platform==='booth'?purchaseUrl(row.purchaseUrl):undefined;
  const libraryItem=platform==='booth'&&pageUrl(platform,value.url)==='https://accounts.booth.pm/library'&&typeof row.libraryItem==='string'&&/^[1-9]\d{0,11}$/.test(row.libraryItem)?row.libraryItem:undefined;
  // An owned purchase link is mandatory before any accompanying text is eligible.
  if(platform==='booth'&&!download&&!libraryItem||!download&&!libraryItem&&!shares.length)continue;
  const title=platform==='booth'&&typeof row.title==='string'?row.title.replace(/[\x00-\x1f]/g,' ').trim().slice(0,160):'';
  // Calendar-relative labels may remain on a loaded page across midnight as well.
  const approximate=platform==='xianyu'&&sourceAt!==undefined&&row.time&&(relativeInboxTime(row.time,context.now)!==undefined||/^(?:今天|今日|昨天|昨日|Today|Yesterday)\s*/i.test(row.time.trim()));
  observations.push({platform,accountKey,sourceKey:row.key,sourceUrl:download||pageUrl(platform,value.url)!,title:title||(platform==='booth'?'BOOTH 已购交付':'闲鱼交付链接'),sourceAt,...(approximate?{sourceTimeApproximate:true}:{}),text:row.text,...(download?{boothDownloadPage:download}:{}),...(libraryItem?{boothLibraryItem:libraryItem}:{})});
  if(platform==='xianyu'){timeReview||=age==='unknown';codeReview||=shares.some(share=>share.codeConflict)}
 }
 if(platform==='xianyu'){
  if(!observations.length)return result('ready',mode==='background'?'已检查当前页面的近期未读预览；未发现符合条件的链接，未打开聊天。':oldShare?`已识别聊天区域；找到的链接早于所选的最近 ${context.hours} 小时，未加入列表。`:'已识别聊天区域，当前会话未发现符合条件的百度网盘链接。');
  // A visible time such as 18:25 is deliberately undated. Explain where the
  // detected link will appear instead of making the default pending list look broken.
  if(mode==='foreground')return result('ready','已识别当前会话中的百度网盘链接。'+(timeReview||codeReview?(timeReview?'部分消息未显示完整日期，':'')+(codeReview?'部分提取码有冲突，':'')+'请查看“时间／提取码待核对”。':'请在“待下载”中查看。'),observations);
 }
 const noPurchaseTime=platform==='booth'&&value.rows.length>0&&value.rows.every(r=>inboxSourceTime(r.time,platform,context.now,r.day)===undefined);
 return result('ready',noPurchaseTime?(mode==='background'?'资料库未显示购买时间；无法判断近期新增，未加入后台通知。':'已识别资料库条目；页面未提供购买时间，条目仅待核对。'):(mode==='background'?'已检查当前页面的近期未读预览／购买记录；未打开聊天。':'已检查当前页面中的交付链接。'),observations);
}

/** No navigation, clicks, private APIs, cookies, browser-profile reads, or page-state writes. */
export async function readOwnedInbox(platform:InboxPlatform,pages:InboxPage[],mode:'foreground'|'background',signal:AbortSignal,context:InboxReadContext,permitted:()=>boolean):Promise<InboxReadResult> {
 const active=()=>!signal.aborted&&permitted();if(!active())return result('paused','账号检查已暂停。');
 const owned=pages.filter(p=>!p.isDestroyed()).slice(0,20),candidates=owned.filter(p=>pageUrl(platform,p.getURL())).slice(0,4);
 if(!candidates.length)return inboxAccountStatus(platform,owned.map(p=>p.getURL()),mode);
 let fallback=result('unsupported','当前交付区域无法安全识别；没有读取或打开其他会话。');const observations:InboxObservation[]=[],messages=new Set<string>();
 for(const page of candidates){
  if(!active())return result('paused','账号检查已暂停。');const before=page.getURL();
  try{
   const captured=await evaluateInboxPage(page,inboxCaptureScript(platform,mode,false),signal);
   if(!active()||page.isDestroyed())return result('paused','账号检查已暂停。');
   if(page.getURL()===before&&captured&&typeof captured==='object'&&(captured as InboxDomSnapshot).url===before&&(captured as InboxDomSnapshot).login===true){fallback=result('login','请在官方窗口完成登录后重试。');continue}
   if(page.getURL()!==before||!validSnapshot(captured)||captured.url!==before){fallback=result('unsupported','页面或账号已变化，请等待页面稳定。');continue}
   const parsed=interpretInboxSnapshot(platform,captured,mode,context);if(parsed.state!=='ready'){fallback=parsed;continue}
   const verified=await evaluateInboxPage(page,inboxCaptureScript(platform,mode,true),signal);
   if(!active()||page.isDestroyed())return result('paused','账号检查已暂停。');
   if(page.getURL()!==before||!validSnapshot(verified)||verified.url!==before||verified.account!==captured.account||!verified.supported||verified.login){fallback=result('unsupported','页面或账号已变化，本次结果已丢弃。');continue}
   observations.push(...parsed.observations);if(parsed.observations.length)messages.add(parsed.message);fallback=parsed;
  }catch{if(!active())return result('paused','账号检查已暂停。');fallback=result('unsupported','页面暂时无法读取；请等待官方页面完成加载。')}
 }
 return observations.length?result('ready',[...messages].join(' ').slice(0,200),observations.slice(0,300)):fallback;
}
