import type {InboxPlatform} from '../shared/link-inbox';

/** Kept separate so capture recipes can be replayed against sanitized DOM fixtures. */
export function inboxCaptureScript(platform:InboxPlatform,mode:'foreground'|'background',identityOnly:boolean):string {
 return `(${capture.toString()})(${JSON.stringify(platform)},${JSON.stringify(mode)},${identityOnly})`;
}

function capture(platform:string,mode:string,identityOnly:boolean) {
 const output:{url:string;account:string;supported:boolean;login?:boolean;diagnostic?:'account-header'|'account-avatar'|'conversation-root'|'message-root'|'message-layout'|'conversation-empty'|'chat-unselected'|'empty';rows:Array<{key:string;kind:'purchase'|'conversation'|'message';text:string;title?:string;time?:string;unread?:boolean;libraryItem?:string}>}={url:location.href,account:'',supported:false,rows:[]};
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
 if(personal.length!==1){output.diagnostic='account-header';return output}const label=text(personal[0],80),avatars=Array.from(personal[0].querySelectorAll('img[src]')).filter(visible);
 if(!label||/^(?:登录|登录\/注册|立即登录|login|sign in)$/i.test(label)){output.login=true;output.diagnostic='account-header';return output}
 if(avatars.length!==1){output.diagnostic='account-avatar';return output}
 const avatar=url(avatars[0].getAttribute('src'));
 if(!avatar||avatar.hostname!=='img.alicdn.com'||!/^\/bao\/uploaded\//.test(avatar.pathname)||!/mtopupload/.test(avatar.pathname)||avatar.pathname.length>350){output.diagnostic='account-avatar';return output}
 // The live header has no UID: this is a scoped visible identity fingerprint,
 // deliberately not a claim to know the platform's internal account identifier.
 output.account='xianyu-visible:'+label+'\0'+avatar.origin+avatar.pathname;
 const lists=document.querySelectorAll('aside[class*="conversation-list--"]'),chats=document.querySelectorAll('main[class*="chat-main--"]');
 if(lists.length!==1){output.diagnostic='conversation-root';return output}if(chats.length!==1){output.diagnostic='message-root';return output}
 // Preserve explicit semantic fixtures, including a role on the root itself.
 const root=mode==='background'?lists[0]:chats[0],role=mode==='background'?'list':'log',scope=root.getAttribute('role')===role?root:root.querySelector('[role="'+role+'"]');
 if(!scope){
  // Public official xy-site/0.0.179/p_im-index.js, SHA256
  // ec9c8491cc0ef9366f8491ae5d68ec0b8d44620129078136c245b4b126770093.
  // The site uses divs, not ARIA log/list rows. Never inspect React private data
  // or navigate into an unopened conversation to compensate for missing DOM.
  const token=(element:Element,prefix:string)=>(element.getAttribute('class')||'').split(/\s+/).some(value=>value.startsWith(prefix));
  const classNodes=(element:Element,prefix:string)=>Array.from(element.querySelectorAll('[class]')).filter(node=>token(node,prefix));
  const style=(element:Element)=>{const values:Record<string,string>={};for(const declaration of (element.getAttribute('style')||'').split(';')){const colon=declaration.indexOf(':');if(colon>=0)values[declaration.slice(0,colon).trim().toLowerCase()]=declaration.slice(colon+1).replace(/\s/g,'').toLowerCase()}return values};
  let visits=0;
  const ownText=(element:Element,limit:number)=>{const parts:string[]=[];let left=limit;const walk=(node:Node,depth:number)=>{
   if(left<=0||++visits>20000||depth>40)return;
   if(node.nodeType===3){const value=(node.nodeValue||'').slice(0,left);parts.push(value);left-=value.length;return}
   if(!(node instanceof HTMLElement)||!visible(node)||token(node,'reply-container--')||['INPUT','TEXTAREA','FORM'].includes(node.tagName)||node.getAttribute('contenteditable')==='true')return;
   for(const child of Array.from(node.childNodes)){walk(child,depth+1);if(left<=0)break}
  };walk(element,0);return parts.join('').trim()};
  const conversationScopes=Array.from(lists[0].querySelectorAll('#conv-list-scrollable')).filter(visible);
  if(mode==='background'){
   if(conversationScopes.length!==1){output.diagnostic='conversation-root';return output}
   const conversationRows=classNodes(conversationScopes[0],'conversation-item--').filter(visible).slice(0,100);output.supported=true;
   if(!conversationRows.length){output.diagnostic='conversation-empty';return output}if(identityOnly)return output;
   let remaining=262144;
   for(const [index,row] of conversationRows.entries()){
    if(row.querySelector('input,textarea,[contenteditable="true"],form'))continue;
    const badges=Array.from(row.querySelectorAll('sup.ant-badge-count[data-show="true"][title]')).filter(badge=>visible(badge)&&/^[1-9]\d{0,8}$/.test(badge.getAttribute('title')||''));if(badges.length!==1)continue;
    // Source uses one precisely styled summary div; its text may be a local
    // [草稿] replacement. Peer names, product cards and the entire row are not body.
    const summaries=Array.from(row.querySelectorAll('div[style]')).filter(element=>{const s=style(element);return visible(element)&&s['text-overflow']==='ellipsis'&&s['max-height']==='20px'&&s.overflow==='hidden'&&s.display==='inline-block'&&s['white-space']==='nowrap'&&s['font-size']==='12px'&&s['margin-top']==='2px'});if(summaries.length!==1)continue;
    const summary=summaries[0],next=summary.nextElementSibling;if(!next)continue;
    const clocks=[next,...Array.from(next.querySelectorAll('div[style]'))].filter(element=>{const s=style(element);return visible(element)&&element.tagName==='DIV'&&element.children.length===0&&s['font-size']==='10px'&&s['line-height']==='14px'});if(clocks.length!==1)continue;
    const time=text(clocks[0],80);if(!/^(?:刚刚|[1-9]\d{0,3}(?:分钟|小时|天)前|(?:\d{4}-)?\d{2}-\d{2})$/.test(time))continue;
    const body=ownText(summary,Math.min(32768,remaining));remaining-=body.length;if(/^\s*\[\s*草稿\s*\]/.test(body)||!body.includes('https://pan.baidu.com/s/'))continue;
    output.rows.push({key:'preview-'+index,kind:'conversation',text:body,time,unread:true});if(remaining<=0)break;
   }
   if(!output.rows.length)output.diagnostic='empty';return output;
  }
  const scrollers=Array.from(chats[0].querySelectorAll('#message-list-scrollable')).filter(visible);
  if(!scrollers.length){
   if(conversationScopes.length===1){const rows=classNodes(conversationScopes[0],'conversation-item--').filter(visible);if(!rows.length){output.supported=true;output.diagnostic='conversation-empty'}else output.diagnostic='chat-unselected'}else output.diagnostic='message-layout';return output;
  }
  if(scrollers.length!==1||!token(scrollers[0],'message-list--')&&!token(scrollers[0],'message-list-reverse--')){output.diagnostic='message-layout';return output}
  const containers=Array.from(scrollers[0].querySelectorAll('#msg-list-container')).filter(visible);if(containers.length!==1){output.diagnostic='message-layout';return output}
  const container=containers[0],scroll=container.closest('[class*="scroll-container--"]');if(!scroll||!token(scroll,'scroll-container--')||scroll.closest('#message-list-scrollable')!==scrollers[0]){output.diagnostic='message-layout';return output}
  output.supported=true;if(identityOnly)return output;
  const messages=classNodes(container,'message-text--').filter(message=>{
   if(!visible(message)||message.querySelector('input,textarea,[contenteditable="true"],form'))return false;
   const row=message.closest('[class*="message-row--"]');if(!row||!token(row,'message-row--'))return false;
   for(let parent:Element|null=message;parent&&parent!==container;parent=parent.parentElement)if(token(parent,'reply-container--'))return false;return true;
  }).slice(0,100);let remaining=262144;
  for(const [index,message] of messages.entries()){
   const body=ownText(message,Math.min(32768,remaining));remaining-=body.length;if(!body.includes('https://pan.baidu.com/s/'))continue;
   // showTime is a sibling belonging to this renderItem only. Do not inherit
   // another row's separator or the conversation's latest timestamp.
   let time:string|undefined,parent=message.closest('[class*="message-row--"]')?.parentElement;
   for(let depth=0;parent&&parent!==container&&depth<8;depth++,parent=parent.parentElement){const s=style(parent);if(s.position!=='relative'||s['z-index']!=='99'||classNodes(parent,'message-row--').length!==1)continue;const first=parent.children[0];if(!first)break;const clock=style(first);if(clock['text-align']==='center'&&['10px0','10px0px'].includes(clock.padding)&&clock['font-size']==='12px'&&visible(first)){const shown=text(first,80);if(/^(?:\d{2}:\d{2}|昨天 \d{2}:\d{2}|(?:\d{4}-)?\d{2}-\d{2} \d{2}:\d{2})$/.test(shown))time=shown}break}
   output.rows.push({key:'message-'+index,kind:'message',text:body,...(time?{time}:{})});if(remaining<=0)break;
  }
  if(!output.rows.length)output.diagnostic='empty';return output;
 }
 const rows=Array.from(scope.querySelectorAll('[role="listitem"]')).filter(visible).slice(0,100);
 if(!rows.length){output.supported=true;output.diagnostic='empty';return output}
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
