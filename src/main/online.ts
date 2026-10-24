import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import * as cheerio from 'cheerio';
import type { AssetRecord, Category, OnlineInfo, ProductCandidate, QueueProgress, TransferProgress, TransferSummary, SpeedSample, MatchEvidence } from '../shared/contracts';
import { assertSafeWrite } from './safety';
import { inferAvatars, inferProductCategory,officialProductCategory } from './hints';
import { TransferMeter } from './transfer';
import { searchClue, searchClues,searchQueries,filenameIdentityConflict, candidateScore, extractBoothIds, boothProductId, canonicalSourceKey, canonicalCreator, MATCH_RULE_VERSION } from './matching';
export { searchClue, searchClues, candidateScore, extractBoothIds } from './matching';

const HTML_LIMIT = 3 * 1024 * 1024;
const IMAGE_LIMIT = 16 * 1024 * 1024;
const CACHE_AGE = 7 * 24 * 60 * 60 * 1000;
type Fetch = (url:string, init?:RequestInit)=>Promise<Response>;
type Task = { id:string; url?:string; accept?:boolean; previews?:boolean; attempts?:number; notBefore?:number;manualRequest?:boolean;correction?:boolean;rematch?:boolean;capturedHtml?:string };
interface Persisted { tasks:Task[]; activeTasks?:Task[]; paused:boolean; completed:number; recentTransfers?:TransferSummary[]; recentDownloads?:TransferSummary[]; speedHistory?:SpeedSample[]; downloadedBytes?:number; peakDownloadBps?:number; hosts?:Record<string,HostState> }
export interface QueueDependencies {
  dataDir:string; roots:()=>string[]; all:()=>AssetRecord[]; get:(id:string)=>AssetRecord|null;
  updateOnline:(id:string, patch:Partial<OnlineInfo>)=>void; fetch:Fetch;
  concurrency?:()=>number;
  canonicalId?:(id:string)=>string|undefined;
  onProgress?:(progress:QueueProgress)=>void; onChange?:()=>void;
  /** Test-only overrides are ignored unless NODE_ENV=test. */
  testing?:{ intervalMs?:number; timeoutMs?:number; lookup?:(hostname:string)=>Promise<string[]> };
}
export interface ParsedProduct extends ProductCandidate { category:Category; tags:string[]; avatars:string[]; description:string;metadataFields?:{description:boolean;tags:boolean;avatars:boolean} }
class QueuePaused extends Error {}
class QueueSuperseded extends QueuePaused {}
class RequestFailure extends Error { constructor(message:string, public code:'failed'|'blocked'|'not-found', public retryAfter?:number, public countedRetry=true) { super(message); } }
class UnsafeSource extends RequestFailure {constructor(message:string){super(message,'failed');}}
const hash = (value:string)=>createHash('sha256').update(value).digest('hex');
const unique = (items:string[])=>[...new Set(items.map(x=>x.trim()).filter(Boolean))];

export function publicHttpsUrl(raw:string):URL {
  if (raw.length > 2048) throw new Error('网址过长');
  let url:URL; try { url = new URL(raw); } catch { throw new Error('请输入完整的 HTTPS 商品网址'); }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || isIP(hostname.replace(/^\[|\]$/g,'')) || !hostname.includes('.') || /(?:^|\.)(localhost|local|internal|test|invalid|example|onion)$/.test(hostname)) throw new Error('仅允许公开网站的 HTTPS 网址');
  if (/\/(?:users\/sign_in|login|signin|age[_-]?check|adult[_-]?check|accounts)(?:\/|$)/i.test(url.pathname)) throw new Error('不能读取登录或年龄验证页面');
  url.hash = ''; return url;
}
export function isPublicAddress(address:string):boolean {
  const ip=address.toLowerCase();
  if (ip.startsWith('::ffff:')) return isPublicAddress(ip.slice(7));
  if (isIP(ip)===4) { const a=ip.split('.').map(Number); return !(a[0]===0 || a[0]===10 || a[0]===127 || a[0]>=224 || (a[0]===169&&a[1]===254) || (a[0]===172&&a[1]>=16&&a[1]<=31) || (a[0]===192&&[0,168].includes(a[1])) || (a[0]===100&&a[1]>=64&&a[1]<=127) || (a[0]===198&&[18,19,51].includes(a[1])) || (a[0]===203&&a[1]===0&&a[2]===113)); }
  return isIP(ip)===6 && /^[23]/.test(ip) && !ip.startsWith('2001:db8:') && !ip.startsWith('2002:') && !ip.startsWith('2001:0:');
}
const boothItem=boothProductId;
function marketItem(raw:string):string|undefined {try{const u=new URL(raw),ids=u.searchParams.getAll('id');return u.protocol==='https:'&&/(?:^|\.)goofish\.com$/i.test(u.hostname)&&u.pathname==='/item'&&ids.length===1&&/^[1-9]\d{0,23}$/.test(ids[0])?ids[0]:undefined}catch{return}}
function shopAlias(raw:unknown):string|undefined {try{const u=new URL(toText(raw));const match=u.hostname.match(/^([a-z0-9-]+)\.booth\.pm$/i);return match&&!['www','accounts'].includes(match[1])?match[1]:undefined;}catch{return undefined;}}
function cleanTitle(text:string):string { return text.replace(/\s+-\s+BOOTH\s*$/i,'').replace(/\s+-\s+[^-]+$/,'').trim(); }
function toText(value:unknown):string { return typeof value==='string'?value:''; }

function officialTitleAliases(title:string,description:string):string[] {
  // A short introductory sentence is still prose. Require an explicit language
  // label, or the dated, adjacent bilingual identity block used by shops such as Li-ne.
  const opening=description.replace(/<br\s*\/?\s*>/gi,'\n').split(/\r?\n/).map(line=>line.trim()).filter(Boolean).slice(0,5),aliases:string[]=[];
  const identity=(line:string)=>line.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu,'').toLowerCase();
  const key=identity(title),dated=/^\d{4}[./-]\d{1,2}[./-]\d{1,2}$/.test(opening[0]??'');
  for(let index=0;index<opening.length;index++){
    const line=opening[index],label=line.match(/^(?:EN(?:GLISH)?|JA|JP|JAPANESE|英語|英文|日本語|日文)(?:\s+(?:title|name)|タイトル|商品名)?\s*[:：]\s*(.+)$/i),name=label?.[1]??line;
    if(/Unity|liltoon|Modular\s+Avatar|対応|supported|compatible|requirements?|credits?|使用|利用|商品説明|version|https?:/i.test(line))break;
    if(identity(name)===key)continue;
    if(!/^[\p{L}\p{N}][\p{L}\p{N}\s'’・ー-]{3,99}$/u.test(name))continue;
    const adjacent=identity(opening[index-1]??'')===key||identity(opening[index+1]??'')===key;
    const japanese=/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;
    const bilingual=japanese.test(name)!==japanese.test(title);
    const prose=/\b(?:this|these|our|your|you|for|with|is|are|to|we|please|use|designed|compatible|includes?|contains?)\b|この|本商品|本製品|です|ます/i.test(name);
    if(label&&!prose){aliases.push(name);continue;}
    const latinTitle=!/[A-Za-z]/.test(name)||name.split(/\s+/).every(word=>/^[A-Z0-9]/.test(word));
    if(dated&&adjacent&&bilingual&&!prose&&latinTitle)aliases.push(name);
  }
  return unique(aliases).slice(0,3);
}

export function parseProduct(html:string, rawUrl:string):ParsedProduct {
  const url=publicHttpsUrl(rawUrl).href, $=cheerio.load(html);
  const expectedId=boothItem(url);
  const marketHost=/(?:^|\.)goofish\.com$/i.test(new URL(url).hostname),marketId=marketItem(url);
  if(marketHost&&!marketId)throw new RequestFailure('请先打开闲鱼商品详情页，再尝试补全。','not-found');
  let product:any;
  const visit=(node:any):void=>{ if (!node||typeof node!=='object') return; if (Array.isArray(node)) { node.forEach(visit); return; } const types=Array.isArray(node['@type'])?node['@type']:[node['@type']]; if (types.includes('Product') && (!expectedId || boothItem(toText(node.url))===expectedId) && (!marketId || marketItem(toText(node.url))===marketId)) product ??= node; if (node['@graph']) visit(node['@graph']); };
  $('script[type="application/ld+json"]').each((_i,element)=>{try {visit(JSON.parse($(element).text()));} catch { /* Malformed third-party metadata is ignored. */ }});
  const root=$('.market-item-detail-article').first().clone();
  const categoryRoot=root.clone();
  categoryRoot.find('.shop-items,.item-card,.recommended-items,.recommend-items,[data-recommendations],script,style,.description,.item-description,.js-autolink,[itemprop="description"]').remove();
  const categoryRegion='.item-category,.item-categories,.market-item-category,.market-item-detail-category,[data-item-category],.breadcrumb,.breadcrumbs,[aria-label="breadcrumb"],[aria-label="Breadcrumb"],[itemtype="https://schema.org/BreadcrumbList"]';
  const categories=categoryRoot.find('a[href*="/browse/"]').filter((_i,e)=>$(e).closest(categoryRegion).length>0).map((_i,e)=>$(e).text()).get();
  root.find('.shop-items,.item-card,.recommended-items,.recommend-items,script,style,nav').remove();
  const meta=(key:string)=>$(`meta[property="${key}"],meta[name="${key}"]`).first().attr('content')?.trim()||'';
  const og=meta('og:title')||$('title').first().text();
  const marketOg=!!marketId&&/^(?:og:)?product(?:[.:]|$)/i.test(meta('og:type'))&&marketItem(meta('og:url')||$('link[rel="canonical"]').first().attr('href')||'')===marketId;
  const marketTitle=toText(product?.name).trim()||(marketOg?meta('og:title'):'');
  if(marketId&&(!marketTitle||/^(?:闲鱼|閑魚|goofish|xianyu|淘宝登录|淘宝网|login|sign in)$/i.test(marketTitle.trim())||/captcha|access denied|just a moment|登录|登入|ログイン/i.test(marketTitle)))throw new RequestFailure('闲鱼页面未提供可核对的商品信息，请完成网站验证或手动填写资料。','blocked');
  const identity=$(`[data-product-id="${expectedId}"]`).toArray().some(element=>!$(element).closest('.item-card,.recommended-items,.recommend-items,.shop-items,[data-recommendations]').length);
  if (expectedId && !product && !identity) throw new RequestFailure('该商品已下架，或页面需要登录／年龄验证', /ログイン|年齢|成人|認証|captcha|access denied/i.test(og)?'blocked':'not-found');
  const title=marketId?marketTitle:toText(product?.name)||cleanTitle(og)||root.find('h1').first().text().trim();
  if (!title || /captcha|access denied|just a moment|年齢確認|年齢認証/i.test(title)) throw new RequestFailure('网页需要验证，已停止读取','blocked');
  const brand=product?.brand||product?.manufacturer||product?.author;
  const author=toText(brand?.name)||toText(brand)||root.find('.shop-name,.shop-name-anchor,[data-shop-name]').first().text().trim()||(expectedId?og.match(/\s+-\s+(.+?)\s+-\s+BOOTH\s*$/i)?.[1]:'')||meta('author');
  const description=unique([toText(product?.description),root.find('.js-autolink,.item-description,.description').text().trim(),meta('og:description')||meta('description')]).join('\n').slice(0,16000);
  const variations=root.find('.variation-name').map((_i,e)=>$(e).text()).get().join('\n');
  const tags=unique(root.find('a[href*="tags"],.item-tag').map((_i,e)=>$(e).text()||$(e).find('img').attr('alt')||'').get()).slice(0,30);
  // URLs contain shop names (for example chocolaterice), which are not avatar names.
  const primary=unique([title,description,variations,...tags,...categories]).join('\n').replace(/https?:\/\/\S+/g,'');
  const official=expectedId?officialProductCategory(categories):undefined;
  const category=inferProductCategory({title,tags,description,categories});
  const categoryEvidence=official&&expectedId?{rawCategory:official.rawCategory,sourceUrl:url,itemId:expectedId,ruleVersion:MATCH_RULE_VERSION}:undefined;
  const extraAvatars:[string,RegExp][]=[['Ramune',/\bramune\b|ラムネ/i],['Milfy',/\bmilfy\b|ミルフィ/i],['Rurune',/\brurune\b|ルルネ/i],['Lasyusha',/\blasyusha\b|ラシューシャ/i]];
  const image=Array.isArray(product?.image)?product.image[0]:product?.image;
  const coverUrl=toText(image?.url)||toText(image)||meta('og:image')||undefined;
  const authorAliases=unique([shopAlias(url),shopAlias(brand?.url),shopAlias(product?.seller?.url),...root.find('.shop-name-anchor,.shop-name a,a[data-shop-name]').map((_i,e)=>shopAlias($(e).attr('href'))).get()].filter((alias):alias is string=>!!alias));
  const avatars=unique([...inferAvatars(primary),...extraAvatars.filter(([,r])=>r.test(primary)).map(([name])=>name)]);
  const descriptionAvailable=!!product&&Object.hasOwn(product,'description')||root.find('.js-autolink,.item-description,.description').length>0||$('meta[property="og:description"],meta[name="description"]').length>0;
  return {url,title,titleAliases:officialTitleAliases(title,description),author:author||undefined,authorAliases,coverUrl,description,category,categoryEvidence,avatars,tags,metadataFields:{description:descriptionAvailable,tags:root.length>0,avatars:avatars.length>0||root.length>0}};
}

/** Keep only public product fields. Browser HTML and account data never enter the queue or backup. */
export function captureMarketplaceProduct(url:string,snapshot:unknown,manualTitle?:unknown):string {
  const id=marketItem(url),page=snapshot as {url?:unknown;html?:unknown}|undefined;
  if(!id||!page||typeof page.url!=='string'||marketItem(page.url)!==id)throw new Error('商品页面已切换，请重载并核对后采用来源。');
  if(typeof page.html!=='string'||page.html.length>HTML_LIMIT)throw new Error('商品页面内容过大，无法读取。');
  let product:ParsedProduct;
  try{product=parseProduct(page.html,url)}catch{
    if(typeof manualTitle!=='string'||!manualTitle.trim()||manualTitle.trim().length>500||/[\x00-\x1f]/.test(manualTitle)||/^(?:闲鱼|閑魚|goofish|xianyu|login|sign in)$/i.test(manualTitle.trim()))throw new Error('网页未提供商品资料，请在上方填写已核对的商品名称后应用。');
    product={url,title:manualTitle.trim(),category:'未分类',tags:[],avatars:[],description:''};
  }
  const data={'@type':'Product',url,title:undefined,name:product.title.slice(0,500),brand:product.author?{name:product.author.slice(0,500)}:undefined,image:product.coverUrl?.slice(0,2048),description:product.description.slice(0,16000)};
  return '<script type="application/ld+json">'+JSON.stringify(data).replace(/</g,'\\u003c')+'</script>';
}

export function parseSearch(html:string, url:string):ProductCandidate[] {
  const $=cheerio.load(html), results:ProductCandidate[]=[];
  if(/captcha|access denied|just a moment|年齢確認|年齢認証|ログイン - BOOTH/i.test($('title').text()))throw new RequestFailure('网站需要验证，已停止读取','blocked');
  const main=$('.market-items').first();
  const empty=(main.length?main:$('body')).find('h2,h3,.search-empty,.no-results,[data-search-empty]').toArray().some(element=>/条件に一致する商品は見つかりませんでした|検索結果がありません|no\s+(?:matching\s+)?(?:items|products|results)(?:\s+(?:were\s+)?found)?|没有找到(?:匹配|相关)?(?:商品|结果)|沒有找到(?:符合|相關)?(?:商品|結果)/i.test($(element).text()));
  if(empty)return [];
  const explicit=$('[data-search-results],#search-results,.search-results').first(),grid=main.find('.l-cards-5cols').first();
  const scope=(explicit.length?explicit:grid.length?grid:main.length?main:$('body')).clone();
  scope.find('.recommended-items,.recommend-items,.recommended-products,.recommendations,.shop-items,[data-recommendations]').remove();
  scope.find('.item-card').each((_i,e)=>{
    const node=$(e); const href=node.find('a[href*="/items/"]').first().attr('href');
    if (!href) return; let full:string; try { full=new URL(href,url).href; if (!boothItem(full)) return; publicHttpsUrl(full); } catch { return; }
    const title=node.find('.item-card__title,.item-card__title-anchor,.item-card-title').first().text().trim()||node.find('[data-product-name]').first().attr('data-product-name')||node.attr('data-product-name')||'';
    const author=node.find('.item-card__shop-name-anchor,.item-card__shop-name,.shop-name').first().text().trim();
    const authorAliases=unique(node.find('.item-card__shop-name-anchor,.shop-name a').map((_i,e)=>shopAlias($(e).attr('href'))).get().filter((alias):alias is string=>!!alias));
    const id=boothItem(full),cardId=node.attr('data-product-id');
    const official=cardId===id?officialProductCategory(node.find('a[href*="/browse/"]').map((_i,e)=>$(e).text()).get()):undefined;
    if (title && !results.some(c=>boothItem(c.url)===id)) results.push({url:`https://booth.pm/ja/items/${id}`,title,author:author||undefined,authorAliases,...(official&&id?{category:official.category,categoryEvidence:{rawCategory:official.rawCategory,sourceUrl:url,itemId:id,ruleVersion:MATCH_RULE_VERSION}}:{})});
  });
  return results.slice(0,30);
}
function compact(text:string):string { return text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,''); }
export function detectedImageExtension(bytes:Buffer):string|undefined {
  if (bytes.length>=8 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return '.png';
  if (bytes.length>=3 && bytes[0]===255&&bytes[1]===216&&bytes[2]===255) return '.jpg';
  if (bytes.length>=6&&/^GIF8[79]a$/.test(bytes.subarray(0,6).toString('ascii'))) return '.gif';
  if (bytes.length>=12&&bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP') return '.webp';
  return undefined;
}

interface TaskContext { discovery?:boolean; task:Task; current:string; controller:AbortController; lastTransferId?:string;sourceUrl?:string }
interface ActiveRequest { controller:AbortController; consumers:Set<TaskContext>; promise:Promise<Resource>; host?:string;transferId?:string }
interface Resource {bytes:Buffer;url:string;mime:string}
interface LiveTransfer {meter:TransferMeter;id:string;taskId:string;lastEmission:number}
interface HostState {nextStart:number;cooldown:number}
export class EnrichmentQueue {
  private tasks:Task[]=[]; private contexts=new Map<string,TaskContext>(); private workers=new Set<Promise<void>>();
  private paused=false; private stopped=false; private completed=0; private message=''; private concurrency=3;
  private blockedHosts=new Set<string>(); private hosts=new Map<string,HostState>(); private requests=new Map<string,ActiveRequest>();
  private liveTransfers=new Map<string,LiveTransfer>(); private transfer?:TransferProgress; private recentTransfers:TransferSummary[]=[];
  private speedHistory:SpeedSample[]=[]; private downloadedBytes=0; private peakDownloadBps=0; private lastByteAt=0;
  private heartbeat?:ReturnType<typeof setInterval>; private kickTimer?:ReturnType<typeof setTimeout>; private lastSave=0;
  private readonly statePath:string; private readonly htmlInterval:number; private readonly imageInterval:number; private readonly timeout:number;
  constructor(private readonly deps:QueueDependencies) {
    this.statePath=path.join(deps.dataDir,'queue.json');
    const test=process.env.NODE_ENV==='test';
    this.htmlInterval=test&&deps.testing?.intervalMs!==undefined?Math.max(0,deps.testing.intervalMs):3000;
    this.imageInterval=test&&deps.testing?.intervalMs!==undefined?Math.max(0,deps.testing.intervalMs):200;
    this.timeout=test&&deps.testing?.timeoutMs!==undefined?deps.testing.timeoutMs:25000;
    this.concurrency=this.validConcurrency(deps.concurrency?.()??3);
    try {
      const stat=fs.statSync(this.statePath); if(stat.size>2*1024*1024)throw new Error('队列文件过大');
      const saved:Persisted=JSON.parse(fs.readFileSync(this.statePath,'utf8'));
      const valid=(task:Task)=>task&&typeof task.id==='string'&&(!task.url||typeof task.url==='string');
      this.tasks=this.normalizeTasks([...(Array.isArray(saved.tasks)?saved.tasks:[]),...(Array.isArray(saved.activeTasks)?saved.activeTasks:[])].filter(valid).slice(0,10000));
      this.paused=!!saved.paused;this.completed=Math.max(0,Number(saved.completed)||0);
      const history=saved.recentTransfers??saved.recentDownloads;
      if(Array.isArray(history))this.recentTransfers=history.filter(t=>t&&typeof t.url==='string'&&typeof t.finishedAt==='string'&&Number.isFinite(t.receivedBytes)).slice(0,100);
      if(Array.isArray(saved.speedHistory)){
        const validSamples=saved.speedHistory.filter(s=>s&&Number.isFinite(s.at)&&Number.isFinite(s.downloadBps)&&Number.isFinite(s.uploadBps)&&s.at<=Date.now()).sort((a,b)=>a.at-b.at),lastAt=validSamples.at(-1)?.at??0;
        this.speedHistory=validSamples.filter(s=>s.at>=lastAt-60000).map(s=>({...s,uploadBps:0})).slice(-61);
      }
      this.downloadedBytes=Math.max(0,Number(saved.downloadedBytes)||0);this.peakDownloadBps=Math.max(0,Number(saved.peakDownloadBps)||0);
      if(saved.hosts&&typeof saved.hosts==='object')for(const [key,state] of Object.entries(saved.hosts)){if(typeof key==='string'&&state&&Number.isFinite(state.nextStart)&&Number.isFinite(state.cooldown))this.hosts.set(key,{nextStart:Math.min(Date.now()+24*60*60*1000,Math.max(0,state.nextStart)),cooldown:Math.min(Date.now()+24*60*60*1000,Math.max(0,state.cooldown))});}
    } catch { /* A new or damaged queue can be rebuilt from the library. */ }
  }
  /** Public search operations share request spacing, host cooldowns, transfer UI and safe caches.
   * They never become persisted asset jobs or change source bindings. */
  async discoveryPage(url:string,signal:AbortSignal):Promise<{html:string;url:string}> {
    const u=publicHttpsUrl(url);if(u.hostname!=='booth.pm'||!u.pathname.startsWith('/ja/search/'))throw new Error('仅支持 BOOTH 搜索页。');
    return this.discoveryContext(signal,ctx=>this.html(ctx,u.href,'search'));
  }
  async discoveryCover(url:string,signal:AbortSignal):Promise<string> {
    return this.discoveryContext(signal,ctx=>this.cover(ctx,url));
  }
  private async discoveryContext<T>(signal:AbortSignal,run:(ctx:TaskContext)=>Promise<T>):Promise<T> {
    const controller=new AbortController(),abort=()=>controller.abort(new QueuePaused('搜索已停止。'));
    signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
    const ctx:TaskContext={discovery:true,task:{id:'discovery-'+randomUUID()},current:'找素材',controller};
    try{return await run(ctx)}finally{signal.removeEventListener('abort',abort)}
  }
  private validConcurrency(value:number):number {return Number.isFinite(value)?Math.min(6,Math.max(1,Math.round(value))):3;}
  private canonicalId(id:string):string {return this.deps.canonicalId?.(id)??id;}
  private normalizeTasks(tasks:Task[]):Task[] {
    const grouped=new Map<string,Task>();
    for(const input of tasks){const task={...input,id:this.canonicalId(input.id)},previous=grouped.get(task.id),chosen=this.deps.get(task.id)?.manual.sourceUrl;
      const rank=(candidate:Task)=>((candidate.url&&chosen&&canonicalSourceKey(candidate.url)===canonicalSourceKey(chosen))?8:0)+(candidate.accept?4:0)+(candidate.manualRequest?2:0)+(candidate.url?1:0)-(candidate.previews?1:0);
      if(!previous||rank(task)>rank(previous))grouped.set(task.id,task);
    }return [...grouped.values()];
  }
  private needsCorrection(asset:AssetRecord):boolean {
    if(asset.online.status==='review')return !asset.manual.sourceUrl&&asset.online.matchEvidence?.method!=='manual'&&!asset.online.confirmedSource&&asset.manual.matchingMode!=='manual'&&asset.online.matchingCheckedVersion!==MATCH_RULE_VERSION;
    return asset.online.status==='matched'&&!!asset.online.url&&(asset.online.matchEvidence?.ruleVersion!==MATCH_RULE_VERSION||!asset.online.categoryEvidence&&asset.online.classificationCheckedVersion!==MATCH_RULE_VERSION);
  }
  setConcurrency(value:number):void {this.concurrency=this.validConcurrency(value);this.save();this.emit();this.start();}
  get progress():QueueProgress {
    const activeTransfers=[...this.liveTransfers.values()].map(({meter,id,taskId})=>({...meter.snapshot(),id,taskId}));
    const totalDownloadBps=this.paused||this.stopped?0:activeTransfers.reduce((sum,t)=>sum+t.downloadBps,0);
    return {running:!this.paused&&!this.stopped&&(this.contexts.size>0||this.tasks.length>0),paused:this.paused,pending:this.tasks.length+this.contexts.size,completed:this.completed,current:[...this.contexts.values()].map(c=>c.current).join(' · '),message:this.message||undefined,transfer:this.transfer?{...this.transfer}:undefined,recentTransfers:this.recentTransfers.map(t=>({...t})),activeTransfers,speedHistory:this.speedHistory.map(s=>({...s})),downloadedBytes:this.downloadedBytes,peakDownloadBps:this.peakDownloadBps,totalDownloadBps,totalUploadBps:0,concurrency:this.concurrency,activeTasks:this.contexts.size};
  }
  private emit():void {this.deps.onProgress?.(this.progress);}
  private check(ctx:TaskContext):void {if(ctx.controller.signal.aborted)throw ctx.controller.signal.reason||new QueuePaused();if(ctx.discovery){if(this.stopped)throw new QueuePaused("资料库正在关闭或迁移，请稍后重新搜索。");return;}const current=this.deps.get(ctx.task.id);if(!current||current.online.rematchRequested&&!ctx.task.rematch&&!ctx.task.url&&!ctx.task.previews||current.manual.matchingMode==='manual'&&!(ctx.task.url&&ctx.task.manualRequest===true)){const error=new QueueSuperseded('此素材已转入手动归类或不再参与匹配');ctx.controller.abort(error);throw error;}if(this.paused||this.stopped)throw new QueuePaused();}
  private stopHeartbeat():void {if(this.heartbeat)clearInterval(this.heartbeat);this.heartbeat=undefined;}
  private ensureHeartbeat():void {
    if(this.heartbeat||this.paused||this.stopped)return;
    this.heartbeat=setInterval(()=>{
      if(this.paused||this.stopped){this.stopHeartbeat();return;}
      this.sample();
      const live=[...this.liveTransfers.values()].at(-1);
      if(live)this.transfer={...live.meter.snapshot(),id:live.id,taskId:live.taskId};
      this.emit();if(Date.now()-this.lastSave>=1000)this.save();
      // Freeze the last real traffic window after a short honest zero-speed tail.
      if(!this.contexts.size&&!this.liveTransfers.size&&Date.now()-this.lastByteAt>=2000){this.save();this.stopHeartbeat();}
    },300);
    this.heartbeat.unref?.();
  }
  private sample(bytes=0):void {
    const now=Date.now(),at=Math.floor(now/1000)*1000;
    this.speedHistory=this.speedHistory.filter(sample=>sample.at>=now-60000);
    let point=this.speedHistory.at(-1);
    if(!point||point.at!==at){point={at,downloadBps:0,uploadBps:0};this.speedHistory.push(point);}
    point.downloadBps+=bytes;point.uploadBps=0;
    if(bytes){this.lastByteAt=now;this.downloadedBytes+=bytes;this.peakDownloadBps=Math.max(this.peakDownloadBps,point.downloadBps);}
  }
  private beginTransfer(ctx:TaskContext,url:string,kind:TransferProgress['kind'],phase:TransferProgress['phase']='connecting'):LiveTransfer {
    const id=randomUUID(),meter=new TransferMeter(publicHttpsUrl(url).href,kind,(kind==='search'?'商品检索':kind==='page'?'商品页面':'封面图片')+' · '+ctx.current,phase);
    const live={id,taskId:ctx.task.id,meter,lastEmission:Date.now()};ctx.lastTransferId=id;this.liveTransfers.set(id,live);this.transfer={...meter.snapshot(),id,taskId:ctx.task.id};this.ensureHeartbeat();this.emit();return live;
  }
  private updateTransfer(live:LiveTransfer,phase?:TransferProgress['phase'],bytes=0,force=false):void {
    if(!this.liveTransfers.has(live.id))return;if(phase)live.meter.setPhase(phase);
    if(bytes){live.meter.received(bytes);this.sample(bytes);}
    this.transfer={...live.meter.snapshot(),id:live.id,taskId:live.taskId};
    this.peakDownloadBps=Math.max(this.peakDownloadBps,this.progress.totalDownloadBps??0);
    if(phase||force||Date.now()-live.lastEmission>=250){live.lastEmission=Date.now();this.emit();}
  }
  private endTransfer(live:LiveTransfer,status:TransferSummary['status'],fromCache=false,suspended=false):void {
    if(!this.liveTransfers.delete(live.id))return;
    live.meter.setPhase(suspended?'waiting':fromCache?'cache':status==='complete'?'complete':'error');
    this.transfer={...live.meter.snapshot(),id:live.id,taskId:live.taskId};
    if(!suspended){
      const metrics=fromCache?{}:live.meter.completedMetrics();
      if(metrics.downloadBps)this.peakDownloadBps=Math.max(this.peakDownloadBps,metrics.downloadBps);
      this.recentTransfers.unshift({id:live.id,taskId:live.taskId,url:this.transfer.url,kind:this.transfer.kind,label:this.transfer.label,receivedBytes:this.transfer.receivedBytes,fromCache,finishedAt:new Date().toISOString(),status,...metrics});
      this.recentTransfers=this.recentTransfers.slice(0,100);this.save();
    }
    this.emit();
  }
  private cacheTransfer(ctx:TaskContext,url:string,kind:TransferProgress['kind'],bytes:number):void {this.check(ctx);const live=this.beginTransfer(ctx,url,kind,'cache');live.meter.received(bytes);this.endTransfer(live,'complete',true);}
  private failCompletedTransfer(ctx:TaskContext,url:string):void {
    const summary=this.recentTransfers.find(t=>t.id===ctx.lastTransferId&&t.url===url);
    if(summary)summary.status='error';
    if(this.transfer&&this.transfer.id===ctx.lastTransferId){this.transfer={...this.transfer,phase:'error',downloadBps:0};}
    this.save();this.emit();
  }
  private save():void {
    assertSafeWrite(this.statePath,this.deps.dataDir,this.deps.roots());fs.mkdirSync(path.dirname(this.statePath),{recursive:true});
    const temp=this.statePath+'.tmp';assertSafeWrite(temp,this.deps.dataDir,this.deps.roots());
    const active=[...this.contexts.values()].filter(c=>!(c.controller.signal.reason instanceof QueueSuperseded)).map(c=>c.task),pendingIds=new Set(this.tasks.map(t=>t.id));
    const tasks=[...this.tasks,...active.filter(t=>!pendingIds.has(t.id))];
    fs.writeFileSync(temp,JSON.stringify({version:2,tasks,activeTasks:active,paused:this.paused,completed:this.completed,recentTransfers:this.recentTransfers,recentDownloads:this.recentTransfers,speedHistory:this.speedHistory,downloadedBytes:this.downloadedBytes,peakDownloadBps:this.peakDownloadBps,hosts:Object.fromEntries(this.hosts)}),{encoding:'utf8',mode:0o600});fs.renameSync(temp,this.statePath);this.lastSave=Date.now();
  }
  private update(ctx:TaskContext,patch:Partial<OnlineInfo>):void {this.check(ctx);
    if(ctx.task.rematch&&this.deps.get(ctx.task.id)?.online.rematchRequested&&!ctx.task.url){patch={...patch,status:'review'};for(const key of ['url','confirmedSource','matchEvidence','metadataSourceUrl'] as const)delete patch[key];}
    this.deps.updateOnline(ctx.task.id,patch);this.deps.onChange?.();}
  private rejected(id:string,url:string):boolean {const key=canonicalSourceKey(url);return !!this.deps.get(id)?.online.rejectedUrls?.some(source=>canonicalSourceKey(source)===key);}
  private requireCurrentBinding(ctx:TaskContext,product:ProductCandidate):void {
    this.check(ctx);const current=this.deps.get(ctx.task.id),chosen=current?.manual.sourceUrl;
    if(!chosen||ctx.task.rematch&&current?.online.rematchRequested&&!ctx.task.url)return;
    const key=canonicalSourceKey(chosen),taskSource=ctx.task.url||ctx.sourceUrl;
    if(key!==canonicalSourceKey(product.url)&&(!taskSource||key!==canonicalSourceKey(taskSource))){
      const error=new QueueSuperseded('本地来源已改变，已停止旧商品任务');ctx.controller.abort(error);throw error;
    }
  }
  private evidence(asset:AssetRecord,product:ProductCandidate,method:MatchEvidence['method'],manualConfirmed=false):MatchEvidence {
    const id=boothItem(product.url),nameScore=candidateScore(asset.name,product),clue=searchClue(asset.name),signals:string[]=[];
    if(method==='manual')signals.push(manualConfirmed?'用户已确认这一商品来源':'用户提供来源网址；仍按名称与作者核对');
    if(method==='known-source')signals.push('刷新已登记商品来源；不视为新增人工确认');
    if(id&&extractBoothIds(asset.name).includes(id))signals.push('文件名商品编号与 BOOTH '+id+' 一致');
    if(method==='child-package'){
      const localName=asset.localNameHints?.find(name=>id&&extractBoothIds(name).includes(id)||candidateScore(name,product)>=.95);
      signals.push(localName?'子包线索：'+localName.slice(0,160):'浅层本地包名提供商品线索');signals.push('原文件仍保持独立，未移动或合并到磁盘');
    }
    if(method==='readme-link')signals.push('本地说明中的商品链接提供来源线索');
    if(nameScore===1)signals.push('移除压缩、版本及适配包装后，完整商品名称一致');
    else if(nameScore>=.95)signals.push('同商品编号、英文主名一致，日文说明括注兼容');
    if(clue.author&&[product.author,...(product.authorAliases||[])].some(author=>author&&canonicalCreator(author)===canonicalCreator(clue.author!)))signals.push('作者线索与商品作者或商店标识一致');
    if(method==='name-search')signals.push('搜索结果已核对主商品名称，未把推荐区当作搜索结果');
    return {method,signals:unique(signals).slice(0,8),ruleVersion:MATCH_RULE_VERSION,recordedAt:new Date().toISOString()};
  }
  private reviewReason(asset:AssetRecord,product:ProductCandidate):string {
    const clue=searchClue(asset.name),score=candidateScore(asset.name,product),id=boothItem(product.url);
    if(id&&extractBoothIds(asset.name).length>1)return '文件名包含多个商品编号；这一候选仅对应其中一个，请确认具体商品';
    if(id&&extractBoothIds(asset.name).includes(id)&&score<.95)return '文件名编号对应这一商品；名称或作者未能唯一核对，请看图确认';
    if(clue.author&&score===0)return '来源已有线索，但文件中的作者标识与网页作者尚未对应';
    return score>=.95?'商品名称已对应，但还有相似商品或多个本地包，需由你确认':'名称存在部分对应；型号、版本说明或作者仍需核对';
  }
  async enqueue(ids?:string[],retry=false):Promise<void> {
    if(retry&&!this.contexts.size)this.blockedHosts.clear();
    const selected=(ids?ids.map(id=>this.deps.get(this.canonicalId(id))).filter((a):a is AssetRecord=>!!a):this.deps.all().filter(a=>a.kind!=='unity-project'&&(!retry||a.online.status!=='matched'||this.needsCorrection(a)))).filter(a=>a.manual.matchingMode!=='manual');
    if(retry){const requested=new Set(selected.map(a=>a.id));this.tasks=this.tasks.filter(task=>!task.previews||!requested.has(task.id));for(const ctx of this.contexts.values())if(ctx.task.previews&&requested.has(ctx.task.id))ctx.controller.abort(new QueueSuperseded());}
    const queued=new Set([...this.tasks.map(t=>t.id),...[...this.contexts.values()].filter(ctx=>!retry||!ctx.task.previews).map(ctx=>ctx.task.id)]);
    for(const asset of selected){const id=this.canonicalId(asset.id),correction=this.needsCorrection(asset);if(asset.missing||asset.kind==='unity-project'||(!retry&&asset.online.status!=='pending'&&!correction)||queued.has(id))continue;this.tasks.push({id,...(asset.online.rematchRequested?{rematch:true}:{}),...(correction?{correction:true}:{})});queued.add(id);}
    this.message='';this.save();this.emit();this.start();
  }
  async enqueueCandidateCovers(ids:string[]):Promise<void> {
    const queued=new Set([...this.tasks.map(task=>task.id),...this.contexts.keys()]);
    for(const id of new Set(ids.map(id=>this.canonicalId(id)))){const asset=this.deps.get(id);if(!asset||asset.manual.matchingMode==='manual'||asset.missing||asset.online.status!=='review'||queued.has(id)||!asset.online.candidates?.some(candidate=>candidate.coverUrl&&!candidate.coverFile))continue;this.tasks.push({id,previews:true,...(asset.online.rematchRequested?{rematch:true}:{})});queued.add(id);}
    this.save();this.emit();this.start();
  }
  private cancelAll():void {
    if(this.kickTimer)clearTimeout(this.kickTimer);this.kickTimer=undefined;this.stopHeartbeat();
    for(const live of this.liveTransfers.values()){live.meter.setPhase('waiting');this.transfer={...live.meter.snapshot(),id:live.id,taskId:live.taskId};}
    for(const ctx of this.contexts.values())ctx.controller.abort(new QueuePaused());
    for(const request of this.requests.values())request.controller.abort(new QueuePaused());
  }
  exclude(ids:string[]):void {const excluded=new Set(ids.map(id=>this.canonicalId(id)));this.tasks=this.tasks.filter(task=>!excluded.has(this.canonicalId(task.id)));for(const ctx of this.contexts.values())if(excluded.has(this.canonicalId(ctx.task.id)))ctx.controller.abort(new QueueSuperseded('此素材已转入手动归类'));this.save();this.emit();this.start();}
  pause():void {this.paused=true;this.message='已暂停，现有资料仍可浏览';this.cancelAll();this.save();this.emit();}
  stop():void {this.stopped=true;this.cancelAll();this.save();this.emit();}
  async waitIdle():Promise<void> {
    while(this.workers.size||this.requests.size){await Promise.allSettled([...this.workers,...[...this.requests.values()].map(request=>request.promise)]);}
    this.save();
  }
  async resume():Promise<void> {this.paused=false;this.stopped=false;this.blockedHosts.clear();this.message='';this.save();this.emit();this.start();}
  private replaceTask(task:Task):void {
    task={...task,id:this.canonicalId(task.id)};
    this.tasks=this.tasks.filter(t=>t.id!==task.id);this.tasks.push(task);
    this.contexts.get(task.id)?.controller.abort(new QueueSuperseded());
    this.save();this.emit();this.start();
  }
  async linkSource(id:string,rawUrl:string):Promise<void> {
    id=this.canonicalId(id);
    const asset=this.deps.get(id);if(!asset)throw new Error('素材不存在');const url=publicHttpsUrl(rawUrl.trim()).href;
    const metadataSourceUrl=asset.online.metadataSourceUrl||(asset.online.status==='matched'?asset.online.url:undefined);
    this.deps.updateOnline(id,{status:'pending',url,metadataSourceUrl,confirmedSource:false,candidates:[],message:'正在读取手动添加的来源'});this.deps.onChange?.();this.replaceTask({id,url,manualRequest:asset.manual.matchingMode==='manual'});
  }
  async acceptCandidate(id:string,rawUrl:string,groupConfirmed=false,capturedHtml?:string):Promise<void> {
    id=this.canonicalId(id);
    const asset=this.deps.get(id);if(!asset)throw new Error('素材不存在');const url=publicHttpsUrl(rawUrl).href;
    if(this.rejected(id,url))throw new Error('已排除此商品，请恢复候选后再确认');
    const trustedGroup=groupConfirmed&&!!asset.manual.sourceUrl&&canonicalSourceKey(asset.manual.sourceUrl)===canonicalSourceKey(url);
    if(!trustedGroup&&asset.online.url!==url&&!asset.online.candidates?.some(c=>publicHttpsUrl(c.url).href===url))throw new Error('请先添加来源或选择当前候选商品');
    if(capturedHtml!==undefined){if(!marketItem(url)||capturedHtml.length>HTML_LIMIT)throw new Error('商品页面资料无效。');parseProduct(capturedHtml,url);}
    this.message='';this.replaceTask({id,url,accept:true,manualRequest:asset.manual.matchingMode==='manual',...(capturedHtml?{capturedHtml}:{})});
  }
  private start():void {
    if(this.paused||this.stopped)return;
    this.tasks=this.normalizeTasks(this.tasks);
    if(this.kickTimer)clearTimeout(this.kickTimer);this.kickTimer=undefined;
    while(this.contexts.size<this.concurrency){
      const index=this.tasks.findIndex(task=>(!task.notBefore||task.notBefore<=Date.now())&&!this.contexts.has(task.id));
      if(index<0)break;
      const task=this.tasks.splice(index,1)[0],asset=this.deps.get(task.id),ctx:TaskContext={task,current:asset?.name||task.id,controller:new AbortController()};
      this.contexts.set(task.id,ctx);this.save();this.emit();this.ensureHeartbeat();
      const worker=this.runTask(ctx).catch(error=>{this.message=error instanceof Error?error.message:'队列运行失败';this.paused=true;this.cancelAll();}).finally(()=>{
        this.contexts.delete(task.id);this.workers.delete(worker);this.save();this.emit();this.start();
        if(!this.contexts.size&&!this.tasks.length&&!this.lastByteAt)this.stopHeartbeat();
      });
      this.workers.add(worker);
    }
    const future=this.tasks.filter(task=>!this.contexts.has(task.id)&&task.notBefore&&task.notBefore>Date.now()).map(task=>task.notBefore!);
    if(this.contexts.size<this.concurrency&&future.length){this.kickTimer=setTimeout(()=>{this.kickTimer=undefined;this.start();},Math.min(2147483647,Math.max(1,Math.min(...future)-Date.now())));}
  }
  private async runTask(ctx:TaskContext):Promise<void> {
    const task=ctx.task;
    try {const asset=this.deps.get(task.id);this.check(ctx);if(asset&&!asset.missing){if(task.previews)await this.candidateCovers(ctx,asset);else await this.enrich(ctx,asset,task);}this.check(ctx);if(!task.previews)this.completed++;}
    catch(error){
      if(error instanceof QueueSuperseded||ctx.controller.signal.reason instanceof QueueSuperseded)return;
      if(error instanceof QueuePaused||this.paused||this.stopped||ctx.controller.signal.reason instanceof QueuePaused){
        if(!this.tasks.some(t=>t.id===task.id))this.tasks.unshift({...task,notBefore:undefined});
      } else if(error instanceof RequestFailure&&error.retryAfter!==undefined&&(task.attempts||0)<3) {
        if(!this.tasks.some(t=>t.id===task.id))this.tasks.push({...task,attempts:(task.attempts||0)+(error.countedRetry?1:0),notBefore:Date.now()+error.retryAfter});
        this.message='网站正在限流，该网站稍后重试；其他网站继续下载';
      } else {
        const status=error instanceof RequestFailure?error.code:'failed';
        this.update(ctx,task.previews?{message:'候选预览图读取失败，可稍后重试：'+(error instanceof Error?error.message:'网络不可用')}:task.correction?{message:'自动分类复核未完成，保留上次资料：'+(error instanceof Error?error.message:'网络不可用')}:{status,message:error instanceof Error?error.message:'联网读取失败'});if(!task.previews)this.completed++;
      }
    }
  }
  private hostKey(host:string):string {return /(?:^|\.)booth\.pm$/.test(host)?'booth.pm':host;}
  private hostState(key:string):HostState {let state=this.hosts.get(key);if(!state){state={nextStart:0,cooldown:0};this.hosts.set(key,state);}return state;}
  private async wait(milliseconds:number,signal:AbortSignal):Promise<void> {
    if(signal.aborted)throw signal.reason||new QueuePaused();if(milliseconds<=0)return;
    await new Promise<void>((resolve,reject)=>{
      const done=()=>{signal.removeEventListener('abort',abort);resolve();};
      const timer=setTimeout(done,milliseconds);
      const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(signal.reason||new QueuePaused());};
      signal.addEventListener('abort',abort,{once:true});
    });
  }
  private async gate(url:URL,kind:'html'|'image',signal:AbortSignal,live:LiveTransfer):Promise<void> {
    const key=this.hostKey(url.hostname),state=this.hostState(key),interval=key==='booth.pm'||kind==='html'?this.htmlInterval:this.imageInterval;
    while(true){
      if(signal.aborted)throw signal.reason||new QueuePaused();
      if(this.blockedHosts.has(key))throw new RequestFailure('网站要求验证，已停止本轮自动读取；可在浏览器查看来源','blocked');
      const now=Date.now();if(state.cooldown>now)throw new RequestFailure('网站正在限流','failed',state.cooldown-now,false);
      const delay=state.nextStart-now;if(delay>0){this.updateTransfer(live,'waiting');await this.wait(delay,signal);continue;}
      state.nextStart=now+interval;return;
    }
  }
  private async validated(rawUrl:string):Promise<URL> {
    let url:URL;try{url=publicHttpsUrl(rawUrl);}catch(error){throw new UnsafeSource(error instanceof Error?error.message:'网址无效');}
    const addresses=this.deps.testing?.lookup&&process.env.NODE_ENV==='test'?await this.deps.testing.lookup(url.hostname):(await lookup(url.hostname,{all:true,verbatim:true})).map(a=>a.address);
    if(!addresses.length||addresses.some(a=>!isPublicAddress(a)))throw new UnsafeSource('网站地址不是公开网络地址');return url;
  }
  private resource(ctx:TaskContext,rawUrl:string,kind:'html'|'image',transferKind:TransferProgress['kind']):Promise<Resource> {
    this.check(ctx);const url=publicHttpsUrl(rawUrl).href,key=kind+':'+url;
    let request=this.requests.get(key);
    if(!request){
      const controller=new AbortController(),consumers=new Set<TaskContext>();
      request={controller,consumers,promise:undefined!};this.requests.set(key,request);
      const current=request;
      current.promise=this.download(ctx,url,kind,transferKind,current).finally(()=>{if(this.requests.get(key)===current)this.requests.delete(key);});
      void current.promise.catch(()=>{});
    }
    const shared=request;shared.consumers.add(ctx);ctx.lastTransferId=shared.transferId;
    return new Promise<Resource>((resolve,reject)=>{
      let settled=false;
      const finish=(error:unknown,value?:Resource)=>{
        if(settled)return;settled=true;ctx.controller.signal.removeEventListener('abort',abort);shared.consumers.delete(ctx);
        if(error)reject(error);else resolve(value!);
        if(!shared.consumers.size&&!shared.controller.signal.aborted)shared.controller.abort(new QueuePaused());
      };
      const abort=()=>finish(ctx.controller.signal.reason||new QueuePaused());
      ctx.controller.signal.addEventListener('abort',abort,{once:true});
      if(ctx.controller.signal.aborted){abort();return;}
      shared.promise.then(value=>{this.check(ctx);finish(undefined,value);}).catch(error=>finish(error));
    });
  }
  private async download(ctx:TaskContext,rawUrl:string,kind:'html'|'image',transferKind:TransferProgress['kind'],request:ActiveRequest):Promise<Resource> {
    const controller=request.controller,live=this.beginTransfer(ctx,rawUrl,transferKind),limit=kind==='html'?HTML_LIMIT:IMAGE_LIMIT;
    request.transferId=live.id;
    let timer:ReturnType<typeof setTimeout>|undefined,settled=false;
    const startTimeout=()=>{if(timer)clearTimeout(timer);timer=setTimeout(()=>controller.abort(new RequestFailure('网页读取超时，可稍后重试','failed')),this.timeout);};
    const work=async():Promise<Resource>=>{
      let url=rawUrl;
      for(let redirects=0;redirects<=5;redirects++){
        startTimeout();const target=await this.validated(url);if(timer)clearTimeout(timer);timer=undefined;
        if(controller.signal.aborted)throw controller.signal.reason;request.host=this.hostKey(target.hostname);
        await this.gate(target,kind,controller.signal,live);if(controller.signal.aborted)throw controller.signal.reason;
        if(redirects)live.meter=new TransferMeter(target.href,transferKind,(transferKind==='cover'?'封面图片':'商品页面')+' · '+ctx.current);
        this.updateTransfer(live,'connecting');live.meter.startRequest();startTimeout();
        const response=await this.deps.fetch(target.href,{redirect:'manual',signal:controller.signal,credentials:'omit',headers:{'User-Agent':'VRChatAssetLibrary/1.4 (+local personal catalog)','Accept':kind==='html'?'text/html,application/xhtml+xml':'image/png,image/jpeg,image/webp,image/gif'}});
        if(controller.signal.aborted||settled){await response.body?.cancel();throw controller.signal.reason||new QueuePaused();}
        if([301,302,303,307,308].includes(response.status)){const location=response.headers.get('location');await response.body?.cancel();if(!location)throw new RequestFailure('网页重定向缺少目标','failed');url=new URL(location,target).href;continue;}
        const key=this.hostKey(target.hostname);
        if(response.status===429){
          const value=response.headers.get('retry-after')||'',seconds=/^\d+$/.test(value)?Number(value)*1000:Date.parse(value)-Date.now();
          const duration=Math.min(24*60*60*1000,Math.max(this.htmlInterval||10,Number.isFinite(seconds)?seconds:60000));
          this.hostState(key).cooldown=Math.max(this.hostState(key).cooldown,Date.now()+duration);await response.body?.cancel();
          throw new RequestFailure('网站正在限流','failed',duration);
        }
        if([401,403].includes(response.status)){
          this.blockedHosts.add(key);await response.body?.cancel();
          const error=new RequestFailure('网站要求登录或验证，已停止本轮读取','blocked');
          for(const other of this.requests.values())if(other!==request&&other.host===key)other.controller.abort(error);
          throw error;
        }
        if([404,410].includes(response.status)){await response.body?.cancel();throw new RequestFailure('商品网页已下架或不存在','not-found');}
        if(!response.ok){await response.body?.cancel();throw new RequestFailure('网页暂时无法读取（'+response.status+'），可稍后重试','failed');}
        const mime=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
        if(kind==='html'&&!['text/html','application/xhtml+xml'].includes(mime)){await response.body?.cancel();throw new RequestFailure('来源不是公开 HTML 网页','failed');}
        if(kind==='image'&&!['image/jpeg','image/png','image/gif','image/webp'].includes(mime)){await response.body?.cancel();throw new RequestFailure('封面不是支持的图片格式','failed');}
        if(Number(response.headers.get('content-length'))>limit){await response.body?.cancel();throw new RequestFailure(kind==='html'?'网页过大，已跳过':'封面超过 16 MB，已跳过','failed');}
        const reader=response.body?.getReader();if(!reader)throw new RequestFailure('网站没有返回内容','failed');
        live.meter.setTotal(response.headers);this.updateTransfer(live,'downloading');
        const chunks:Buffer[]=[];let size=0;
        const abortRead=()=>{void reader.cancel().catch(()=>{});};controller.signal.addEventListener('abort',abortRead,{once:true});
        try {
          while(true){const {done,value}=await reader.read();if(controller.signal.aborted||settled)throw controller.signal.reason||new QueuePaused();if(done)break;size+=value.length;this.updateTransfer(live,undefined,value.length,size===value.length);if(size>limit)throw new RequestFailure('网站返回内容超过大小限制','failed');chunks.push(Buffer.from(value));}
        } catch(error){await reader.cancel().catch(()=>{});throw error;}
        finally {controller.signal.removeEventListener('abort',abortRead);reader.releaseLock();}
        return {bytes:Buffer.concat(chunks,size),url:target.href,mime};
      }
      throw new RequestFailure('网页重定向次数过多','failed');
    };
    let abortListener:()=>void=()=>{};
    const cancelled=new Promise<never>((_resolve,reject)=>{abortListener=()=>reject(controller.signal.reason||new QueuePaused());controller.signal.addEventListener('abort',abortListener,{once:true});});
    try {const result=await Promise.race([work(),cancelled]);this.endTransfer(live,'complete');return result;}
    catch(error){const suspended=error instanceof QueuePaused||controller.signal.reason instanceof QueuePaused;this.endTransfer(live,'error',false,suspended);throw error;}
    finally {settled=true;if(timer)clearTimeout(timer);controller.signal.removeEventListener('abort',abortListener);}
  }
  private cachePath(file:string):string {const target=path.join(this.deps.dataDir,'cache',file);assertSafeWrite(target,this.deps.dataDir,this.deps.roots());return target;}
  private atomicCache(target:string,data:string|Buffer):void {
    fs.mkdirSync(path.dirname(target),{recursive:true});assertSafeWrite(target,this.deps.dataDir,this.deps.roots());
    const temp=target+'.'+randomUUID()+'.tmp';assertSafeWrite(temp,this.deps.dataDir,this.deps.roots());
    try{fs.writeFileSync(temp,data);fs.renameSync(temp,target);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
  }
  private async html(ctx:TaskContext,rawUrl:string,kind:TransferProgress['kind']='page'):Promise<{html:string;url:string}> {
    this.check(ctx);const url=publicHttpsUrl(rawUrl).href,target=this.cachePath('page-'+hash(url)+'.json');
    try{const stat=fs.statSync(target);if(stat.size<=HTML_LIMIT*2){const cached=JSON.parse(fs.readFileSync(target,'utf8'));if(Date.now()-cached.at<CACHE_AGE&&typeof cached.html==='string'&&Buffer.byteLength(cached.html)<=HTML_LIMIT){const cachedUrl=publicHttpsUrl(cached.url).href;this.cacheTransfer(ctx,cachedUrl,kind,Buffer.byteLength(cached.html));return {html:cached.html,url:cachedUrl};}}}catch(error){if(error instanceof QueuePaused)throw error;}
    const result=await this.resource(ctx,url,'html',kind);this.check(ctx);const html=result.bytes.toString('utf8'),cached=JSON.stringify({at:Date.now(),url:result.url,html});this.atomicCache(target,cached);
    if(result.url!==url)this.atomicCache(this.cachePath('page-'+hash(result.url)+'.json'),cached);
    return {html,url:result.url};
  }
  private async product(ctx:TaskContext,url:string):Promise<ParsedProduct> {
    try{const result=await this.html(ctx,url);let product:ParsedProduct;try{if(marketItem(url)&&marketItem(url)!==marketItem(result.url))throw new RequestFailure('闲鱼页面未提供可核对的商品信息，请完成网站验证或手动填写资料。','blocked');product=parseProduct(result.html,result.url);}catch(error){this.failCompletedTransfer(ctx,result.url);throw error;}
      this.requireCurrentBinding(ctx,product);return product;}
    catch(error){if(error instanceof RequestFailure&&error.code==='blocked')this.blockedHosts.add(this.hostKey(publicHttpsUrl(url).hostname));throw error;}
  }
  private async cover(ctx:TaskContext,rawUrl:string):Promise<string> {
    this.check(ctx);const url=publicHttpsUrl(rawUrl).href;
    for(const extension of ['.jpg','.png','.gif','.webp']){const file='cover-'+hash(url)+extension,target=this.cachePath(file);try{const stat=fs.statSync(target);if(stat.size<=IMAGE_LIMIT&&detectedImageExtension(fs.readFileSync(target))===extension){this.cacheTransfer(ctx,url,'cover',stat.size);return file;}}catch(error){if(error instanceof QueuePaused)throw error;}}
    const result=await this.resource(ctx,url,'image','cover');this.check(ctx);const extension=detectedImageExtension(result.bytes),mimeExt:Record<string,string>={'image/jpeg':'.jpg','image/png':'.png','image/gif':'.gif','image/webp':'.webp'};
    if(!extension||mimeExt[result.mime]!==extension){this.failCompletedTransfer(ctx,result.url);throw new RequestFailure('封面内容与图片格式不符，已跳过','failed');}
    const file='cover-'+hash(url)+extension;this.atomicCache(this.cachePath(file),result.bytes);return file;
  }
  private async apply(ctx:TaskContext,asset:AssetRecord,product:ParsedProduct,method:MatchEvidence['method']='name-search',confirmed=false):Promise<void> {
    this.requireCurrentBinding(ctx,product);
    if(ctx.task.rematch&&this.deps.get(asset.id)?.online.rematchRequested&&!ctx.task.accept){await this.showReview(ctx,[{...product,reason:'重新匹配找到的候选，请核对后应用；旧来源尚未替换。'}],'重新检索已完成，请确认新的商品来源。');return;}
    if(this.rejected(asset.id,product.url))return;
    let classificationCheckedVersion=product.categoryEvidence?MATCH_RULE_VERSION:undefined,categoryFailure:unknown;
    if(boothItem(product.url)&&!product.categoryEvidence){
      try{const search=await this.html(ctx,'https://booth.pm/en/search/'+encodeURIComponent(product.title),'search'),exact=parseSearch(search.html,search.url).find(candidate=>boothItem(candidate.url)===boothItem(product.url)&&candidate.categoryEvidence);
        if(exact?.categoryEvidence)product={...product,category:exact.category!,categoryEvidence:exact.categoryEvidence};
        classificationCheckedVersion=MATCH_RULE_VERSION;
      }catch(error){if(error instanceof QueuePaused||error instanceof UnsafeSource)throw error;categoryFailure=error;}
    }
    let coverFile:string|undefined,message:string|undefined;
    if(product.coverUrl){try{coverFile=await this.cover(ctx,new URL(product.coverUrl,product.url).href);}catch(error){if(error instanceof QueuePaused)throw error;message='商品已确认；封面读取失败：'+(error instanceof Error?error.message:'请稍后重试');}}
    this.requireCurrentBinding(ctx,product);if(this.rejected(asset.id,product.url)){this.update(ctx,{status:'review',matchingCheckedVersion:MATCH_RULE_VERSION,candidates:this.deps.get(asset.id)?.online.candidates?.filter(candidate=>!this.rejected(asset.id,candidate.url))??[],message:'已记住排除的候选，请添加新来源或恢复候选后重试'});return;}
    const current=this.deps.get(asset.id)?.online,metadataSource=current?.metadataSourceUrl||(current?.status==='matched'?current.url:undefined);
    const previous=metadataSource&&canonicalSourceKey(metadataSource)===canonicalSourceKey(product.url)?current:undefined;
    const fields=product.metadataFields;
    const retained=previous&&(!coverFile&&previous.coverFile||!product.coverUrl&&previous.coverUrl||!product.author&&previous.author||product.category==='未分类'&&previous.category||fields?.tags===false&&previous.tags?.length||fields?.avatars===false&&previous.avatars?.length||fields?.description===false&&previous.description);
    if(retained)message=[message,'本次未获取完整资料或封面，部分内容沿用上次记录'].filter(Boolean).join('；');
    if(categoryFailure){message=[message,'官方分类读取未完成，保留上次分类并稍后重试'].filter(Boolean).join('；');if((ctx.task.attempts??0)<3&&!this.tasks.some(task=>task.id===ctx.task.id)){this.tasks.push({...ctx.task,correction:true,attempts:(ctx.task.attempts??0)+1,notBefore:Date.now()+Math.max(60000,categoryFailure instanceof RequestFailure?categoryFailure.retryAfter??0:0)});}}
    this.update(ctx,{status:'matched',rematchRequested:false,title:product.title,titleAliases:unique([...(product.titleAliases??[]),...(previous?.titleAliases??[])]),author:product.author||previous?.author,authorAliases:unique([...(product.authorAliases??[]),...(previous?.authorAliases??[])]),url:product.url,metadataSourceUrl:product.url,category:((categoryFailure||!product.categoryEvidence&&previous?.categoryEvidence)&&previous?.category)?previous.category:product.category==='未分类'?previous?.category:product.category,categoryEvidence:product.categoryEvidence||previous?.categoryEvidence,classificationCheckedVersion:classificationCheckedVersion||previous?.classificationCheckedVersion,classificationPending:!!categoryFailure,tags:previous&&fields?.tags===false?previous.tags:product.tags,avatars:previous&&fields?.avatars===false?previous.avatars:product.avatars,description:previous&&fields?.description===false?previous.description:product.description,coverUrl:product.coverUrl||previous?.coverUrl,coverFile:coverFile||previous?.coverFile,fetchedAt:new Date().toISOString(),candidates:[],message,confirmedSource:confirmed,matchEvidence:this.evidence(asset,product,method,confirmed)});
  }
  private async candidateCovers(ctx:TaskContext,asset:AssetRecord):Promise<void> {
    for(const candidate of asset.online.candidates?.slice(0,5)||[]){
      if(!candidate.coverUrl||candidate.coverFile||this.rejected(asset.id,candidate.url))continue;
      try{
        this.requireCurrentBinding(ctx,candidate);
        const file=await this.cover(ctx,new URL(candidate.coverUrl,candidate.url).href);this.check(ctx);
        this.requireCurrentBinding(ctx,candidate);
        const current=this.deps.get(asset.id);if(current?.online.status!=='review')return;
        const candidates=current.online.candidates?.filter(item=>!this.rejected(asset.id,item.url)).map(item=>item.url===candidate.url&&item.coverUrl===candidate.coverUrl?{...item,coverFile:file}:item);
        this.update(ctx,{candidates});
      }catch(error){if(error instanceof QueuePaused||error instanceof RequestFailure&&error.retryAfter!==undefined)throw error;this.check(ctx);if(error instanceof RequestFailure&&error.code==='blocked'){this.update(ctx,{message:'候选已找到；网站暂时拒绝读取预览图，可稍后重试或打开网页预览'});return;}}
    }
  }
  private async showReview(ctx:TaskContext,candidates:ProductCandidate[],message:string):Promise<void> {
    if(candidates[0])this.requireCurrentBinding(ctx,candidates[0]);
    const visible=candidates.filter(candidate=>!this.rejected(ctx.task.id,candidate.url)).slice(0,5);
    this.update(ctx,{status:'review',matchingCheckedVersion:MATCH_RULE_VERSION,candidates:visible,message:visible.length?message:'已记住排除的候选，请添加新来源或恢复候选后重试'});
    // Product discovery is complete; thumbnail errors must not replace its state.
    if(!ctx.task.previews){this.completed++;ctx.task.previews=true;this.save();this.emit();}
    const asset=this.deps.get(ctx.task.id);if(asset)await this.candidateCovers(ctx,asset);
  }
  private async enrich(ctx:TaskContext,asset:AssetRecord,task:Task):Promise<void> {
    let registered:string|undefined;
    if((asset.online.status==='matched'||asset.online.matchEvidence?.method==='known-source')&&asset.online.url){try{registered=publicHttpsUrl(asset.online.url).href;}catch{/* An invalid legacy URL is not an identity binding. */}}
    const legacy=!task.url&&!asset.manual.sourceUrl&&!asset.online.confirmedSource&&!!registered;
    const chosen=task.url||(task.rematch?undefined:asset.manual.sourceUrl||(asset.online.confirmedSource?asset.online.url:undefined)||registered);
    if(chosen){
      const source=publicHttpsUrl(chosen).href;
      ctx.sourceUrl=source;
      if(!asset.online.metadataSourceUrl&&asset.online.status==='matched'&&asset.online.url)this.update(ctx,{metadataSourceUrl:asset.online.url});
      if(this.rejected(asset.id,source)){this.update(ctx,{status:'review',matchingCheckedVersion:MATCH_RULE_VERSION,candidates:[],message:'已排除此来源，请添加新的商品网址或恢复候选'});return;}
      if(legacy)this.update(ctx,{matchEvidence:{method:'known-source',signals:['刷新已登记商品来源；不视为新增人工确认'],ruleVersion:MATCH_RULE_VERSION,recordedAt:new Date().toISOString()}});
      if(task.capturedHtml&&(!marketItem(source)||task.capturedHtml.length>HTML_LIMIT))throw new Error('商品页面资料无效。');
      const product=task.capturedHtml?parseProduct(task.capturedHtml,source):await this.product(ctx,source);if(this.rejected(asset.id,product.url))return;
      const changedItem=!!boothItem(source)&&boothItem(source)!==boothItem(product.url);
      const trusted=!!task.accept||!!asset.online.confirmedSource&&!!asset.online.url&&canonicalSourceKey(asset.online.url)===canonicalSourceKey(source);
      const method:MatchEvidence['method']=legacy?'known-source':'manual';
      if(!changedItem&&(trusted||legacy||!!boothItem(source)&&candidateScore(asset.name,product)>=.95))await this.apply(ctx,asset,product,method,trusted);
      else{this.update(ctx,{url:changedItem?source:product.url,confirmedSource:false,matchEvidence:this.evidence(asset,product,method,false)});await this.showReview(ctx,[{...product,reason:changedItem?'网址跳转到了另一商品编号，需要重新确认':this.reviewReason(asset,product)}],'来源已读取，确认后应用封面与标签');}return;
    }
    const primaryIds=extractBoothIds(asset.name),localNames=(asset.localNameHints||[]).filter(name=>!/[\\/]/.test(name)).slice(0,20),childIds=unique(localNames.flatMap(extractBoothIds));
    const multiplePrimaryIds=primaryIds.length>1,multipleChildIds=!primaryIds.length&&childIds.length>1;
    const packageCores=unique(localNames.filter(name=>/\.(?:zip|rar|7z|unitypackage)$/i.test(name)).map(name=>compact(searchClue(name).query)).filter(core=>core.length>=4));
    const multipleChildNames=!primaryIds.length&&packageCores.length>1;
    const ambiguousChildren=multiplePrimaryIds||multipleChildIds||multipleChildNames;
    const names=[asset.name,...localNames.filter(name=>!primaryIds.length||extractBoothIds(name).some(id=>primaryIds.includes(id)))];
    const score=(product:ProductCandidate)=>searchClue(asset.name).author&&candidateScore(asset.name,product)===0?0:Math.max(...names.map(name=>candidateScore(name,product)));
    const potential=(product:ProductCandidate)=>{let value=score(product);
      const verified=unique([product.author??'',...(product.authorAliases??[])].map(canonicalCreator));
      for(const name of names){const clue=searchClue(name);if(clue.author&&!verified.includes(canonicalCreator(clue.author)))continue;
        if(verified.some(author=>author.length>=3&&compact(clue.query).startsWith(author)&&compact(clue.query).length>=author.length+4)||searchClues(name).some(prefix=>prefix.author&&verified.includes(canonicalCreator(prefix.author))))value=Math.max(value,.95);
      }
      if(!product.authorAliases?.length)for(const name of names)for(const clue of searchClues(name))if(clue.author)value=Math.max(value,candidateScore(name,{...product,authorAliases:[clue.author]}));return value;};
    const products=new Map<string,ParsedProduct>(),unverified=new Map<string,ProductCandidate>(),redirected=new Set<string>();let lastError:unknown;
    const key=(url:string)=>boothItem(url)||url;
    const ranked=()=>[...products.values()].filter(product=>!this.rejected(asset.id,product.url)).map(p=>({p,score:score(p)})).sort((a,b)=>b.score-a.score);
    const automatic=()=>{const list=ranked();const exact=primaryIds.length===1?[...products.values()].find(p=>boothItem(p.url)===primaryIds[0]&&!redirected.has(p.url)&&!this.rejected(asset.id,p.url)&&!filenameIdentityConflict(asset.name,p)):undefined;if(exact)return exact;
      return !multiplePrimaryIds&&!multipleChildIds&&list[0]?.score>=.95&&!redirected.has(list[0].p.url)&&(!multipleChildNames||candidateScore(asset.name,list[0].p)>=.95)&&(list.length===1||list[0].score-list[1].score>=.12)&&![...unverified.values()].some(candidate=>!this.rejected(asset.id,candidate.url)&&potential(candidate)>=list[0].score-.12)?list[0].p:undefined;};
    const methodFor=(product:ProductCandidate):MatchEvidence['method']=>primaryIds.includes(boothItem(product.url)||'')?'filename-id':localNames.some(name=>extractBoothIds(name).includes(boothItem(product.url)||'')||candidateScore(name,product)>=.95)&&candidateScore(asset.name,product)<.95?'child-package':asset.hintUrls.some(url=>canonicalSourceKey(url)===canonicalSourceKey(product.url))?'readme-link':'name-search';
    const read=async(url:string)=>{const id=key(url);if(products.has(id)||this.rejected(asset.id,url)){unverified.delete(id);return;}try{const p=await this.product(ctx,url);if(boothItem(url)&&boothItem(url)!==boothItem(p.url))redirected.add(p.url);if(!this.rejected(asset.id,p.url))products.set(key(p.url),p);unverified.delete(id);}catch(error){if(error instanceof QueuePaused||error instanceof UnsafeSource||error instanceof RequestFailure&&(error.code==='blocked'||error.retryAfter!==undefined))throw error;lastError=error;}};
    // Filename IDs precede README credits; locale/shop variants are one item.
    const explicit=new Map<string,string>();
    for(const id of [...primaryIds,...childIds])if(!explicit.has(id))explicit.set(id,'https://booth.pm/zh-cn/items/'+id);
    for(const url of asset.hintUrls){const id=boothItem(url);if(id&&!explicit.has(id))explicit.set(id,url);}
    for(const [id,url] of [...explicit].slice(0,5)){
      await read(url);
      const match=automatic();if(match&&primaryIds.length===1&&id===primaryIds[0]){await this.apply(ctx,asset,match,methodFor(match));return;}
    }
    const direct=automatic();if(direct){await this.apply(ctx,asset,direct,methodFor(direct));return;}
    const otherSource=asset.hintUrls.find(url=>{try{return !boothItem(url)&&!!publicHttpsUrl(url);}catch{return false;}});
    if(!explicit.size&&otherSource&&!this.rejected(asset.id,otherSource)){const p=await this.product(ctx,otherSource);this.update(ctx,{url:p.url,matchEvidence:this.evidence(asset,p,'readme-link')});await this.showReview(ctx,[{...p,reason:'本地说明中的其他网站来源，请核对'}],'其他网站来源已读取，需要手动确认');return;}
    // A dead ID or README dependency does not suppress filename searching.
    const queries=unique(names.flatMap(searchQueries)).slice(0,3);
    for(const query of queries){
      try{
        const result=await this.html(ctx,'https://booth.pm/ja/search/'+encodeURIComponent(query),'search');
        const found=parseSearch(result.html,result.url).filter(candidate=>!this.rejected(asset.id,candidate.url)&&potential(candidate)>0).sort((a,b)=>potential(b)-potential(a));
        for(const candidate of found)if(!products.has(key(candidate.url)))unverified.set(key(candidate.url),candidate);
        for(const candidate of found.slice(0,8)){await read(candidate.url);const ready=automatic();if(ready){await this.apply(ctx,asset,ready,methodFor(ready));return;}}
        const match=automatic();if(match){await this.apply(ctx,asset,match,methodFor(match));return;}
      }catch(error){if(error instanceof QueuePaused||error instanceof UnsafeSource||error instanceof RequestFailure&&(error.code==='blocked'||error.retryAfter!==undefined))throw error;lastError=error;}
    }
    if(task.correction&&asset.online.status==='review'&&lastError)throw lastError;
    const review=ranked().filter(({p,score})=>score>0||redirected.has(p.url)||primaryIds.includes(boothItem(p.url)||'')||childIds.includes(boothItem(p.url)||'')).slice(0,5).map(({p})=>({...p,reason:redirected.has(p.url)?'网址跳转到了另一商品编号，需要重新确认':this.reviewReason(asset,p)}));
    if(review.length){this.update(ctx,{matchEvidence:this.evidence(asset,review[0],methodFor(review[0]))});await this.showReview(ctx,review,multiplePrimaryIds?'文件名包含多个商品编号，请确认具体商品':ambiguousChildren?'文件夹包含不同商品的包名或编号，请核对对应商品':'候选商品已找到，但名称或作者仍需确认');return;}
    if(otherSource&&!this.rejected(asset.id,otherSource)){const p=await this.product(ctx,otherSource);this.update(ctx,{url:p.url,matchEvidence:this.evidence(asset,p,'readme-link')});await this.showReview(ctx,[{...p,reason:'本地说明中的其他网站来源，请核对'}],'其他网站来源已读取，需要手动确认');return;}
    if(task.correction&&asset.online.status==='review'){
      const previous=(asset.online.candidates??[]).filter(candidate=>!this.rejected(asset.id,candidate.url));
      if(previous.length)await this.showReview(ctx,previous,'本次未找到更可靠的来源，保留原待确认候选');
      else this.update(ctx,{status:'not-found',matchingCheckedVersion:MATCH_RULE_VERSION,candidates:[],message:'已完成当前规则复核，没有可用候选；已排除的来源和手动标注仍保留'});
      return;
    }
    if(lastError&&!(lastError instanceof RequestFailure&&lastError.code==='not-found'))throw lastError;
    if(!queries.length){this.update(ctx,{status:'review',matchingCheckedVersion:MATCH_RULE_VERSION,candidates:[],message:'名称线索不足，请手动粘贴商品网址'});return;}
    this.update(ctx,{status:'not-found',candidates:[],message:'已尝试商品编号和名称检索，没有找到可靠商品；可粘贴来源网址'});
  }
}
