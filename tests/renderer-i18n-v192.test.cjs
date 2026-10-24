const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const Module = require('node:module');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
function loadSource(relative) {
  const filename = path.resolve(__dirname, '../src', relative);
  assert(fs.existsSync(filename), `Missing source module: ${relative}`);
  const previous = Object.fromEntries(['.ts', '.tsx'].map(ext => [ext, Module._extensions[ext]]));
  for (const ext of ['.ts', '.tsx']) Module._extensions[ext] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions:{target:ts.ScriptTarget.ES2022, module:ts.ModuleKind.CommonJS, jsx:ts.JsxEmit.ReactJSX}}).outputText, file);
  try { return require(filename); } finally { for (const [ext, original] of Object.entries(previous)) { if (original) Module._extensions[ext] = original; else delete Module._extensions[ext]; } }
}
const locale = loadSource('renderer/i18n.tsx');
test('renderer locale changes notify subscribers and interpolate counts offline', () => {
  locale.setLanguage('zh-CN');
  const events = [];
  const unsubscribe = locale.subscribeLanguage(() => events.push(locale.getLanguage()));
  locale.setLanguage('en');
  assert.equal(locale.t('全部素材'), 'All assets');
  assert.equal(locale.t('第 {page} / {pages} 页', {page:2,pages:8}), 'Page 2 / 8');
  locale.setLanguage('ja');
  assert.equal(locale.t('全部素材'), 'すべての素材');
  assert.equal(locale.t('我的用户名称'), '我的用户名称');
  assert.deepEqual(events, ['en','ja']);
  unsubscribe();
  locale.setLanguage('zh-CN');
  assert.equal(events.length, 2);
});
test('UI translations preserve tokens; explicit deferred new copy falls back to Chinese', () => {
  const {UI_MESSAGES} = loadSource('shared/messages-ui.ts');
  for (const [source, translations] of Object.entries(UI_MESSAGES)) {
    assert.equal(translations.length,2,source);
    for (const translation of translations) {
      assert.equal(typeof translation,'string',source);
      assert(translation.trim(),source);
      assert.deepEqual([...translation.matchAll(/\{(\w+)\}/g)].map(match=>match[1]).sort(), [...source.matchAll(/\{(\w+)\}/g)].map(match=>match[1]).sort(), source);
    }
  }
  const directory = path.resolve(__dirname,'../src/renderer');
  for (const file of fs.readdirSync(directory).filter(name=>name.endsWith('.tsx'))) {
    const source = ts.createSourceFile(file,fs.readFileSync(path.join(directory,file),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    function visit(node) {
      if (ts.isCallExpression(node) && node.expression.getText(source)==='t' && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) assert(UI_MESSAGES[node.arguments[0].text] || (file==='baidu-download-panel.tsx' && ['暂停'].includes(node.arguments[0].text)),`${file}: missing ${node.arguments[0].text}`); // 1.3.0 translation deferred by request, 2026-10-24.
      // User explicitly postponed translation of the new workbench (2026-10-24).
      // Only the exact reviewed copy is exempt; existing and future UI stays covered.
      if (ts.isJsxText(node) && /[\u3400-\u9fff]/.test(node.text)) assert((require('./fixtures/deferred-workbench-copy.json')[file]||[]).includes(node.text.trim()),`${file}: unlocalized JSX text ${node.text}`);
      ts.forEachChild(node,visit);
    }
    visit(source);
  }
});
test('gallery localizes display enums while preserving user titles, authors, tags and avatar names', () => {
  const {AssetGallery} = loadSource('renderer/gallery.tsx');
  const asset = {id:'asset',path:'D:/原始路径/全部素材.unitypackage',name:'文件名',kind:'unitypackage',group:'我的分组',size:20,mtimeMs:1,missing:false,localCategory:'服装',localAvatars:['模型'],hintUrls:[],manual:{title:'全部素材',tags:['标签'],notes:'用户备注'},online:{status:'matched',author:'作者'},createdAt:'2026-01-01',updatedAt:'2026-01-01'};
  const before = structuredClone(asset);
  const noop = ()=>{};
  const props = {assets:[asset],selected:new Set(['asset']),focusId:'asset',preferences:{},loading:false,cover:()=>null,onFocus:noop,onClick:noop,onKey:noop,onContext:noop,onHover:noop,onLeave:noop,onCheck:noop,onFavorite:noop,onMore:noop};
  for (const [language, category] of [['en','Clothing'],['ja','衣装'],['zh-CN','服装']]) {
    locale.setLanguage(language);
    const html = renderToStaticMarkup(React.createElement(AssetGallery,props));
    assert(html.includes(`class="card-category">${category}</span>`),html);
    assert(html.includes('<h3 title="全部素材">全部素材</h3>'),html);
    assert(html.includes('class="card-author">作者</div>'),html);
    assert(html.includes('<span>标签</span>'),html);
    assert(html.includes('title="模型">模型</div>'),html);
    assert.deepEqual(asset,before);
    assert.deepEqual([...props.selected],['asset']);
  }
});
test('all four theme choices and language selectors render in each locale', () => {
  const {ThemeSettings} = loadSource('renderer/appearance.tsx');
  for (const language of ['zh-CN','ja','en']) {
    locale.setLanguage(language);
    const html = renderToStaticMarkup(React.createElement(ThemeSettings,{value:'x-light',onChange:async()=>{}}));
    assert.equal((html.match(/class="theme-option"/g)||[]).length,4);
    assert(html.includes('theme-preview-x-light'));
    assert(html.includes(locale.t('X 浅色')));
    const selector=renderToStaticMarkup(React.createElement(locale.LanguageSwitcher,{compact:true,onChange:async()=>{}}));
    assert(selector.includes('data-language-selector="header"'));
    for (const name of ['中文','日本語','English']) assert(selector.includes(name));
  }
  locale.setLanguage('zh-CN');
});

test('translated display text never changes CSS classes, stored values or data identifiers', () => {
  const directory=path.resolve(__dirname,'../src/renderer');
  for(const file of fs.readdirSync(directory).filter(name=>name.endsWith('.tsx'))){
    const source=ts.createSourceFile(file,fs.readFileSync(path.join(directory,file),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    function visit(node){if(ts.isJsxAttribute(node)&&(['className','key','value'].includes(node.name.text)||node.name.text.startsWith('data-'))&&node.initializer)assert(!/\bt\(/.test(node.initializer.getText(source)),`${file}: translated structural attribute ${node.getText(source)}`);ts.forEachChild(node,visit)}visit(source);
  }
});
test('update download cancellation remains available while the download promise is pending', async () => {
  const {UpdateSettings}=loadSource('renderer/update.tsx');
  const state={status:'downloading',currentVersion:'1.9.1',latestVersion:'1.10.0',receivedBytes:512,totalBytes:1024,canInstall:true};
  const original={useState:React.useState,useEffect:React.useEffect,useRef:React.useRef,useSyncExternalStore:React.useSyncExternalStore};
  let index=0,cancelled=0;
  React.useState=initial=>[[state,true,'',false][index++]??initial,()=>{}];
  React.useEffect=()=>{};React.useRef=initial=>({current:initial});React.useSyncExternalStore=(_subscribe,get)=>get();
  try{
    const tree=UpdateSettings({api:{cancelUpdate:async()=>{cancelled++},updateState:async()=>state},run:async fn=>{await fn();return true}});
    function find(node){if(!node||typeof node!=='object')return undefined;if(node.props?.['data-update-action']==='cancel')return node;for(const child of React.Children.toArray(node.props?.children)){const match=find(child);if(match)return match}}
    const cancel=find(tree);assert(cancel,'Cancel control should be present');assert.equal(cancel.props.disabled,false,'A pending download must remain cancellable');cancel.props.onClick();await new Promise(resolve=>setImmediate(resolve));assert.equal(cancelled,1);
  }finally{Object.assign(React,original)}
});
test('every updater status and validation message has offline English and Japanese translations',()=>{
  const {UI_MESSAGES}=loadSource('shared/messages-ui.ts');
  const filename=path.resolve(__dirname,'../src/main/updater.ts'),source=ts.createSourceFile(filename,fs.readFileSync(filename,'utf8'),ts.ScriptTarget.Latest,true);let count=0;
  function visit(node){if(ts.isStringLiteral(node)&&/[\u3400-\u9fff]/.test(node.text)){count++;assert(UI_MESSAGES[node.text],`Updater message is untranslated: ${node.text}`);for(const language of ['en','ja']){locale.setLanguage(language);assert.notEqual(locale.t(node.text),node.text,node.text)}}ts.forEachChild(node,visit)}visit(source);assert(count>=46);
  for(const language of ['en','ja']){locale.setLanguage(language);assert(locale.t('当前版本：{version}',{version:'1.10.0'}).includes('1.10.0'));assert.equal(locale.t('D:/原始路径/更新1.10.0-x64.exe'),'D:/原始路径/更新1.10.0-x64.exe')};locale.setLanguage('zh-CN');
});
