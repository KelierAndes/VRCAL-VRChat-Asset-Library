const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),{load}=require('cheerio');
const {boothDownloadCaptureScript,boothDownloadableIds,boothDownloadLibraryPage}=require('../dist/main/main/booth-download-source');
const own='<nav><img src="https://booth.pximg.net/c/48x48/users/123/icon_image/fixture.jpg"></nav>';
const card=(item=456,file=987)=>`<div class="fixture-card"><div class="flex gap-8 border-b border-border300 pb-16"><a href="https://booth.pm/zh-cn/items/${item}"><img class="l-library-item-thumbnail"></a></div><div class="mt-16"><div class="js-download-button" data-href="https://booth.pm/downloadables/${file}" data-is-external="false"><button id="file-${file}">Download</button></div></div></div>`;
function page(html=own+'<main>'+card()+'</main>'){
 const $=load(html),cache=new WeakMap(),listeners=new Map();let now=100000;
 class Element{constructor(node){this.node=node}getAttribute(name){return $(this.node).attr(name)??null}get parentElement(){return wrap($(this.node).parent()[0])}querySelectorAll(selector){return $(this.node).find(selector).toArray().map(wrap)}closest(selector){return wrap($(this.node).closest(selector)[0])}getClientRects(){return $(this.node).closest('[hidden]').length?[]:[{}]}}
 const wrap=node=>{if(!node)return null;if(!cache.has(node))cache.set(node,new Element(node));return cache.get(node)};
 const document={querySelectorAll:selector=>$(selector).toArray().map(wrap),addEventListener:(name,callback)=>listeners.set(name,callback)};
 const context=vm.createContext({document,location:new URL('https://accounts.booth.pm/library'),URL,Element,getComputedStyle:()=>({visibility:'visible',display:'block'}),Date:{now:()=>now},addEventListener:(name,callback)=>listeners.set(name,callback)});
 const run=(action,ids=[])=>vm.runInContext(boothDownloadCaptureScript(action,ids),context);
 return {$,context,run,click:(selector='#file-987',trusted=true)=>listeners.get('click')?.({target:wrap($(selector)[0]),isTrusted:trusted,button:0}),advance:ms=>{now+=ms},dispatch:name=>listeners.get(name)?.()};
}
test('library download chain maps only the exact downloadable inside one verified product card',()=>{
 const p=page(own+'<main><aside><a href="https://booth.pm/items/999">Recommendation</a></aside>'+card(456,987)+card(777,888)+'</main>');
 assert.equal(p.run('consume',['987']),'456');assert.equal(p.run('consume',['888']),'777');assert.equal(p.run('consume',['999']),undefined);
 for(const html of [own+'<main>'+card().replace('data-is-external="false"','data-is-external="true"')+'</main>',own+'<main>'+card()+card(777,987)+'</main>',own+'<main>'+card().replace('</button>','</button><a href="https://booth.pm/items/888">Other product</a>')+'</main>','<main>'+card()+'</main>'])assert.equal(page(html).run('consume',['987']),undefined);
 assert.equal(p.run('consume',['987','888']),undefined);
});
test('trusted library click supports a signed transfer without an ID and can only be consumed once',()=>{
 const p=page();p.run('install');p.click();assert.equal(p.run('consume',[]),'456');assert.equal(p.run('consume',[]),undefined);
 const synthetic=page();synthetic.run('install');synthetic.click('#file-987',false);assert.equal(synthetic.run('consume',[]),undefined);
});
test('library download click rejects concurrent clicks, conflicting chains, account changes and stale evidence',()=>{
 const concurrent=page(own+'<main>'+card(456,987)+card(777,888)+'</main>');concurrent.run('install');concurrent.click();concurrent.click('#file-888');assert.equal(concurrent.run('consume',[]),undefined);assert.equal(concurrent.run('consume',['987']),undefined);assert.equal(concurrent.run('consume',['888']),undefined);
 const conflict=page();conflict.run('install');conflict.click();assert.equal(conflict.run('consume',['888']),undefined);
 const stale=page();stale.run('install');stale.click();stale.advance(15001);assert.equal(stale.run('consume',[]),undefined);
 const changed=page();changed.run('install');changed.click();changed.$('nav img').attr('src','https://booth.pximg.net/c/48x48/users/999/icon_image/fixture.jpg');assert.equal(changed.run('consume',[]),undefined);
 const navigation=page();navigation.run('install');navigation.click();navigation.context.location=new URL('https://accounts.booth.pm/library?page=2');assert.equal(navigation.run('consume',[]),undefined);
 const hidden=page();hidden.run('install');hidden.click();hidden.dispatch('pagehide');assert.equal(hidden.run('consume',[]),undefined);
});
test('library source extraction keeps order IDs, recommended products and signed addresses outside product evidence',()=>{
 assert.equal(boothDownloadLibraryPage('https://accounts.booth.pm/library?page=2'),true);
 for(const url of ['https://accounts.booth.pm/orders/456','https://accounts.booth.pm/library/gifts','https://accounts.booth.pm.evil.net/library','http://accounts.booth.pm/library'])assert.equal(boothDownloadLibraryPage(url),false);
 const signed='https://s.booth.pm/private/file?token=PRIVATE_SIGNED_TOKEN';assert.deepEqual(boothDownloadableIds(['https://booth.pm/downloadables/987',signed]),['987']);
 assert.deepEqual(boothDownloadableIds([signed,'https://booth.pm.evil.net/downloadables/456','https://booth.pm/downloadables/987?secret=PRIVATE','https://booth.pm/items/456','https://accounts.booth.pm/orders/456']),[]);
 const script=boothDownloadCaptureScript('consume',boothDownloadableIds([signed]));assert.equal(script.includes('PRIVATE_SIGNED_TOKEN'),false);assert.equal(script.includes('outerHTML'),false);assert.equal(script.includes('innerHTML'),false);
});
