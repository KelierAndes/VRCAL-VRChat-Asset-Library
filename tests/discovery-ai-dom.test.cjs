const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),vm=require('node:vm'),ts=require('typescript'),{load}=require('cheerio');
const source=path.resolve(__dirname,'../src'),cache=new Map();
function sourceModule(relative){const file=path.resolve(source,relative);assert(fs.existsSync(file),`source module exists: ${relative}`);if(cache.has(file))return cache.get(file).exports;const item=new Module(file,module);item.filename=file;item.paths=Module._nodeModulePaths(path.dirname(file));cache.set(file,item);const ordinary=item.require.bind(item);item.require=name=>name.startsWith('.')?sourceModule(path.relative(source,path.resolve(path.dirname(file),name+'.ts'))):ordinary(name);item._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true},fileName:file}).outputText,file);return item.exports}
const api=()=>sourceModule('main/discovery-ai-dom.ts'),requestId='11111111-1111-4111-8111-111111111111',otherId='22222222-2222-4222-8222-222222222222';
const plan={summary:'哥特礼裙',boothQueries:['ゴシック ドレス','gothic dress'],xianyuQuery:'VRChat 哥特 礼裙',terms:['gothic','ドレス']},request={description:'黑白哥特礼裙',avatar:'Shinano',platforms:['booth','xianyu']};
const envelope=(id=requestId,value=plan)=>JSON.stringify({requestId:id,plan:value});
const layouts={
 qwen:{url:'https://www.qianwen.com/',editor:'<div data-chat-input-shell="true"><div data-chat-input-body="true"><div data-slate-editor="true" contenteditable="true"></div></div></div>',reply:text=>`<div data-chat-list-key="assistant-new"><div data-chat-answers-wrap="assistant-new">${text}</div></div>`},
 kimi:{url:'https://www.kimi.com/',editor:'<div id="chat-box"><div data-testid="chat-editor"><div class="chat-input-editor" contenteditable="true"></div></div></div>',reply:text=>`<div class="segment-assistant"><div class="segment-content"><div class="segment-content-box">${text}</div></div></div>`},
 deepseek:{url:'https://chat.deepseek.com/',editor:'<textarea name="user query" class="ds-textarea__textarea"></textarea>',reply:text=>`<div data-virtual-list-item-key="assistant-new"><div class="ds-assistant-message-main-content">${text}</div></div>`}
};
// Empty editor body captured from the visible public Qwen landing page. The
// noneditable placeholder contributes to innerText even though no draft exists.
const qwenEmptySlate='<p data-slate-node="element" class="relative m-0 p-0"><span data-slate-node="text"><span data-slate-leaf="true"><span data-slate-zero-width="n" data-slate-length="0">\ufeff<br></span><span data-slate-placeholder="true" contenteditable="false" class="pointer-events-none absolute inset-x-0 top-0 select-none truncate text-inherit opacity-35" style="position:absolute;top:0px;pointer-events:none;display:block;opacity:0.333;user-select:none">向千问提问</span></span></span></p>';
function browser(html,href,options={}){
 const $=load(html),nodes=new WeakMap(),events=[],forbiddenReads=[];let selected;
 const hidden=node=>$(node).parents().addBack().toArray().some(e=>$(e).attr('hidden')!==undefined||$(e).attr('aria-hidden')==='true'||$(e).attr('inert')!==undefined||/display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:;|$)/i.test($(e).attr('style')||''));
 // Captured from a visible native Chromium editor after execCommand('insertText'):
 // first line + <div>next</div><div><br></div><div>after blank</div>. Its innerText
 // has three line breaks at a requested two-break paragraph separator.
 const chromiumEditableText=node=>(node.children||[]).map(child=>child.type==='text'?child.data:child.tagName==='br'?'\n':(child.tagName==='div'?'\n':'')+chromiumEditableText(child)).join('');
 class Element{
  constructor(node){this.node=node}get nodeType(){return this.node.type==='text'?3:1}get nodeValue(){if($(this.node).closest('[data-forbid-read]').length){forbiddenReads.push(this.node);throw Error('private or quoted text was read')}return this.node.data??null}get tagName(){return String(this.node.tagName||'').toUpperCase()}get isConnected(){return true}get parentElement(){return wrap($(this.node).parent()[0])}get childNodes(){return (this.node.children||[]).map(wrap)}get children(){return $(this.node).children().toArray().map(wrap)}get innerText(){if($(this.node).closest('[data-forbid-read]').length){forbiddenReads.push(this.node);throw Error('private or quoted text was read')}return options.chromiumEditable&&this.isContentEditable?options.flattenEditableBreaks?chromiumEditableText(this.node).replace(/\n/g,''):chromiumEditableText(this.node):$(this.node).text()}get textContent(){return this.innerText}get isContentEditable(){return this.getAttribute('contenteditable')==='true'}get disabled(){return this.hasAttribute('disabled')}get readOnly(){return this.hasAttribute('readonly')}
  getAttribute(name){return $(this.node).attr(name)??null}hasAttribute(name){return $(this.node).attr(name)!==undefined}matches(selector){return $(this.node).is(selector)}closest(selector){return wrap($(this.node).closest(selector)[0])}querySelectorAll(selector){return $(this.node).find(selector).toArray().map(wrap)}querySelector(selector){return this.querySelectorAll(selector)[0]||null}getClientRects(){return hidden(this.node)?[]:[{}]}focus(){document.activeElement=this}dispatchEvent(event){events.push({target:this,type:event.type});return true}
 }
 class TextArea extends Element{get value(){return $(this.node).attr('data-value')??$(this.node).text()}set value(value){$(this.node).attr('data-value',value)}}
 const wrap=node=>{if(!node)return null;if(!nodes.has(node))nodes.set(node,node.tagName==='textarea'?new TextArea(node):new Element(node));return nodes.get(node)};
 const document={visibilityState:'visible',activeElement:null,querySelectorAll:selector=>$(selector).toArray().map(wrap),querySelector:selector=>wrap($(selector)[0]),createRange:()=>({selectNodeContents:element=>{selected=element},collapse(){}}),execCommand(command,_ui,value){assert.equal(command,'insertText');if(options.slateEditable){$(selected.node).empty();for(const line of value.split('\n')){const paragraph=$('<p data-slate-node="element"><span data-slate-node="text"><span data-slate-leaf="true"></span></span></p>'),leaf=paragraph.find('[data-slate-leaf]');leaf.append(line?$('<span data-slate-string="true">').text(line):$('<span data-slate-zero-width="n" data-slate-length="0">\ufeff<br></span>'));$(selected.node).append(paragraph)}}else if(options.chromiumEditable){const lines=value.split('\n');$(selected.node).empty().append($('<span>').text(lines.shift()).contents());for(const line of lines)$(selected.node).append(line?$('<div>').text(line):$('<div><br></div>'))}else $(selected.node).text(value);events.push({target:selected,type:'input'});return true}};
 const selection={removeAllRanges(){},addRange(){}};class Event{constructor(type,options){this.type=type;Object.assign(this,options)}}
 const context=vm.createContext({document,location:new URL(href),URL,HTMLElement:Element,HTMLTextAreaElement:TextArea,Node:{TEXT_NODE:3,ELEMENT_NODE:1},InputEvent:Event,Event,getComputedStyle:element=>({display:hidden(element.node)?'none':'block',visibility:'visible',opacity:'1'}),getSelection:()=>selection});context.window=context;
 return {$,events,forbiddenReads,document,run:script=>JSON.parse(JSON.stringify(vm.runInContext(script,context))),append:html=>$('body').append(html)};
}

test('in-app prompts keep fixed official URLs and redaction while requiring a random request envelope',()=>{
 for(const provider of Object.keys(layouts)){const result=api().inAppDiscoveryPrompt(provider,{...request,description:request.description+' C:\\Users\\PrivateAlice\\secret.png https://pan.baidu.com/s/private?pwd=abcd'},requestId);assert.equal(result.url,layouts[provider].url);assert(result.prompt.includes(requestId));assert(result.prompt.includes('requestId'));assert(result.prompt.includes('plan'));assert(!result.prompt.includes('PrivateAlice'));assert(!result.prompt.includes('pan.baidu'))}
 assert.throws(()=>api().inAppDiscoveryPrompt('evil',request,requestId));assert.throws(()=>api().inAppDiscoveryPrompt('qwen',request,'guessable'));
});
test('only one complete matching envelope yields a validated ordinary plan JSON',()=>{
 const parse=api().parseInAppDiscoveryReply;assert.deepEqual(JSON.parse(parse(envelope(),requestId)),plan);assert.deepEqual(JSON.parse(parse('```json\n'+envelope()+'\n```',requestId)),plan);
 for(const raw of [envelope(otherId),JSON.stringify(plan),JSON.stringify({requestId,plan,extra:true}),JSON.stringify({requestId,result:plan}),envelope(requestId,{...plan,boothQueries:['https://evil.invalid']}),'prefix '+envelope(),envelope()+'\n'+envelope(),envelope()+' trailing','x'.repeat(16001),'"'+envelope().replaceAll('"','\\"')+'"','{"requestId":"wrong","requestId":"'+requestId+'","plan":'+JSON.stringify(plan)+'}'])assert.equal(parse(raw,requestId),undefined,raw.slice(0,100));
 assert.equal(parse(envelope(),'guessable'),undefined);
});
test('automatic parsing does not inherit the manual parser ability to unwrap nested envelopes',()=>{
 const service=sourceModule('main/discovery-web.ts'),original=service.parseWebDiscoveryReply;
 service.parseWebDiscoveryReply=raw=>{const value=JSON.parse(raw);return original(JSON.stringify(value?.plan??value))};
 try{assert.equal(api().parseInAppDiscoveryReply(envelope(requestId,{requestId:otherId,plan}),requestId),undefined)}finally{service.parseWebDiscoveryReply=original}
});
test('official visible editors receive prompts and input events without any send or key event',()=>{
 for(const [provider,layout] of Object.entries(layouts)){const b=browser(layout.editor,layout.url),prompt=api().inAppDiscoveryPrompt(provider,request,requestId).prompt;assert.equal(b.run(api().aiEditorScript(provider,prompt)),true);assert(b.events.some(event=>event.type==='input'));assert(!b.events.some(event=>/key|click|submit/.test(event.type)));assert.equal(b.run(api().aiEditorScript(provider,prompt)),true)}
});

test('Chromium contenteditable paragraph readback marks a completed fill without rewriting an equivalent draft',()=>{
 for(const provider of ['qwen','kimi']){
  const layout=layouts[provider],b=browser(layout.editor,layout.url,{chromiumEditable:true}),prompt=api().inAppDiscoveryPrompt(provider,request,requestId).prompt,script=api().aiEditorScript(provider,prompt);
  assert.equal(b.run(script),true);const editor=b.document.querySelector('[contenteditable="true"]');assert(editor.innerText.includes('\n\n\n'));assert(b.$('[contenteditable="true"] > div > br').length);const filledHtml=b.$('[contenteditable="true"]').html(),eventCount=b.events.length;
  assert.equal(b.run(script),true);assert.equal(b.events.length,eventCount);assert.equal(b.$('[contenteditable="true"]').html(),filledHtml);
  b.$('[contenteditable="true"]').append(' USER DRAFT');assert.equal(b.run(script),false);assert.equal(b.events.length,eventCount);assert(b.$('[contenteditable="true"]').text().endsWith(' USER DRAFT'));
  const spaces=browser(layout.editor,layout.url,{chromiumEditable:true});spaces.$('[contenteditable="true"]').text('first  line');assert.equal(spaces.run(api().aiEditorScript(provider,'first line')),false);assert.equal(spaces.events.length,0);
 }
});

test('Kimi rich editor readback may omit paragraph separators while preserving every prompt character',()=>{
 const provider='kimi',layout=layouts[provider],b=browser(layout.editor,layout.url,{chromiumEditable:true,flattenEditableBreaks:true}),prompt=api().inAppDiscoveryPrompt(provider,request,requestId).prompt,script=api().aiEditorScript(provider,prompt);
 assert.equal(b.run(script),true);const editor=b.document.querySelector('[contenteditable="true"]');assert.equal(editor.innerText,prompt.replace(/\n/g,''));const filledHtml=b.$('[contenteditable="true"]').html(),eventCount=b.events.length;
 assert.equal(b.run(script),true);assert.equal(b.events.length,eventCount);assert.equal(b.$('[contenteditable="true"]').html(),filledHtml);
 for(const draft of [prompt.replace('需求概括','我的草稿'),prompt.replace('VRChat 中文检索词','VRChat  中文检索词')]){b.$('[contenteditable="true"]').text(draft);assert.equal(b.run(script),false);assert.equal(b.events.length,eventCount);assert.equal(b.$('[contenteditable="true"]').text(),draft)}
 const textArea=browser(layouts.deepseek.editor,layouts.deepseek.url);textArea.$('textarea').text(prompt.replace(/\n/g,''));assert.equal(textArea.run(api().aiEditorScript('deepseek',prompt)),false);assert.equal(textArea.events.length,0);
});

test('Qwen empty Slate placeholder is not a draft and normal Slate text confirms a completed fill',()=>{
 const layout=layouts.qwen,html=layout.editor.replace('contenteditable="true">','contenteditable="true">'+qwenEmptySlate),b=browser(html,layout.url,{slateEditable:true}),prompt=api().inAppDiscoveryPrompt('qwen',request,requestId).prompt,script=api().aiEditorScript('qwen',prompt);
 assert(b.document.querySelector('[data-slate-editor]').innerText.includes('向千问提问'));assert.equal(b.run(script),true);assert(b.$('[data-slate-string]').length>1);assert.equal(b.$('[data-slate-placeholder]').length,0);assert.equal(b.$('[data-slate-string]').toArray().map(node=>b.$(node).text()).join(''),prompt.replace(/\n/g,''));
 const htmlAfter=b.$('[data-slate-editor]').html(),eventCount=b.events.length;assert.equal(b.run(script),true);assert.equal(b.events.length,eventCount);assert.equal(b.$('[data-slate-editor]').html(),htmlAfter);
});

test('Qwen keeps genuine placeholder-word drafts, unnormalized IME text and editable placeholder nodes intact',()=>{
 for(const body of [
  '<p data-slate-node="element"><span data-slate-node="text"><span data-slate-leaf="true"><span data-slate-string="true">向千问提问</span></span></span></p>',
  qwenEmptySlate.replace('\ufeff<br>','\ufeff正在输入的草稿<br>'),
  qwenEmptySlate.replace('contenteditable="false"','contenteditable="true"'),
  qwenEmptySlate.replace(' contenteditable="false"','')
 ]){const layout=layouts.qwen,html=layout.editor.replace('contenteditable="true">','contenteditable="true">'+body),b=browser(html,layout.url,{slateEditable:true}),before=b.$('[data-slate-editor]').html(),prompt=api().inAppDiscoveryPrompt('qwen',request,requestId).prompt;assert.equal(b.run(api().aiEditorScript('qwen',prompt)),false);assert.equal(b.events.length,0);assert.equal(b.$('[data-slate-editor]').html(),before)}
});
test('editor filling preserves drafts and rejects disabled, hidden, ambiguous, login and foreign-page targets',()=>{
 for(const [provider,layout] of Object.entries(layouts)){
  for(const html of [layout.editor.replace('></textarea>','>PRIVATE DRAFT</textarea>').replace('contenteditable="true">','contenteditable="true">PRIVATE DRAFT'),'<div hidden>'+layout.editor+'</div>',layout.editor+layout.editor,layout.editor.replace('name="user query"','disabled name="user query"').replace('contenteditable="true"','contenteditable="false"')]){const b=browser(html,layout.url);assert.equal(b.run(api().aiEditorScript(provider,'test prompt')),false);assert.equal(b.events.length,0)}
  for(const href of ['https://evil.invalid/',layout.url+'login'])assert.equal(browser(layout.editor,href).run(api().aiEditorScript(provider,'test prompt')),false);
 }
});
test('reply capture only returns the latest visible explicit assistant body with this request marker',()=>{
 for(const [provider,layout] of Object.entries(layouts)){const html='<div data-forbid-read>'+envelope()+'</div>'+layout.reply(envelope(otherId)).replace('assistant-new','old-message')+layout.reply(envelope());const b=browser(html,layout.url);assert.deepEqual(b.run(api().aiReplyScript(provider,requestId)),[envelope()]);assert.deepEqual(browser(layout.reply(envelope(otherId)),layout.url).run(api().aiReplyScript(provider,requestId)),[]);assert.deepEqual(browser(layout.reply(envelope()),'https://evil.invalid/').run(api().aiReplyScript(provider,requestId)),[])}
});
test('capture excludes quoted, hidden, thinking and user text without reading those private subtrees',()=>{
 for(const [provider,layout] of Object.entries(layouts)){
  const content='<blockquote data-forbid-read>'+envelope()+'</blockquote><div class="ds-think-content" data-forbid-read>PRIVATE REASONING</div><div hidden data-forbid-read>PRIVATE HIDDEN</div>'+envelope();
  assert.deepEqual(browser(layout.reply(content),layout.url).run(api().aiReplyScript(provider,requestId)),[envelope()]);
  for(const content of ['<blockquote data-forbid-read>'+envelope()+'</blockquote>','<div hidden data-forbid-read>'+envelope()+'</div>'])assert.deepEqual(browser(layout.reply(content),layout.url).run(api().aiReplyScript(provider,requestId)),[]);
  const body=provider==='kimi'?'<div class="segment-user">'+layout.reply(envelope())+'</div>':'<textarea>'+envelope()+'</textarea>';
  assert.deepEqual(browser(body,layout.url).run(api().aiReplyScript(provider,requestId)),[]);
 }
});
test('a no-text baseline prevents old assistant nodes and stable message IDs from being read after filling',()=>{
 for(const [provider,layout] of Object.entries(layouts)){
  const b=browser(layout.editor+layout.reply(envelope()).replace('assistant-new','old-message').replace('<div data-chat-answers-wrap','<div data-forbid-read data-chat-answers-wrap').replace('class="segment-content-box"','class="segment-content-box" data-forbid-read').replace('class="ds-assistant-message-main-content"','class="ds-assistant-message-main-content" data-forbid-read'),layout.url),prompt=api().inAppDiscoveryPrompt(provider,request,requestId).prompt;
  assert.equal(b.run(api().aiEditorScript(provider,prompt)),true);assert.deepEqual(b.run(api().aiReplyScript(provider,requestId)),[]);assert.equal(b.forbiddenReads.length,0);b.append(layout.reply(envelope()));assert.deepEqual(b.run(api().aiReplyScript(provider,requestId)),[envelope()]);
 }
});
test('stable assistant IDs remain excluded when an old reply DOM node is remounted',()=>{
 for(const provider of ['qwen','deepseek']){
  const layout=layouts[provider],b=browser(layout.editor+layout.reply(envelope()).replace('assistant-new','old-message'),layout.url),prompt=api().inAppDiscoveryPrompt(provider,request,requestId).prompt;
  assert.equal(b.run(api().aiEditorScript(provider,prompt)),true);b.$(provider==='qwen'?'[data-chat-list-key]':'[data-virtual-list-item-key]').remove();b.append(layout.reply(envelope()).replace('assistant-new','old-message').replace('data-chat-answers-wrap=','data-forbid-read data-chat-answers-wrap=').replace('class="ds-assistant-message-main-content"','class="ds-assistant-message-main-content" data-forbid-read'));
  assert.deepEqual(b.run(api().aiReplyScript(provider,requestId)),[]);assert.equal(b.forbiddenReads.length,0);
 }
});
test('mixed, multiple and oversized assistant output is rejected whole rather than sliced into a JSON substring',()=>{
 for(const [provider,layout] of Object.entries(layouts))for(const content of ['reasoning '+envelope(),envelope()+envelope(),envelope()+'x'.repeat(16000)]){
  const replies=browser(layout.reply(content),layout.url).run(api().aiReplyScript(provider,requestId));assert(replies.every(reply=>reply.length<=16000));for(const reply of replies)assert.equal(api().parseInAppDiscoveryReply(reply,requestId),undefined);
 }
});
