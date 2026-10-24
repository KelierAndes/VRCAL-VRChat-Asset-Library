const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),{load}=require('cheerio');
const {inboxCaptureScript}=require('../dist/main/main/link-inbox-dom');
function capture(html,platform='booth',mode='foreground',identityOnly=false){
 const $=load(html),cache=new WeakMap();class Element{constructor(node){this.node=node}getAttribute(name){return $(this.node).attr(name)??null}get innerText(){return $(this.node).text()}get parentElement(){return wrap($(this.node).parent()[0])}querySelector(s){return wrap($(this.node).find(s)[0])}querySelectorAll(s){return $(this.node).find(s).toArray().map(wrap)}closest(s){return wrap($(this.node).closest(s)[0])}getClientRects(){return $(this.node).closest('[hidden]').length?[]:[{}]}}
 const wrap=node=>{if(!node)return null;if(!cache.has(node))cache.set(node,new Element(node));return cache.get(node)};
 const document={querySelectorAll:s=>$(s).toArray().map(wrap)};return JSON.parse(JSON.stringify(vm.runInNewContext(inboxCaptureScript(platform,mode,identityOnly),{document,location:new URL(platform==='booth'?'https://accounts.booth.pm/library':'https://www.goofish.com/im'),URL,HTMLElement:Element,getComputedStyle:()=>({visibility:'visible',display:'block'})})));
}
const own='<nav><img src="https://booth.pximg.net/c/48x48/users/123/icon_image/fixture.jpg"></nav>';
const card=(id=456)=>`<div class="fixture-card"><div class="flex gap-8 border-b border-border300 pb-16"><a href="https://booth.pm/zh-cn/items/${id}"><img class="l-library-item-thumbnail"></a></div><div class="mt-16"><div class="whitespace-pre-line">Synthetic file</div><div class="js-download-button" data-href="https://booth.pm/downloadables/987" data-is-external="false"><button>Download</button></div></div></div>`;
test('verified BOOTH card recipe returns only item selection, never signed/direct download URL or fake time',()=>{
 const value=capture(own+'<main>'+card()+'</main>');assert.equal(value.supported,true);assert.equal(value.account,'booth-user:123');assert.equal(value.rows.length,1);assert.equal(value.rows[0].libraryItem,'456');assert.equal(value.rows[0].time,undefined);assert(!JSON.stringify(value).includes('downloadables'));
 const identity=capture(own+'<main>'+card()+'</main>','booth','foreground',true);assert.equal(identity.account,value.account);assert.deepEqual(identity.rows,[]);
});
test('seller avatar, recommended product and default/missing own account cannot qualify as owned purchase',()=>{
 for(const html of ['<main>'+own+card()+'</main>',own+'<main><a href="https://booth.pm/items/123">Recommendation</a></main>','<main>'+card()+'</main>',own+own+'<main>'+card()+'</main>'])assert.equal(capture(html).supported,false);
 const bad=card().replace('data-is-external="false"','data-is-external="true"');assert.equal(capture(own+'<main>'+bad+'</main>').supported,false);
});
test('BOOTH card scope never climbs to main or a wrapper containing multiple products',()=>{
 const bare=card().replace('<div class="fixture-card">','').replace(/<\/div>$/,'');
 assert.equal(capture(own+'<main>'+bare+'</main>').supported,false);
 assert.equal(capture(own+'<main><div>'+bare+bare.replace('/items/456','/items/999')+'</div></main>').supported,false);
 const good=capture(own+'<main>'+card(456)+card(999)+'</main>');assert.deepEqual(good.rows.map(r=>r.libraryItem),['456','999']);
});
const xown='<header><div class="user-order-container--fixture"><a href="/personal"><img src="https://img.alicdn.com/bao/uploaded/i1/private-mtopupload.jpg">Fixture account</a></div></header>';
test('Xianyu actual empty shell stays unsupported and default avatars do not create account identity',()=>{
 const shell='<aside class="conversation-list--fixture"><div class="conv-header--fixture">消息</div></aside><main class="chat-main--fixture"></main>';
 const s=capture(xown+shell,'xianyu');assert.equal(s.supported,false);assert(s.account.startsWith('xianyu-visible:'));assert.deepEqual(s.rows,[]);
 assert.equal(capture(xown.replace('/bao/uploaded/i1/private-mtopupload.jpg','/imgextra/login-icon.png')+shell,'xianyu').account,'');
});
test('semantic Xianyu preview stays within verified conversation roots and excludes composer content',()=>{
 const html=xown+'<a>https://pan.baidu.com/s/1OutsideLink</a><aside class="conversation-list--fixture"><div role="list"><div role="listitem" aria-label="未读消息"><time datetime="2026-10-24T11:30:00+08:00"></time>https://pan.baidu.com/s/1ScopedLink 提取码: Ab12</div><div role="listitem" aria-label="未读消息"><textarea>https://pan.baidu.com/s/1DraftLink</textarea></div></div></aside><main class="chat-main--fixture"></main>';
 const s=capture(html,'xianyu','background');assert.equal(s.supported,true);assert.equal(s.rows.length,1);assert(s.rows[0].text.includes('1ScopedLink'));assert.equal(s.rows[0].unread,true);assert(!JSON.stringify(s).includes('1OutsideLink'));assert(!JSON.stringify(s).includes('1DraftLink'));
});
