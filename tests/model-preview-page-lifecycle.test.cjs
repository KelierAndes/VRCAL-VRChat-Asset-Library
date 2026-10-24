const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const filename=path.join(__dirname,'../src/renderer/model-preview-page.tsx');
const source=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}};
const choice=token=>({token,name:token+'.obj',label:token,format:'obj',size:30});
const scene=(name,reference)=>({primary:{name,files:[],warnings:[]},...(reference?{reference:{name:reference,files:[],warnings:[]}}:{})});
const find=(node,predicate)=>{if(!node||typeof node!=='object')return;if(predicate(node))return node;for(const child of node.children||[]){const result=Array.isArray(child)?child.map(n=>find(n,predicate)).find(Boolean):find(child,predicate);if(result)return result}};
const flatten=node=>!node?'':Array.isArray(node)?node.map(flatten).join(''):typeof node==='object'?(node.children||[]).map(flatten).join(''):String(node);

// Runs the actual page's hooks and event handlers. Native rendering is verified
// separately; this harness controls late IPC/decoder results without a GPU.
function harness(t,{choices=[choice('clothes-a')]}={}){
 const values=[],effects=[],refs=new Map(),timers=new Map(),loads=[],selections=[],decoded=[],presentation={};let cursor=0,dirty=true,tree,disposed=false,timerId=0,cancels=0,decoderHook;
 const api={state:async()=>({title:'Library clothing',theme:'x',choices,warnings:[]}),sources:async()=>[{id:'avatar',title:'Avatar'}],
  loadScene(primary,reference){const pending=deferred();loads.push({primary,reference,...pending});return pending.promise},
  selectReference(id){const pending=deferred();selections.push({id,...pending});if(id===null)pending.resolve({choices:[],warnings:[]});return pending.promise},
  async cancel(){cancels++}};
 class ModelViewer{
  constructor(_host,warning){this.warning=warning}
  cancelPending(){}
  async loadScene(bundle){decoded.push(bundle);if(decoderHook)await decoderHook(bundle,this.warning);this.current=bundle;return {meshes:1,triangles:1,materials:1,animations:0,dimensions:'1',composite:!!bundle.reference}}
  parts(){return this.current?.reference?[{id:'body',name:'Original body mesh',visible:true}]:[]}dispose(){disposed=true}
  setRatio(){}setExposure(){}setWireframe(){}setSolid(){}setPrimaryTransform(value){presentation.transform={...value}}setLayerVisible(){}setPlaying(){}reset(){}setView(){}setPartVisible(){}
 }
 const React={createElement:(type,props,...children)=>({type,props:props||{},children}),
  useState(initial){const at=cursor++;if(!(at in values))values[at]=typeof initial==='function'?initial():initial;return [values[at],next=>{const value=typeof next==='function'?next(values[at]):next;if(!Object.is(value,values[at])){values[at]=value;dirty=true}}]},
  useRef(initial){const at=cursor++;if(!(at in values))values[at]={current:initial};return values[at]},
  useEffect(callback,deps){const at=cursor++,previous=effects[at];if(!previous||!deps||deps.length!==previous.deps?.length||deps.some((value,i)=>!Object.is(value,previous.deps[i])))pendingEffects.push({at,callback,deps})}
 };React.default=React;let pendingEffects=[];
 const module={exports:{}};vm.runInNewContext(source,{module,exports:module.exports,require:name=>name==='react'?React:name==='./i18n'?{t:text=>text}:name==='./model-viewer'?{ModelViewer}:{},window:{modelPreview:api},document:{documentElement:{dataset:{}}},requestAnimationFrame:callback=>callback(),setTimeout:(callback)=>{const id=++timerId;timers.set(id,callback);return id},clearTimeout:id=>timers.delete(id)});
 function render(){if(disposed)return;dirty=false;cursor=0;pendingEffects=[];tree=module.exports.ModelPreviewPage();const attach=node=>{if(!node||typeof node!=='object')return;if(node.props?.ref){let element=refs.get(node.props.ref);if(!element){element={scrollIntoView(){}};refs.set(node.props.ref,element)}node.props.ref.current=element}for(const child of node.children||[])if(Array.isArray(child))child.forEach(attach);else attach(child)};attach(tree);const jobs=pendingEffects;pendingEffects=[];for(const job of jobs){effects[job.at]?.cleanup?.();effects[job.at]={deps:job.deps,cleanup:job.callback()}}}
 async function flush(){for(let i=0;i<8;i++){if(dirty)render();await new Promise(setImmediate)}}
 const element=(predicate,label)=>{const found=find(tree,predicate);assert(found,label||'UI element must exist');return found};
 const button=label=>element(node=>node.type==='button'&&flatten(node)===label,'button '+label);
 const select=label=>element(node=>node.type==='select'&&node.props['aria-label']===label,'select '+label);
 async function click(label){const target=button(label);assert(!target.props.disabled,label+' must be enabled');target.props.onClick();await flush()}
 async function change(label,value){const target=select(label);assert(!target.props.disabled,label+' must be enabled');target.props.onChange({target:{value}});await flush()}
 function unmount(){if(disposed)return;for(const effect of effects)effect?.cleanup?.();timers.clear();disposed=true}
 t.after(unmount);return {api,loads,selections,decoded,presentation,flush,click,change,unmount,decode:hook=>{decoderHook=hook},async adjust(label,value){element(node=>typeof node.type==='function'&&node.props.label===label).props.onChange(value);await flush()},get text(){return flatten(tree)},get tree(){return tree},get cancels(){return cancels},select};
}
async function ready(t,options){const h=harness(t,options);await h.flush();return h}
async function displayed(t){const h=await ready(t);assert.equal(h.loads.length,1);h.loads[0].resolve(scene('successful-clothes.obj'));await h.flush();assert(h.text.includes('successful-clothes.obj'));return h}

test('cancelling reference indexing preserves the displayed scene and ignores a late selection without restarting a load',async t=>{
 const h=await displayed(t);await h.click('添加角色看上身参考');await h.change('角色素材','avatar');assert.equal(h.selections.length,1);assert(h.text.includes('正在查找角色模型'));
 await h.click('取消读取');assert(h.cancels>=1);assert.equal(h.selections.at(-1).id,null);assert.equal(h.loads.length,1);
 h.selections[0].resolve({title:'Late avatar',choices:[choice('stale-avatar')],warnings:['stale warning']});await h.flush();
 assert.equal(h.loads.length,1,'cancellation must not silently restart primary-only or reference loading');assert.equal(h.decoded.length,1);assert.equal(h.select('角色素材').props.value,'');assert(h.text.includes('successful-clothes.obj'));assert(h.text.includes('已停止本次读取'));assert(!h.text.includes('stale warning'));
});

test('explicit retry after cancellation starts one fresh read and discards the old IPC result',async t=>{
 const h=await displayed(t);await h.click('重新读取');assert.equal(h.loads.length,2);await h.click('取消读取');h.loads[1].resolve(scene('cancelled-result.obj'));await h.flush();assert.equal(h.decoded.length,1);
 await h.click('重新读取');assert.equal(h.loads.length,3,'an explicit retry must re-enable loading after cancel');h.loads[2].resolve(scene('retried-result.obj'));await h.flush();assert.equal(h.decoded.length,2);assert(h.text.includes('retried-result.obj'));assert(!h.text.includes('cancelled-result.obj'));
});

test('choosing another primary model after cancellation resumes loading with the selected token',async t=>{
 const h=await ready(t,{choices:[choice('clothes-a'),choice('clothes-b')]});assert.equal(h.loads.length,0);await h.change('查看模型','clothes-a');assert.equal(h.loads.length,1);await h.click('取消读取');
 await h.change('查看模型','clothes-b');assert.equal(h.loads.length,2,'an explicit primary selection must re-enable loading after cancel');assert.equal(h.loads[1].primary,'clothes-b');h.loads[0].resolve(scene('old-a.obj'));h.loads[1].resolve(scene('current-b.obj'));await h.flush();assert.equal(h.decoded.length,1);assert(h.text.includes('current-b.obj'));
});

test('choosing another reference model after cancellation resumes the current composition',async t=>{
 const h=await displayed(t);await h.click('添加角色看上身参考');await h.change('角色素材','avatar');h.selections[0].resolve({title:'Avatar',choices:[choice('avatar-a'),choice('avatar-b')],warnings:[]});await h.flush();
 // The page may redraw the primary while it waits for an explicit reference choice.
 for(const load of h.loads.slice(1))load.resolve(scene('successful-clothes.obj'));await h.flush();await h.change('角色模型','avatar-a');const cancelled=h.loads.at(-1);assert.equal(cancelled.reference,'avatar-a');await h.click('取消读取');
 const before=h.loads.length;await h.change('角色模型','avatar-b');assert.equal(h.loads.length,before+1,'an explicit reference selection must re-enable loading after cancel');assert.equal(h.loads.at(-1).reference,'avatar-b');cancelled.resolve(scene('cancelled-clothes.obj','old-avatar.obj'));h.loads.at(-1).resolve(scene('current-clothes.obj','current-avatar.obj'));await h.flush();assert(h.text.includes('current-avatar.obj'));assert(!h.text.includes('old-avatar.obj'));
});

test('unmount cancels pending work and a late IPC reply never reaches the disposed viewer',async t=>{
 const h=await ready(t);assert.equal(h.loads.length,1);h.unmount();h.loads[0].resolve(scene('too-late.obj'));await h.flush();assert(h.cancels>=1);assert.equal(h.decoded.length,0);
});

test('reference indexing can be cancelled before a multi-model primary is selected',async t=>{
 const h=await ready(t,{choices:[choice('clothes-a'),choice('clothes-b')]});await h.click('添加角色看上身参考');await h.change('角色素材','avatar');assert(h.text.includes('正在查找角色模型'));assert(h.select('角色素材').props.disabled);
 await h.click('取消读取');assert.equal(h.selections.at(-1).id,null);assert.equal(h.loads.length,0);assert.equal(h.select('角色素材').props.disabled,false);
});

test('a successful scene retains decoder warnings alongside source warnings',async t=>{
 const h=await displayed(t);h.decode((_bundle,warning)=>warning('部分贴图无法读取，画面可能与 Unity 不同。'));await h.click('重新读取');const bundle=scene('decoded-with-warning.obj');bundle.primary.warnings=['Source format is approximate'];h.loads.at(-1).resolve(bundle);await h.flush();
 assert(h.text.includes('Source format is approximate'));assert(h.text.includes('部分贴图无法读取'),'the success handler must not overwrite warnings from the viewer decoder');
});

test('cancelled reference replacement preserves the committed clothing transform and visible part controls',async t=>{
 const h=await displayed(t);await h.click('添加角色看上身参考');await h.change('角色素材','avatar');h.selections[0].resolve({title:'Original avatar',choices:[choice('original-avatar')],warnings:[]});await h.flush();h.loads.at(-1).resolve(scene('clothes.obj','original-avatar.obj'));await h.flush();
 await h.adjust('衣服缩放倍数',2);assert.equal(h.presentation.transform.scale,2);assert(h.text.includes('Original body mesh'));
 await h.change('角色素材','next-avatar');assert.equal(h.presentation.transform.scale,2,'selecting a new source must not reset the scene before it succeeds');assert(h.text.includes('Original body mesh'),'the old scene parts remain available while replacement indexing is pending');
 await h.click('取消读取');h.selections.find(selection=>selection.id==='next-avatar').resolve({title:'Late replacement',choices:[choice('late-reference')],warnings:[]});await h.flush();assert.equal(h.presentation.transform.scale,2);assert(h.text.includes('Original body mesh'));assert(h.text.includes('original-avatar.obj'));
});

test('a reference with several models waits for an explicit model choice before replacing the scene',async t=>{
 const h=await displayed(t);await h.click('添加角色看上身参考');await h.change('角色素材','avatar');h.selections[0].resolve({title:'Multi-model avatar',choices:[choice('avatar-body'),choice('avatar-outfit')],warnings:[]});await h.flush();
 assert.equal(h.loads.length,1,'finishing a multi-model index must not replace the committed scene with a primary-only load');assert(h.text.includes('successful-clothes.obj'));assert.equal(h.select('角色模型').props.value,'');
 await h.change('角色模型','avatar-body');assert.equal(h.loads.length,2);assert.equal(h.loads[1].reference,'avatar-body');
});
