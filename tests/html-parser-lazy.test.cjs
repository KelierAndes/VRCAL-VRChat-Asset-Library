const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{spawnSync}=require('node:child_process');

// A fresh process prevents another test's parsing from hiding eager imports.
function parseInFreshProcess(moduleName,operation){
 const source=String.raw`
  const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
  const dependencies=()=>[...new Set(Object.keys(require.cache).map(file=>file.match(/[\\/]node_modules[\\/](cheerio|undici)[\\/]/)?.[1]).filter(Boolean))].sort();
  let nativeImports=0;
  // A Node unit probe needs no native runtime; the npm entrypoint can auto-install it.
  const ordinaryLoad=Module._load;
  Module._load=function(request,parent,isMain){
   if(request==='electron'){nativeImports++;return {};}
   return ordinaryLoad.call(this,request,parent,isMain);
  };
  let api;
  try{api=require(process.argv[1]);}finally{Module._load=ordinaryLoad;}
  const fixtures=process.argv[2],operation=process.argv[3];
  if(operation==='baidu-workspace'){
   if(typeof api.BaiduWorkspace!=='function')throw new Error('BaiduWorkspace must remain importable without opening a browser');
   api=require(path.join(path.dirname(process.argv[1]),'baidu-page.js'));
  }
  if(operation.startsWith('baidu'))api.baiduBrowserUrl('https://pan.baidu.com/disk/main');
  else if(operation==='discovery')api.localDiscoveryPlan({description:'哥特礼裙',platforms:['booth']});
  else api.publicHttpsUrl('https://booth.pm/ja/items/8492723');
  const before=dependencies(),fixture=name=>fs.readFileSync(path.join(fixtures,name+'.html'),'utf8');
  let result;
  if(operation.startsWith('baidu')){
   // Sanitized modern-table contract, matching the existing Baidu parser regressions.
   const html='<div class="wp-s-pan-table"><div class="wp-s-pan-table__header"><table><tr><th></th><th>文件名</th><th>大小</th><th>类型</th><th>修改时间</th></tr></table></div><div class="wp-s-pan-table__body"><table><tbody><tr class="wp-s-pan-table__body-row" data-id="123456789"><td></td><td><div class="wp-s-pan-list__file-name-content" data-title="衣装 日本語😀.zip">衣装&nbsp;日本語😀.zip</div></td><td>12.34 MB</td><td>压缩包</td><td>2026-10-21 01:00</td></tr></tbody></table></div></div>';
   result=api.parseBaiduVisiblePage({url:'https://pan.baidu.com/disk/main#/index?category=all&path=%2F%E7%B4%A0%E6%9D%90',html,accountKey:'baidu:'+'a'.repeat(64),capturedAt:'2026-10-21T00:00:00.000Z'});
  }else if(operation==='product'){
   const p=api.parseProduct(fixture('cherimel-live'),'https://booth.pm/ja/items/8492723');
   result={title:p.title,author:p.author,url:p.url,category:p.category,avatars:p.avatars};
  }else{
   const html=fixture('rho-search-live'),url='https://booth.pm/ja/search/BCP-17%20Rho';
   result=operation==='search'?api.parseSearch(html,url):api.parseBoothDiscovery(html,url);
  }
  const electronModules=Object.keys(require.cache).filter(file=>/[\\/]node_modules[\\/]electron[\\/]/.test(file));
  console.log(JSON.stringify({before,after:dependencies(),result,nativeImports,electronModules}));
 `;
 const child=spawnSync(process.execPath,['-e',source,path.resolve(__dirname,'../dist/main/main',moduleName+'.js'),path.join(__dirname,'fixtures'),operation],{encoding:'utf8',windowsHide:true,timeout:15000});
 assert.ifError(child.error);assert.equal(child.status,0,child.stderr||child.stdout);
 return JSON.parse(child.stdout);
}

const searchResult=[{url:'https://booth.pm/ja/items/8399277',title:'BCP-17 ✢ Rho',author:'Binary',authorAliases:[]}];
const baiduResult={accountKey:'baidu:'+'a'.repeat(64),directoryPath:'/素材',items:[{name:'衣装 日本語😀.zip',path:'/素材/衣装 日本語😀.zip',directory:false,id:'123456789'}],capturedAt:'2026-10-21T00:00:00.000Z',complete:false,source:'web-visible',warnings:['visible-partial']};
for(const [moduleName,operation,expected] of [
 ['online','product',{title:'🍒 CheriMeL 🍒',author:'LOVACE',url:'https://booth.pm/ja/items/8492723',category:'未分类',avatars:['Airi','Shinano','Mayo','Milltina','Lumina','Kumaly']}],
 ['online','search',searchResult],
 ['discovery-parser','discovery',searchResult],
 ['baidu-page','baidu-page',baiduResult],
 ['baidu-workspace','baidu-workspace',baiduResult],
])test(`${operation} defers HTML dependencies until parsing and preserves fixture output`,()=>{
 const {before,after,result,nativeImports,electronModules}=parseInFreshProcess(moduleName,operation);
 assert.deepEqual(electronModules,[],'unit probes must not load the Electron npm entrypoint or binary installer');
 if(operation==='baidu-workspace')assert(nativeImports>0,'the workspace probe must exercise the stubbed native Electron boundary');
 assert.deepEqual(before,[],'business imports and non-HTML operations must not load Cheerio or Undici');
 assert.deepEqual(after,['cheerio','undici'],'the first parse must use the existing complete Cheerio parser');
 assert.deepEqual(result,expected);
});
