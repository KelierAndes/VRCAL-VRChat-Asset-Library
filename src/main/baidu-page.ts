import {createHash} from 'node:crypto';
import {loadHtml as load} from './html-parser';
import type {BaiduScanState} from '../shared/cloud-contracts';

export interface BaiduVisibleItem {id?:string;name:string;path:string;directory:boolean;size?:number;modifiedAt?:string;productId?:string}
export interface BaiduDirectoryCapture {accountKey:string;directoryPath:string;items:BaiduVisibleItem[];capturedAt:string;complete:false;source:'web-visible';warnings:string[]}
export interface BaiduWorkspaceState {connected:boolean;open:boolean;loading:boolean;url:string;status:string;accountKey?:string;scan?:BaiduScanState}
export interface BaiduVisiblePageInput {url:string;html:string;accountKey:string;capturedAt?:string;blocked?:boolean}
export const BAIDU_HOME='https://pan.baidu.com/disk/main';
const TOP_HOSTS=new Set(['pan.baidu.com','passport.baidu.com','wappass.baidu.com']);

/** Top-level navigation only. CDN requests use the separate public-HTTPS resource policy. */
export function baiduBrowserUrl(raw:string):URL {
 let url:URL;try{if(typeof raw!=='string'||raw.length>16384)throw new Error();url=new URL(raw)}catch{throw new Error('baidu-official-url')}
 if(url.protocol!=='https:'||url.username||url.password||(url.port&&url.port!=='443')||!TOP_HOSTS.has(url.hostname.toLowerCase()))throw new Error('baidu-official-url');
 return url;
}
/** No query or fragment crosses the native/renderer boundary (login URLs can carry credentials). */
export function baiduDisplayUrl(raw:string):string {try{const url=baiduBrowserUrl(raw);return url.origin+url.pathname}catch{return ''}}

/** Only cookies read from this workspace's owned Electron session may be passed here. */
export function baiduAccountKey(cookies:ReadonlyArray<{name:string;value:string;domain?:string;path?:string;expirationDate?:number}>):string|undefined {
 for(const name of ['BDUSS','BDUSS_BFESS']){
  const values=new Set(cookies.filter(cookie=>cookie.name===name&&['baidu.com','pan.baidu.com'].includes((cookie.domain||'').replace(/^\./,'').toLowerCase())&&(cookie.path===undefined||cookie.path==='/')&&(cookie.expirationDate===undefined||cookie.expirationDate>Date.now()/1000)&&typeof cookie.value==='string'&&cookie.value.length>=8&&cookie.value.length<=16384&&!/[\x00-\x20\x7f]/.test(cookie.value)).map(cookie=>cookie.value));
  if(values.size>1)return;if(values.size===1)return 'baidu:'+createHash('sha256').update('vrcal-baidu-owned-session\0'+name+'\0'+[...values][0]).digest('hex');
 }
 return undefined;
}
export function cloudPath(raw:string):string {
 if(typeof raw!=='string'||raw.length>8192||!raw.startsWith('/')||raw!==raw.normalize('NFC')||/[\\\x00-\x1f\x7f\ufffd]/.test(raw)||raw!=='/'&&(raw.endsWith('/')||raw.includes('//')))throw new Error('baidu-invalid-path');
 for(const part of raw.slice(1).split('/'))if(part==='.'||part==='..'||/%(?:2e|2f|5c|00)/i.test(part))throw new Error('baidu-invalid-path');
 return raw;
}
export function baiduDirectoryUrl(directoryPath:string):string {return BAIDU_HOME+'#/index?category=all&path='+encodeURIComponent(cloudPath(directoryPath))}
export function currentDirectory(raw:string):string {
 const url=baiduBrowserUrl(raw);if(url.hostname!=='pan.baidu.com'||!/^\/disk\/main\/?$/.test(url.pathname))throw new Error('baidu-unknown-directory');
 // The hash must explicitly identify the all-files directory view; recent/search/category views are not directories.
 const match=url.hash.match(/^#\/?index\?(.+)$/);if(!match)throw new Error('baidu-unknown-directory');const query=new URLSearchParams(match[1]);
 if(query.getAll('path').length>1||query.getAll('category').length>1||query.get('category')!=='all'||query.has('search')||query.has('key'))throw new Error('baidu-unknown-directory');
 return cloudPath(query.has('path')?query.get('path')!:'/');
}
function fileName(raw:string|undefined):string {
 if(!raw||raw.length>1024||!raw.trim()||raw!==raw.normalize('NFC')||raw==='.'||raw==='..'||/[\/\\\x00-\x1f\x7f\ufffd]/.test(raw)||/%(?:2e|2f|5c|00)/i.test(raw))throw new Error('baidu-invalid-name');return raw;
}
/**
 * Narrow table-layout contract, not a general scraper. The live logged-in layout has NOT been verified.
 * No JavaScript state, React/Vue internals, response interception, or private endpoint is inspected.
 * A fixture proves this parser's contract only; unsupported/empty/grid layouts deliberately refuse.
 */
export function parseBaiduVisiblePage(input:BaiduVisiblePageInput):BaiduDirectoryCapture {
 if(!input||!/^baidu:[a-f0-9]{64}$/.test(input.accountKey))throw new Error('baidu-login-identity-required');
 const directoryPath=currentDirectory(input.url);
 if(input.blocked)throw new Error('baidu-login-or-verification-required');
 if(typeof input.html!=='string'||input.html.length>2*1024*1024)throw new Error('baidu-unsupported-layout');
 const $=load(input.html);if($('input[type="password"],#passport-login-pop,.passport-login-pop,.login-dialog,form[action*="passport.baidu.com"]').length)throw new Error('baidu-login-or-verification-required');
 const bodies=$('.wp-s-pan-table__body');if(bodies.length!==1)throw new Error('baidu-unsupported-layout');
 const rows=bodies.find('.wp-s-pan-table__body-row');if((!rows.length&&bodies.attr('data-empty')!=='true')||rows.length>2000)throw new Error('baidu-unsupported-layout');
 const header=$('.wp-s-pan-table__header th').map((_index,node)=>$(node).text().trim()).get().filter(Boolean);
 const modernHeader=JSON.stringify(header)===JSON.stringify(['文件名','大小','类型','修改时间']);
 const byPath=new Map<string,BaiduVisibleItem>(),byId=new Map<string,string>();
 rows.each((_index,element)=>{
  const row=$(element),legacy=row.find('.wp-s-pan-table__file-name-text'),modern=row.find('.wp-s-pan-list__file-name-content[data-title]');
  const names=legacy.length?legacy:modern;if(names.length!==1)throw new Error('baidu-unsupported-layout');
  const nameNode=names.first(),name=fileName(nameNode.attr('data-title')??nameNode.attr('title')??nameNode.text());
  if(nameNode.text().replace(/\u00a0/g,' ').trim()!==name.replace(/\u00a0/g,' ').trim())throw new Error('baidu-conflicting-name');
  let rawType=row.attr('data-isdir');
  if(modern.length){
   const cells=row.children('td');if(!modernHeader||cells.length!==5)throw new Error('baidu-unsupported-layout');
   const type=cells.eq(3).text().trim();if(!type||/^[-—]$/.test(type))throw new Error('baidu-unsupported-layout');
   const displayedType=type==='文件夹'?'1':'0';if(rawType!==undefined&&rawType!==displayedType)throw new Error('baidu-conflicting-row');rawType=displayedType;
  }
  if(rawType!=='0'&&rawType!=='1')throw new Error('baidu-unsupported-layout');
  const item:BaiduVisibleItem={name,path:directoryPath==='/'?'/'+name:directoryPath+'/'+name,directory:rawType==='1'};
  const explicitPath=row.attr('data-path');if(explicitPath!==undefined&&cloudPath(explicitPath)!==item.path)throw new Error('baidu-invalid-path');
  const id=row.attr('data-fsid')??row.attr('data-id');if(id!==undefined){if(!/^\d{1,32}$/.test(id))throw new Error('baidu-unsupported-file-id');item.id=id;const previous=byId.get(id);if(previous&&previous!==item.path)throw new Error('baidu-conflicting-row');byId.set(id,item.path)}
  if(directoryPath==='/'&&id==='1001'&&name==='共享给我的文件夹')return;
  const size=row.attr('data-size');if(!item.directory&&size!==undefined){if(!/^\d{1,16}$/.test(size)||!Number.isSafeInteger(Number(size)))throw new Error('baidu-unsupported-size');item.size=Number(size)}
  // Displayed rounded units and local timestamps are not exact metadata and are intentionally omitted.
  const dates=row.find('time[datetime]');if(dates.length>1)throw new Error('baidu-unsupported-date');if(dates.length){const raw=dates.attr('datetime')!;if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(raw)||!Number.isFinite(Date.parse(raw)))throw new Error('baidu-unsupported-date');item.modifiedAt=new Date(raw).toISOString()}
  const previous=byPath.get(item.path);if(previous&&JSON.stringify(previous)!==JSON.stringify(item))throw new Error('baidu-conflicting-row');byPath.set(item.path,item);
 });
 const capturedAt=input.capturedAt??new Date().toISOString();if(!Number.isFinite(Date.parse(capturedAt)))throw new Error('baidu-invalid-capture-time');
 return {accountKey:input.accountKey,directoryPath,items:[...byPath.values()],capturedAt,complete:false,source:'web-visible',warnings:['visible-partial',...(modernHeader||bodies.attr('data-layout')==='modern'?[]:['live-layout-unverified'])]};
}

export function baiduBreadcrumbMatches(directory:string,breadcrumb:readonly string[]):boolean {
 const parts=breadcrumb.filter(p=>p!=='返回上一级');if(parts[0]!=='全部文件')return false;
 const expected=directory.split('/').filter(Boolean),visible=parts.slice(1);
 const folded=visible.findIndex(p=>p==='...'||p==='…');
 if(folded<0)return JSON.stringify(visible)===JSON.stringify(expected);
 if(folded!==0||visible.length<2)return false;
 const suffix=visible.slice(1);return suffix.length<=expected.length&&JSON.stringify(suffix)===JSON.stringify(expected.slice(-suffix.length));
}
export interface BaiduPageSnapshot extends BaiduVisiblePageInput {
 loading?:boolean; breadcrumb?:string[]; scroll?:{top:number;height:number;total:number}; hasNextPage?:boolean;
}

/** Only rendered directory DOM is inspected. No framework state, responses or private endpoints. */
const BAIDU_SNAPSHOT_FUNCTION='('+function snapshotVisibleBaiduTable(includeRendered=false){
 const shown=(element:Element):boolean=>{
  const rect=element.getBoundingClientRect();if(!rect.width||!rect.height)return false;
  for(let parent:Element|null=element;parent;parent=parent.parentElement){const style=getComputedStyle(parent);if(parent.hasAttribute('hidden')||parent.getAttribute('aria-hidden')==='true'||style.display==='none'||style.visibility==='hidden'||style.opacity==='0')return false}return true;
 };
 const visible=(element:Element):boolean=>{if(!shown(element))return false;const r=element.getBoundingClientRect();if(r.bottom<=0||r.right<=0||r.top>=innerHeight||r.left>=innerWidth)return false;for(let parent=element.parentElement;parent;parent=parent.parentElement){const style=getComputedStyle(parent);if(/(auto|scroll|hidden|clip)/.test(style.overflow+style.overflowY+style.overflowX)){const box=parent.getBoundingClientRect();if(r.bottom<=box.top||r.top>=box.bottom||r.right<=box.left||r.left>=box.right)return false}}return true};
 const blocked=Array.from(document.querySelectorAll('input[type="password"],#passport-login-pop,.passport-login-pop,.login-dialog')).some(visible);
 if(blocked)return {url:location.href,html:'',blocked:true};
 const bodies=Array.from(document.querySelectorAll('.wp-s-pan-table__body')).filter(shown);
 const loading=Array.from(document.querySelectorAll('.u-loading-mask,[role="progressbar"]')).some(visible);
 const nav=document.querySelector('.wp-s-pan-file-main__nav-left');
 const breadcrumb=nav?Array.from(nav.querySelectorAll('.wp-s-pan-file-main__nav-item-title,.title')).filter(e=>shown(e)&&e.children.length===0).map(e=>(e.textContent||'').trim()).filter(Boolean):[];
 if(nav&&/(?:>\s*\.\.\.|>\s*…)/.test((nav as HTMLElement).innerText)&&!breadcrumb.includes('...')&&!breadcrumb.includes('…'))breadcrumb.splice(breadcrumb.indexOf('全部文件')+1,0,'...');
 if(bodies.length!==1)return {url:location.href,html:'',loading,breadcrumb};
 const source=bodies[0],rendered=Array.from(source.querySelectorAll('.wp-s-pan-table__body-row')).filter(shown);
 // Traversal may read rendered rows outside the viewport. This also handles
 // official lists whose scroll area extends past the final file row.
 const rows=includeRendered&&rendered.length<=1500?rendered:rendered.filter(visible);
 if(includeRendered&&!rows.length&&rendered.length)rows.push(...rendered.slice(-100));
 const header=Array.from(document.querySelectorAll('.wp-s-pan-table__header th')).map(e=>(e.textContent||'').trim()).filter(Boolean);
 const modernHeader=JSON.stringify(header)===JSON.stringify(['文件名','大小','类型','修改时间']);
 const body=document.createElement('div');body.className='wp-s-pan-table__body';if(modernHeader)body.setAttribute('data-layout','modern');
 for(const row of rows){
  const legacy=row.querySelectorAll('.wp-s-pan-table__file-name-text'),modern=row.querySelectorAll('.wp-s-pan-list__file-name-content[data-title]');
  const names=legacy.length?legacy:modern;if(names.length!==1)return {url:location.href,html:'',loading,breadcrumb};
  const label=names[0],name=label.getAttribute('data-title')??label.getAttribute('title')??label.textContent??'';
  let type=row.getAttribute('data-isdir');
  if(modern.length){const cells=Array.from(row.children);if(!modernHeader||cells.length!==5)return {url:location.href,html:'',loading,breadcrumb};const text=(cells[3].textContent||'').trim();if(!text||/^[-—]$/.test(text))return {url:location.href,html:'',loading,breadcrumb};const displayed=text==='文件夹'?'1':'0';if(type!==null&&type!==displayed)return {url:location.href,html:'',loading,breadcrumb};type=displayed}
  const clone=document.createElement('div');clone.className='wp-s-pan-table__body-row';
  for(const attr of ['data-path','data-size'])if(row.hasAttribute(attr))clone.setAttribute(attr,row.getAttribute(attr)!);
  const id=row.getAttribute('data-fsid')??row.getAttribute('data-id');if(id!==null)clone.setAttribute('data-fsid',id);if(type!==null)clone.setAttribute('data-isdir',type);
  const item=document.createElement('span');item.className='wp-s-pan-table__file-name-text';item.setAttribute('title',name);item.textContent=name;clone.append(item);
  for(const node of Array.from(row.querySelectorAll('time[datetime]'))){const time=document.createElement('time');time.setAttribute('datetime',node.getAttribute('datetime')!);clone.append(time)}
  body.append(clone);
 }
 if(!source.querySelector('.wp-s-pan-table__body-row')&&!loading&&/^(?:此文件夹为空|文件夹为空|暂无文件|暂无内容|空空如也)$/.test((source.textContent||'').trim()))body.setAttribute('data-empty','true');
 const scroll={top:source.scrollTop,height:source.clientHeight,total:source.scrollHeight};
 const hasNextPage=Array.from(document.querySelectorAll('.u-pagination .btn-next,.el-pagination .btn-next')).some(e=>shown(e)&&!e.hasAttribute('disabled')&&e.getAttribute('aria-disabled')!=='true');
 return {url:location.href,html:body.outerHTML,loading,breadcrumb,scroll,hasNextPage};
}.toString()+')';
export const BAIDU_VISIBLE_SNAPSHOT_SCRIPT=BAIDU_SNAPSHOT_FUNCTION+'(false)';
export const BAIDU_DIRECTORY_SNAPSHOT_SCRIPT=BAIDU_SNAPSHOT_FUNCTION+'(true)';

export const BAIDU_SCROLL_SCRIPT='('+function scrollDirectoryList(){
 const body=document.querySelector('.wp-s-pan-table__body');if(!body)return false;
 body.scrollTop+=Math.max(60,body.clientHeight*.8);return true;
}.toString()+')()';
