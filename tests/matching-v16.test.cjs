const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
process.env.NODE_ENV='test';
const {searchClue,searchClues,candidateScore,fileVersion,extractBoothIds,MATCH_RULE_VERSION}=require('../dist/main/main/matching');
const {EnrichmentQueue}=require('../dist/main/main/online');
const url=id=>'https://booth.pm/ja/items/'+id;
const candidate=(title,author='Shop',extra={})=>({title,author,url:url('1234567'),...extra});
const asset=(name,extra={})=>({id:'a',name,path:'E:\\VRChat\\test-fixture.zip',group:'Kaguya',kind:'archive',missing:false,size:10,mtimeMs:1,localCategory:'未分类',localAvatars:[],hintUrls:[],manual:{notes:'保留人工备注'},online:{status:'pending'},createdAt:'',updatedAt:'',...extra});
const product=(id,title)=>'<script type="application/ld+json">'+JSON.stringify({'@type':'Product',url:url(id),name:title,brand:{name:'Shop',url:'https://shop.booth.pm/'}})+'</script>';
const card=(id,title)=>'<div class="item-card"><a class="item-card__title" href="/ja/items/'+id+'">'+title+'</a><a class="item-card__shop-name-anchor" href="https://shop.booth.pm/">Shop</a></div>';
function queueFixture(t,item,fetch){
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'vrc-matching-v16-')),calls=[],updates=[];
  const queue=new EnrichmentQueue({dataDir,roots:()=>['E:\\VRChat'],all:()=>[item],get:id=>id===item.id?item:null,updateOnline:(_id,patch)=>{updates.push(patch);item.online={...item.online,...patch};},fetch:async target=>{calls.push(target);return fetch(target);},testing:{intervalMs:0,lookup:async()=>['93.184.216.34']}});
  t.after(async()=>{queue.stop();await queue.waitIdle();fs.rmSync(dataDir,{recursive:true,force:true});});return {queue,calls,updates,item};
}
const html=value=>new Response(value,{headers:{'content-type':'text/html'}});

test('the exact observed comma-separated avatar prefix and dotted version retain Veil Breeze',()=>{
  const name='Kaguya,Mizuki,Rurune_Veil_Breeze_v.1.1.unitypackage';
  assert.equal(searchClue(name).query,'Veil Breeze');
  assert.equal(fileVersion(name),'1.1');
  assert.equal(candidateScore(name,candidate('Veil Breeze')),1);
  assert.equal(candidateScore(name,candidate('【Kaguya / Mizuki / Rurune対応】Veil Breeze v.1.2')),1);
  assert.equal(candidateScore(name,candidate('Veil Breeze Black')),.89);
});
test('multi-avatar suffixes, full-width aliases and explicit lists remain local variant clues',()=>{
  for(const name of ['Veil_Breeze_Kaguya,Mizuki,Rurune_v.1.1.zip','Ｋａｇｕｙａ，Ｍｉｚｕｋｉ，Ｒｕｒｕｎｅ＿Veil_Breeze_v.1.1.zip','カグヤ・瑞希・ルルネ_Veil_Breeze_v.1.1.zip','Kaguya + Mizuki + Rurune_Veil_Breeze.zip'])assert.equal(searchClue(name).query,'Veil Breeze',name);
  assert.equal(candidateScore('Veil Breeze for Kaguya, Mizuki & Rurune v.1.1.zip',candidate('Veil Breeze')),1);
});
test('unknown model prefixes, embedded avatar words and ordinary product-title prefixes stay significant',()=>{
  for(const name of ['Kaguyana,Mizuki,Rurune_Veil_Breeze.zip','OtherAvatar,Kaguya,Mizuki_Veil_Breeze.zip','Airi_Veil_Breeze.zip','Airi Veil Breeze.zip','Maya Moe Dress.zip']){
    assert(candidateScore(name,candidate(name.includes('Dress')?'Dress':'Veil Breeze'))<.95,name);
  }
  assert.equal(searchClue('Kaguya,Mizuki,Rurune_Veil_Breeze_Black.zip').query,'Veil Breeze Black');
  assert(candidateScore('Kaguya,Mizuki,Rurune_Veil_Breeze_Black.zip',candidate('Veil Breeze'))<.95);
  assert(candidateScore('Kaguya,Mizuki,Rurune.zip',candidate('Veil Breeze'))<.95);
});
test('a material companion has a useful base-name search clue but cannot automatically stand for that product',()=>{
  const name='Veil_Breeze_Materialpack_v.1.0.unitypackage';
  assert.equal(searchClue(name).query,'Veil Breeze Materialpack');
  assert.equal(fileVersion(name),'1.0');
  assert.deepEqual(searchClues(name).filter(clue=>!clue.author),[{query:'Veil Breeze Materialpack',author:undefined},{query:'Veil Breeze',author:undefined,requiresConfirmation:true}]);
  assert.equal(candidateScore(name,candidate('Veil Breeze')),.89);
  assert.equal(candidateScore(name,candidate('Veil Breeze Materialpack')),1);
  assert(candidateScore('Veil_Breeze.zip',candidate('Veil Breeze Materialpack'))<.95);
  assert.equal(searchClues('Glasspack.zip').length,1);
  assert.equal(searchClues('Veil Breeze Material Pack Black.zip').length,1);
});
test('dotted versions do not become authors and material hints cannot bypass an author conflict',()=>{
  assert.deepEqual(searchClue('Veil_Breeze@Shop_v.1.1.zip'),{query:'Veil Breeze',author:'Shop'});
  assert.equal(candidateScore('Veil_Breeze@Shop_v.1.1.zip',candidate('Veil Breeze')),1);
  assert.equal(candidateScore('Veil_Breeze_Materialpack@Shop_v.1.1.zip',candidate('Veil Breeze','Other')),0);
  assert(candidateScore('Maker_Veil_Breeze_Materialpack.zip',candidate('Veil Breeze','Other'))<.95);
  assert.equal(candidateScore('Maker_Veil_Breeze_Materialpack.zip',candidate('Veil Breeze','Shop',{authorAliases:['maker']})),.89);
});
test('the observed package searches the product name and records the current rule without sending avatar filenames',async t=>{
  const item=asset('Kaguya,Mizuki,Rurune_Veil_Breeze_v.1.1.unitypackage'),f=queueFixture(t,item,async target=>html(target.includes('/search/')?card('1234567','Veil Breeze'):product('1234567','Veil Breeze')));
  await f.queue.enqueue();await f.queue.waitIdle();
  assert.equal(item.online.status,'matched');assert.equal(item.online.title,'Veil Breeze');assert.equal(item.online.matchEvidence.ruleVersion,MATCH_RULE_VERSION);
  assert.equal(f.calls[0],'https://booth.pm/ja/search/Veil%20Breeze');assert(f.calls.every(target=>!target.includes('Kaguya')&&!target.includes('Mizuki')));
  assert.equal(item.manual.notes,'保留人工备注');
});
test('a material-only package finds the base product through a second search and still needs confirmation',async t=>{
  const item=asset('Veil_Breeze_Materialpack_v.1.0.unitypackage'),f=queueFixture(t,item,async target=>html(target.includes('Materialpack')?'':target.includes('/search/')?card('1234567','Veil Breeze'):product('1234567','Veil Breeze')));
  await f.queue.enqueue();await f.queue.waitIdle();
  assert.equal(item.online.status,'review');assert.equal(item.online.confirmedSource,undefined);assert.equal(item.online.url,undefined);assert.equal(item.online.candidates[0].title,'Veil Breeze');
  assert(f.calls.includes('https://booth.pm/ja/search/Veil%20Breeze'));assert(!f.updates.some(p=>p.status==='matched'));assert.equal(item.manual.notes,'保留人工备注');
});
test('the container with the observed full and material-only packages never silently adopts one child',async t=>{
  const item=asset('泳装',{kind:'folder',localNameHints:['Kaguya,Mizuki,Rurune_Veil_Breeze_v.1.1.unitypackage','Veil_Breeze_Materialpack_v.1.0.unitypackage']}),f=queueFixture(t,item,async target=>html(target.includes('/search/')?card('1234567','Veil Breeze'):product('1234567','Veil Breeze')));
  await f.queue.enqueue();await f.queue.waitIdle();
  assert.equal(item.online.status,'review');assert(item.online.message.includes('文件夹包含不同商品'));assert.equal(item.online.candidates[0].title,'Veil Breeze');assert(!f.updates.some(p=>p.status==='matched'));
});
test('direct IDs, ZAICRIFICE, CheriMeL and Rho regression identities remain supported',()=>{
  assert.deepEqual(extractBoothIds('5053741.zip'),['5053741']);
  assert.deepEqual(extractBoothIds('BCP-17 Rho 12345.zip'),[]);
  assert.equal(candidateScore('ZAICRIFICE_Y2K_Hair_Clips (1)',candidate('Y2K Hair Clips','Display',{authorAliases:['zaicrifice']})),1);
  assert(candidateScore('ZAICRIFICE_Y2K_Hair_Clips (1)',candidate('Y2K Hair Clips','Other'))<.95);
  assert.equal(candidateScore('CheriMeL@LOVACE_8492723.zip',candidate('CheriMeL','LOVACE')),1);
  assert.equal(candidateScore('BCP-17 Rho_Airi_v.1.0.zip',candidate('BCP-17 ✢ Rho')),1);
});
