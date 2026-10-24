const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const filename=path.join(__dirname,'../src/renderer/discovery-page.tsx');
const source=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}};
const text=node=>node==null?'':Array.isArray(node)?node.map(text).join(''):typeof node==='object'?(node.children||[]).map(text).join(''):String(node);
const nodes=(node,predicate)=>node==null?[]:Array.isArray(node)?node.flatMap(child=>nodes(child,predicate)):typeof node==='object'?[...(predicate(node)?[node]:[]),...(node.children||[]).flatMap(child=>nodes(child,predicate))]:[];
const discovery={running:false,notice:'',products:[],sources:{}};
const workspace={token:'current-token',provider:'qwen',url:'https://www.qianwen.com/',status:'waiting',notice:'请在官网发送',promptReady:true};

// Execute the page's hooks and handlers, with controlled IPC completion and a
// real rectangle intersection model. No website, login or AI call is involved.
function harness(t){
 const values=[],effects=[],timers=new Map(),frames=new Map(),listeners=new Map(),mutations=new Set(),calls={open:[],bounds:[],collect:[],apply:[],close:0,external:0,manual:[],search:0};let cursor=0,dirty=true,tree,disposed=false,pending=[],sequence=0,current={...workspace},currentDiscovery=discovery,openHook,collectHook,applyHook,searchHook,stateHook,overlays=[];
 const parent={parentElement:null,clientLeft:0,clientTop:0,clientWidth:960,clientHeight:540,getBoundingClientRect:()=>({left:20,top:180,right:980,bottom:720,width:960,height:540})};
 const host={parentElement:parent,isConnected:true,getBoundingClientRect:()=>({left:40,top:300,right:940,bottom:820,width:900,height:520})};
 const props={online:true,xianyuEnabled:true,nativeOverlayBlocked:false};
 const api={discoveryState:()=>stateHook?stateHook():Promise.resolve(currentDiscovery),webDiscoveryState:async()=>({status:'closed',notice:'',promptReady:false}),
  openWebDiscovery(provider,request){calls.open.push({provider,request});return openHook?openHook():Promise.resolve({...current,provider})},
  async setWebDiscoveryBounds(token,bounds){calls.bounds.push({token,bounds})},
  collectWebDiscovery(token){calls.collect.push(token);return collectHook?collectHook():Promise.resolve({...current})},
  applyWebDiscoveryReply(token){calls.apply.push(token);return (applyHook?applyHook():Promise.resolve({...discovery,method:'web-ai',notice:'new result'})).then(result=>(currentDiscovery=result))},
  async closeWebDiscovery(){calls.close++},async fillWebDiscovery(){return current},async copyWebDiscoveryPrompt(){},async clearWebDiscoverySession(){},
  async prepareWebDiscovery(){calls.external++},startDiscovery(){calls.search++;return searchHook?searchHook():Promise.resolve(discovery)},async startWebDiscovery(request,reply){calls.manual.push({request,reply});return discovery},async cancelDiscovery(){return discovery}};
 const React={createElement:(type,props,...children)=>({type,props:props||{},children}),
  useState(initial){const at=cursor++;if(!(at in values))values[at]=typeof initial==='function'?initial():initial;return [values[at],next=>{const value=typeof next==='function'?next(values[at]):next;if(!Object.is(value,values[at])){values[at]=value;dirty=true}}]},
  useRef(initial){const at=cursor++;if(!(at in values))values[at]={current:initial};return values[at]},
  useEffect(callback,deps){const at=cursor++,previous=effects[at];if(!previous||!deps||deps.some((value,i)=>!Object.is(value,previous.deps?.[i])))pending.push({at,callback,deps})}};
 React.useLayoutEffect=React.useEffect;React.default=React;
 const window={innerWidth:1000,innerHeight:800,addEventListener:(name,fn)=>{const set=listeners.get(name)||new Set();set.add(fn);listeners.set(name,set)},removeEventListener:(name,fn)=>listeners.get(name)?.delete(fn)};
 const module={exports:{}};vm.runInNewContext(source,{module,exports:module.exports,require:name=>name==='react'?React:name==='./i18n'?{t:value=>value}:name==='../shared/discovery-prompt'?{DISCOVERY_SEARCH_PROMPT:'prompt',DISCOVERY_WEB_PROVIDERS:[{id:'qwen',label:'千问'},{id:'kimi',label:'Kimi'},{id:'deepseek',label:'DeepSeek'}]}:{},window,document:{body:{},visibilityState:'visible',querySelectorAll:selector=>overlays.filter(node=>!node.selector||selector.split(',').includes(node.selector)),addEventListener:window.addEventListener,removeEventListener:window.removeEventListener},getComputedStyle:()=>({overflowX:'hidden',overflowY:'auto',display:'block',visibility:'visible'}),MutationObserver:class{constructor(callback){this.callback=callback}observe(){mutations.add(this.callback)}disconnect(){mutations.delete(this.callback)}},ResizeObserver:class{observe(){}disconnect(){}},requestAnimationFrame:fn=>{const id=++sequence;frames.set(id,fn);return id},cancelAnimationFrame:id=>frames.delete(id),setInterval:fn=>{const id=++sequence;timers.set(id,fn);return id},clearInterval:id=>timers.delete(id),setTimeout:fn=>{const id=++sequence;frames.set(id,fn);return id},clearTimeout:id=>frames.delete(id)});
 function render(){dirty=false;cursor=0;pending=[];tree=module.exports.DiscoveryPage({...props,api});for(const node of nodes(tree,node=>!!node.props.ref))node.props.ref.current=host;for(const job of pending){effects[job.at]?.cleanup?.();effects[job.at]={deps:job.deps,cleanup:job.callback()}}}
 async function flush(){for(let i=0;i<10;i++){if(!disposed&&dirty)render();const jobs=[...frames];frames.clear();for(const [,fn]of jobs)fn();await new Promise(setImmediate)}}
 const element=(predicate,label)=>{const found=nodes(tree,predicate)[0];assert(found,label);return found};
 const button=label=>element(node=>node.type==='button'&&text(node)===label,'button '+label);
 async function click(label){const node=button(label);assert(!node.props.disabled,label+' enabled');node.props.onClick();await flush()}
 async function change(id,value){element(node=>node.props.id===id||node.props['aria-label']===id,id).props.onChange({target:{value,checked:value}});await flush()}
 async function tick(){for(const fn of [...timers.values()])fn();await flush()}
 function unmount(){if(disposed)return;disposed=true;for(const effect of effects)effect?.cleanup?.();frames.clear();timers.clear()}
 t.after(unmount);return {calls,api,props,host,parent,flush,click,change,tick,unmount,button,element,setWorkspace:state=>{current={...workspace,...state}},setOpen:fn=>{openHook=fn},setCollect:fn=>{collectHook=fn},setApply:fn=>{applyHook=fn},setSearch:fn=>{searchHook=fn},setStateRead:fn=>{stateHook=fn},setOverlays:value=>{overlays=value},async mutate(value){overlays=value;for(const callback of mutations)callback([]);await flush()},async update(next){Object.assign(props,next);dirty=true;await flush()},async event(name,event={}){for(const fn of listeners.get(name)||[])fn(event);await flush()},get tree(){return tree},get text(){return text(tree)}};
}
async function ready(t){const h=harness(t);await h.flush();await h.change('discovery-query','哥特蕾丝礼裙');return h}
async function opened(t){const h=await ready(t);await h.click('在应用内打开官方 AI');return h}

test('official AI opens inside the application with only the current request and no external browser action',async t=>{
 const h=await opened(t);assert.equal(h.calls.open.length,1);assert.equal(h.calls.open[0].request.description,'哥特蕾丝礼裙');assert.equal(h.calls.external,0);assert(h.text.includes('在下方官网正常登录并点击发送'));assert.equal(nodes(h.tree,node=>node.type==='form').length,1);assert.equal(nodes(h.tree,node=>node.type==='iframe').length,0);
});
test('native view is clipped to its scrolling ancestor and hides for external overlays then restores',async t=>{
 const h=await opened(t);const visible=h.calls.bounds.find(call=>call.bounds);assert(visible);assert.deepEqual(JSON.parse(JSON.stringify(visible.bounds)),{x:40,y:300,width:900,height:420});
 await h.update({nativeOverlayBlocked:true});assert.equal(h.calls.bounds.at(-1).bounds,null);await h.update({nativeOverlayBlocked:false});assert(h.calls.bounds.at(-1).bounds);
 h.host.getBoundingClientRect=()=>({left:40,top:830,right:940,bottom:1200,width:900,height:370});await h.event('scroll');assert.equal(h.calls.bounds.at(-1).bounds,null);
});
test('settings, offline and collapse hide the native surface and stop collection while hidden',async t=>{
 const h=await opened(t);await h.click('AI 设置');assert.equal(h.calls.bounds.at(-1).bounds,null);const count=h.calls.collect.length;await h.tick();assert.equal(h.calls.collect.length,count);await h.click('收起 AI 设置');assert(h.calls.bounds.at(-1).bounds);
 await h.update({online:false});assert.equal(h.calls.bounds.at(-1).bounds,null);await h.update({online:true});await h.click('收起官网工作区');assert.equal(h.calls.bounds.at(-1).bounds,null);
});
test('editing a request invalidates a late open and never attaches its stale token',async t=>{
 const h=await ready(t),pending=deferred();h.setOpen(()=>pending.promise);h.button('在应用内打开官方 AI').props.onClick();await h.flush();await h.change('discovery-query','新需求');pending.resolve({...workspace,token:'old-token'});await h.flush();assert(h.calls.close>=1);assert(!h.calls.bounds.some(call=>call.token==='old-token'&&call.bounds));assert.equal(h.calls.apply.length,0);
});
test('a nonce-checked current reply automatically starts exactly one search despite repeated polling',async t=>{
 const h=await opened(t),pending=deferred();h.setWorkspace({status:'reply-ready'});h.setApply(()=>pending.promise);await h.tick();await h.tick();assert.deepEqual(h.calls.apply,['current-token']);pending.resolve({...discovery,method:'web-ai',notice:'new result'});await h.flush();await h.tick();assert.equal(h.calls.apply.length,1);assert(h.text.includes('new result'));
});
test('late collected replies after editing cannot apply to the new request',async t=>{
 const h=await opened(t),pending=deferred();h.setCollect(()=>pending.promise);await h.tick();await h.change('discovery-query','另一套衣服');pending.resolve({...workspace,status:'reply-ready'});await h.flush();assert.equal(h.calls.apply.length,0);assert.equal(h.calls.bounds.at(-1).bounds,null);
});
test('rapid duplicate open clicks are serialized and unmount closes the native workspace',async t=>{
 const h=await ready(t),pending=deferred();h.setOpen(()=>pending.promise);const button=h.button('在应用内打开官方 AI');button.props.onClick();button.props.onClick();await h.flush();assert.equal(h.calls.open.length,1);pending.resolve(workspace);await h.flush();const closes=h.calls.close;h.unmount();await h.flush();assert(h.calls.close>closes);assert.equal(h.calls.bounds.at(-1).bounds,null);
});
test('the native surface hides for an open HTML appearance popover that has no React overlay flag',async t=>{
 const h=await opened(t);h.setOverlays([{getBoundingClientRect:()=>({width:280,height:320})}]);await h.event('toggle');assert.equal(h.calls.bounds.at(-1).bounds,null);h.setOverlays([]);await h.event('toggle');assert(h.calls.bounds.at(-1).bounds);
});
test('editing fields while a search is starting never permits a second concurrent search',async t=>{
 const h=await ready(t),pending=deferred();h.setSearch(()=>pending.promise);const form=h.element(node=>node.type==='form','search form');form.props.onSubmit({preventDefault(){}});await h.flush();await h.change('discovery-query','修改需求');h.element(node=>node.type==='form').props.onSubmit({preventDefault(){}});await h.flush();assert.equal(h.calls.search,1);pending.resolve(discovery);await h.flush();
});
test('a workspace scrolled completely out of view is not polled for an invisible answer',async t=>{
 const h=await opened(t);h.host.getBoundingClientRect=()=>({left:40,top:830,right:940,bottom:1200,width:900,height:370});await h.event('scroll');const count=h.calls.collect.length;h.setWorkspace({status:'reply-ready'});await h.tick();assert.equal(h.calls.collect.length,count);assert.equal(h.calls.apply.length,0);
});
test('manual JSON remains a collapsed fallback and forwards the complete reply envelope unchanged',async t=>{
 const h=await opened(t),fallback=h.element(node=>node.type==='details'&&text(node).includes('手动粘贴完整 JSON'),'manual fallback');assert.equal(fallback.props.open,false);fallback.props.onToggle({currentTarget:{open:true}});await h.flush();assert.equal(h.calls.bounds.at(-1).bounds,null);const reply=JSON.stringify({requestId:'12345678-abcd-4abc-8abc-123456789abc',plan:{summary:'manual',boothQueries:['gothic dress'],xianyuQuery:'VRChat 礼裙',terms:['gothic']}});await h.change('discovery-web-reply',reply);await h.click('使用粘贴回答搜索商品');assert.equal(h.calls.manual.length,1);assert.equal(h.calls.manual[0].reply,reply);assert.equal(h.calls.manual[0].request.description,'哥特蕾丝礼裙');
});
test('clearing an official login session blocks a replacement open until it finishes',async t=>{
 const h=await opened(t),pending=deferred();h.api.clearWebDiscoverySession=()=>pending.promise;h.button('退出该官网并清除会话').props.onClick();await h.flush();await h.change('discovery-query','新需求');h.button('在应用内打开官方 AI').props.onClick();await h.flush();assert.equal(h.calls.open.length,1);pending.resolve();await h.flush();
});
test('a pre-search state read cannot overwrite the current running search and enable another open',async t=>{
 const h=await ready(t),pending=deferred();h.setStateRead(()=>pending.promise);await h.tick();h.setSearch(()=>Promise.resolve({...discovery,running:true,notice:'current search'}));h.element(node=>node.type==='form').props.onSubmit({preventDefault(){}});await h.flush();pending.resolve({...discovery,notice:'old state'});await h.flush();assert(h.text.includes('current search'));assert(h.button('在应用内打开官方 AI').props.disabled);
});
for(const [name,selector] of [['Star invitation','[data-star-invite]'],['error toast','.toast']])test('the native surface hides for a '+name+' and resumes after the notice is removed',async t=>{
 const h=await opened(t);await h.mutate([{selector,getBoundingClientRect:()=>({width:300,height:120})}]);assert.equal(h.calls.bounds.at(-1).bounds,null);const reads=h.calls.collect.length;await h.tick();assert.equal(h.calls.collect.length,reads);await h.mutate([]);assert(h.calls.bounds.at(-1).bounds);
});
