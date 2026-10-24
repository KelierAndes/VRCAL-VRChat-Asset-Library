/** The remote page has no preload or desktop bridge. Evidence stays in this isolated world. */
export const BOOTH_DOWNLOAD_SOURCE_WORLD=9473;

export function boothDownloadLibraryPage(raw:string):boolean {
 try{const u=new URL(raw);return u.origin==='https://accounts.booth.pm'&&!u.username&&!u.password&&!u.hash&&u.pathname==='/library'}catch{return false}
}
export function boothDownloadableIds(chain:unknown):string[] {
 if(!Array.isArray(chain)||chain.length>50)return [];
 return [...new Set(chain.flatMap(raw=>{if(typeof raw!=='string'||raw.length>16384)return [];try{const u=new URL(raw),match=/^\/downloadables\/([1-9]\d{0,23})$/.exec(u.pathname);return u.origin==='https://booth.pm'&&!u.username&&!u.password&&!u.search&&!u.hash&&match?[match[1]]:[]}catch{return []}}))];
}
/** Only sanitized numeric downloadable IDs enter the script; only a product ID can leave it. */
export function boothDownloadCaptureScript(action:'install'|'consume',downloadableIds:string[]=[]):string {
 const ids=downloadableIds.filter(id=>/^[1-9]\d{0,23}$/.test(id)).slice(0,50);
 return `(${capture.toString()})(${JSON.stringify(action)},${JSON.stringify(ids)})`;
}

function capture(action:string,downloadableIds:string[]) {
 if(location.origin!=='https://accounts.booth.pm'||location.pathname!=='/library'||location.hash)return;
 const key='__vrcBoothDownloadSourceV1',ttl=15000;
 type Choice={item:string;downloadable:string;at:number;account:string};
 type State={page:string;pending?:Choice;blockedUntil:number;invalid:boolean};
 const memory=globalThis as unknown as Record<string,State|undefined>;
 const visible=(e:Element)=>e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';
 const url=(raw:string|null)=>{try{if(!raw)return;const u=new URL(raw,location.href);if(u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.search&&!u.hash)return u}catch{return}};
 const account=()=>{
  const ids=Array.from(document.querySelectorAll('nav img[src]')).filter(e=>visible(e)&&!e.closest('main')).flatMap(e=>{const u=url(e.getAttribute('src'));if(u?.hostname!=='booth.pximg.net')return [];const m=/^\/c\/\d+x\d+\/users\/([1-9]\d{0,23})\/icon_image\//.exec(u.pathname);return m?[m[1]]:[]});
  return ids.length===1?ids[0]:undefined;
 };
 const cards=()=>{
  const mains=document.querySelectorAll('main');if(mains.length!==1)return [];
  // This exact /library card structure was observed on 2026-10-24. The header
  // alone excludes its sibling download controls; climbing farther mixes items.
  return Array.from(mains[0].querySelectorAll('.l-library-item-thumbnail')).slice(0,100).flatMap(image=>{
   const heading=image.closest('div.flex.gap-8.border-b.border-border300.pb-16'),card=heading?.parentElement;
   if(!card||card===mains[0]||card.closest('main')!==mains[0]||card.querySelectorAll('.l-library-item-thumbnail').length!==1||!visible(card))return [];
   const ids=new Set(Array.from(card.querySelectorAll('a[href]')).flatMap(a=>{const u=url(a.getAttribute('href'));if(!u||!/(?:^|\.)booth\.pm$/.test(u.hostname))return [];const match=/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?items\/([1-9]\d{0,11})\/?$/.exec(u.pathname);return match?[match[1]]:[]}));
   return ids.size===1?[{card,item:[...ids][0]}]:[];
  });
 };
 const download=(button:Element)=>{const u=url(button.getAttribute('data-href'));if(button.getAttribute('data-is-external')!=='false'||u?.hostname!=='booth.pm')return;return /^\/downloadables\/([1-9]\d{0,23})$/.exec(u.pathname)?.[1]};
 const matches=(id:string)=>cards().flatMap(({card,item})=>Array.from(card.querySelectorAll('.js-download-button[data-href]')).slice(0,100).some(button=>visible(button)&&download(button)===id)?[item]:[]);
 const state=memory[key];
 if(action==='install'){
  if(state)return state.page===location.href&&!state.invalid;
  const installed:State={page:location.href,blockedUntil:0,invalid:false};memory[key]=installed;
  document.addEventListener('click',event=>{
   if(!event.isTrusted||installed.invalid||installed.page!==location.href)return;
   const now=Date.now(),button=event.target instanceof Element?event.target.closest('.js-download-button[data-href]'):null;
   const id=button&&visible(button)?download(button):undefined,owner=account(),items=id?matches(id):[];
   if(installed.pending||installed.blockedUntil>now){installed.pending=undefined;installed.blockedUntil=now+ttl;return}
   if(!id||!owner||items.length!==1)return;
   // Match the clicked element to this card as well as its downloadable ID.
   if(!cards().some(entry=>entry.item===items[0]&&Array.from(entry.card.querySelectorAll('.js-download-button[data-href]')).includes(button!)))return;
   installed.pending={item:items[0],downloadable:id,at:now,account:owner};
  },true);
  const invalidate=()=>{installed.pending=undefined;installed.invalid=true};
  addEventListener('pagehide',invalidate);addEventListener('popstate',invalidate);addEventListener('hashchange',invalidate);
  return true;
 }
 if(action!=='consume')return;
 const pending=state?.pending;if(state)state.pending=undefined;
 if(state&&(state.invalid||state.page!==location.href||state.blockedUntil>Date.now())||downloadableIds.length>1)return;
 const owner=account();if(!owner)return;
 if(pending){
  if(pending.account!==owner||Date.now()-pending.at<0||Date.now()-pending.at>ttl||downloadableIds.length&&downloadableIds[0]!==pending.downloadable)return;
  const items=matches(pending.downloadable);return items.length===1&&items[0]===pending.item?pending.item:undefined;
 }
 if(downloadableIds.length!==1)return;
 const items=matches(downloadableIds[0]);return items.length===1?items[0]:undefined;
}
