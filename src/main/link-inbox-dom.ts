import type {InboxPlatform} from '../shared/link-inbox';

/** Kept separate so capture recipes can be replayed against sanitized DOM fixtures. */
export function inboxCaptureScript(platform:InboxPlatform,mode:'foreground'|'background',identityOnly:boolean):string {
 return `(${capture.toString()})(${JSON.stringify(platform)},${JSON.stringify(mode)},${identityOnly})`;
}

function capture(platform:string,mode:string,identityOnly:boolean) {
 const output:{url:string;account:string;supported:boolean;login?:boolean;rows:Array<{key:string;kind:'purchase'|'conversation'|'message';text:string;title?:string;time?:string;unread?:boolean;libraryItem?:string}>}={url:location.href,account:'',supported:false,rows:[]};
 const visible=(e:Element)=>e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';
 const text=(e:Element|undefined|null,limit=32768)=>e instanceof HTMLElement?(e.innerText||'').trim().slice(0,limit):'';
 const url=(raw:string|null)=>{try{if(!raw)return;const u=new URL(raw,location.href);if(u.protocol==='https:'&&!u.username&&!u.password&&!u.port)return u}catch{return}};
 if(platform==='booth'){
  if(location.origin!=='https://accounts.booth.pm'||location.pathname!=='/library')return output;
  // Observed 2026-10-24: own avatar is in the navigation, seller avatars are in main.
  const identities=Array.from(document.querySelectorAll('nav img[src]')).filter(e=>visible(e)&&!e.closest('main')).flatMap(e=>{
   const u=url(e.getAttribute('src'));if(!u||u.hostname!=='booth.pximg.net')return [];
   const match=/^\/c\/\d+x\d+\/users\/([1-9]\d{0,23})\/icon_image\//.exec(u.pathname);return match?[match[1]]:[];
  });
  if(identities.length!==1)return output;output.account='booth-user:'+identities[0];
  const mains=document.querySelectorAll('main');if(mains.length!==1)return output;
  const cards=Array.from(mains[0].querySelectorAll('.l-library-item-thumbnail')).slice(0,100).flatMap(image=>{
   // The observed border-bottom element is only the product header. Downloads
   // are its siblings inside the immediate card; never climb to the whole list.
   const heading=image.closest('div.flex.gap-8.border-b.border-border300.pb-16'),card=heading?.parentElement;
   return card&&card!==mains[0]&&card.closest('main')===mains[0]&&card.querySelectorAll('.l-library-item-thumbnail').length===1&&visible(card)?[card]:[];
  });
  if(!cards.length)return output;let remaining=262144;
  for(const card of cards){
   const ids=new Set(Array.from(card.querySelectorAll('a[href]')).flatMap(a=>{const u=url(a.getAttribute('href'));if(!u||!/(?:^|\.)booth\.pm$/.test(u.hostname)||u.search||u.hash)return [];const match=/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?items\/([1-9]\d{0,11})\/?$/.exec(u.pathname);return match?[match[1]]:[]}));
   const download=Array.from(card.querySelectorAll('.js-download-button[data-href]')).some(button=>{const u=url(button.getAttribute('data-href'));return button.getAttribute('data-is-external')==='false'&&u?.hostname==='booth.pm'&&/^\/downloadables\/[1-9]\d{0,23}$/.test(u.pathname)&&!u.search&&!u.hash});
   if(ids.size!==1||!download)continue;output.supported=true;if(identityOnly)continue;
   const libraryItem=[...ids][0],body=text(card.querySelector('.whitespace-pre-line'),Math.min(32768,remaining));remaining-=body.length;
   // The observed library has no purchase date. Never turn a file's date/name or
   // this polling instant into a purchase timestamp, and never return download URLs.
   output.rows.push({key:'item-'+libraryItem,kind:'purchase',text:body,title:text(card.querySelector('.text-text-default.font-bold.text-16.mb-8.break-all'),160),libraryItem});
  }
  return output;
 }
 if(platform!=='xianyu'||location.origin!=='https://www.goofish.com'||location.pathname!=='/im')return output;
 const personal=Array.from(document.querySelectorAll('header [class*="user-order-container--"] a[href]')).filter(a=>{const u=url(a.getAttribute('href'));return visible(a)&&u?.origin===location.origin&&u.pathname==='/personal'&&!u.search&&!u.hash});
 if(personal.length!==1)return output;const label=text(personal[0],80),avatars=Array.from(personal[0].querySelectorAll('img[src]')).filter(visible);
 if(!label||/^(?:登录|登录\/注册|立即登录|login|sign in)$/i.test(label)||avatars.length!==1){output.login=true;return output}
 const avatar=url(avatars[0].getAttribute('src'));
 if(!avatar||avatar.hostname!=='img.alicdn.com'||!/^\/bao\/uploaded\//.test(avatar.pathname)||!/mtopupload/.test(avatar.pathname)||avatar.pathname.length>350)return output;
 // The live header has no UID: this is a scoped visible identity fingerprint,
 // deliberately not a claim to know the platform's internal account identifier.
 output.account='xianyu-visible:'+label+'\0'+avatar.origin+avatar.pathname;
 const lists=document.querySelectorAll('aside[class*="conversation-list--"]'),chats=document.querySelectorAll('main[class*="chat-main--"]');
 if(lists.length!==1||chats.length!==1)return output;
 // Nonempty class-based message rows have not yet been observed in this account.
 // Accept only the explicit ARIA conversation/log semantics within verified roots;
 // an empty/loading shell or an unlabelled layout stays unsupported.
 const root=mode==='background'?lists[0]:chats[0],scope=root.querySelector(mode==='background'?'[role="list"]':'[role="log"]');
 if(!scope)return output;const rows=Array.from(scope.querySelectorAll('[role="listitem"]')).filter(visible).slice(0,100);if(!rows.length)return output;
 output.supported=true;if(identityOnly)return output;let remaining=262144;
 for(const [index,row] of rows.entries()){
  if(row.querySelector('input,textarea,[contenteditable="true"],form'))continue;
  const clock=row.querySelector('time'),time=clock?.getAttribute('datetime')||text(clock,100)||undefined;
  const unread=mode==='background'&&/未读|unread/i.test(row.getAttribute('aria-label')||'');
  const body=text(row,Math.min(32768,remaining));remaining-=body.length;
  if(!/https:\/\/pan\.baidu\.com\/s\//.test(body))continue;
  output.rows.push({key:(mode==='background'?'preview-':'message-')+index,kind:mode==='background'?'conversation':'message',text:body,time,unread});
 }
 return output;
}
