import {DISCOVERY_WEB_PROVIDERS,type DiscoveryWebProvider} from '../shared/discovery-prompt';
import {buildWebDiscoveryPrompt,parseWebDiscoveryReply} from './discovery-web';

const NONCE=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const MAX_REPLY=16000;
type Recipe={provider:DiscoveryWebProvider;origin:string;editor:string;reply:string};
// Public official page/bundle evidence only. These selectors are not a promise
// about authenticated account layouts; missing or changed structure fails closed.
// Qwen: https://g.alicdn.com/code/npm/@ali/qianwen-web/4.11.5/web/js/async/199.js
// Kimi: https://statics.moonshot.cn/kimi-web-seo/assets/CEzCYjwX.js
// DeepSeek: https://fe-static.deepseek.com/chat/static/main.d1d163b7e4.js
// Qwen's answers wrapper can include non-final content: the caller must accept
// only one complete nonce envelope and otherwise retain the manual fallback.
const RECIPES:Record<DiscoveryWebProvider,Omit<Recipe,'provider'>>={
  qwen:{origin:'https://www.qianwen.com',editor:'[data-chat-input-shell="true"] [data-slate-editor="true"][contenteditable="true"]',reply:'[data-chat-answers-wrap]'},
  kimi:{origin:'https://www.kimi.com',editor:'#chat-box [data-testid="chat-editor"] .chat-input-editor[contenteditable="true"]',reply:'.segment-assistant .segment-content > .segment-content-box'},
  deepseek:{origin:'https://chat.deepseek.com',editor:'textarea[name="user query"].ds-textarea__textarea',reply:'.ds-assistant-message-main-content'}
};
function recipe(provider:unknown):Recipe {const selected=DISCOVERY_WEB_PROVIDERS.find(item=>item.id===provider);if(!selected)throw new Error('请选择千问、Kimi 或 DeepSeek 官方网页。');return {provider:selected.id,...RECIPES[selected.id]}}

export function inAppDiscoveryPrompt(provider:unknown,request:unknown,requestId:string):{url:string;prompt:string} {
  if(!NONCE.test(requestId))throw new Error('网页检索请求标记无效。');
  const built=buildWebDiscoveryPrompt(provider,request);
  return {url:built.url,prompt:built.prompt+'\n\n应用内校验格式：把上文规定的完整检索词对象放在 plan 字段中。最终只输出一个 JSON 对象，外层字段必须恰好是 requestId、plan，不加解释、思考过程或其他文字。\n本次请求标记：'+requestId+'\n外层格式：'+JSON.stringify({requestId,plan:{summary:'需求概括',boothQueries:['日文检索词','英文检索词'],xianyuQuery:'VRChat 中文检索词',terms:['细节同义词']}})};
}

/** Reject duplicate JSON keys too; JSON.parse alone would silently keep the last. */
function uniqueKeys(text:string):boolean {
  const objects:Set<string>[]=[];
  for(let i=0;i<text.length;i++){
    if(text[i]==='{')objects.push(new Set());else if(text[i]==='}')objects.pop();
    else if(text[i]==='"'){
      const start=i++;for(;i<text.length;i++){if(text[i]==='\\')i++;else if(text[i]==='"')break}
      let next=i+1;while(/\s/.test(text[next]??'')&&next<text.length)next++;
      if(text[next]===':'){const key=JSON.parse(text.slice(start,i+1)) as string,scope=objects.at(-1);if(!scope||scope.has(key))return false;scope.add(key)}
    }
  }
  return true;
}
export function parseInAppDiscoveryReply(raw:unknown,requestId:string):string|undefined {
  if(!NONCE.test(requestId)||typeof raw!=='string'||!raw.trim()||raw.length>MAX_REPLY)return;
  let text=raw.trim();const fenced=text.match(/^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i);if(fenced)text=fenced[1].trim();
  try{
    const value=JSON.parse(text);if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==2||!Object.hasOwn(value,'requestId')||!Object.hasOwn(value,'plan')||value.requestId!==requestId||!uniqueKeys(text))return;
    if(!value.plan||typeof value.plan!=='object'||Array.isArray(value.plan)||Object.keys(value.plan).sort().join(',')!=='boothQueries,summary,terms,xianyuQuery')return;
    return JSON.stringify(parseWebDiscoveryReply(JSON.stringify(value.plan)));
  }catch{return}
}

// Serialized into the same isolated world on each operation. Keep this function
// self-contained: it touches ordinary DOM only, never page stores, tokens or APIs.
function pageOperation(config:Recipe,operation:'editor'|'reply',value:string):boolean|string[] {
  const empty=operation==='editor'?false:[];
  try{
    if(location.origin!==config.origin||/^\/(?:login|sign_in|sign_up|authorized|auth|share)(?:\/|$)/i.test(location.pathname)||document.visibilityState==='hidden')return empty;
    const noncePattern=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
    const skip='script,style,noscript,textarea,input,button,select,option,svg,canvas,iframe,blockquote,q,.segment-user,.chat-question-wrap,.ds-think-content,[data-role="thinking"],[data-type="thinking"],[data-thinking="true"],[role="status"]';
    const visible=(element:Element):element is HTMLElement=>{
      if(!(element instanceof HTMLElement)||!element.isConnected||element.closest('[hidden],[aria-hidden="true"],[inert]'))return false;
      let parent:HTMLElement|null=element,depth=0;
      while(parent&&depth++<64){const style=getComputedStyle(parent);if(style.display==='none'||style.visibility==='hidden'||style.visibility==='collapse'||style.opacity==='0')return false;parent=parent.parentElement}
      return !parent&&element.getClientRects().length>0;
    };
    const bodies=()=>Array.from(document.querySelectorAll(config.reply)).filter(element=>visible(element)&&!element.closest('blockquote,q,.segment-user,.chat-question-wrap,.ds-think-content')) as HTMLElement[];
    const messageKey=(element:HTMLElement)=>{
      if(config.provider==='deepseek')return element.closest('[data-virtual-list-item-key]')?.getAttribute('data-virtual-list-item-key')||'';
      if(config.provider==='qwen')return element.closest('[data-chat-list-key]')?.getAttribute('data-chat-list-key')||element.getAttribute('data-chat-answers-wrap')||'';
      return '';
    };
    const world=globalThis as typeof globalThis&{__vrcalDiscoveryBaselineV1?:{requestId:string;provider:string;document:Document;nodes:WeakSet<HTMLElement>;keys:Set<string>}};
    const arm=(requestId:string)=>{
      const previous=world.__vrcalDiscoveryBaselineV1;if(previous?.requestId===requestId&&previous.provider===config.provider&&previous.document===document)return;
      const previousBodies=bodies().slice(-64);
      world.__vrcalDiscoveryBaselineV1={requestId,provider:config.provider,document,nodes:new WeakSet(previousBodies),keys:new Set(previousBodies.map(messageKey).filter(Boolean))};
    };
    const clean=(text:string)=>text.replace(/[\u200b-\u200d\ufeff]/g,'').replace(/\r\n/g,'\n').trim();
    if(operation==='editor'){
      const editors=Array.from(document.querySelectorAll(config.editor)).filter(visible);if(editors.length!==1)return false;
      const editor=editors[0];if(editor.hasAttribute('disabled')||editor.hasAttribute('readonly')||editor.getAttribute('aria-disabled')==='true')return false;
      const read=()=>{
        if(editor instanceof HTMLTextAreaElement)return editor.value;
        if(config.provider!=='qwen')return editor.innerText;
        // Slate's noneditable placeholder contributes to innerText even when
        // the composer is empty. Keep actual text (including IME text inside a
        // zero-width span); clean() removes only the sentinel characters.
        const pieces:string[]=[];
        const visit=(node:Node)=>{
          if(node.nodeType===3){pieces.push(node.nodeValue||'');return}
          if(!(node instanceof HTMLElement)||node.matches('[data-slate-placeholder="true"][contenteditable="false"]'))return;
          for(const child of Array.from(node.childNodes))visit(child);
        };
        visit(editor);return pieces.join('');
      };
      // Contenteditable paragraph rendering may duplicate or omit line breaks.
      // Compare all other characters exactly; an existing equivalent draft only
      // returns true and is never rewritten. Textareas retain exact line breaks.
      const comparable=(text:string)=>editor instanceof HTMLTextAreaElement?clean(text):clean(text).replace(/\n/g,'');
      const previous=comparable(read()),expected=comparable(value);if(!expected||previous&&previous!==expected)return false;
      const requestId=value.match(/\n本次请求标记：([a-f0-9-]{36})\n/i)?.[1];if(requestId&&noncePattern.test(requestId))arm(requestId);
      if(previous===expected)return true;
      editor.focus();
      if(editor instanceof HTMLTextAreaElement){
        const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')?.set;if(!setter)return false;setter.call(editor,value);
        editor.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:value}));
      }else{
        const selection=getSelection();if(!selection)return false;const range=document.createRange();range.selectNodeContents(editor);selection.removeAllRanges();selection.addRange(range);
        if(!document.execCommand('insertText',false,value))return false;
      }
      return comparable(read())===expected;
    }
    if(!noncePattern.test(value))return [];
    const current=bodies().at(-1);if(!current)return [];
    const baseline=world.__vrcalDiscoveryBaselineV1,key=messageKey(current);
    if(baseline?.requestId===value&&baseline.provider===config.provider&&baseline.document===document&&(baseline.nodes.has(current)||key&&baseline.keys.has(key)))return [];
    // Never inspect preceding conversation turns, user drafts or quoted subtrees.
    const pieces:string[]=[];let length=0,oversized=false;
    const append=(text:string)=>{length+=text.length;if(length>16000)oversized=true;else pieces.push(text)};
    const visit=(node:Node)=>{
      if(oversized)return;if(node.nodeType===3){append(node.nodeValue||'');return}
      if(!(node instanceof HTMLElement)||node.matches(skip)||!visible(node))return;
      const block=/^(?:DIV|P|PRE|LI|UL|OL|BR|SECTION|ARTICLE)$/.test(node.tagName);if(block)append('\n');
      for(const child of Array.from(node.childNodes)){visit(child);if(oversized)break}if(block&&!oversized)append('\n');
    };
    visit(current);if(oversized)return [];const text=pieces.join('').trim();return text&&text.includes(value)?[text]:[];
  }catch{return empty}
}
export function aiEditorScript(provider:unknown,prompt:string):string {
  const selected=recipe(provider);if(typeof prompt!=='string'||!prompt.trim()||prompt.length>12000)throw new Error('网页提示词无效。');
  return `(${pageOperation.toString()})(${JSON.stringify(selected)},"editor",${JSON.stringify(prompt)})`;
}
export function aiReplyScript(provider:unknown,requestId:string):string {
  const selected=recipe(provider);if(!NONCE.test(requestId))throw new Error('网页检索请求标记无效。');
  return `(${pageOperation.toString()})(${JSON.stringify(selected)},"reply",${JSON.stringify(requestId)})`;
}
