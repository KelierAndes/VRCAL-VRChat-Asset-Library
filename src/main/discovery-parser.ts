import {loadHtml} from './html-parser';
import {parseSearch,publicHttpsUrl} from './online';
import type {DiscoveryPlatform,DiscoveryPlan,DiscoveryProduct,DiscoveryRequest} from '../shared/discovery';
import {redactAiText} from './ai-privacy';

export function discoveryRequest(raw:unknown):DiscoveryRequest {
 const r=raw as DiscoveryRequest;
 if(!r||typeof r.description!=='string'||!r.description.trim()||r.description.length>600||r.avatar!==undefined&&(typeof r.avatar!=='string'||r.avatar.length>80)||!Array.isArray(r.platforms)||!r.platforms.length||r.platforms.length>2||!r.platforms.every(p=>p==='booth'||p==='xianyu'))throw new Error('请填写 1 至 600 字的需求，并选择搜索平台。');
 return {description:redactAiText(r.description,600),avatar:redactAiText(r.avatar,80),platforms:[...new Set(r.platforms)]};
}
const vocabulary=[['哥特','ゴシック','gothic'],['礼裙','ドレス','dress'],['连衣裙','ワンピース','dress'],['洛丽塔','ロリータ','lolita'],['和服','着物','kimono'],['赛博','サイバー','cyber'],['头发','ヘア','hair'],['鞋','靴','shoes'],['饰品','アクセサリー','accessory'],['制服','制服','uniform'],['泳装','水着','swimsuit']] as const;
export function localDiscoveryPlan(request:DiscoveryRequest):DiscoveryPlan {
 const raw=request.description.replace(/我想要|我需要|请帮我找|帮我找|找一[件套个]|一[件套个]|风格|的/g,' ').replace(/\s+/g,' ').trim();
 const matched=vocabulary.filter(row=>row.some(term=>request.description.toLowerCase().includes(term.toLowerCase())));
 const avatar=request.avatar?` ${request.avatar}`:'';
 const ja=matched.map(row=>row[1]).join(' '),en=matched.map(row=>row[2]).join(' ');
 return {summary:request.description,boothQueries:[...new Set((matched.length?[ja+avatar,en+avatar]:[raw+avatar]).map(q=>q.slice(0,100)))],xianyuQuery:(raw+' VRChat'+avatar).slice(0,100),terms:[...new Set(matched.length?matched.flatMap(r=>[...r]):raw.split(/\s+/))].slice(0,8)};
}
export function discoveryUrl(platform:DiscoveryPlatform,query:string):string {
 if(typeof query!=='string'||!query.trim()||query.length>100||/https?:|www\.|[\x00-\x1f]/i.test(query))throw new Error('检索词无效。');
 return platform==='booth'?'https://booth.pm/ja/search/'+encodeURIComponent(query)+'?tags%5B%5D=VRChat':'https://www.goofish.com/search?q='+encodeURIComponent(query);
}
export function discoveryImage(raw:unknown,platform:DiscoveryPlatform):string|undefined {
 try{if(typeof raw!=='string')return;const u=publicHttpsUrl(raw.startsWith('//')?'https:'+raw:raw);const allowed=platform==='booth'?/(?:^|\.)(?:pximg\.net|booth\.pm)$/:/(?:^|\.)(?:alicdn\.com|goofish\.com)$/;return allowed.test(u.hostname)?u.href:undefined}catch{return}
}
export function discoveryItem(raw:string,platform:DiscoveryPlatform):string|undefined {
 try{const u=publicHttpsUrl(raw);if(platform==='booth'&&/(?:^|\.)booth\.pm$/.test(u.hostname)){const id=u.pathname.match(/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?items\/(\d{1,12})\/?$/)?.[1];if(id)return 'https://booth.pm/ja/items/'+id}
 if(platform==='xianyu'&&u.hostname==='www.goofish.com'&&u.pathname==='/item'&&u.searchParams.getAll('id').length===1&&/^[1-9]\d{0,23}$/.test(u.searchParams.get('id')||''))return 'https://www.goofish.com/item?id='+u.searchParams.get('id');}catch{}return;
}
export function decorateDiscovery(product:import('../shared/contracts').ProductCandidate,platform:DiscoveryPlatform,query:string,request:DiscoveryRequest,plan:DiscoveryPlan):DiscoveryProduct {
 const title=product.title.slice(0,500),matchedTerms=plan.terms.filter(term=>title.toLowerCase().includes(term.toLowerCase()));
 return {...product,title,platform,searchQuery:query,matchedTerms,avatarNote:request.avatar?(title.toLowerCase().includes(request.avatar.toLowerCase())?'标题提及 '+request.avatar+'；请在商品页核对具体版本。':'未确认支持 '+request.avatar+'，请核对适配列表。'):'未指定角色；购买前请核对适配与授权。'};
}
export function parseBoothDiscovery(html:string,url:string):import('../shared/contracts').ProductCandidate[] {
 if(new URL(url).hostname!=='booth.pm'||!new URL(url).pathname.startsWith('/ja/search/'))throw new Error('搜索页已跳转，请在 BOOTH 完成验证后重试。');
 const $=loadHtml(html),products=parseSearch(html,url);
 if(!products.length&&!/market-items|search-results|条件に一致する商品|no-results|search-empty/.test(html))throw new Error('未能读取 BOOTH 搜索结果，请打开站内搜索核对。');
 return products.filter(p=>!/vroid|vrm専用|実物|実際の衣服/i.test(p.title)).slice(0,12).map(p=>{
  const card=$('.item-card').filter((_i,e)=>$(e).find('a[href*="/items/"]').toArray().some(a=>{try{return discoveryItem(new URL($(a).attr('href')!,url).href,'booth')===p.url}catch{return false}})).first();
  const image=card.find('.item-card__thumbnail-image,img').first(),raw=image.attr('data-original')||image.attr('data-src')||image.attr('src');
  return {...p,coverUrl:discoveryImage(raw,'booth')};
 });
}
/** Only rendered item anchors from the official search page; no private APIs or application state. */
export const XIANyu_SEARCH_CAPTURE=`(()=>{if(location.origin!=='https://www.goofish.com'||location.pathname!=='/search')return {blocked:true,items:[]};const items=[];for(const a of Array.from(document.querySelectorAll('a[href*="/item?"]')).slice(0,60)){const image=a.querySelector('img[class*="feeds-image"]')||a.querySelector('img');const title=a.querySelector('[class*="title"],[class*="Title"]')?.textContent||image?.alt||a.innerText;const text=(title||'').trim().replace(/\\s+/g,' ');if(!text||text.length>500)continue;items.push({url:a.href,title:text,coverUrl:image&&image.naturalWidth>8&&!/tps-2-2/.test(image.currentSrc||image.src)?(image.currentSrc||image.src):undefined});}return {blocked:/验证码|滑块验证|安全验证/.test(document.body.innerText.slice(0,3000)),login:/扫码登录|密码登录|请登录后/.test(document.body.innerText.slice(0,3000)),items:items.slice(0,12)};})()`;
export function parseXianyuDiscovery(value:unknown):import('../shared/contracts').ProductCandidate[] {
 const r=value as {blocked?:boolean;login?:boolean;items?:unknown[]};
 if(!r||r.blocked||r.login)throw new Error('闲鱼需要登录或网站验证；请打开站内搜索完成后重试。');
 if(!Array.isArray(r.items)||!r.items.length)throw new Error('暂未读取到闲鱼商品卡片，可能没有结果或网页尚未就绪。可打开站内搜索核对。');
 const result:import('../shared/contracts').ProductCandidate[]=[];
 for(const item of r.items.slice(0,24)){const p=item as {url?:unknown;title?:unknown;coverUrl?:unknown};if(typeof p.url!=='string'||typeof p.title!=='string'||!p.title.trim()||p.title.length>500)continue;const url=discoveryItem(p.url,'xianyu');if(!url||result.some(p=>p.url===url))continue;result.push({url,title:p.title,coverUrl:discoveryImage(p.coverUrl,'xianyu')});}
 if(!result.length)throw new Error('闲鱼没有提供可核对的商品链接。');return result.slice(0,12);
}
