const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
process.env.NODE_ENV='test';
const {EnrichmentQueue}=require('../dist/main/main/online');
const {candidateScore,searchClue}=require('../dist/main/main/matching');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jzX8AAAAASUVORK5CYII=','base64');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const url=id=>'https://booth.pm/ja/items/'+id;
const html=body=>new Response(body,{headers:{'content-type':'text/html'}});
const product=(id,title,cover)=>'<script type="application/ld+json">'+JSON.stringify({'@type':'Product',url:url(id),name:title,brand:{name:'Shop'},...(cover?{image:cover}:{})})+'</script>';
const asset=(name,extra={})=>({id:'a',name,path:'E:\\VRChat\\fixture.zip',group:'Airi',kind:'archive',missing:false,size:10,mtimeMs:0,localCategory:'未分类',localAvatars:['Airi'],hintUrls:[],manual:{notes:'keep my notes',category:'饰品'},online:{status:'pending'},createdAt:'',updatedAt:'',...extra});
function setup(t,item,fetch){
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'vrc-matching-regression-'));
  const queue=new EnrichmentQueue({dataDir,roots:()=>['E:\\VRChat'],all:()=>[item],get:id=>id===item.id?item:null,updateOnline:(_id,patch)=>{item.online={...item.online,...patch};},fetch,testing:{intervalMs:0,lookup:async()=>['93.184.216.34']}});
  t.after(async()=>{queue.stop();await queue.waitIdle();fs.rmSync(dataDir,{recursive:true,force:true});});return queue;
}
async function idle(queue){for(let i=0;i<600&&queue.progress.running;i++)await wait(5);assert(!queue.progress.running,'queue must stop after bounded retry');await queue.waitIdle();}

test('candidate thumbnail 429 exhaustion preserves review and a preview-only retry can recover',async t=>{
  const item=asset('Different Product.zip'),originalManual=JSON.stringify(item.manual);let limit=true,pages=0,covers=0;
  const queue=setup(t,item,async target=>{if(target.includes('cdn.')){covers++;return limit?new Response('',{status:429,headers:{'retry-after':'0'}}):new Response(png,{headers:{'content-type':'image/png'}});}pages++;return html(product('1234567','Moon Dress','https://cdn.example.org/cover.png'));});
  await queue.linkSource('a',url('1234567'));await idle(queue);assert.equal(item.online.status,'review');assert.equal(item.online.candidates.length,1);assert.equal(item.online.candidates[0].title,'Moon Dress');assert.equal(item.online.coverFile,undefined);assert.equal(pages,1);assert.equal(covers,4);assert.equal(queue.progress.completed,1);assert.equal(JSON.stringify(item.manual),originalManual);
  limit=false;await queue.enqueueCandidateCovers(['a']);await idle(queue);assert.equal(item.online.status,'review');assert(item.online.candidates[0].coverFile);assert.equal(item.online.coverFile,undefined);assert.equal(pages,1,'preview recovery never restarts product discovery');assert.equal(queue.progress.completed,1);assert.equal(JSON.stringify(item.manual),originalManual);
});
test('unlabelled independent shallow packages never let the first search match the whole collection',async t=>{
  const item=asset('合集',{kind:'folder',localNameHints:['Moon Dress.zip','Star Dress.zip']});
  const queue=setup(t,item,async target=>{const star=target.includes('Star')||target.includes('7654321'),id=star?'7654321':'1234567',title=star?'Star Dress':'Moon Dress';return html(target.includes('/search/')?'<div class="item-card"><a class="item-card__title" href="/ja/items/'+id+'">'+title+'</a></div>':product(id,title));});
  await queue.enqueue();await idle(queue);assert.equal(item.online.status,'review');assert.equal(item.online.title,undefined);assert.equal(item.online.url,undefined);
});
test('embedded SKU differences survive cleanup while a genuine leading BOOTH ID can still be removed',()=>{
  assert.equal(searchClue('DressMaker1234567.zip').query,'DressMaker1234567');
  assert(candidateScore('DressMaker1234567.zip',{url:url('5555555'),title:'DressMaker7654321'})<.95);
  assert.equal(searchClue('7848881Somie.zip').query,'Somie');
});
test('a corresponding unique filename ID permits only a contained Japanese explanatory note difference',()=>{
  const local='6097412 【11アバター対応】Succubus Tattoo（タトゥー）';
  const remote={url:url('6097412'),title:'Succubus Tattoo（淫紋タトゥー）',author:'Shop'};
  assert.equal(candidateScore(local,remote),.97);
  assert.equal(candidateScore('6097412 Succubus Tattoo（淫紋タトゥー）', {...remote,title:'Succubus Tattoo（タトゥー）'}),.97);
  assert(candidateScore(local,{...remote,url:url('6097413')})<.95,'another item ID cannot relax annotation matching');
  assert(candidateScore(local,{...remote,url:'https://notbooth.pm/items/6097412'})<.95);
  assert(candidateScore('Succubus Tattoo（タトゥー）',remote)<.95,'a name-only match remains conservative');
  assert(candidateScore('6097412 1234567 Succubus Tattoo（タトゥー）',remote)<.95,'multiple filename IDs cannot choose one');
  assert.equal(candidateScore(local+'@Other',remote),0,'an explicit conflicting author remains a conflict');
  assert.equal(candidateScore(local+'@slug',{...remote,author:'Display Shop',authorAliases:['slug']}),.97);
});
test('Japanese-note relaxation preserves colors, models, numbers, English notes and different meanings',()=>{
  const remote={url:url('6097412'),title:'Succubus Tattoo（タトゥー）',author:'Shop'};
  for(const note of ['黒いタトゥー','ピンクタトゥー','大型タトゥー','タトゥー2','tattoo','メイク'])assert(candidateScore('6097412 Succubus Tattoo（'+note+'）',remote)<.95,note+' is a significant difference');
  assert(candidateScore('6097412 Succubus Tattoo Summer（淫紋タトゥー）',{...remote,title:'Succubus Tattoo Winter（タトゥー）'})<.95);
  assert(candidateScore('6097412 Moon（タトゥー）',{...remote,title:'Moon（淫紋タトゥー）'})<.95,'short/generic main names remain untrusted');
  assert(candidateScore('6097412 Succubus Tattoo（淫紋タトゥー）（メイク）',remote)<.95,'multiple annotation options remain significant');
});
test('the complete actual Succubus Tattoo wrappers retain the corresponding ID note score',()=>{
  const local='6097412 【11アバター対応】Succubus Tattoo（タトゥー）【テクスチャ素材】(Fullset)';
  const remote={url:url('6097412'),title:'【11アバター対応】Succubus Tattoo（淫紋タトゥー）【テクスチャ素材】',author:'Shop'};
  assert.equal(candidateScore(local,remote),.97);
  assert.equal(candidateScore(local+' (ver.1.2)',remote),.97,'explicit download/version labels do not become extra explanatory notes');
  assert(candidateScore(local,{...remote,url:url('6097413')})<.95,'complete wrappers do not relax another item ID');
  assert(candidateScore(local.replace('6097412 ',''),remote)<.95,'complete wrappers do not relax a name-only result');
  assert(candidateScore(local.replace('【テクスチャ素材】','【ブラック素材】'),remote)<.95,'unrecognized Japanese qualifiers remain significant');
  assert(candidateScore(local.replace('(Fullset)','(Black)'),remote)<.95,'English option labels are not download wrappers');
});
