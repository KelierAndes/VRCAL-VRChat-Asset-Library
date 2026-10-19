const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),cheerio=require('cheerio');
function loadSource(relative,expose=[]){
  const target=path.resolve(__dirname,'../src',relative),previous=Object.fromEntries(['.ts','.tsx'].map(ext=>[ext,Module._extensions[ext]]));
  for(const ext of ['.ts','.tsx'])Module._extensions[ext]=(mod,file)=>{
    // Expose the actual private view components only in this test module. No
    // dependencies or component behavior are replaced.
    const extra=file===target&&expose.length?'\nexport {'+expose.join(',')+'};':'';
    mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8')+extra,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,file);
  };
  try{return require(target);}finally{for(const [ext,original] of Object.entries(previous))if(original)Module._extensions[ext]=original;else delete Module._extensions[ext];}
}
const locale=loadSource('renderer/i18n.tsx');
const render=(Component,props)=>cheerio.load(renderToStaticMarkup(React.createElement(Component,props)));
const noCall=()=>{throw new Error('Rendering must not invoke an API action');};
const props={api:new Proxy({},{get:()=>noCall}),run:noCall,enabled:true};

test('candidate review translates explanations and tooltips while preserving the title and creator',()=>{
  const {CandidateChoice}=loadSource('renderer/review.tsx',['CandidateChoice']);
  const candidate={url:'https://booth.pm/ja/items/1234567',title:'全部素材',author:'我的作者',reason:'名称存在部分对应；型号、版本说明或作者仍需核对'};
  const before=structuredClone(candidate);
  for(const [language,reason] of [['en','The names partially match; check the model, version notes and creator.'],['ja','名前は一部一致しています。モデル、バージョンの説明、作者を確認してください。']]){
    locale.setLanguage(language);const $=render(CandidateChoice,{...props,asset:{id:'fixture'},candidate});
    assert.equal($('.review-candidate-reason').text(),reason);
    assert.equal($('.review-candidate-reason').attr('title'),reason);
    assert.equal($('h4').text(),'全部素材');assert.equal($('.review-candidate-author').text(),'我的作者');
    assert.deepEqual(candidate,before);
  }
  locale.setLanguage('zh-CN');
});

test('asset evidence renders localized application signals and retains embedded local package names',()=>{
  const {AssetEvidence}=loadSource('renderer/evidence.tsx');
  const asset={online:{status:'matched',url:'https://booth.pm/ja/items/1234567',matchEvidence:{method:'child-package',signals:['文件名商品编号与 BOOTH 1234567 一致','子包线索：全部素材 {page}.zip'],ruleVersion:'1.9.0',recordedAt:'2026-01-01'}},manual:{sourceUrl:'https://booth.pm/ja/items/1234567'},searchEvidence:[{field:'description',text:'名称存在部分对应；型号、版本说明或作者仍需核对'}]};
  for(const [language,name] of [['en','Child package clue: 全部素材 {page}.zip'],['ja','内部パッケージの手がかり：全部素材 {page}.zip']]){
    locale.setLanguage(language);const $=render(AssetEvidence,{asset});
    assert($('.match-signal').toArray().some(element=>$(element).text()===name));
    assert(!$('.match-signal').text().includes('文件名商品编号'));
    assert($('body').text().includes(asset.searchEvidence[0].text),'Raw description evidence must remain unchanged');
  }
  locale.setLanguage('zh-CN');
});

test('network views localize declared transfer wrappers and preserve filenames, URLs and route identifiers',()=>{
  const {ActiveTransfer,TransferHistoryEntry,NetworkPanel,ProxyState}=loadSource('renderer/network.tsx',['ActiveTransfer','TransferHistoryEntry']);
  const url='https://images.booth.pm/private/%E5%85%A8%E9%83%A8%E7%B4%A0%E6%9D%90.png';
  const transfer={id:'raw-id',kind:'cover',phase:'downloading',label:'封面图片 · 全部素材 {page}.zip',url,receivedBytes:1,totalBytes:2,downloadBps:1,uploadBps:0,uploadBytes:0,elapsedMs:1000};
  const entry={...transfer,finishedAt:'2026-01-01',status:'complete',fromCache:false,durationMs:1000};
  for(const [language,label,route] of [['en','Cover image · 全部素材 {page}.zip','The current network route could not be identified.'],['ja','表紙画像 · 全部素材 {page}.zip','現在のネットワーク経路を識別できません。']]){
    locale.setLanguage(language);
    let $=render(ActiveTransfer,{...props,transfer});assert.equal($('.active-transfer-name').text(),label);assert.equal($('.active-transfer-name').attr('title'),label);assert.equal($('.network-url').text(),url);assert($('[role=progressbar]').attr('aria-label').includes(label));assert.equal($('article').attr('data-transfer-id'),'raw-id');
    $=render(TransferHistoryEntry,{...props,entry});assert.equal($('.transfer-entry-content strong').text(),label);assert.equal($('.transfer-entry').attr('title'),url);
    $=render(NetworkPanel,{...props,queue:{running:false,paused:false,pending:0,completed:1,current:'全部素材 {page}.zip',recentTransfers:[entry]}});assert($('.latest-download-name').text().includes(label));assert.equal($('.latest-download-name').attr('title'),label+'\n'+url);
    $=render(ProxyState,{...props,proxy:{mode:'unknown',status:'unchecked',route:'无法识别当前网络路线'}});assert($('body').text().includes(route));
    for(const routeId of ['DIRECT','PROXY 127.0.0.1:7890 ; DIRECT']){$=render(ProxyState,{...props,proxy:{mode:'direct',status:'unchecked',route:routeId}});assert($('body').text().includes(routeId));}
    $=render(ProxyState,{...props,proxy:{mode:'proxy',status:'unchecked',route:'PROXY private:7890',endpoint:'private:7890'}});assert($('body').text().includes('private:7890'));
  }
  locale.setLanguage('zh-CN');
});
