const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),Module=require('node:module');
const originalLoad=Module._load;Module._load=function(request,...args){return request==='electron'?{safeStorage:{isEncryptionAvailable:()=>true}}:originalLoad.call(this,request,...args)};
const {ProductPreview}=require('../dist/main/main/preview'),{BoothWorkspace}=require('../dist/main/main/booth-workspace');Module._load=originalLoad;
function chrome(){const events=[],titles=[];return {events,titles,window:{setTitle:title=>titles.push(title),setBackgroundColor:()=>{},webContents:{isDestroyed:()=>false,send:(channel,state)=>events.push({channel,state})}},view:{webContents:{isDestroyed:()=>false,getURL:()=> 'https://booth.pm/zh-cn/items/6986518',navigationHistory:{canGoBack:()=>false,canGoForward:()=>false}}}}}
test('trusted helper snapshots switch language repeatedly without rewriting product names or search queries',t=>{
 const root=fs.mkdtempSync(path.join(__dirname,'.fixtures-native-languages-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));let language='en';
 const shared={parent:()=>null,getTheme:()=> 'x-light',getLanguage:()=>language,dataDir:root,roots:()=>[],canNetwork:()=>true};
 const preview=new ProductPreview({...shared,validate:()=>({title:'关闭',canConfirm:true}),accept:async()=>{}}),booth=new BoothWorkspace({...shared,getDownloadDir:()=>undefined,validateAsset:()=>({title:'关闭'}),applyProduct:async()=>{},onChanged:()=>{},onDownloaded:async()=>({})});
 const entries=[{owner:preview,key:'active',status:'正在打开公开商品页面…',channel:'preview',sourceUrl:'https://booth.pm/zh-cn/items/6986518',id:'asset',loaded:true},{owner:booth,key:'entry',status:'正在打开 BOOTH…',channel:'booth',assetId:'asset',tab:'favorites',query:'关闭 my search'}];
 for(const fixture of entries){const ui=chrome(),entry={...ui,...fixture,title:'关闭',loading:false,busy:false,closed:false};fixture.owner[fixture.key]=entry;
  for(const selected of ['en','ja','zh-CN','invalid']){language=selected;fixture.owner.refreshTheme();const state=ui.events.at(-1).state;assert.equal(state.language,selected==='invalid'?'zh-CN':selected);assert.equal(state.title,'关闭');assert.equal(state.theme,'x-light');assert.equal(state.status,selected==='en'||selected==='ja'?state.messages[fixture.status]:fixture.status);assert(state.messages['关闭']);if(fixture.query)assert.equal(state.query,fixture.query)}
 }
});
for(const [file,name,prefix] of [['preview-preload.js','productPreview','preview'],['booth-workspace-preload.js','boothWorkspace','booth']])test(name+' preload allowlists locale and x-light without local-module access',()=>{
 for(const raw of ['en','ja','zh-CN','bad','en;alert(1)',undefined]){let api;vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../dist/main/main',file),'utf8'),{exports:{},process:{argv:['--vrc-'+prefix+'-channel=vrc-'+prefix+':11111111-1111-4111-8111-111111111111','--vrc-theme=x-light',...(raw?['--vrc-language='+raw]:[])]},require:name=>{assert.equal(name,'electron');return {contextBridge:{exposeInMainWorld:(_name,value)=>{api=value}},ipcRenderer:{}}}});assert.equal(api.initialTheme,'x-light');assert.equal(api.initialLanguage,['en','ja','zh-CN'].includes(raw)?raw:'zh-CN')}
});

function localPage(file,apiName){
 const cheerio=require('cheerio'),html=fs.readFileSync(path.join(__dirname,'../assets',file),'utf8'),$=cheerio.load(html),wrappers=new Map();let receive;
 const wrap=element=>{if(!element)return;let item=wrappers.get(element);if(item)return item;const node=$(element);item={dataset:element.attribs?new Proxy({},{get:(_target,key)=>node.attr('data-'+String(key).replace(/[A-Z]/g,c=>'-'+c.toLowerCase()))}):{},classList:{toggle:()=>{}},addEventListener:()=>{},setAttribute:(key,value)=>node.attr(key,value),getAttribute:key=>node.attr(key),removeAttribute:key=>node.removeAttr(key),get textContent(){return node.text()},set textContent(value){node.text(value)},get value(){return node.val()},set value(value){node.val(value)},get tagName(){return element.tagName.toUpperCase()},getBoundingClientRect:()=>({height:150})};wrappers.set(element,item);return item};
 const document={documentElement:{dataset:{},lang:'zh-CN'},body:wrap($('body')[0]),getElementById:id=>wrap($('#'+id)[0]),querySelectorAll:selector=>$(selector).toArray().map(wrap),addEventListener:()=>{}};document.activeElement=document.body;
 const api={initialTheme:'x-light',initialLanguage:'en',onState:callback=>{receive=callback},state:()=>Promise.resolve(undefined)},context={document,requestAnimationFrame:()=>{},ResizeObserver:class {observe(){}},[apiName]:api};context.window=context;vm.createContext(context);
 for(const element of $('script').toArray()){const src=$(element).attr('src');vm.runInContext(src?fs.readFileSync(path.join(__dirname,'../assets',src),'utf8'):$(element).text(),context)}
 return {$,document,receive};
}
for(const [file,apiName] of [['preview.html','productPreview'],['booth-workspace.html','boothWorkspace']])test(file+' renders real local chrome in all languages while preserving user text and long counts',()=>{
 const {translate}=require('../dist/main/shared/i18n'),{NATIVE_MESSAGES}=require('../dist/main/shared/messages-native'),page=localPage(file,apiName),user='关闭 my product 日本語',url='https://booth.pm/ja/items/123';
 for(const language of ['en','ja','zh-CN','en']){
  const messages=Object.fromEntries(Object.keys(NATIVE_MESSAGES).map(source=>[source,translate(source,language)]));page.receive({title:user,url,status:'external status stays unchanged',language,messages,theme:'x-light',query:user,tab:'favorites',activeDownloads:12345,confirmed:true,applied:true,online:false,busy:false});
  assert.equal(page.document.documentElement.lang,language);assert.equal(page.$('#close').text(),translate('关闭',language));assert.equal(page.$('#title').text(),user);assert.equal(page.$('#url').text(),url);assert.equal(page.$('#status').text(),'external status stays unchanged');
  if(file==='preview.html')assert.equal(page.$('#confirm').text(),translate('已确认',language));
  if(file==='booth-workspace.html'){assert.equal(page.$('#query').val(),user);assert(page.$('#session').text().includes(translate('{count} 个下载中',language,{count:12345})));assert.equal(page.$('#query').attr('placeholder'),translate('搜索 BOOTH · 商品名称、编号或商品网址',language))}
 }
});
test('every explicitly marked local label and attribute has an offline English and Japanese translation',()=>{
 const cheerio=require('cheerio'),{NATIVE_MESSAGES}=require('../dist/main/shared/messages-native');
 for(const file of ['preview.html','booth-workspace.html']){const $=cheerio.load(fs.readFileSync(path.join(__dirname,'../assets',file),'utf8'));for(const element of $('*').toArray())for(const [attribute,source] of Object.entries(element.attribs))if(attribute.startsWith('data-i18n')){assert(NATIVE_MESSAGES[source],source);assert.equal(NATIVE_MESSAGES[source].length,2);assert(NATIVE_MESSAGES[source].every(value=>typeof value==='string'&&value.length>0))}}
});
test('preview HTTP errors retain their dynamic status through page completion and language changes',()=>{
 let language='en';const ui=chrome(),listeners=new Map(),preview=new ProductPreview({parent:()=>null,getLanguage:()=>language,validate:()=>({title:'product',canConfirm:true}),accept:async()=>{}}),entry={...ui,channel:'preview',sourceUrl:'https://booth.pm/zh-cn/items/6986518',title:'product',id:'asset',loading:true,closed:false};preview.active=entry;ui.view.webContents.on=(name,callback)=>listeners.set(name,callback);ui.view.webContents.setWindowOpenHandler=()=>{};preview.protectNavigation(entry);listeners.get('did-navigate')({},entry.sourceUrl,503);listeners.get('did-finish-load')();assert.equal(ui.events.at(-1).state.status,'Product page temporarily unavailable (503).');language='ja';preview.refreshTheme();assert.equal(ui.events.at(-1).state.status,'商品ページを一時的に読み込めません（503）。');
});
