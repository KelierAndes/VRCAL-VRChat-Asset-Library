const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),{load}=require('cheerio');
// Compile only this pure capture recipe in memory; never overwrite shared dist.
const filename=path.resolve(__dirname,'../src/main/link-inbox-dom.ts'),compiled=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,mod={exports:{}};vm.runInNewContext(compiled,{module:mod,exports:mod.exports});const {inboxCaptureScript}=mod.exports;
const own='<header><div class="user-order-container--fixture"><a href="/personal"><img src="https://img.alicdn.com/bao/uploaded/i1/synthetic-mtopupload.jpg">Synthetic user</a></div></header>';
const link='https://pan.baidu.com/s/1SyntheticDelivery';
const item='<div role="listitem" data-fixture-message aria-label="未读"><time datetime="2026-10-24T11:30:00+08:00"></time>'+link+' 提取码: Ab12</div>';
function capture(html,{mode='foreground',identityOnly=false,forbidMessageText=false,forbidQuotedText=false,href='https://www.goofish.com/im',script}={}){
 const $=load(html),cache=new WeakMap();let messageReads=0;
 const hidden=node=>$(node).parents().addBack().toArray().some(e=>$(e).attr('hidden')!==undefined||/display\s*:\s*none|visibility\s*:\s*hidden/i.test($(e).attr('style')||''));
 class Element{
  constructor(node){this.node=node}
  getAttribute(name){return $(this.node).attr(name)??null}
  get tagName(){return String(this.node.tagName).toUpperCase()}
  get nodeType(){return this.node.type==='text'?3:1}
  get nodeValue(){if($(this.node).closest('[data-fixture-quote]').length&&forbidQuotedText)throw Error('quoted historical text must never be read');if($(this.node).closest('[data-fixture-message]').length){messageReads++;if(forbidMessageText)throw Error('identity-only capture read message content')}return this.node.data??null}
  get childNodes(){return (this.node.children||[]).map(wrap)}
  get children(){return $(this.node).children().toArray().map(wrap)}
  get nextElementSibling(){return wrap($(this.node).next()[0])}
  get innerText(){if($(this.node).closest('[data-fixture-message]').length){messageReads++;if(forbidMessageText)throw Error('identity-only capture read message content')}return $(this.node).text()}
  get parentElement(){return wrap($(this.node).parent()[0])}
  querySelector(selector){return wrap($(this.node).find(selector)[0])}
  querySelectorAll(selector){return $(this.node).find(selector).toArray().map(wrap)}
  matches(selector){return $(this.node).is(selector)}
  closest(selector){return wrap($(this.node).closest(selector)[0])}
  getClientRects(){return hidden(this.node)?[]:[{}]}
 }
 const wrap=node=>{if(!node)return null;if(!cache.has(node))cache.set(node,new Element(node));return cache.get(node)},document={querySelectorAll:selector=>$(selector).toArray().map(wrap),querySelector:selector=>wrap($(selector)[0])};
 const result=JSON.parse(JSON.stringify(vm.runInNewContext(script??inboxCaptureScript('xianyu',mode,identityOnly),{document,location:new URL(href),URL,HTMLElement:Element,getComputedStyle:element=>({display:hidden(element.node)?'none':'block',visibility:'visible'})})));
 return {result,messageReads};
}
// These are semantic layout variants, not claims about newly observed live site
// classes. Class prefixes below come only from the already documented recipe.
test('existing descendant semantic fixture remains scoped and excludes unrelated links and composer drafts',()=>{
 const html=own+'<aside class="conversation-list--fixture"></aside><main class="chat-main--fixture"><div role="log">'+item+'<div role="listitem"><textarea>https://pan.baidu.com/s/1DraftSecret</textarea></div></div></main><div role="listitem">https://pan.baidu.com/s/1OutsideSecret</div>';
 const {result}=capture(html);assert.equal(result.supported,true);assert.equal(result.rows.length,1);assert(result.rows[0].text.includes(link));assert(!JSON.stringify(result.rows).includes('DraftSecret'));assert(!JSON.stringify(result.rows).includes('OutsideSecret'));
});

test('foreground accepts the verified chat root itself as the semantic log without needing a redundant nested log',()=>{
 const html=own+'<aside class="conversation-list--fixture"></aside><main class="chat-main--fixture" role="log">'+item+'</main>';
 const {result}=capture(html);assert.equal(result.supported,true);assert.equal(result.rows.length,1);assert(result.rows[0].text.includes(link));assert.equal(result.rows[0].kind,'message');
});

test('background accepts the verified conversation root itself as the semantic list and retains unread/time evidence',()=>{
 const html=own+'<aside class="conversation-list--fixture" role="list">'+item+'</aside><main class="chat-main--fixture"></main>';
 const {result}=capture(html,{mode:'background'});assert.equal(result.supported,true);assert.equal(result.rows.length,1);assert.equal(result.rows[0].kind,'conversation');assert.equal(result.rows[0].unread,true);assert.equal(result.rows[0].time,'2026-10-24T11:30:00+08:00');
});

test('identity-only verification of root semantics never reads message text',()=>{
 const html=own+'<aside class="conversation-list--fixture"></aside><main class="chat-main--fixture" role="log">'+item+'</main>';
 const {result,messageReads}=capture(html,{identityOnly:true,forbidMessageText:true});assert.equal(result.supported,true);assert(result.account.startsWith('xianyu-visible:'));assert.deepEqual(result.rows,[]);assert.equal(messageReads,0);
});

test('root semantics never admit outside chat content, ambiguous verified roots, missing owner or another origin',()=>{
 const body='<aside class="conversation-list--fixture"></aside><main class="chat-main--fixture" role="log">'+item+'</main>',duplicate='<main class="chat-main--fixture" role="log">'+item+'</main>';
 for(const html of [body,own+body+duplicate,own+'<aside class="conversation-list--fixture"></aside><main class="chat-main--fixture"></main><section role="log">'+item+'</section>']){const {result}=capture(html);assert.equal(result.supported,false);assert.deepEqual(result.rows,[])}
 const {result}=capture(own+body,{href:'https://www.goofish.com.evil.invalid/im'});assert.equal(result.supported,false);assert.deepEqual(result.rows,[]);
});

test('capture diagnostics contain only fixed reasons for account and verified-root failures',()=>{
 const body='<aside class="conversation-list--fixture"></aside><main class="chat-main--fixture" role="log">'+item+'</main>';
 for(const [html,expected] of [[body,'account-header'],[own.replace('synthetic-mtopupload.jpg','default-avatar.jpg')+body,'account-avatar'],[own+'<main class="chat-main--fixture" role="log">'+item+'</main>','conversation-root'],[own+'<aside class="conversation-list--fixture"></aside>','message-root'],[own+'<aside class="conversation-list--fixture"></aside><main class="chat-main--fixture"></main>','message-layout']]){
  const {result}=capture(html);assert.equal(result.diagnostic,expected);assert.equal(result.supported,false);assert.deepEqual(result.rows,[]);assert(!result.diagnostic.includes('Synthetic'));assert(!result.diagnostic.includes('https:'));
 }
});

test('a confirmed semantic log without delivery links is ready and does not become an unsupported account',()=>{
 for(const content of ['', '<div role="listitem" data-fixture-message>Non-delivery synthetic message</div>']){const {result}=capture(own+'<aside class="conversation-list--fixture"></aside><main class="chat-main--fixture" role="log">'+content+'</main>');assert.equal(result.supported,true);assert.deepEqual(result.rows,[])}
});

// Sanitized render structure from public official p_im-index.js 0.0.179:
// SHA256 ec9c8491cc0ef9366f8491ae5d68ec0b8d44620129078136c245b4b126770093.
// Stable ids: bytes 2484118,2965630,2966366; message/reply token maps and
// rendering: 4469,4795,2514383,2522694; summary/time: 2458452,2458730.
// No fixture text, account, link or identifier below comes from a real user.
const summaryStyle='text-overflow:ellipsis;max-height:20px;overflow:hidden;display:inline-block;white-space:nowrap;font-size:12px;margin-top:2px';
const clockStyle='font-size:10px;line-height:14px';
function conversation(body,{time='2分钟前',unread=true,draft=false,nestedTime=false,duplicateSummary=false}={}){const summary='<div style="'+summaryStyle+'" data-fixture-message>'+(draft?'[草稿] ':'')+body+'</div>',clock='<div style="'+clockStyle+'">'+time+'</div>';return '<div class="conversation-item--fixture conversation-item-active--fixture"><span class="ant-badge"><img src="https://img.alicdn.com/synthetic-peer.png"><sup class="ant-badge-count" data-show="'+unread+'" title="'+(unread?2:0)+'"><span>0123456789</span></sup></span><div><div>Synthetic peer</div>'+summary+(duplicateSummary?summary:'')+(nestedTime?'<div style="display:flex">'+clock+'</div>':clock)+'</div></div>'}
function message(body,{quote='',time=''}={}){return '<div style="position:relative;z-index:99">'+(time?'<div style="text-align:center;padding:10px 0px;font-size:12px">'+time+'</div>':'')+'<div><li class="ant-list-item"><div class="message-row--fixture"><div class="message-text--fixture message-text-left--fixture" data-fixture-message>'+(quote?'<div class="reply-container--fixture" data-fixture-quote><span>'+quote+'</span></div>':'')+'<span>'+body+'</span></div></div></li></div></div>'}
function official({conversations='',messages='',selected=true}={}){return own+'<aside class="conversation-list--fixture"><div id="conv-list-scrollable">'+conversations+'</div></aside><main class="chat-main--fixture">'+(selected?'<div id="message-list-scrollable" class="message-list-reverse--fixture"><div class="scroll-container--fixture"><div id="msg-list-container">'+messages+'</div></div></div>':'<div>尚未选择任何联系人</div>')+'<div class="sendbox--fixture"><textarea>https://pan.baidu.com/s/1NeverSentDraft</textarea></div></main>'}

test('official non-ARIA foreground reads only selected message text and its own displayed time',()=>{
 const html=official({conversations:conversation('https://pan.baidu.com/s/1UnopenedPreview'),messages:message(link+' 提取码: Ab12',{quote:'https://pan.baidu.com/s/1OldQuotedLink',time:'昨天 12:34'})+message('No delivery in this message',{quote:'https://pan.baidu.com/s/1AnotherOldQuote'})});
 const {result}=capture(html,{forbidQuotedText:true});assert.equal(result.supported,true);assert.equal(result.rows.length,1);assert.equal(result.rows[0].time,'昨天 12:34');assert(result.rows[0].text.includes(link));assert(!JSON.stringify(result.rows).includes('OldQuote'));assert(!JSON.stringify(result.rows).includes('UnopenedPreview'));assert(!JSON.stringify(result.rows).includes('NeverSentDraft'));
});

test('official identity verification never reads selected message or quoted body text',()=>{
 const {result,messageReads}=capture(official({messages:message(link,{quote:'https://pan.baidu.com/s/1PrivateQuote'})}),{identityOnly:true,forbidMessageText:true,forbidQuotedText:true});assert.equal(result.supported,true);assert.deepEqual(result.rows,[]);assert.equal(messageReads,0);
});

test('official foreground leaves undated messages unknown and never inherits another message time',()=>{
 const {result}=capture(official({messages:message('No link',{time:'2026-10-24 12:34'})+message(link)}));assert.equal(result.supported,true);assert.equal(result.rows.length,1);assert.equal(result.rows[0].time,undefined);
});

test('official background reads only unambiguous unread non-draft summaries with their adjacent time',()=>{
 const html=official({conversations:conversation(link,{nestedTime:true})+conversation('https://pan.baidu.com/s/1ReadPreview',{unread:false})+conversation('https://pan.baidu.com/s/1DraftPreview',{draft:true})+conversation('https://pan.baidu.com/s/1AmbiguousPreview',{duplicateSummary:true})+conversation('https://pan.baidu.com/s/1UnknownDate',{time:'Unknown'})});
 const {result}=capture(html,{mode:'background'});assert.equal(result.supported,true);assert.equal(result.rows.length,1);assert.equal(result.rows[0].unread,true);assert.equal(result.rows[0].time,'2分钟前');assert(result.rows[0].text.includes(link));for(const privatePart of ['ReadPreview','DraftPreview','AmbiguousPreview','UnknownDate','NeverSentDraft'])assert(!JSON.stringify(result.rows).includes(privatePart));
});

test('official unselected conversation and truly empty conversation list have explicit non-account diagnostics',()=>{
 const waiting=capture(official({conversations:conversation('No delivery link'),selected:false})).result;assert.equal(waiting.supported,false);assert.equal(waiting.diagnostic,'chat-unselected');assert.deepEqual(waiting.rows,[]);
 const empty=capture(official({selected:false}),{mode:'background'}).result;assert.equal(empty.supported,true);assert.equal(empty.diagnostic,'conversation-empty');assert.deepEqual(empty.rows,[]);
});

test('official recipe rejects ambiguous lists and forged class substrings without scanning the surrounding page',()=>{
 const duplicate=official({messages:message(link)}).replace('</main>','<div id="message-list-scrollable" class="message-list--fixture"><div id="msg-list-container">'+message(link)+'</div></div></main>');const bad=capture(duplicate).result;assert.equal(bad.supported,false);assert.deepEqual(bad.rows,[]);
 const forged=official({messages:message(link).replace('message-text--fixture','not-message-text--fixture')});const value=capture(forged).result;assert.equal(value.supported,true);assert.deepEqual(value.rows,[]);
});

test('official selected share survives wrapped text, account verification and encrypted restart as time-review only',async t=>{
 // Recreate the public message shape shown in feedback, with entirely synthetic
 // account/product/link data. CSS wrapping and WBR do not change a link's text.
 const body='【超级会员V6】通过百度网盘分享的文件：Synthetic Garment 等3个文件\n链接:<span>https://pan.baidu.com/s/1Synthetic</span><wbr><span>Delivery?pwd=Ab12</span>\n复制这段内容打开「百度网盘APP 即可获取」';
 const html=official({conversations:conversation('No delivery in unread preview'),messages:message(body,{quote:'https://pan.baidu.com/s/1NeverReadOldQuote',time:'18:25'})});
 const Module=require('node:module'),filename=path.resolve(__dirname,'../src/main/link-inbox-reader.ts'),reader=new Module(filename,module);reader.filename=filename;reader.paths=Module._nodeModulePaths(path.dirname(filename));reader.require=Module.createRequire(path.resolve(__dirname,'../dist/main/main/link-inbox-reader.js'));reader._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename);
 const now=Date.parse('2026-10-25T19:00:00+08:00'),context={now,hours:6};let evaluations=0;
 const page={isDestroyed:()=>false,getURL:()=> 'https://www.goofish.com/im',executeJavaScript:async script=>{evaluations++;return capture(html,{script,forbidQuotedText:true}).result}};
 const result=await reader.exports.readOwnedInbox('xianyu',[page],'foreground',new AbortController().signal,context,()=>true);
 assert.equal(evaluations,2);assert.equal(result.state,'ready');assert.equal(result.observations.length,1);assert.equal(result.observations[0].sourceAt,undefined);assert.match(result.message,/时间／提取码待核对/);
 const crypto=require('node:crypto'),os=require('node:os'),{LinkInboxStore}=require('../dist/main/main/link-inbox-store'),{INBOX_POLICY_VERSION}=require('../dist/main/shared/inbox-policy');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vrc-inbox-flow-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const key=crypto.randomBytes(32),cipher={encrypt:text=>{const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv),bytes=Buffer.concat([c.update(text,'utf8'),c.final()]);return Buffer.concat([iv,c.getAuthTag(),bytes])},decrypt:bytes=>{const c=crypto.createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));c.setAuthTag(bytes.subarray(12,28));return Buffer.concat([c.update(bytes.subarray(28)),c.final()]).toString('utf8')}};
 const make=()=>new LinkInboxStore({dataDir:dir,roots:()=>[],cipher,now:()=>now}),store=make();store.configure({enabled:true,background:false,hours:6},{version:INBOX_POLICY_VERSION,acceptedAt:now,scope:'foreground'});for(const observation of result.observations)store.ingest(observation);
 const state=store.state();assert.equal(state.items.length,1);assert.equal(state.items[0].url,link);assert.equal(state.items[0].code,'Ab12');assert.equal(state.items[0].sourceAt,undefined);assert.equal(state.unread,0);assert(!fs.readFileSync(path.join(dir,'link-inbox.bin')).includes(Buffer.from('pan.baidu.com')));assert.deepEqual(make().state(),JSON.parse(JSON.stringify(state)));
});
