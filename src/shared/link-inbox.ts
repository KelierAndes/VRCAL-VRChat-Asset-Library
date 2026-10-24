import {parseBaiduShare} from './baidu-download';

export type InboxPlatform='xianyu'|'booth';
export type InboxAge='recent'|'old'|'unknown';
export interface InboxSettings {enabled:boolean;background:boolean;hours:6|12|24}
export interface InboxLink {url:string;code:string;codeConflict:boolean}
export interface InboxObservation {platform:InboxPlatform;accountKey:string;sourceKey:string;sourceUrl:string;title:string;sourceAt?:number;text:string;boothDownloadPage?:string;boothLibraryItem?:string}
export interface InboxItem extends InboxLink {id:string;platform:InboxPlatform;accountKey:string;sourceUrl:string;title:string;sourceAt?:number;discoveredAt:number;read:boolean;dismissed:boolean;kind:'baidu'|'booth';boothLibraryItem?:string;taskIds:string[];completed:boolean}
export interface InboxStatus {platform:InboxPlatform;state:'paused'|'login'|'ready'|'checking'|'unsupported'|'error';message:string;checkedAt?:number}
export interface InboxState {settings:InboxSettings;items:InboxItem[];unread:number;statuses:InboxStatus[];error?:string}
export const DEFAULT_INBOX_SETTINGS:InboxSettings={enabled:false,background:false,hours:24};
export function validateInboxSettings(input:unknown):InboxSettings {
 const v=input as InboxSettings;if(!v||typeof v.enabled!=='boolean'||typeof v.background!=='boolean'||![6,12,24].includes(v.hours))throw new Error('链接识别设置无效。');return {enabled:v.enabled,background:v.background,hours:v.hours};
}

export function recency(at:number|undefined,now:number,hours:number):InboxAge {
 if(at===undefined||!Number.isFinite(at)||at<=0||at>now)return 'unknown';
 return now-at<=hours*3600000?'recent':'old';
}

/** Only exact displayed timestamps qualify. A time without a proven day is not "today". */
export function sourceTime(raw:string,now:number,offsetMinutes:number,dayContext?:string):number|undefined {
 if(typeof raw!=='string'||raw.length>100||!Number.isFinite(now)||!Number.isInteger(offsetMinutes)||Math.abs(offsetMinutes)>840)return;
 let value=raw.trim().replace(/\//g,'-');
 const dateAt=(days:number)=>new Date(now+offsetMinutes*60000-days*86400000).toISOString().slice(0,10);
 value=value.replace(/^(?:今天|今日|Today)\s*/i,dateAt(0)+' ').replace(/^(?:昨天|昨日|Yesterday)\s*/i,dateAt(1)+' ');
 if(/^\d{1,2}:\d{2}(?::\d{2})?$/.test(value)&&dayContext&&/^\d{4}-\d{2}-\d{2}$/.test(dayContext))value=dayContext+' '+value;
 const match=/^(\d{4})-(\d{1,2})-(\d{1,2})[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value);if(!match)return;
 const [year,month,day,hour,minute,second]=match.slice(1).map(n=>Number(n||0));
 if(year<2000||month<1||month>12||day<1||day>31||hour>23||minute>59||second>59)return;
 const local=Date.UTC(year,month-1,day,hour,minute,second),check=new Date(local);
 if(check.getUTCFullYear()!==year||check.getUTCMonth()!==month-1||check.getUTCDate()!==day)return;
 const result=local-offsetMinutes*60000;return result<=now?result:undefined;
}

/** Each code belongs only to text after its own link, up to the next link. */
export function extractShareLinks(text:string):InboxLink[] {
 if(typeof text!=='string'||text.length>32768)return [];
 const matches=[...text.matchAll(/https?:\/\/[^\s<>「」"']+/g)].slice(0,30),result:InboxLink[]=[];
 for(let index=0;index<matches.length;index++){
  const match=matches[index],raw=match[0].replace(/[，。；）)]+$/,'');let url:URL;
  try{url=new URL(raw);if(url.protocol!=='https:'||url.hostname!=='pan.baidu.com'||url.port||url.username||url.password||url.hash||!/^\/s\/[A-Za-z0-9_-]{5,100}$/.test(url.pathname)||[...url.searchParams.keys()].some(key=>key!=='pwd')||url.searchParams.getAll('pwd').length>1)continue}catch{continue}
  const following=text.slice(match.index!+match[0].length,matches[index+1]?.index??text.length).slice(0,300);
  const codes=[url.searchParams.get('pwd')||'',...Array.from(following.matchAll(/(?:提取码|提取碼|密码)\s*[:：]?\s*([A-Za-z0-9]{4})(?![A-Za-z0-9])/g),m=>m[1])].filter(Boolean);
  const conflict=codes.some(value=>! /^[A-Za-z0-9]{4}$/.test(value))||new Set(codes).size>1;
  const canonical=url.origin+url.pathname;
  try{const checked=parseBaiduShare(canonical,conflict?'':codes[0]||'');result.push({...checked,codeConflict:conflict})}catch{/* Unrecognized links never become download targets. */}
 }
 return result;
}
